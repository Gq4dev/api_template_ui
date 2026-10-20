// Framework-agnostic, dependency-free (fetch) typed client for
// notification-template-service. Source of truth: its /v3/api-docs.
//
// Every method takes and returns the camelCase types of ./types; the
// snake_case wire shapes and the translation both ways live in ./wire, so this
// file only decides URLs, methods and headers.
//
// Deviation from the doc's verbatim snippet: `ApiError`'s constructor cannot use
// TypeScript parameter-property shorthand (`constructor(readonly status: number, ...)`)
// because this project's tsconfig sets `erasableSyntaxOnly: true` (parameter
// properties emit runtime assignment code, so they are not "erasable" syntax).
// Behavior is identical — `status` and `body` are still readonly public fields.
import { API_BASE_URL } from "./config";
import type {
  CreateTemplateRequest,
  UploadUrlRequest,
  CommitRequest,
  UpdateDraftRequest,
  PublishRequest,
  ListTemplatesParams,
  ApiErrorBody,
} from "./types";
import {
  fromWireContent,
  fromWireCreateResult,
  fromWirePage,
  fromWireResolve,
  fromWireSummary,
  fromWireUploadUrl,
  fromWireVersionStatus,
  toWireCommit,
  toWireCreate,
  toWireListQuery,
  toWirePublish,
  toWireUpdateDraft,
  toWireUploadUrl,
  type WireCreateTemplateResult,
  type WirePageResult,
  type WireResolveResult,
  type WireTemplateContentResult,
  type WireTemplateSummaryResult,
  type WireUploadUrlResult,
  type WireVersionStatusResult,
} from "./wire";

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
    // The deployed API sits behind an edge credential. fetch defaults to
    // "same-origin", which drops credentials on exactly the cross-origin calls
    // that need them — the request then arrives anonymous and comes back 401
    // no matter how the CORS policy is written.
    //
    // Note the browser will NOT prompt for basic auth on a cross-origin fetch:
    // it only reuses credentials already cached for that origin. Until the
    // Keycloak flow lands, authenticate once by opening the API URL in a tab.
    // Against a local API with no edge auth this changes nothing.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}

// Path segments are user-chosen strings (a collector suffix included), so they
// are encoded rather than trusted to be URL-safe.
const seg = encodeURIComponent;

export const templatesApi = {
  // --- Admin ---
  create(
    payload: CreateTemplateRequest,
    opts?: { author?: string; idempotencyKey?: string },
  ) {
    // Empty path is intentional: API_BASE_URL already targets the collection
    // endpoint (/api/v1/templates), so POST goes straight to it.
    return request<WireCreateTemplateResult>("", {
      method: "POST",
      headers: {
        ...(opts?.author ? { "X-User-Email": opts.author } : {}),
        ...(opts?.idempotencyKey
          ? { "Idempotency-Key": opts.idempotencyKey }
          : {}),
      },
      body: JSON.stringify(toWireCreate(payload)),
    }).then(fromWireCreateResult);
  },

  requestUploadUrl(payload: UploadUrlRequest) {
    return request<WireUploadUrlResult>("/upload-url", {
      method: "POST",
      body: JSON.stringify(toWireUploadUrl(payload)),
    }).then(fromWireUploadUrl);
  },

  commit(payload: CommitRequest, opts?: { author?: string }) {
    return request<WireCreateTemplateResult>("/commit", {
      method: "POST",
      headers: opts?.author ? { "X-User-Email": opts.author } : {},
      body: JSON.stringify(toWireCommit(payload)),
    }).then(fromWireCreateResult);
  },

  // Save a correction to a DRAFT. Same version number, same s3Key — only the
  // bytes and the checksum move. This is the authoring "save", and it is why a
  // draft costs one version no matter how many times it is fixed.
  //
  // 409 VERSION_NOT_EDITABLE once the version is published: from there the
  // content is frozen, because something may already have been sent with it.
  updateDraft(
    templateKey: string,
    version: number,
    payload: UpdateDraftRequest,
    opts?: { author?: string },
  ) {
    return request<WireCreateTemplateResult>(
      `/${seg(templateKey)}/versions/${version}`,
      {
        method: "PUT",
        headers: opts?.author ? { "X-User-Email": opts.author } : {},
        body: JSON.stringify(toWireUpdateDraft(payload)),
      },
    ).then(fromWireCreateResult);
  },

  // The one call that puts a template in front of customers. An empty payload
  // means "live now"; a future effectiveFrom schedules it instead.
  //
  // Publishing also auto-closes the previously-open version at this version's
  // effectiveFrom, so the caller never has to archive the old one by hand.
  publish(
    templateKey: string,
    version: number,
    payload: PublishRequest = {},
    opts?: { author?: string },
  ) {
    return request<WireVersionStatusResult>(
      `/${seg(templateKey)}/versions/${version}/publish`,
      {
        method: "POST",
        headers: opts?.author ? { "X-User-Email": opts.author } : {},
        body: JSON.stringify(toWirePublish(payload)),
      },
    ).then(fromWireVersionStatus);
  },

  // archive() sends no X-User-Email header: the endpoint does not declare one.
  archive(templateKey: string, version: number) {
    return request<WireVersionStatusResult>(
      `/${seg(templateKey)}/versions/${version}/archive`,
      { method: "POST" },
    ).then(fromWireVersionStatus);
  },

  // --- Read ---
  list(params: ListTemplatesParams = {}) {
    return request<WirePageResult<WireTemplateSummaryResult>>(toWireListQuery(params)).then(
      (page) => fromWirePage(page, fromWireSummary),
    );
  },

  resolve(templateKey: string, at?: string) {
    const q = at ? `?at=${encodeURIComponent(at)}` : "";
    return request<WireResolveResult>(`/${seg(templateKey)}/resolve${q}`).then(fromWireResolve);
  },

  // ONE specific version, with its HTML, addressed rather than resolved.
  // Works for every status — including DRAFT, which is in effect at no instant
  // and therefore unreachable by any resolve call.
  getVersion(templateKey: string, version: number) {
    return request<WireTemplateContentResult>(
      `/${seg(templateKey)}/versions/${version}`,
    ).then(fromWireContent);
  },

  // Effective version WITH html, resolved by action + actionType.
  //
  // `collector` is an override, not a filter: sending one asks "does THIS client
  // have its own servable version?", and the answer is either that version or
  // the generic with `fallbackToGeneric: true`. It never 404s for a missing
  // variant — only for an action with no in-effect generic either.
  //
  // Only set when non-empty. An empty `collector=` in the query string is a
  // different question from omitting the parameter ("a collector whose name is
  // blank" vs "no collector asked for"), and only the second one means generic.
  //
  // The value goes out AS TYPED. The server canonicalizes case itself, so
  // lowercasing here would add a second place that can disagree with it — and
  // if the two ever drift, the UI would be sending something other than what
  // the operator typed and reading back an answer to a question they did not
  // ask. Display is normalized instead (see src/lib/collector.ts).
  resolveByAction(
    action: string,
    actionType: string,
    opts?: { collector?: string; at?: string },
  ) {
    const search = new URLSearchParams({ action, action_type: actionType });
    if (opts?.collector) search.set("collector", opts.collector);
    if (opts?.at) search.set("at", opts.at);
    return request<WireTemplateContentResult>(`/resolve?${search.toString()}`).then(
      fromWireContent,
    );
  },

  // Rendering and validation are NOT here. The API stores templates and decides
  // which version is live; it does not parse, render or validate them. Both
  // authoring aids that used to live at POST /preview and GET /contract now run
  // in the browser against the vendored render core — see src/preview/.
};
