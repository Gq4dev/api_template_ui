// Framework-agnostic, dependency-free (fetch) typed client.
// Source of truth: api-template/docs/INTEGRATION.md §6.
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
  PublishRequest,
  VersionStatusResponse,
  ResolveResponse,
  RenderRequest,
  RenderResponse,
  ApiErrorBody,
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

export const templatesApi = {
  // --- Admin ---
  create(
    payload: CreateTemplateRequest,
    opts?: { author?: string; idempotencyKey?: string },
  ) {
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

  publish(templateKey: string, version: number, payload: PublishRequest) {
    return request<VersionStatusResponse>(
      `/${templateKey}/versions/${version}/publish`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  archive(templateKey: string, version: number) {
    return request<VersionStatusResponse>(
      `/${templateKey}/versions/${version}/archive`,
      { method: "POST" },
    );
  },

  // --- Read ---
  resolve(templateKey: string, at?: string) {
    const q = at ? `?at=${encodeURIComponent(at)}` : "";
    return request<ResolveResponse>(`/${templateKey}/resolve${q}`);
  },

  // The UI's preview: renders an explicit version (works on DRAFT).
  preview(templateKey: string, version: number, data?: RenderRequest["data"]) {
    return request<RenderResponse>(
      `/${templateKey}/versions/${version}/preview`,
      { method: "POST", body: JSON.stringify({ data: data ?? {} }) },
    );
  },

  // Send-path render (effective-now). Usually a backend concern, exposed here for
  // completeness — the admin UI rarely calls this.
  render(templateKey: string, data?: RenderRequest["data"]) {
    return request<RenderResponse>(`/${templateKey}/render`, {
      method: "POST",
      body: JSON.stringify({ data: data ?? {} }),
    });
  },
};
