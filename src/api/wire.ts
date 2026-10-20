// The wire contract, and the only place that knows it is snake_case.
//
// notification-template-service speaks snake_case everywhere — JSON bodies,
// query parameters, path variables — while everything from `api/types.ts`
// inward is camelCase. The translation happens here, once, in both directions,
// so a feature never sees `action_type` and a request never leaves with
// `actionType` (which the server would not reject: it would silently drop the
// field and answer a different question).
//
// EXPLICIT MAPPERS, NOT A RECURSIVE KEY CONVERTER. A generic snake↔camel walk
// would be shorter, but it would type every response as whatever we cast it to:
// a field the server renames would arrive as `undefined` under a type that
// promises a string, and nothing would fail until a screen rendered blank.
// Written out, each wire type is checked against its domain type by the
// compiler, and a contract change is a compile error in exactly one function.
// Source of truth: the service's /v3/api-docs.
import type {
  CommitRequest,
  CreateTemplateRequest,
  CreateTemplateResponse,
  ListTemplatesParams,
  PageResponse,
  PublishRequest,
  ResolveResponse,
  TemplateContentResponse,
  TemplateStatus,
  TemplateSummary,
  UpdateDraftRequest,
  UploadUrlRequest,
  UploadUrlResponse,
  VersionStatusResponse,
} from "./types";

// ---- Responses ----

export interface WireCreateTemplateResult {
  template_key: string;
  version: number;
  status: TemplateStatus;
  s3_key: string;
  checksum: string;
}

export interface WireVersionStatusResult {
  template_key: string;
  version: number;
  status: TemplateStatus;
  effective_from: string | null;
  effective_to: string | null;
}

export interface WireUploadUrlResult {
  upload_url: string;
  s3_key: string;
  expires_in: number;
}

export interface WireTemplateSummaryResult {
  template_key: string;
  version: number;
  status: TemplateStatus;
  action: string;
  action_type: string;
  collector: string | null;
  subject: string | null;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string;
  created_at: string;
}

export interface WirePageResult<T> {
  content: T[];
  page: number;
  size: number;
  total_elements: number;
  total_pages: number;
}

export interface WireResolveResult {
  template_key: string;
  version: number;
  status: TemplateStatus;
  collector: string | null;
  s3_key: string;
  subject: string | null;
  variables: string[] | null;
  effective_from: string | null;
  effective_to: string | null;
}

export interface WireTemplateContentResult {
  template_key: string;
  version: number;
  status: TemplateStatus;
  action: string;
  action_type: string;
  collector: string | null;
  subject: string | null;
  variables: string[] | null;
  html: string;
  effective_from: string | null;
  effective_to: string | null;
  fallback_to_generic: boolean;
}

// `?? null` on every nullable field: Jackson may omit a null rather than send
// it, depending on the inclusion setting, and the domain types promise `null`
// — never `undefined` — for "stated as absent".

export function fromWireCreateResult(wire: WireCreateTemplateResult): CreateTemplateResponse {
  return {
    templateKey: wire.template_key,
    version: wire.version,
    status: wire.status,
    s3Key: wire.s3_key,
    checksum: wire.checksum,
  };
}

export function fromWireVersionStatus(wire: WireVersionStatusResult): VersionStatusResponse {
  return {
    templateKey: wire.template_key,
    version: wire.version,
    status: wire.status,
    effectiveFrom: wire.effective_from ?? null,
    effectiveTo: wire.effective_to ?? null,
  };
}

export function fromWireUploadUrl(wire: WireUploadUrlResult): UploadUrlResponse {
  return {
    uploadUrl: wire.upload_url,
    s3Key: wire.s3_key,
    expiresIn: wire.expires_in,
  };
}

export function fromWireSummary(wire: WireTemplateSummaryResult): TemplateSummary {
  return {
    templateKey: wire.template_key,
    version: wire.version,
    status: wire.status,
    action: wire.action,
    actionType: wire.action_type,
    collector: wire.collector ?? null,
    subject: wire.subject ?? null,
    effectiveFrom: wire.effective_from ?? null,
    effectiveTo: wire.effective_to ?? null,
    createdBy: wire.created_by,
    createdAt: wire.created_at,
  };
}

