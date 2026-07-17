import { describe, expect, it } from "vitest";
import { ApiError } from "../api/templatesClient";
import { toUiError } from "./errors";

describe("toUiError", () => {
  it("maps VALIDATION_ERROR with field details", () => {
    const error = new ApiError(400, {
      error: "VALIDATION_ERROR",
      details: ["html: must not be blank"],
    });
    expect(toUiError(error)).toEqual({
      kind: "VALIDATION_ERROR",
      message: "Some fields are invalid.",
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

  it("maps a non-ApiError failure to NETWORK", () => {
    const result = toUiError(new TypeError("Failed to fetch"));
    expect(result.kind).toBe("NETWORK");
  });
});
