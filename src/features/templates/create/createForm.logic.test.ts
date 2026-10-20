import { describe, expect, it } from "vitest";
import { COLLECTOR_FORMAT_MESSAGE } from "../../../lib/collector";
// The WRITE half of the "New version" query-param contract this file's
// `initialFormValues` tests read back. Imported from the list feature on
// purpose: the round trip is only pinned if both halves are the ones that ship.
import { newVersionHref } from "../list/listFilters.logic";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  detachSourceTemplateKey,
  fromVersionHref,
  identityMatchesSource,
  pairSpellings,
  spellingFor,
  spellingHints,
  initialFormValues,
  isPublishedStatus,
  seedFromVersion,
  sourceAddressFromParams,
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

  it("maps the server's snake_case field names onto the form's fields", () => {
    const { fieldErrors, generalDetails } = mapValidationDetails([
      "action_type: only letters and digits grouped by single underscores are allowed",
      "template_key: does not match action/action_type",
    ]);
    expect(fieldErrors).toEqual({
      actionType: "action_type: only letters and digits grouped by single underscores are allowed",
      templateKey: "template_key: does not match action/action_type",
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

describe("create from an existing version", () => {
  const ROW = {
    templateKey: "payment_approved__bbva",
    version: 4,
    action: "payment",
    actionType: "approved",
    collector: "bbva",
  };

  function paramsOf(href: string): URLSearchParams {
    return new URLSearchParams(href.split("?")[1]);
  }

  it("offers it only for published statuses", () => {
    expect(isPublishedStatus("ACTIVE")).toBe(true);
    expect(isPublishedStatus("SCHEDULED")).toBe(true);
    expect(isPublishedStatus("DRAFT")).toBe(false);
    expect(isPublishedStatus("ARCHIVED")).toBe(false);
  });

  // Pinned against the real writer, like the New version round trip above.
  it("round-trips the source address and the identity through the URL", () => {
    const href = fromVersionHref(ROW);

    expect(href.startsWith("/create?")).toBe(true);
    expect(sourceAddressFromParams(paramsOf(href))).toEqual({
      templateKey: "payment_approved__bbva",
      version: 4,
    });
    expect(initialFormValues(paramsOf(href))).toEqual({
      ...EMPTY_CREATE_FORM_VALUES,
      templateKey: "payment_approved__bbva",
      action: "payment",
      actionType: "approved",
      collector: "bbva",
    });
  });

  it("writes a generic row's collector blank", () => {
    const href = fromVersionHref({ ...ROW, templateKey: "payment_approved", collector: null });
    expect(initialFormValues(paramsOf(href)).collector).toBe("");
  });

  it("reads a missing or malformed address as no source", () => {
    expect(sourceAddressFromParams(new URLSearchParams())).toBeNull();
    expect(sourceAddressFromParams(new URLSearchParams({ fromKey: "k" }))).toBeNull();
    expect(
      sourceAddressFromParams(new URLSearchParams({ fromKey: " ", fromVersion: "2" })),
    ).toBeNull();
    for (const bad of ["0", "-1", "1.5", "abc", " "]) {
      expect(
        sourceAddressFromParams(new URLSearchParams({ fromKey: "k", fromVersion: bad })),
      ).toBeNull();
    }
  });

  it("seeds every field from the fetched version", () => {
    expect(
      seedFromVersion({
        templateKey: "order_created",
        action: "ORDER",
        actionType: "CREATED",
        collector: null,
        html: "<p>hi</p>",
        subject: null,
      }),
    ).toEqual({
      templateKey: "order_created",
      action: "ORDER",
      actionType: "CREATED",
      collector: "",
      html: "<p>hi</p>",
      subject: "",
    });
  });

  it("compares identity trimmed and case-insensitively", () => {
    const source = { action: "ORDER", actionType: "CREATED", collector: "" };
    expect(
      identityMatchesSource({ action: " order", actionType: "created ", collector: "" }, source),
    ).toBe(true);
    expect(identityMatchesSource({ ...source, collector: "bbva" }, source)).toBe(false);
    expect(identityMatchesSource({ ...source, action: "PAYMENT" }, source)).toBe(false);
  });

  describe("detachSourceTemplateKey", () => {
    const SOURCE = {
      ...EMPTY_CREATE_FORM_VALUES,
      action: "ORDER",
      actionType: "CREATED",
      templateKey: "order_created",
      html: "<p>x</p>",
    };

    it("is a no-op without a source", () => {
      const next = { ...SOURCE, action: "PAYMENT" };
      expect(detachSourceTemplateKey(next, null)).toBe(next);
    });

    it("keeps the copied key while the identity is unchanged", () => {
      expect(detachSourceTemplateKey(SOURCE, SOURCE).templateKey).toBe("order_created");
    });

    // Otherwise a PAYMENT template would be filed under the ORDER key.
    it("clears the copied key once the identity diverges, and restores it on the way back", () => {
      const diverged = detachSourceTemplateKey({ ...SOURCE, action: "PAYMENT" }, SOURCE);
      expect(diverged.templateKey).toBe("");

      const back = detachSourceTemplateKey({ ...diverged, action: "ORDER" }, SOURCE);
      expect(back.templateKey).toBe("order_created");
    });

    // A variant source turned back into the generic: same action pair, collector
    // blanked. The copied `__bbva` key must not travel — the server derives the
    // generic's key from action + actionType.
    it("drops a variant's key when the collector is blanked, so the payload targets the generic", () => {
      const variant = {
        ...SOURCE,
        collector: "bbva",
        templateKey: "order_created__bbva",
      };
      const next = detachSourceTemplateKey({ ...variant, collector: "" }, variant);

      expect(next.templateKey).toBe("");
      const payload = buildCreatePayload(next);
      expect(payload).not.toHaveProperty("templateKey");
      expect(payload).not.toHaveProperty("collector");
      expect(payload).toMatchObject({ action: "ORDER", actionType: "CREATED" });
    });

    it("never touches a key the author typed", () => {
      const typed = { ...SOURCE, action: "PAYMENT", templateKey: "my_key" };
      expect(detachSourceTemplateKey(typed, SOURCE).templateKey).toBe("my_key");
    });
  });
});

describe("spelling sent on create", () => {
  const stored = (
    templateKey: string,
    version: number,
    action: string,
    actionType: string,
    collector: string | null,
  ) => ({ templateKey, version, action, actionType, collector });

  // The live catalogue: generic and bbva as PAYMENT/APPROVED, dell as payment/approved.
  const LIVE = [
    stored("payment_approved", 3, "PAYMENT", "APPROVED", null),
    stored("payment_approved", 2, "PAYMENT", "APPROVED", null),
    stored("payment_approved__bbva", 1, "PAYMENT", "APPROVED", "bbva"),
    stored("payment_approved__dell", 1, "payment", "approved", "dell"),
  ];
  const CONSISTENT = LIVE.slice(0, 3);

  const identity = (action: string, actionType: string, collector = "") => ({
    action,
    actionType,
    collector,
  });

  // A key reserves one raw spelling; anything else is a 400.
  it("rule 1: an existing key's reserved spelling", () => {
    expect(spellingFor(identity("payment", "approved"), LIVE)).toEqual({
      action: "PAYMENT",
      actionType: "APPROVED",
      rule: "EXISTING_KEY",
    });
    expect(spellingFor(identity("PAYMENT", "APPROVED", "DELL"), LIVE)).toEqual({
      action: "payment",
      actionType: "approved",
      rule: "EXISTING_KEY",
    });
  });

  it("rule 2: a new variant takes the generic's spelling", () => {
    expect(spellingFor(identity("payment", "approved", "newco"), LIVE)).toEqual({
      action: "PAYMENT",
      actionType: "APPROVED",
      rule: "GENERIC",
    });
  });

  it("rule 3: without a generic, the most common spelling among the variants", () => {
    const noGeneric = [
      stored("order_created__a", 1, "Order", "Created", "a"),
      stored("order_created__b", 1, "Order", "Created", "b"),
      stored("order_created__c", 4, "order", "created", "c"),
    ];
    expect(spellingFor(identity("ORDER", "CREATED", "z"), noGeneric)).toEqual({
      action: "Order",
      actionType: "Created",
      rule: "SIBLINGS",
    });
  });

  // One key with many versions is still one vote.
  it("rule 3 counts keys, not versions", () => {
    const manyVersions = [
      stored("x_y__a", 1, "X", "Y", "a"),
      stored("x_y__a", 2, "X", "Y", "a"),
      stored("x_y__a", 3, "X", "Y", "a"),
      stored("x_y__b", 1, "x", "y", "b"),
      stored("x_y__c", 1, "x", "y", "c"),
    ];
    expect(spellingFor(identity("x", "y", "z"), manyVersions).action).toBe("x");
  });

  it("rule 4: nothing stored for the pair, the canonical form", () => {
    expect(spellingFor(identity("Refund Done", "OK"), LIVE)).toEqual({
      action: "refund_done",
      actionType: "ok",
      rule: "CANONICAL",
    });
  });

  it("sends exactly what was typed while the catalogue has not loaded", () => {
    expect(spellingFor(identity(" payment ", "approved"), null)).toEqual({
      action: "payment",
      actionType: "approved",
      rule: "TYPED",
    });
  });

  describe("spellingHints", () => {
    it("says what will be sent when it differs from what was typed", () => {
      const typed = identity("payment", "APPROVED");
      expect(
        spellingHints(typed, spellingFor(typed, CONSISTENT), pairSpellings(typed, CONSISTENT)),
      ).toEqual({
        action: "Se enviará como PAYMENT para coincidir con la plantilla existente.",
        actionType: null,
      });
    });

    it("names the rule that chose the spelling", () => {
      const typed = identity("payment", "approved", "newco");
      expect(
        spellingHints(typed, spellingFor(typed, CONSISTENT), pairSpellings(typed, CONSISTENT))
          .actionType,
      ).toBe("Se enviará como APPROVED para coincidir con la plantilla genérica.");
    });

    it("says nothing when typed and sent agree, or before the catalogue loads", () => {
      const exact = identity("PAYMENT", "APPROVED");
      expect(
        spellingHints(exact, spellingFor(exact, CONSISTENT), pairSpellings(exact, CONSISTENT)),
      ).toEqual({ action: null, actionType: null });

      const loose = identity("payment", "approved");
      expect(spellingHints(loose, spellingFor(loose, null), pairSpellings(loose, null))).toEqual({
        action: null,
        actionType: null,
      });
    });

    it("warns when the catalogue already holds the pair in more than one spelling", () => {
      const typed = identity("PAYMENT", "APPROVED");
      expect(spellingHints(typed, spellingFor(typed, LIVE), pairSpellings(typed, LIVE)).action).toBe(
        "El catálogo ya tiene esta plantilla escrita de 2 formas (PAYMENT/APPROVED, payment/approved): el envío responde distinto según cuál use el emisor.",
      );
    });
  });

  // The new-version hint must agree with the server about what is "the same key".
  it("compares the source identity canonically", () => {
    expect(
      identityMatchesSource(
        { action: "payment", actionType: "approved", collector: "" },
        { action: "PAYMENT", actionType: "APPROVED", collector: "" },
      ),
    ).toBe(true);
    expect(
      identityMatchesSource(
        { action: "order.created", actionType: "x", collector: " BBVA" },
        { action: "ORDER_CREATED", actionType: "X", collector: "bbva" },
      ),
    ).toBe(true);
  });
});
