// TypeScript models mirroring the backend DTOs exactly.
// Source of truth: api-template/docs/INTEGRATION.md + API.md (verbatim).
// Instants are ISO-8601 strings over the wire.

// Shared enum — the version lifecycle status. Authoring and publishing are
// separate acts: a version is created DRAFT (stored, editable, and NEVER
// servable), and only reaches customers once published — ACTIVE (now/past
// effectiveFrom) or SCHEDULED (future). ARCHIVED is terminal.
export type TemplateStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ARCHIVED";

// ---- Admin: create / commit ----
// No effective dates: creating never publishes. The backend REJECTS
// effectiveFrom/effectiveTo here with a 400 rather than ignoring them, so this
// omission is part of the contract, not a convenience.
export interface CreateTemplateRequest {
  action: string; // e.g. "ORDER"
  actionType: string; // e.g. "CREATED"
  templateKey?: string; // derived from action+actionType when omitted
  html: string; // full HTML body
  subject?: string; // may contain {{placeholders}}
  variables?: string[]; // auto-derived from HTML when omitted
  // Optional per-client OVERRIDE, not a third part of the identity. With it the
  // derived key gains a `__collector` suffix and the version only reaches that
  // client; without it this is the generic template every client falls back to.
  // Omitted entirely when blank — an empty string is not "the generic", it is a
  // collector whose name is empty, and the server would have to guess which was
  // meant.
  collector?: string;
}

export interface CreateTemplateResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus; // always DRAFT from create/commit/updateDraft
  s3Key: string;
  checksum: string; // e.g. "sha256:ab12..."
}

// ---- Admin: edit a draft in place ----
// Same version number, same s3Key, new checksum. This is the authoring "save".
// 409 VERSION_NOT_EDITABLE once the version is published.
export interface UpdateDraftRequest {
  html: string;
  subject?: string;
  variables?: string[];
}

// ---- Admin: publish ----
// The only call that makes a version reachable by the send path. Every field is
// optional; an empty body means "live now".
export interface PublishRequest {
  effectiveFrom?: string; // ISO-8601; omitted → now (ACTIVE); future → SCHEDULED
  effectiveTo?: string; // ISO-8601; must be after effectiveFrom
}

// ---- Admin: upload-url (Mode B) ----
export interface UploadUrlRequest {
  templateKey: string;
}
export interface UploadUrlResponse {
  uploadUrl: string; // presigned S3 URL — PUT the HTML here
  s3Key: string;
  expiresIn: number; // seconds
}
export interface CommitRequest {
  action: string;
  actionType: string;
  templateKey: string;
  s3Key: string; // the s3Key returned by upload-url
  variables?: string[];
  subject?: string;
  // Same override semantics as on create. Mode B commits the SAME kind of
  // version as Mode A does, so leaving it off here would make the upload path
  // quietly incapable of authoring a collector variant.
  collector?: string;
}

// ---- Admin: publish / archive ----
export interface VersionStatusResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  effectiveFrom: string | null; // null while DRAFT — a draft has no vigency at all
  effectiveTo: string | null;
}

// ---- Read: list ----
export interface TemplateSummary {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  action: string;
  actionType: string;
  // null on a generic row — the template every client gets when they have no
  // variant of their own. Nullable rather than optional because the server
  // always sends the field; the absence of a collector is stated, not implied.
  collector: string | null;
  subject: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PageResponse<T> {
  content: T[];
  page: number; // 0-based
  size: number;
  totalElements: number;
  totalPages: number;
}

// Query params accepted by GET /api/v1/templates. All optional; only the set
// fields are serialized into the query string.
export interface ListTemplatesParams {
  action?: string;
  actionType?: string;
  templateKey?: string;
  // Partial match, case-insensitive — same contract as the other text filters,
  // so "bbv" finds bbva. Absent means "no collector filter", which is NOT the
  // same as "only generic rows": there is no way to ask for generics alone.
  collector?: string;
  status?: TemplateStatus;
  page?: number; // 0-based
  size?: number;
  sort?: string; // e.g. "createdAt,desc"
}

// ---- Read: resolve ----
//
// Note what is NOT here: `fallbackToGeneric`. This is `GET /{templateKey}/resolve`,
// which addresses a variant by a key that ALREADY contains the collector — ask
// for `payment_approved__bbva` and you either get a version of that key or a
// 404. There is no generic to fall back to, because you did not ask a question
// that has two possible answers. A field that could only ever be `false` would
// be noise, and worse: it would invite a reader to check it here and conclude
// that fallback had been ruled out, when in fact it was never on the table.
// Only `GET /resolve` (by action) can report a fallback, and only that response
// type carries the flag.
export interface ResolveResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  s3Key: string;
  // Echoed back so the caller can render what it got without re-parsing the
  // templateKey it sent. null when the key addressed a generic template.
  collector: string | null;
  subject: string | null;
  variables: string[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

// ---- Read: resolve-by-action, and the addressed single-version read ----
// Carries action/actionType because the addressed read is reached by
// templateKey + version, and the caller still needs the action to ask for the
// variable catalogue or to preview the content it just fetched.
export interface TemplateContentResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  action: string;
  actionType: string;
  // The collector of the version ACTUALLY SERVED, which is not necessarily the
  // one that was asked for — see fallbackToGeneric below.
  collector: string | null;
  subject: string | null;
  variables: string[];
  html: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /**
   * True when a collector WAS requested and had no servable version, so the
   * generic was served instead. Only `GET /resolve` (by action) can set it: it
   * is the one call that asks a question with two possible answers.
   *
   * "Servable" means published AND inside its effectivity window. A variant
   * that is DRAFT, archived, or scheduled for next month is not servable, and
   * asking for it falls back just as silently as asking for one that was never
   * authored — which is exactly why the flag has to be surfaced loudly. An
   * operator looking at the generic while believing they are looking at
   * Santander's variant will go and fix the wrong document.
   */
  fallbackToGeneric: boolean;
}

// Preview and contract types used to live here. They described two endpoints
// the API no longer has — it stores templates and decides which version is
// live, and does not parse, render or validate them. Their replacements are not
// API types at all: see src/preview/protocol.ts.

// ---- Error envelope (all non-2xx) ----
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
  | "INVALID_STATE_TRANSITION"
  // 409. Editing content on a version that is already published. Its bytes are
  // frozen because something may already have been sent with them.
  | "VERSION_NOT_EDITABLE"
  // 503. The API refuses to store a template it could not validate, so writes
  // fail closed when the validation service is down. Distinct from a network
  // failure: the API answered, it just cannot vouch for the content.
  | "VALIDATOR_UNAVAILABLE";

export interface ApiErrorBody {
  error: ApiErrorCode;
  details?: string[]; // present on VALIDATION_ERROR and VERSION_NOT_EDITABLE
  from?: TemplateStatus; // present on INVALID_STATE_TRANSITION
  to?: TemplateStatus;
}
