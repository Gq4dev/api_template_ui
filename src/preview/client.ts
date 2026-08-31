// The main-thread half of the preview engine.
//
// One worker per session, created lazily. Pyodide costs ~14 MB and a couple of
// seconds to boot, so the instance is shared by every panel that needs it and
// nothing tears it down between renders.
import type {
  CatalogueResult,
  EngineInfo,
  PreviewVariant,
  RenderRequest,
  RenderResult,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

/** Raised when the ENGINE fails — Pyodide did not boot, an asset 404'd. */
export class PreviewEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewEngineError";
  }
}

type Pending = {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
};

/**
 * `Omit` collapses a union into its common members, which would drop every
 * message-specific field. The conditional makes it distribute over each member.
 */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./preview.worker.ts", import.meta.url), {
    type: "module",
  });

  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) entry.resolve(response.result as never);
    else entry.reject(new PreviewEngineError(response.error));
  });

  worker.addEventListener("error", (event) => {
    // The worker died. Every in-flight call is unanswerable, and a new worker
    // is created on the next request rather than leaving a dead handle around.
    const error = new PreviewEngineError(
      event.message || "the preview engine stopped unexpectedly",
    );
    for (const [, entry] of pending) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  });

  return worker;
}

function send<T>(request: WithoutId<WorkerRequest>): Promise<T> {
  const id = nextId++;
  const instance = ensureWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: never) => void, reject });
    instance.postMessage({ ...request, id } as WorkerRequest);
  });
}

/** Boots the engine and reports what it is running. Safe to call repeatedly. */
export function initPreviewEngine(): Promise<EngineInfo> {
  return send<EngineInfo>({ type: "init" });
}

/** What an action provides — the replacement for the removed `GET /contract`. */
export function fetchCatalogue(
  action: string,
  actionType: string,
  variant: PreviewVariant = "single",
): Promise<CatalogueResult> {
  return send<CatalogueResult>({ type: "catalogue", action, actionType, variant });
}

/** Renders a draft. Template problems come back as `ok: false`, not as throws. */
export function renderDraft(request: RenderRequest): Promise<RenderResult> {
  return send<RenderResult>({ type: "render", ...request });
}

/** Test seam: drops the worker so the next call boots a fresh one. */
export function resetPreviewEngine(): void {
  worker?.terminate();
  worker = null;
  pending.clear();
}
