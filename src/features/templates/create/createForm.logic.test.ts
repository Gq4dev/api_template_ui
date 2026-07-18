import { describe, expect, it } from "vitest";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  mapValidationDetails,
  validateCreateForm,
} from "./createForm.logic";

describe("validateCreateForm", () => {
  it("flags missing required fields", () => {
    const errors = validateCreateForm(EMPTY_CREATE_FORM_VALUES);
    expect(errors).toEqual({
      action: "Action is required.",
      actionType: "Action type is required.",
      html: "HTML body is required.",
    });
  });

  it("passes when required fields are filled and optional ones are blank", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>hi</p>",
    });
    expect(errors).toEqual({});
  });

  it("treats whitespace-only values as missing", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "   ",
      actionType: "CREATED",
      html: "<p>hi</p>",
    });
    expect(errors.action).toBe("Action is required.");
  });
});

describe("buildCreatePayload", () => {
  it("omits blank optional fields and never sends variables", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>{{name}}</p>",
    });
    expect(payload).toEqual({
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>{{name}}</p>",
    });
    expect(payload).not.toHaveProperty("variables");
  });

  it("includes trimmed optional fields when present", () => {
    const payload = buildCreatePayload({
      action: " ORDER ",
      actionType: " CREATED ",
      templateKey: " order-created ",
      html: "<p>hi</p>",
      subject: " Your order ",
      effectiveFrom: null,
    });
    expect(payload).toMatchObject({
      action: "ORDER",
      actionType: "CREATED",
      templateKey: "order-created",
      subject: "Your order",
    });
  });

  it("converts the naive Mantine datetime string to an ISO-8601 instant", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>hi</p>",
      effectiveFrom: "2026-08-01 10:30:00",
    });
    expect(payload.effectiveFrom).toMatch(
      /^2026-08-01T\d{2}:30:00\.000Z$/,
    );
  });
});

describe("mapValidationDetails", () => {
  it("maps known-field details to fieldErrors", () => {
    const { fieldErrors, generalDetails } = mapValidationDetails([
      "html: must not be blank",
      "action: must not be blank",
    ]);
    expect(fieldErrors).toEqual({
      html: "html: must not be blank",
      action: "action: must not be blank",
    });
    expect(generalDetails).toEqual([]);
  });

  it("routes unknown-field or unprefixed details to generalDetails", () => {
    const { fieldErrors, generalDetails } = mapValidationDetails([
      "effectiveTo must be after effectiveFrom",
      "unknownField: something",
    ]);
    expect(fieldErrors).toEqual({});
    expect(generalDetails).toEqual([
      "effectiveTo must be after effectiveFrom",
      "unknownField: something",
    ]);
  });
});
