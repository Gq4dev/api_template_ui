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
  status?: TemplateStatus;
  page?: number; // 0-based
  size?: number;
  sort?: string; // e.g. "createdAt,desc"
}

// ---- Read: resolve ----
export interface ResolveResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  s3Key: string;
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
  subject: string | null;
  variables: string[];
  html: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
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
