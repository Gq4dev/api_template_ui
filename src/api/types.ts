// TypeScript models mirroring the backend DTOs exactly.
// Source of truth: api-template/docs/INTEGRATION.md + API.md (verbatim).
// Instants are ISO-8601 strings over the wire.

// Shared enum — the version lifecycle status. A version takes effect at
// creation: there is no DRAFT and no publish step. Status is ACTIVE (now/past
// effectiveFrom) or SCHEDULED (future effectiveFrom); ARCHIVED is terminal.
export type TemplateStatus = "SCHEDULED" | "ACTIVE" | "ARCHIVED";

// ---- Admin: create / commit ----
export interface CreateTemplateRequest {
  action: string; // e.g. "ORDER"
  actionType: string; // e.g. "CREATED"
  templateKey?: string; // derived from action+actionType when omitted
  html: string; // full HTML body
  subject?: string; // may contain {{placeholders}}
  variables?: string[]; // auto-derived from HTML when omitted
  effectiveFrom?: string; // ISO-8601; decides SCHEDULED (future) vs ACTIVE (now/past)
  effectiveTo?: string; // ISO-8601
}

export interface CreateTemplateResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus; // ACTIVE or SCHEDULED on creation
  s3Key: string;
  checksum: string; // e.g. "sha256:ab12..."
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
  effectiveFrom?: string; // ISO-8601; decides SCHEDULED vs ACTIVE
  effectiveTo?: string; // ISO-8601
}

// ---- Admin: archive ----
export interface VersionStatusResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  effectiveFrom: string | null;
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

// ---- Read: resolve-by-action (with html) ----
export interface TemplateContentResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  subject: string | null;
  variables: string[];
  html: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

// ---- Preview ----
// Rendered by the validation service through the PRODUCTION Jinja2 environment,
// so a field that will arrive empty is shown empty. This is what the recipient
// gets; it is not a validity check. Publishing is gated by create, which
// validates strictly and rejects a template with a missing field.
export interface PreviewRequest {
  action: string;
  actionType: string;
  /** The draft being edited. Omit to render the stored effective version. */
  html?: string;
  /** May contain Jinja of its own; comes back rendered. */
  subject?: string;
  /** "single" or "multi". Defaults to "single" server-side. */
  variant?: PreviewVariant;
  /** Shallow overrides on the sample context, to preview your own wording. */
  data?: Record<string, unknown>;
}

export type PreviewVariant = "single" | "multi";

export interface PreviewResponse {
  action: string;
  variant: PreviewVariant;
  subject: string | null;
  html: string;
}

// ---- Contract: the variables an action actually provides ----
// Computed from the renderer's own context rather than parsed out of the
// template text, so it cannot disagree with what sending will supply.
export interface ContractResponse {
  action: string;
  variant: PreviewVariant;
  /** The leaf template this action maps to, e.g. "payment_rejected.html.j2". */
  template: string;
  variables: string[];
  /** Sample values, so the UI can show what each variable will look like. */
  context: Record<string, unknown>;
}

// ---- Error envelope (all non-2xx) ----
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
  | "INVALID_STATE_TRANSITION"
  // 503. The API refuses to store a template it could not validate, so writes
  // fail closed when the validation service is down. Distinct from a network
  // failure: the API answered, it just cannot vouch for the content.
  | "VALIDATOR_UNAVAILABLE";

export interface ApiErrorBody {
  error: ApiErrorCode;
  details?: string[]; // present on VALIDATION_ERROR
  from?: TemplateStatus; // present on INVALID_STATE_TRANSITION
  to?: TemplateStatus;
}
