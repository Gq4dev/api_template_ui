import { describe, expect, it } from "vitest";
import { ApiError } from "../api/templatesClient";
import { PreviewEngineError } from "../preview/client";
import { toUiError } from "./errors";

describe("toUiError", () => {
  it("maps VALIDATION_ERROR with field details", () => {
    const error = new ApiError(400, {
      error: "VALIDATION_ERROR",
      details: ["html: must not be blank"],
    });
    expect(toUiError(error)).toEqual({
      kind: "VALIDATION_ERROR",
      message: "Hay campos inválidos.",
      fieldDetails: ["html: must not be blank"],
    });
  });

  it("maps INVALID_STATE_TRANSITION with from/to", () => {
    const error = new ApiError(409, {
      error: "INVALID_STATE_TRANSITION",
      from: "ARCHIVED",
      to: "ACTIVE",
    });
    const result = toUiError(error);
    expect(result.kind).toBe("INVALID_STATE_TRANSITION");
    expect(result.message).toContain("ARCHIVED");
    expect(result.message).toContain("ACTIVE");
  });

  it("maps TEMPLATE_NOT_FOUND", () => {
    const error = new ApiError(404, { error: "TEMPLATE_NOT_FOUND" });
    expect(toUiError(error).kind).toBe("TEMPLATE_NOT_FOUND");
  });

  it("maps OBJECT_NOT_FOUND", () => {
    const error = new ApiError(404, { error: "OBJECT_NOT_FOUND" });
    expect(toUiError(error).kind).toBe("OBJECT_NOT_FOUND");
  });

  it("maps OBJECT_ALREADY_EXISTS", () => {
    const error = new ApiError(409, { error: "OBJECT_ALREADY_EXISTS" });
    expect(toUiError(error).kind).toBe("OBJECT_ALREADY_EXISTS");
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
