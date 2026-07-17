// Normalizes ApiError (and non-ApiError network failures) into a shape the UI can
// render without importing api/types or branching on ApiError.body directly in every
// component. See api-template/docs/INTEGRATION.md §7 for the source error taxonomy.
import { ApiError } from "../api/templatesClient";
import type { ApiErrorCode, TemplateStatus } from "../api/types";

export type UiErrorKind =
  | "VALIDATION_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
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
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  OBJECT_NOT_FOUND: "OBJECT_NOT_FOUND",
  OBJECT_ALREADY_EXISTS: "OBJECT_ALREADY_EXISTS",
};

const DEFAULT_MESSAGES: Record<UiErrorKind, string> = {
  VALIDATION_ERROR: "Some fields are invalid.",
  INVALID_STATE_TRANSITION: "That action is not allowed in the template's current state.",
  TEMPLATE_NOT_FOUND: "That template/version no longer exists.",
  OBJECT_NOT_FOUND: "The referenced object no longer exists.",
  OBJECT_ALREADY_EXISTS: "That object already exists.",
  NETWORK: "Network error — the server is unreachable or the request was blocked (check CORS).",
  UNKNOWN: "Unexpected error.",
};

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
    const kind = CODE_TO_KIND[error.body.error] ?? "UNKNOWN";

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
