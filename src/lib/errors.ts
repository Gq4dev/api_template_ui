// Normalizes ApiError (and non-ApiError network failures) into a shape the UI can
// render without importing api/types or branching on ApiError.body directly in every
// component. See api-template/docs/INTEGRATION.md §7 for the source error taxonomy.
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
  | "VALIDATOR_UNAVAILABLE"
  | "ENDPOINT_UNAVAILABLE"
  | "PREVIEW_ENGINE"
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
  // Deliberately says "not saved": the author's work is intact, the check just
  // could not run. Retrying once the service is back is the correct move, which
  // is why this is worth telling apart from a plain failure.
  VALIDATOR_UNAVAILABLE:
    "El verificador de plantillas no está disponible, así que no se guardó nada. Tu trabajo no se perdió: vuelve a intentarlo en un momento.",
  // Names the deployment, because the template is not the problem and looking
  // for the fault in it is a wasted afternoon.
  ENDPOINT_UNAVAILABLE:
    "La API no expone este endpoint. El backend desplegado es más viejo que esta interfaz: hay que volver a desplegarlo.",
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
        // The two states are enum values off the wire, so they stay exactly as
        // the server spelled them.
        message: `No se puede pasar de ${error.body.from ?? "?"} a ${error.body.to ?? "?"}`,
        from: error.body.from,
        to: error.body.to,
      };
    }

    return { kind, message: DEFAULT_MESSAGES[kind] };
  }

  return { kind: "NETWORK", message: DEFAULT_MESSAGES.NETWORK };
}
