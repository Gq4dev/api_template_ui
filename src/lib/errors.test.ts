import { describe, expect, it } from "vitest";
import { ApiError } from "../api/templatesClient";
import { fromWireError } from "../api/wire";
import { PreviewEngineError } from "../preview/client";
import { splitValidationMessage, toUiError } from "./errors";

/** An error exactly as the client builds it from a response body. */
function fromBody(status: number, body: unknown): ApiError {
  return new ApiError(status, fromWireError(body));
}

/** The NTA envelope, as notification-template-service sends it. */
function nta(code: number, extendedCode: number, message: string) {
  return {
    cause: null,
    code,
    datetime: "2026-10-20T17:22:54.346Z",
    extended_code: extendedCode,
    message,
    service_code: "NTA",
    wiki: null,
  };
}

describe("fromWireError", () => {
  it("reads an NTA envelope by extended_code", () => {
    expect(fromWireError(nta(409, 4010, "La versión x v1 está en estado ACTIVE"))).toEqual({
      code: "VERSION_NOT_EDITABLE",
      extendedCode: 4010,
      message: "La versión x v1 está en estado ACTIVE",
    });
  });

  it("keeps an unknown extended_code without inventing a name for it", () => {
    expect(fromWireError(nta(400, 4999, "nuevo"))).toEqual({
      code: null,
      extendedCode: 4999,
      message: "nuevo",
    });
  });

  // Spring's default body has an `error` field ("Bad Request") that must not be
  // mistaken for one of ours.
  it("reads Spring's default body, and non-JSON, as no code at all", () => {
    const spring = {
      timestamp: "2026-10-20T17:22:55.473Z",
      status: 500,
      error: "Internal Server Error",
      path: "/api/v1/templates",
    };
    expect(fromWireError(spring)).toEqual({ code: null, extendedCode: null, message: null });
    expect(fromWireError({})).toEqual({ code: null, extendedCode: null, message: null });
    expect(fromWireError(null)).toEqual({ code: null, extendedCode: null, message: null });
  });
});

describe("toUiError", () => {
  it("maps VALIDATION_ERROR, splitting the joined message into field details", () => {
    const error = fromBody(
      400,
      nta(400, 4000, "html: no debe estar vacío; action_type: no debe estar vacío"),
    );
    expect(toUiError(error)).toEqual({
      kind: "VALIDATION_ERROR",
      message: "Hay campos inválidos.",
      fieldDetails: ["html: no debe estar vacío", "action_type: no debe estar vacío"],
    });
  });

  it("maps INVALID_STATE_TRANSITION, reading from/to off the message", () => {
    const error = fromBody(409, nta(409, 4011, "Transición de estado inválida: ARCHIVED -> ACTIVE"));
    expect(toUiError(error)).toEqual({
      kind: "INVALID_STATE_TRANSITION",
      message: "No se puede pasar de ARCHIVED a ACTIVE",
      from: "ARCHIVED",
      to: "ACTIVE",
    });
  });

  it("keeps a generic sentence when the transition cannot be read", () => {
    const result = toUiError(fromBody(409, nta(409, 4011, "otra cosa")));
    expect(result.kind).toBe("INVALID_STATE_TRANSITION");
    expect(result.message).not.toContain("?");
    expect(result.from).toBeUndefined();
  });

  it.each([
    [404, 4005, "TEMPLATE_NOT_FOUND"],
    [404, 4004, "OBJECT_NOT_FOUND"],
    [409, 4009, "OBJECT_ALREADY_EXISTS"],
    [409, 4010, "VERSION_NOT_EDITABLE"],
  ])("maps HTTP %i / extended_code %i to %s", (status, extendedCode, kind) => {
    expect(toUiError(fromBody(status, nta(status, extendedCode, "x"))).kind).toBe(kind);
  });

  it("maps a 404 without an envelope to ENDPOINT_UNAVAILABLE", () => {
    const error = fromBody(404, { status: 404, error: "Not Found", path: "/api/v1/templates/x" });
    expect(toUiError(error).kind).toBe("ENDPOINT_UNAVAILABLE");
  });

  // Mongo or S3 down: the service fails below its handlers and Spring answers.
  it("maps a 5xx without an envelope to SERVER_ERROR", () => {
    const error = fromBody(500, { status: 500, error: "Internal Server Error" });
    expect(toUiError(error).kind).toBe("SERVER_ERROR");
  });

  it("maps any other non-envelope status to UNKNOWN", () => {
    expect(toUiError(fromBody(400, { status: 400, error: "Bad Request" })).kind).toBe("UNKNOWN");
  });

  it("maps a non-ApiError failure to NETWORK", () => {
    const result = toUiError(new TypeError("Failed to fetch"));
    expect(result.kind).toBe("NETWORK");
  });

  // A LOCAL failure must never be reported as a network one. PreviewEngineError
  // is not an ApiError, so before this branch existed it fell through to the
  // catch-all and told the reader to go and check CORS — about a request the
  // server had already answered correctly. The message is asserted on, not just
  // the kind: pointing at the server is the whole bug, so the sentence must not
  // drift back towards it.
  it("maps a local render-engine failure away from NETWORK", () => {
    const result = toUiError(
      new PreviewEngineError("pyodide failed to initialise"),
    );
    expect(result.kind).toBe("PREVIEW_ENGINE");
    expect(result.message).not.toContain("CORS");
    expect(result.message).toContain("local");
  });
});

describe("splitValidationMessage", () => {
  // The action-format message contains "; " itself; it must survive whole.
  it("splits only where a new field detail starts", () => {
    const formatDetail =
      'action: only letters and digits grouped by single underscores are allowed (no whitespace/dots/other punctuation); got "bad-name" — use "_" instead of "-"';
    expect(splitValidationMessage(`${formatDetail}; html: no debe estar vacío`)).toEqual([
      formatDetail,
      "html: no debe estar vacío",
    ]);
  });

  it("returns nothing for a missing message", () => {
    expect(splitValidationMessage(null)).toEqual([]);
  });
});
