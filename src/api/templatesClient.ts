// Framework-agnostic, dependency-free (fetch) typed client.
// Source of truth: api-template/docs/INTEGRATION.md + API.md.
//
// Deviation from the doc's verbatim snippet: `ApiError`'s constructor cannot use
// TypeScript parameter-property shorthand (`constructor(readonly status: number, ...)`)
// because this project's tsconfig sets `erasableSyntaxOnly: true` (parameter
// properties emit runtime assignment code, so they are not "erasable" syntax).
// Behavior is identical — `status` and `body` are still readonly public fields.
import { API_BASE_URL } from "./config";
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  CommitRequest,
  VersionStatusResponse,
  ResolveResponse,
  TemplateContentResponse,
  TemplateSummary,
  PageResponse,
  ListTemplatesParams,
  ApiErrorBody,
  PreviewRequest,
  PreviewResponse,
  PreviewVariant,
  ContractResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body?.error ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}

// Serializes list params into a query string, dropping undefined/empty values.
// Numbers are stringified; page/size 0 are legitimate so only undefined/"" drop.
function buildListQuery(params: ListTemplatesParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const templatesApi = {
  // --- Admin ---
  create(
    payload: CreateTemplateRequest,
    opts?: { author?: string; idempotencyKey?: string },
  ) {
    // Empty path is intentional: API_BASE_URL already targets the collection
    // endpoint (/api/v1/templates), so POST goes straight to it.
    return request<CreateTemplateResponse>("", {
      method: "POST",
      headers: {
        ...(opts?.author ? { "X-User-Email": opts.author } : {}),
        ...(opts?.idempotencyKey
          ? { "Idempotency-Key": opts.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(payload),
    });
  },

  requestUploadUrl(payload: UploadUrlRequest) {
    return request<UploadUrlResponse>("/upload-url", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  commit(payload: CommitRequest, opts?: { author?: string }) {
    return request<CreateTemplateResponse>("/commit", {
      method: "POST",
      headers: opts?.author ? { "X-User-Email": opts.author } : {},
      body: JSON.stringify(payload),
    });
  },

  // archive() intentionally sends no X-User-Email header: per the backend
  // contract (INTEGRATION.md §8) the audit header applies to create/commit only.
  archive(templateKey: string, version: number) {
    return request<VersionStatusResponse>(
      `/${templateKey}/versions/${version}/archive`,
      { method: "POST" },
    );
  },

  // --- Read ---
  list(params: ListTemplatesParams = {}) {
    return request<PageResponse<TemplateSummary>>(buildListQuery(params));
  },

  resolve(templateKey: string, at?: string) {
    const q = at ? `?at=${encodeURIComponent(at)}` : "";
    return request<ResolveResponse>(`/${templateKey}/resolve${q}`);
  },

  // Effective version WITH html, resolved by action + actionType.
  resolveByAction(action: string, actionType: string, at?: string) {
    const search = new URLSearchParams({ action, actionType });
    if (at) search.set("at", at);
    return request<TemplateContentResponse>(`/resolve?${search.toString()}`);
  },

  // --- Authoring aids ---
  // POST because it carries the draft HTML in the body, NOT because it changes
  // state: preview stores nothing. Safe to call as often as the author asks.
  preview(payload: PreviewRequest) {
    return request<PreviewResponse>("/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  // The variables an author may use, straight from the renderer's context.
  contract(action: string, actionType: string, variant?: PreviewVariant) {
    const search = new URLSearchParams({ action, actionType });
    if (variant) search.set("variant", variant);
    return request<ContractResponse>(`/contract?${search.toString()}`);
  },
};
