import { describe, expect, it } from "vitest";
import { COLLECTOR_FORMAT_MESSAGE } from "../../../lib/collector";
// The WRITE half of the "New version" query-param contract this file's
// `initialFormValues` tests read back. Imported from the list feature on
// purpose: the round trip is only pinned if both halves are the ones that ship.
import { newVersionHref } from "../list/listFilters.logic";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  initialFormValues,
  mapValidationDetails,
  buildStarterTemplate,
  validateCreateForm,
} from "./createForm.logic";

describe("validateCreateForm", () => {
  it("flags missing required fields", () => {
    const errors = validateCreateForm(EMPTY_CREATE_FORM_VALUES);
    expect(errors).toEqual({
      action: "Action es obligatorio.",
      actionType: "Action type es obligatorio.",
      html: "HTML body es obligatorio.",
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
    expect(errors.action).toBe("Action es obligatorio.");
  });

  // A blank collector is the generic template — the common case, not an
  // omission. If this ever started erroring, every create without a collector
  // would break.
  it("accepts a blank collector — that is the generic template", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "",
    });
    expect(errors).toEqual({});
  });

  it("accepts a well-formed collector", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "bbva_sa",
    });
    expect(errors).toEqual({});
  });

  // A malformed collector is a hard 400 on the server, never a quiet fallback
  // to the generic. Catching it here saves the round trip; it does not change
  // the verdict.
  it("rejects a malformed collector with the shared format message", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "bbva sa",
    });
    expect(errors.collector).toBe(COLLECTOR_FORMAT_MESSAGE);
  });

  // The hyphen was accepted until the API team closed the contract on a single
  // canonical separator. It is the value an author is most likely to still be
  // typing out of habit, so the form has to answer it before the server does.
  it("rejects a hyphenated collector, which the server now answers with a 400", () => {
    const errors = validateCreateForm({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "bbva-sa",
    });
    expect(errors.collector).toBe(COLLECTOR_FORMAT_MESSAGE);
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
      collector: "",
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

  it("omits a blank collector entirely — that is how the generic is asked for", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "   ",
    });
    expect(payload).not.toHaveProperty("collector");
  });

  it("sends a trimmed collector as typed — the server canonicalizes case", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "  BBVA  ",
    });
    expect(payload.collector).toBe("BBVA");
  });

  // The server derives the key from action + actionType + collector and rejects
  // any mismatch with a 400. Sending our own copy could only ever be wrong, so
  // the payload carries none — even though the form displays the derived key.
  it("never sends a templateKey alongside a collector", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      collector: "bbva",
      templateKey: "payment_approved__bbva",
    });
    expect(payload).not.toHaveProperty("templateKey");
    expect(payload.collector).toBe("bbva");
  });

  it("still sends a hand-typed templateKey when there is no collector", () => {
    const payload = buildCreatePayload({
      ...EMPTY_CREATE_FORM_VALUES,
      action: "PAYMENT",
      actionType: "APPROVED",
      html: "<p>hi</p>",
      templateKey: "legacy_key",
    });
    expect(payload.templateKey).toBe("legacy_key");
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

  // Without "collector" in KNOWN_FIELDS this detail lands in the general banner
  // at the top of the form, nowhere near the field it is about.
  it("maps a collector detail onto the collector field", () => {
    const { fieldErrors, generalDetails } = mapValidationDetails([
      "collector: must match [a-z0-9_-]+",
    ]);
    expect(fieldErrors.collector).toBe("collector: must match [a-z0-9_-]+");
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

describe("initialFormValues", () => {
  it("seeds the four identity fields from the query and leaves the body blank", () => {
    expect(
      initialFormValues(
        new URLSearchParams({
          templateKey: "payment_approved__bbva",
          action: "payment",
          actionType: "approved",
          collector: "bbva",
        }),
      ),
    ).toEqual({
      ...EMPTY_CREATE_FORM_VALUES,
      templateKey: "payment_approved__bbva",
      action: "payment",
      actionType: "approved",
      collector: "bbva",
    });
  });

  // THE FIELD THIS WHOLE TEST EXISTS FOR. A "New version" of a variant that
  // arrives with the collector dropped is not a smaller version of the right
  // thing — it is a NEW GENERIC, and publishing it changes the mail every
  // client receives. Nothing on screen says so at the time.
  it("carries the collector through on its own", () => {
    expect(
      initialFormValues(new URLSearchParams({ collector: "bbva" })).collector,
    ).toBe("bbva");
  });

  // Blank is the API's own spelling of "the generic", so an absent parameter is
  // an ANSWER and not a gap: a link with no collector and a link written for a
  // generic row have to land on the same form.
  it("reads an absent collector as the generic", () => {
    expect(initialFormValues(new URLSearchParams()).collector).toBe("");
    expect(initialFormValues(new URLSearchParams()).action).toBe("");
    expect(initialFormValues(new URLSearchParams({ collector: "" })).collector).toBe(
      "",
    );
  });

  /*
    THE ROUND TRIP, PINNED AGAINST THE ACTUAL WRITER.

    `newVersionHref` and this function are one contract split across two
    features, held together by nothing but four parameter names. Asserting
    against a hand-written URL would test this half against a copy of the
    contract rather than against the half that ships, and a rename on the list
    side would leave both green while the create form silently authored
    generics.
  */
  it("round-trips the exact URL the list's New version link writes", () => {
    const row = {
      templateKey: "payment_approved__bbva",
      action: "payment",
      actionType: "approved",
      collector: "bbva",
    };
    const href = newVersionHref(row);

    expect(initialFormValues(new URLSearchParams(href.split("?")[1]))).toEqual({
      ...EMPTY_CREATE_FORM_VALUES,
      ...row,
    });
  });

  // The generic row takes the same path, and its blank collector has to survive
  // being written into a URL and read back out.
  it("round-trips a generic row as the generic", () => {
    const href = newVersionHref({
      templateKey: "payment_approved",
      action: "payment",
      actionType: "approved",
      collector: null,
    });

    expect(
      initialFormValues(new URLSearchParams(href.split("?")[1])),
    ).toEqual({
      ...EMPTY_CREATE_FORM_VALUES,
      templateKey: "payment_approved",
      action: "payment",
      actionType: "approved",
      collector: "",
    });
  });
});
