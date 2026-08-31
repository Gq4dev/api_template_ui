import { describe, expect, it } from "vitest";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  mapValidationDetails,
  buildStarterTemplate,
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
    });
    expect(payload).toMatchObject({
      action: "ORDER",
      actionType: "CREATED",
      templateKey: "order-created",
      subject: "Your order",
    });
  });

  // The backend rejects effective dates on create with a 400, so a payload that
  // carried them would fail every create. Asserting their absence pins the
  // split: authoring is not scheduling.
  it("never carries effective dates — those belong to publish", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>hi</p>",
    });
    expect(payload).not.toHaveProperty("effectiveFrom");
    expect(payload).not.toHaveProperty("effectiveTo");
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

describe("buildStarterTemplate", () => {
  it("uses variables the action actually provides", () => {
    const out = buildStarterTemplate(["customer_name", "link", "commerce"]);
    // Matched as an interpolation, not a literal string: the greeting pipes the
    // name through capitalize_words, and a filtered variable is still used.
    expect(out).toMatch(/\{\{\s*customer_name\b/);
    expect(out).toMatch(/\{\{\s*link\b/);
  });

  it("never prints an object variable raw — that would dump a dict into the mail", () => {
    const out = buildStarterTemplate(["commerce", "payer", "payments"]);
    expect(out).not.toContain("{{ commerce }}");
    expect(out).not.toContain("{{ payer }}");
    expect(out).not.toContain("{{ payments }}");
  });

  it("always emits the structure that makes a template render at all", () => {
    const out = buildStarterTemplate([]);
    expect(out.startsWith('{% extends "base.html.j2" %}')).toBe(true);
    expect(out).toContain("{% block content %}");
    expect(out).toContain("{% endblock %}");
    // The branding blocks are the point: base.html.j2 leaves header and footer
    // EMPTY, so a starter without these includes teaches authors to ship mail
    // with no header, no footer and no styling — which is what happened.
    expect(out).toContain("{% block header %}");
    expect(out).toContain('{% include "partials/header.html.j2" %}');
    expect(out).toContain("{% block footer %}");
    expect(out).toContain('{% include "partials/footer.html.j2" %}');
  });

  it("styles inline, because mail clients discard a <style> block", () => {
    const out = buildStarterTemplate(["customer_name", "final_amount"]);
    expect(out).toContain("style=");
    expect(out).not.toContain("<style>");
  });
});
