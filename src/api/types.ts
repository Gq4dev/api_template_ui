// TypeScript models mirroring the backend DTOs exactly.
// Source of truth: api-template/docs/INTEGRATION.md §5 (verbatim).
// Instants are ISO-8601 strings over the wire.

// Shared enum — the version lifecycle status.
export type TemplateStatus = "DRAFT" | "SCHEDULED" | "ACTIVE" | "ARCHIVED";

// ---- Admin: create / commit ----
export interface CreateTemplateRequest {
  action: string; // e.g. "ORDER"
  actionType: string; // e.g. "CREATED"
  templateKey?: string; // derived from action+actionType when omitted
  html: string; // full HTML body
  subject?: string; // may contain {{placeholders}}
  variables?: string[]; // auto-derived from HTML when omitted
  effectiveFrom?: string; // ISO-8601; optional at create, required to publish
  effectiveTo?: string; // ISO-8601
}

export interface CreateTemplateResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus; // "DRAFT" on creation
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
}

// ---- Admin: publish / archive ----
export interface PublishRequest {
  effectiveFrom: string; // ISO-8601, required — decides SCHEDULED vs ACTIVE
  effectiveTo?: string; // ISO-8601, must be after effectiveFrom
}
export interface VersionStatusResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
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

// ---- Read: render / preview ----
export interface RenderRequest {
  data?: Record<string, unknown>; // variable bindings; absent → empty context
}
export interface RenderResponse {
  templateKey: string;
  version: number;
  status: TemplateStatus;
  subject: string | null;
  html: string;
}

// ---- Error envelope (all non-2xx) ----
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
  | "INVALID_STATE_TRANSITION";

export interface ApiErrorBody {
  error: ApiErrorCode;
  details?: string[]; // present on VALIDATION_ERROR
  from?: TemplateStatus; // present on INVALID_STATE_TRANSITION
  to?: TemplateStatus;
}
