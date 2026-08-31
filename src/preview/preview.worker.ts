/// <reference lib="webworker" />
//
// Runs the sender's Jinja2 render core in the browser, off the main thread.
//
// Pyodide boots a full CPython in WebAssembly: ~14 MB and a couple of seconds
// the first time. On the main thread that would freeze the editor while someone
// is typing, which is why this is a worker and why the client keeps exactly one
// of them alive for the session.
//
// What gets loaded is a VENDORED COPY of `notifications-sender-service`, staged
// by scripts/sync-render-core.mjs and checksummed against its source by
// scripts/sync-render-core.test.mjs. Nothing here reimplements rendering — the
// filters, the undefined policy and the layout all come from that copy.
import { loadPyodide, type PyodideInterface } from "pyodide";
import type {
  CatalogueResult,
  EngineInfo,
  RenderResult,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

/** Where the interpreter and wheels were staged. See scripts/setup-pyodide.mjs. */
const PYODIDE_URL = new URL("/pyodide/", self.location.origin).href;

/** Where the vendored render core lives. See scripts/sync-render-core.mjs. */
const PY_ROOT = "/py";

/** Mount point inside Pyodide's virtual filesystem. */
const FS_ROOT = "/render_core";

interface Manifest {
  syncedAt: string;
  pins: { jinja2?: string; markupsafe?: string };
  files: Record<string, string>;
}

let ready: Promise<{ pyodide: PyodideInterface; info: EngineInfo }> | null = null;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.text();
}

/** "3.1.6" vs "3.1.4" is fine; "3.2.0" vs "3.1.4" is not. */
function differsBeyondPatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const [aMajor, aMinor] = a.split(".");
  const [bMajor, bMinor] = b.split(".");
  return aMajor !== bMajor || aMinor !== bMinor;
}

async function boot() {
  const pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
  await pyodide.loadPackage("jinja2");

  const manifest = JSON.parse(
    await fetchText(`${PY_ROOT}/render-core.manifest.json`),
  ) as Manifest;

  // The vendored modules use flat imports (`import config`), exactly as the
  // Lambda does, so their directory goes on sys.path rather than being a
  // package. Same trick as pyproject's pytest pythonpath in the sender repo.
  pyodide.FS.mkdirTree(FS_ROOT);
  pyodide.FS.mkdirTree(`${FS_ROOT}/templates`);

  // The manifest is the file list, so a template added upstream needs no change
  // here — it is synced, listed, and then mounted.
  const entries = Object.keys(manifest.files);
  const contents = await Promise.all(
    entries.map((name) => fetchText(`${PY_ROOT}/render_core/${name}`)),
  );
  entries.forEach((name, index) => {
    const path = `${FS_ROOT}/${name}`;
    const dir = path.slice(0, path.lastIndexOf("/"));
    pyodide.FS.mkdirTree(dir);
    pyodide.FS.writeFile(path, contents[index], { encoding: "utf8" });
  });

  // Our own two modules sit beside the vendored copy, not inside it: the
  // checksum guard would flag a foreign file under render_core/.
  for (const name of ["shape_extractor.py", "preview_api.py"]) {
    pyodide.FS.writeFile(`/${name}`, await fetchText(`${PY_ROOT}/${name}`), {
      encoding: "utf8",
    });
  }

  pyodide.runPython(`
import sys
sys.path.insert(0, "${FS_ROOT}")
sys.path.insert(0, "/")
import preview_api
preview_api.configure("${FS_ROOT}/templates")
`);

  const raw = JSON.parse(
    pyodide.runPython("import preview_api; preview_api.runtime_info()") as string,
  ) as {
    jinja2: string;
    customFilters: string[];
    undefined: string;
    autoescape: boolean;
  };

  const pinned = manifest.pins?.jinja2 ?? null;
  const info: EngineInfo = {
    jinja2: raw.jinja2,
    jinja2Pinned: pinned,
    versionMismatch: differsBeyondPatch(raw.jinja2, pinned),
    customFilters: raw.customFilters,
    undefined: raw.undefined,
    autoescape: raw.autoescape,
    syncedAt: manifest.syncedAt ?? null,
  };

  return { pyodide, info };
}

function engine() {
  // Booting is idempotent and shared: several panels may ask at once on the
  // first paint, and starting two interpreters would double a 14 MB cost.
  ready ??= boot();
  return ready;
}

/**
 * Calls a preview_api function that returns a JSON string.
 *
 * Arguments cross as one JSON string rather than being spliced into the Python
 * source: one of them is an author's HTML, and any quote or backslash in it
 * would otherwise break the statement — or worse, run as code. JSON also keeps
 * both directions free of PyProxy lifetimes to manage.
 */
function callJson<T>(pyodide: PyodideInterface, fn: string, args: unknown[]): T {
  pyodide.globals.set("__args_json", JSON.stringify(args));
  try {
    const json = pyodide.runPython(
      `import preview_api, json; preview_api.${fn}(*json.loads(__args_json))`,
    ) as string;
    return JSON.parse(json) as T;
  } finally {
    pyodide.globals.delete("__args_json");
  }
}

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  const { id } = request;
  try {
    const { pyodide, info } = await engine();

    if (request.type === "init") {
      return { id, ok: true, type: "init", result: info };
    }
    if (request.type === "catalogue") {
      return {
        id,
        ok: true,
        type: "catalogue",
        result: callJson<CatalogueResult>(pyodide, "catalogue", [
          request.action,
          request.actionType,
          request.variant,
        ]),
      };
    }
    return {
      id,
      ok: true,
      type: "render",
      result: callJson<RenderResult>(pyodide, "render_draft", [
        request.action,
        request.actionType,
        request.html,
        request.subject ?? null,
        request.variant,
      ]),
    };
  } catch (error) {
    // A failure here is the ENGINE failing, not the template: Pyodide did not
    // come up, or an asset 404'd. Template problems come back as ok:false
    // results, not exceptions.
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void handle(event.data).then((response) => self.postMessage(response));
});
