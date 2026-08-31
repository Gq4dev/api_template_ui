// The wire format between the app and the preview worker.
//
// Kept in its own module because both sides import it and neither should own
// it: the worker cannot import React-land code, and the client must not reach
// into worker internals.

export type PreviewVariant = "single" | "multi";

/** Why a preview could not be produced. Each kind is actionable on its own. */
export type PreviewFailureKind =
  /** The draft does not parse. Carries a line number. */
  | "SYNTAX"
  /** `{% extends %}` / `{% include %}` names a template that does not exist. */
  | "TEMPLATE_NOT_FOUND"
  /** It parsed and then blew up while rendering. */
  | "RENDER"
  /** Pyodide itself failed to come up — nothing to do with the template. */
  | "ENGINE";

export interface PreviewProblem {
  kind: PreviewFailureKind | "INVALID_ACTION";
  message: string;
  line?: number;
  code?: string | null;
}

export interface RenderRequest {
  action: string;
  actionType: string;
  html: string;
  subject?: string;
  variant: PreviewVariant;
}

export interface RenderSuccess {
  ok: true;
  action: string;
  variant: PreviewVariant;
  html: string;
  subject: string | null;
  subjectProblem: PreviewProblem | null;
  variables: string[];
  sample: Record<string, unknown>;
  /** Non-empty only when the vendored render core is out of sync. */
  unknownFilters: string[];
  /** Set when the action maps to no bundled template; the draft still rendered. */
  actionProblem: PreviewProblem | null;
  template: string | null;
}

export interface RenderFailure extends PreviewProblem {
  ok: false;
  kind: PreviewFailureKind;
}

export type RenderResult = RenderSuccess | RenderFailure;

/** What an action provides, replacing the removed `GET /contract`. */
export interface CatalogueResult {
  action: string;
  variant: PreviewVariant;
  template: string | null;
  known: boolean;
  problem: PreviewProblem | null;
  variables: string[];
  context: Record<string, unknown>;
}

export interface EngineInfo {
  /** Jinja2 version actually running in the browser. */
  jinja2: string;
  /** Jinja2 version the sender Lambda pins, from the sync manifest. */
  jinja2Pinned: string | null;
  /**
   * True when the two differ by more than a patch release. A patch gap is
   * tolerable; a minor one means the preview and the send path can disagree,
   * and the author is entitled to know before they publish.
   */
  versionMismatch: boolean;
  customFilters: string[];
  undefined: string;
  autoescape: boolean;
  syncedAt: string | null;
}

// --- messages ---------------------------------------------------------

export type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "catalogue"; action: string; actionType: string; variant: PreviewVariant }
  | ({ id: number; type: "render" } & RenderRequest);

export type WorkerResponse =
  | { id: number; ok: true; type: "init"; result: EngineInfo }
  | { id: number; ok: true; type: "catalogue"; result: CatalogueResult }
  | { id: number; ok: true; type: "render"; result: RenderResult }
  | { id: number; ok: false; error: string };
