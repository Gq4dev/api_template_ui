// Normalizes ApiError (and non-ApiError network failures) into a shape the UI can
// render without importing api/types or branching on ApiError.body directly in every
// component. See api-template/docs/INTEGRATION.md §7 for the source error taxonomy.
import { ApiError } from "../api/templatesClient";
import type { ApiErrorCode, TemplateStatus } from "../api/types";

export type UiErrorKind =
  | "VALIDATION_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "VERSION_NOT_EDITABLE"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
  | "VALIDATOR_UNAVAILABLE"
  | "ENDPOINT_UNAVAILABLE"
  | "NETWORK"
  | "UNKNOWN";

export interface UiError {
  kind: UiErrorKind;
  message: string;
  /** Field-level messages, present for VALIDATION_ERROR (e.g. "html: must not be blank"). */
  fieldDetails?: string[];
  /** Present for INVALID_STATE_TRANSITION. */
  from?: TemplateStatus;
  to?: TemplateStatus;
}

const CODE_TO_KIND: Record<ApiErrorCode, UiErrorKind> = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  VERSION_NOT_EDITABLE: "VERSION_NOT_EDITABLE",
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  OBJECT_NOT_FOUND: "OBJECT_NOT_FOUND",
  OBJECT_ALREADY_EXISTS: "OBJECT_ALREADY_EXISTS",
  VALIDATOR_UNAVAILABLE: "VALIDATOR_UNAVAILABLE",
};

const DEFAULT_MESSAGES: Record<UiErrorKind, string> = {
  VALIDATION_ERROR: "Some fields are invalid.",
  INVALID_STATE_TRANSITION: "That action is not allowed in the template's current state.",
  // Names the way out, because there is one and it is not obvious: the version is
  // frozen, but authoring a new one costs nothing.
  VERSION_NOT_EDITABLE:
    "This version is already published, so its content can no longer be changed. Create a new version instead.",
  TEMPLATE_NOT_FOUND: "That template/version no longer exists.",
  OBJECT_NOT_FOUND: "The referenced object no longer exists.",
  OBJECT_ALREADY_EXISTS: "That object already exists.",
  // Deliberately says "not saved": the author's work is intact, the check just
  // could not run. Retrying once the service is back is the correct move, which
  // is why this is worth telling apart from a plain failure.
  VALIDATOR_UNAVAILABLE:
    "The template checker is unavailable, so nothing was saved. Your work is not lost — try again in a moment.",
  // Names the deployment, because the template is not the problem and looking
  // for the fault in it is a wasted afternoon.
  ENDPOINT_UNAVAILABLE:
    "The API does not serve this endpoint. The deployed backend is older than this UI — it needs to be redeployed.",
  NETWORK: "Network error — the server is unreachable or the request was blocked (check CORS).",
  UNKNOWN: "Unexpected error.",
};

/**
 * What a non-2xx means when the body carries no code we know.
 *
 * A 404 is the case worth separating. Our own "that template does not exist"
 * always arrives as a TEMPLATE_NOT_FOUND envelope, so a 404 WITHOUT one did not
 * come from a handler at all — Spring answered before routing, because the API
 * serving the request has no such endpoint. In practice that means a deployment
 * older than this UI.
 *
 * Telling them apart matters because the two send you to opposite places:
 * TEMPLATE_NOT_FOUND is about the data, this is about the server. Collapsed into
 * "Unexpected error", a missing endpoint reads as a broken template and you go
 * looking for the fault in Jinja that renders perfectly well.
 */
function fallbackKind(error: ApiError): UiErrorKind {
  return error.status === 404 ? "ENDPOINT_UNAVAILABLE" : "UNKNOWN";
}

/**
 * Maps any error thrown by templatesApi calls into a normalized UiError.
 *
 * - ApiError instances (typed non-2xx responses) branch on `error.body.error`.
 * - Anything else (fetch rejected: offline, DNS failure, CORS preflight blocked) is
 *   reported as a distinct NETWORK kind so the UI can tell "server said no" apart
 *   from "could not reach the server at all".
 */
export function toUiError(error: unknown): UiError {
  if (error instanceof ApiError) {
    const kind = CODE_TO_KIND[error.body.error] ?? fallbackKind(error);

    if (kind === "VALIDATION_ERROR") {
      return {
        kind,
        message: DEFAULT_MESSAGES[kind],
        fieldDetails: error.body.details ?? [],
      };
    }

    if (kind === "INVALID_STATE_TRANSITION") {
      return {
        kind,
        message: `Cannot go ${error.body.from ?? "?"} → ${error.body.to ?? "?"}`,
        from: error.body.from,
        to: error.body.to,
      };
    }

    return { kind, message: DEFAULT_MESSAGES[kind] };
  }

  return { kind: "NETWORK", message: DEFAULT_MESSAGES.NETWORK };
}
