/**
 * Vendors the sender service's Jinja2 render core into `public/py/` so the
 * browser preview runs the SAME code that sends the mail.
 *
 * Why a copy at all: the preview runs in the browser, and the browser cannot
 * import from a sibling git checkout. So a copy is unavoidable — what IS
 * avoidable is the copy silently drifting, which is exactly what happened to
 * the previous SendNotif preview (see the docstring on
 * `renderer.build_environment`). Hence the manifest: every synced file is
 * checksummed against its source, and `--check` fails the build when either
 * side moves.
 *
 * The source checkout is READ-ONLY. This script never writes outside `public/py/`.
 *
 *   node scripts/sync-render-core.mjs            # copy + write the manifest
 *   node scripts/sync-render-core.mjs --check    # verify, exit 1 on drift
 *
 * Point it at a checkout elsewhere with SENDER_REPO=/path/to/notifications-sender-service.
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SENDER_REPO = resolve(
  REPO_ROOT,
  process.env.SENDER_REPO ?? "../notifications-sender-service",
);

/**
 * `lambda/sender` is the source of truth, NOT `terraform/build/stage/render_core`
 * — that one is a build artifact carrying an older copy of the package plus
 * vendored wheels.
 */
const SOURCE_DIR = join(SENDER_REPO, "lambda", "sender");

const DEST_DIR = join(REPO_ROOT, "public", "py", "render_core");
const MANIFEST_PATH = join(REPO_ROOT, "public", "py", "render-core.manifest.json");

/**
 * The transitive import closure of `renderer.py`, verified module by module.
 * Everything else in `lambda/sender` (handler, mailer, store, deadletter) is
 * delivery machinery the preview must not drag in.
 *
 * All seven are stdlib + jinja2 only. `template_source` builds its boto3 client
 * lazily, so importing it under Pyodide costs nothing as long as
 * TEMPLATES_SOURCE stays "bundled" (its default in config.py).
 */
const MODULES = [
  "config.py",
  "errors.py",
  "messages.py",
  "renderer.py",
  "subjects.py",
  "template_resolver.py",
  "template_source.py",
];

const TEMPLATES_SUBDIR = "templates";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/**
 * The versions the Lambda actually renders with. Pyodide ships its own Jinja2
 * build, so the worker compares these at startup: a patch difference is
 * tolerable, a minor one means the preview and the send path can disagree and
 * the author deserves to be told rather than trusting a green preview.
 */
function readPins() {
  const path = join(SOURCE_DIR, "requirements.txt");
  if (!existsSync(path)) return {};
  const pins = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*==\s*([0-9][^\s#]*)/.exec(line);
    if (match) pins[match[1].toLowerCase()] = match[2];
  }
  // Only the two that shape rendering; pymongo/dnspython are delivery concerns.
  return { jinja2: pins.jinja2, markupsafe: pins.markupsafe };
}

/** Manifest keys are posix-style so a Windows sync and a Linux CI check agree. */
const toKey = (from, path) => relative(from, path).split(sep).join(posix.sep);

function listTemplates(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".j2")) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Every file the sync covers, as manifest-key -> absolute source path. */
function sourceFiles() {
  const files = new Map();
  for (const name of MODULES) files.set(name, join(SOURCE_DIR, name));

  const templatesRoot = join(SOURCE_DIR, TEMPLATES_SUBDIR);
  for (const path of listTemplates(templatesRoot)) {
    files.set(
      posix.join(TEMPLATES_SUBDIR, toKey(templatesRoot, path)),
      path,
    );
  }
  return files;
}

function hashAll(files) {
  const hashes = {};
  for (const [key, path] of files) hashes[key] = sha256(readFileSync(path));
  return hashes;
}

export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

export function senderRepoAvailable() {
  return existsSync(SOURCE_DIR);
}

/** Hashes of the SOURCE checkout. Throws when the checkout is missing. */
export function hashSource() {
  if (!senderRepoAvailable()) {
    throw new Error(
      `sender checkout not found at ${SOURCE_DIR}. ` +
        `Set SENDER_REPO to the notifications-sender-service path.`,
    );
  }
  return hashAll(sourceFiles());
}

