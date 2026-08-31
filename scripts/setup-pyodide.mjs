/**
 * Stages the Pyodide runtime and the wheels the preview needs under
 * `public/pyodide/`, so the browser resolves everything from our own origin.
 *
 * The npm package ships the interpreter but no wheels — `loadPackage("jinja2")`
 * would otherwise reach out to the jsdelivr CDN on first use. That is a runtime
 * network dependency on a third party for a tool whose whole point is telling an
 * author whether a template is safe to publish, so the wheels are fetched once,
 * here, and served locally afterwards.
 *
 *   node scripts/setup-pyodide.mjs           # stage (skips what is already there)
 *   node scripts/setup-pyodide.mjs --force   # re-stage from scratch
 *
 * The output is generated and gitignored. Run it after `npm install`.
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(REPO_ROOT, "public", "pyodide");

const require = createRequire(import.meta.url);
const PYODIDE_DIR = dirname(require.resolve("pyodide/package.json"));
const VERSION = require("pyodide/package.json").version;
const LOCK = require("pyodide/pyodide-lock.json");

const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full`;

/**
 * What the interpreter itself needs. The `.map` files and the bundled console
 * demos are deliberately left out — they are megabytes of nothing for us.
 */
const RUNTIME_FILES = [
  "pyodide.asm.js",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide.mjs",
  "pyodide.js",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

/** Only jinja2 is asked for; its dependency closure comes from the lock file. */
const WANTED = ["jinja2"];

/** Walks pyodide-lock.json to the full set of packages a request pulls in. */
function resolveClosure(names) {
  const byName = new Map(
    Object.values(LOCK.packages).map((pkg) => [pkg.name.toLowerCase(), pkg]),
  );
  const seen = new Set();
  const out = [];
  const visit = (name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const pkg = byName.get(key);
    if (!pkg) throw new Error(`package "${name}" is not in pyodide-lock.json`);
    out.push(pkg);
    for (const dep of pkg.depends ?? []) visit(dep);
  };
  for (const name of names) visit(name);
  return out;
}

async function download(fileName) {
  const dest = join(DEST, fileName);
  if (existsSync(dest)) return false;
  const url = `${CDN}/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
  }
  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function main() {
  if (process.argv.includes("--force")) rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });

  for (const name of RUNTIME_FILES) {
    const from = join(PYODIDE_DIR, name);
    if (!existsSync(from)) continue;      // the package drops files across versions
    cpSync(from, join(DEST, name));
  }

  const packages = resolveClosure(WANTED);
  let fetched = 0;
  for (const pkg of packages) {
    if (await download(pkg.file_name)) fetched += 1;
  }

  // Recorded so the worker can assert it is talking to the runtime it expects
  // instead of a half-staged directory left by an interrupted run.
  writeFileSync(
    join(DEST, "staged.json"),
    `${JSON.stringify(
      {
        pyodide: VERSION,
        python: LOCK.info?.python,
        packages: Object.fromEntries(packages.map((p) => [p.name, p.version])),
      },
      null,
      2,
    )}\n`,
  );

  const summary = packages.map((p) => `${p.name}@${p.version}`).join(", ");
  console.log(`pyodide ${VERSION} staged in public/pyodide`);
  console.log(`packages: ${summary} (${fetched} downloaded, ${packages.length - fetched} cached)`);
}

main().catch((error) => {
  console.error(`setup-pyodide failed: ${error.message}`);
  process.exit(1);
});