export function fromWirePage<W, T>(wire: WirePageResult<W>, map: (item: W) => T): PageResponse<T> {
  return {
    content: (wire.content ?? []).map(map),
    page: wire.page,
    size: wire.size,
    totalElements: wire.total_elements,
    totalPages: wire.total_pages,
  };
}

export function fromWireResolve(wire: WireResolveResult): ResolveResponse {
  return {
    templateKey: wire.template_key,
    version: wire.version,
    status: wire.status,
    s3Key: wire.s3_key,
    collector: wire.collector ?? null,
    subject: wire.subject ?? null,
    variables: wire.variables ?? [],
    effectiveFrom: wire.effective_from ?? null,
    effectiveTo: wire.effective_to ?? null,
  };
}

export function fromWireContent(wire: WireTemplateContentResult): TemplateContentResponse {
  return {
    templateKey: wire.template_key,
    version: wire.version,
    status: wire.status,
    action: wire.action,
    actionType: wire.action_type,
    subject: wire.subject ?? null,
    variables: wire.variables ?? [],
    html: wire.html,
    effectiveFrom: wire.effective_from ?? null,
    effectiveTo: wire.effective_to ?? null,
    // Copied only when PRESENT, the one exception to `?? null` above. A body
    // without these keys came from a server that never considered the
    // collector, and `resolutionOutcome` tells that silence apart from an
    // explicit `collector: null` by key presence — a mapper that always wrote
    // both keys would erase the difference before it got there.
    ...("collector" in wire ? { collector: wire.collector ?? null } : {}),
    ...("fallback_to_generic" in wire ? { fallbackToGeneric: wire.fallback_to_generic } : {}),
  } as TemplateContentResponse;
}

// ---- Requests ----
//
// Optional fields stay OMITTED when unset, never sent as null: on create, an
// absent collector means the generic and an explicit null is a different
// payload the server would have to interpret.

function compact<T extends Record<string, unknown>>(body: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function toWireCreate(req: CreateTemplateRequest) {
  return compact({
    action: req.action,
    action_type: req.actionType,
    template_key: req.templateKey,
    html: req.html,
    subject: req.subject,
    variables: req.variables,
    collector: req.collector,
  });
}

export function toWireUploadUrl(req: UploadUrlRequest) {
  return compact({
    template_key: req.templateKey,
    action: req.action,
    action_type: req.actionType,
    collector: req.collector,
  });
}

export function toWireCommit(req: CommitRequest) {
  return compact({
    action: req.action,
    action_type: req.actionType,
    template_key: req.templateKey,
    s3_key: req.s3Key,
    variables: req.variables,
    subject: req.subject,
    collector: req.collector,
  });
}

export function toWireUpdateDraft(req: UpdateDraftRequest) {
  return compact({ html: req.html, subject: req.subject, variables: req.variables });
}

export function toWirePublish(req: PublishRequest) {
  return compact({ effective_from: req.effectiveFrom, effective_to: req.effectiveTo });
}

const LIST_PARAM_NAMES: Record<keyof ListTemplatesParams, string> = {
  action: "action",
  actionType: "action_type",
  templateKey: "template_key",
  collector: "collector",
  status: "status",
  page: "page",
  size: "size",
};

/**
 * The list query string. Unset and empty values are dropped; page/size 0 are
 * legitimate, so only undefined/null/"" drop.
 */
export function toWireListQuery(params: ListTemplatesParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [keyof ListTemplatesParams, unknown][]) {
    if (value === undefined || value === null || value === "") continue;
    const name = LIST_PARAM_NAMES[key];
    // A key the record does not know is a caller passing something the API
    // does not accept (`sort` used to be one). Dropped rather than forwarded.
    if (!name) continue;
    search.set(name, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