/** Hashes of the vendored copy under `public/py/render_core`. */
export function hashVendored() {
  if (!existsSync(DEST_DIR)) return {};
  const files = new Map();
  for (const name of MODULES) {
    const path = join(DEST_DIR, name);
    if (existsSync(path)) files.set(name, path);
  }
  const templatesRoot = join(DEST_DIR, TEMPLATES_SUBDIR);
  if (existsSync(templatesRoot)) {
    for (const path of listTemplates(templatesRoot)) {
      files.set(posix.join(TEMPLATES_SUBDIR, toKey(templatesRoot, path)), path);
    }
  }
  return hashAll(files);
}

/** Returns the keys that differ between two hash maps, in a readable shape. */
export function diffHashes(expected, actual) {
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const changed = [];
  for (const key of keys) {
    if (expected[key] === actual[key]) continue;
    if (!(key in actual)) changed.push({ key, reason: "missing" });
    else if (!(key in expected)) changed.push({ key, reason: "unexpected" });
    else changed.push({ key, reason: "modified" });
  }
  return changed;
}

function sync() {
  const files = sourceFiles();

  // Wipe first: a template deleted upstream must disappear here too, otherwise
  // the preview keeps resolving a name production no longer has.
  rmSync(DEST_DIR, { recursive: true, force: true });
  // Running CPython against public/py (the verification harness does) drops
  // bytecode that vite would copy straight into the bundle.
  rmSync(join(REPO_ROOT, "public", "py", "__pycache__"), {
    recursive: true,
    force: true,
  });
  mkdirSync(join(DEST_DIR, TEMPLATES_SUBDIR), { recursive: true });

  for (const [key, path] of files) {
    const dest = join(DEST_DIR, key.split(posix.sep).join(sep));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(path, dest);
  }

  const manifest = {
    // Read by the preview worker to invalidate its Pyodide filesystem cache.
    syncedAt: new Date().toISOString(),
    source: "notifications-sender-service/lambda/sender",
    note:
      "Generated by scripts/sync-render-core.mjs. Do not edit these files here " +
      "— fix them in the sender repo and re-run the sync.",
    pins: readPins(),
    files: hashAll(files),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  const templateCount = [...files.keys()].filter((k) =>
    k.startsWith(`${TEMPLATES_SUBDIR}/`),
  ).length;
  console.log(
    `synced ${MODULES.length} modules + ${templateCount} templates from ${SOURCE_DIR}`,
  );
  console.log(`manifest: ${toKey(REPO_ROOT, MANIFEST_PATH)}`);
}

function check() {
  const manifest = readManifest();
  if (!manifest) {
    console.error("no manifest found. Run: npm run sync:render-core");
    process.exit(1);
  }

  const vendoredDiff = diffHashes(manifest.files, hashVendored());
  if (vendoredDiff.length) {
    console.error("vendored copy does not match the manifest:");
    for (const { key, reason } of vendoredDiff) console.error(`  ${reason}: ${key}`);
    console.error("\nThe copy under public/py/render_core is generated. Re-run the sync.");
    process.exit(1);
  }

  if (!senderRepoAvailable()) {
    console.log(
      `vendored copy matches the manifest. Sender checkout not found at ` +
        `${SOURCE_DIR}, so upstream drift was NOT checked.`,
    );
    return;
  }

  const sourceDiff = diffHashes(manifest.files, hashSource());
  if (sourceDiff.length) {
    console.error("the sender repo has moved since the last sync:");
    for (const { key, reason } of sourceDiff) console.error(`  ${reason}: ${key}`);
    console.error(
      "\nThe preview would render with stale code. Run: npm run sync:render-core",
    );
    process.exit(1);
  }

  console.log("render core is in sync with the sender repo.");
}

export const paths = { REPO_ROOT, SENDER_REPO, SOURCE_DIR, DEST_DIR, MANIFEST_PATH };

// Only act when executed directly; the test imports the helpers above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(SENDER_REPO) && !process.argv.includes("--check")) {
    console.error(`sender checkout not found at ${SENDER_REPO}.`);
    console.error("Set SENDER_REPO to the notifications-sender-service path.");
    process.exit(1);
  }
  if (process.argv.includes("--check")) check();
  else sync();
}
