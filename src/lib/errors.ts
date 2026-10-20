// Normalizes ApiError (and non-ApiError network failures) into a shape the UI can
// render without importing api/types or branching on ApiError.body directly in every
// component. The error taxonomy is notification-template-service's NTA envelope,
// read by `extended_code` in src/api/wire.ts before it gets here.
import { ApiError } from "../api/templatesClient";
import type { ApiErrorCode, TemplateStatus } from "../api/types";
import { PreviewEngineError } from "../preview/client";

export type UiErrorKind =
  | "VALIDATION_ERROR"
  | "INVALID_STATE_TRANSITION"
  | "VERSION_NOT_EDITABLE"
  | "TEMPLATE_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_ALREADY_EXISTS"
  | "ENDPOINT_UNAVAILABLE"
  | "SERVER_ERROR"
  | "PREVIEW_ENGINE"
  | "NETWORK"
  | "UNKNOWN";

export interface UiError {
  kind: UiErrorKind;
  message: string;
  /** Field-level messages, present for VALIDATION_ERROR (e.g. "html: no debe estar vacío"). */
  fieldDetails?: string[];
  /** Present for INVALID_STATE_TRANSITION, when the server's message names them. */
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
};

const DEFAULT_MESSAGES: Record<UiErrorKind, string> = {
  VALIDATION_ERROR: "Hay campos inválidos.",
  INVALID_STATE_TRANSITION:
    "Esa operación no está permitida en el estado actual de la plantilla.",
  // Names the way out, because there is one and it is not obvious: the version is
  // frozen, but authoring a new one costs nothing.
  VERSION_NOT_EDITABLE:
    "Esta versión ya está publicada, así que su contenido no se puede seguir cambiando. Crea una versión nueva en su lugar.",
  TEMPLATE_NOT_FOUND: "Esa plantilla o versión ya no existe.",
  OBJECT_NOT_FOUND: "El objeto referenciado ya no existe.",
  OBJECT_ALREADY_EXISTS: "Ese objeto ya existe.",
  // Names the deployment, because the template is not the problem and looking
  // for the fault in it is a wasted afternoon.
  ENDPOINT_UNAVAILABLE:
    "La API no expone este endpoint. El backend desplegado es más viejo que esta interfaz: hay que volver a desplegarlo.",
  // A 5xx with no envelope is the service failing below its own handlers —
  // MongoDB or S3 unreachable, typically. Says "retry" and "not your template"
  // because both are true and the reader cannot see either from here.
  SERVER_ERROR:
    "El servidor de plantillas falló al procesar la petición (no es un problema de la plantilla). Vuelve a intentarlo en un momento.",
  // Says "local", twice over, because the instinct on any failure next to a
  // request is to go and look at the server — and here the server is not
  // involved at all. Nothing is wrong with the template and nothing is wrong
  // with the API: the renderer that runs in this browser tab did not start.
  PREVIEW_ENGINE:
    "El motor de vista previa local no pudo arrancar, así que no se pudo renderizar el mail. No es un problema del servidor ni de la plantilla: recarga la página para volver a arrancarlo.",
  NETWORK:
    "Error de red: no se puede llegar al servidor o la petición fue bloqueada (revisa CORS).",
  UNKNOWN: "Error inesperado.",
};

/**
 * What a non-2xx means when the body is not an NTA envelope.
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
  if (error.status === 404) return "ENDPOINT_UNAVAILABLE";
  if (error.status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

/**
 * One VALIDATION_ERROR message, back into the per-field details it was made of.
 *
 * The server joins its violations with "; " into a single `message`. Splitting
 * on every "; " would cut a detail that contains one (the action-format message
 * does: "…punctuation); got \"x\""), so a split only happens where the next
 * piece starts like a detail — a snake_case field name and a colon.
 */
export function splitValidationMessage(message: string | null): string[] {
  if (!message) return [];
  return message
    .split(/; (?=[a-z][a-z0-9_]*: )/)
    .map((detail) => detail.trim())
    .filter((detail) => detail !== "");
}

const STATUS = "(DRAFT|SCHEDULED|ACTIVE|ARCHIVED)";
const TRANSITION = new RegExp(`${STATUS}\\s*->\\s*${STATUS}`);

/**
 * The two states of an INVALID_STATE_TRANSITION.
 *
 * The envelope carries no structured from/to, only a message rendered from
 * them ("Transición de estado inválida: ARCHIVED -> ACTIVE"). The enum values
 * are not translated, so the pair is recoverable in either language; when it
 * is not, nothing is invented.
 */
function parseTransition(message: string | null): { from?: TemplateStatus; to?: TemplateStatus } {
  const match = message ? TRANSITION.exec(message) : null;
  if (!match) return {};
  return { from: match[1] as TemplateStatus, to: match[2] as TemplateStatus };
}

/**
 * Maps any error thrown by templatesApi calls into a normalized UiError.
 *
 * - ApiError instances (typed non-2xx responses) branch on `error.body.code`,
 *   which wire.ts derived from the envelope's `extended_code`. A body that was
 *   not an envelope has no code and is classified by status alone.
 * - PreviewEngineError is pulled out BEFORE the catch-all, because it is the one
 *   failure in this app that has nothing to do with the network. It is thrown by
 *   the local render worker (Pyodide never booted, an asset 404'd, the worker
 *   died) and it is not an ApiError, so without this branch it fell through to
 *   NETWORK and told the reader to go and check CORS about a request the server
 *   had already answered perfectly. Every mutation that fetches and then renders
 *   in one step can produce it.
 * - Anything else (fetch rejected: offline, DNS failure, CORS preflight blocked) is
 *   reported as a distinct NETWORK kind so the UI can tell "server said no" apart
 *   from "could not reach the server at all".
 */
export function toUiError(error: unknown): UiError {
  if (error instanceof PreviewEngineError) {
    return { kind: "PREVIEW_ENGINE", message: DEFAULT_MESSAGES.PREVIEW_ENGINE };
  }

  if (error instanceof ApiError) {
    const kind = error.body.code ? CODE_TO_KIND[error.body.code] : fallbackKind(error);

    if (kind === "VALIDATION_ERROR") {
      return {
        kind,
        message: DEFAULT_MESSAGES[kind],
        fieldDetails: splitValidationMessage(error.body.message),
      };
    }

    if (kind === "INVALID_STATE_TRANSITION") {
      const { from, to } = parseTransition(error.body.message);
      return {
        kind,
        // The two states are enum values off the wire, so they stay exactly as
        // the server spelled them.
        message:
          from && to ? `No se puede pasar de ${from} a ${to}` : DEFAULT_MESSAGES[kind],
        from,
        to,
      };
    }

    return { kind, message: DEFAULT_MESSAGES[kind] };
  }

  return { kind: "NETWORK", message: DEFAULT_MESSAGES.NETWORK };
}
