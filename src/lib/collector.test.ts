import { describe, expect, it } from "vitest";
import {
  COLLECTOR_FORMAT_MESSAGE,
  collectorLabel,
  deriveTemplateKey,
  isValidCollector,
  normalizeCollector,
} from "./collector";

describe("isValidCollector", () => {
  it("accepts alphanumeric groups joined by a single underscore", () => {
    expect(isValidCollector("bbva")).toBe(true);
    expect(isValidCollector("bbva_sa")).toBe(true);
    expect(isValidCollector("a1_b2_c3")).toBe(true);
    expect(isValidCollector("banco24")).toBe(true);
  });

  // Uppercase is a valid collector — a DIFFERENT one from its lowercase
  // spelling. Rejecting it here would invent a rule the API does not have.
  it("accepts uppercase", () => {
    expect(isValidCollector("BBVA")).toBe(true);
  });

  // Empty means "generic template", which is a meaning and not a mistake. The
  // callers decide whether they accept it; this function must not reject it for
  // them, or the create form could never be submitted without a collector.
  it("does not treat empty or whitespace as invalid — emptiness means generic", () => {
    expect(isValidCollector("")).toBe(true);
    expect(isValidCollector("   ")).toBe(true);
  });

  // The hyphen used to be accepted and canonicalized to the same identity as the
  // underscore, which let two different collectors collide on one variant. The
  // server now answers it with a 400, so the form has to say no first.
  it("rejects the hyphen, now that the underscore is the only separator", () => {
    expect(isValidCollector("bbva-sa")).toBe(false);
  });

  // Each of these is a second spelling of a name that already has one, so the
  // underscore has to appear exactly once between two alphanumeric groups.
  it("rejects doubled, leading and trailing underscores", () => {
    expect(isValidCollector("bbva__sa")).toBe(false);
    expect(isValidCollector("_bbva")).toBe(false);
    expect(isValidCollector("bbva_")).toBe(false);
  });

  it("rejects anything else — a space is the canonical 400 case", () => {
    expect(isValidCollector("bbva sa")).toBe(false);
    expect(isValidCollector("bbva.sa")).toBe(false);
    expect(isValidCollector("bbva/sa")).toBe(false);
    expect(isValidCollector("bbva%20sa")).toBe(false);
    expect(isValidCollector("bbva!")).toBe(false);
  });

  it("has a message to show when it says no", () => {
    expect(COLLECTOR_FORMAT_MESSAGE).toMatch(/collector/i);
  });
});

describe("normalizeCollector", () => {
  // BBVA and bbva are two clients to the server: folding case would merge them.
  it("trims and keeps case", () => {
    expect(normalizeCollector("  BBVA  ")).toBe("BBVA");
    expect(normalizeCollector("Galicia")).toBe("Galicia");
    expect(normalizeCollector("")).toBe("");
  });
});

describe("deriveTemplateKey", () => {
  it("joins action and actionType with a single underscore for the generic", () => {
    expect(deriveTemplateKey("PAYMENT", "APPROVED", "")).toBe(
      "payment_approved",
    );
  });

  // The double underscore is the whole point: a single one would make
  // `payment_approved_bbva` indistinguishable from action `payment` with
  // actionType `approved_bbva`.
  it("appends the collector after a DOUBLE underscore", () => {
    expect(deriveTemplateKey("PAYMENT", "APPROVED", "bbva")).toBe(
      "payment_approved__bbva",
    );
  });

  // The server's own derivation: action and type lowercased, collector as sent.
  it("lowercases action and actionType but keeps the collector's case", () => {
    expect(deriveTemplateKey("Payment", "Approved", "BBVA")).toBe(
      "payment_approved__BBVA",
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(deriveTemplateKey("  PAYMENT ", " APPROVED ", "  bbva ")).toBe(
      "payment_approved__bbva",
    );
  });

  // Showing `_approved` while someone is halfway through typing would read as a
  // real key they are about to create.
  it("derives nothing while action or actionType is still blank", () => {
    expect(deriveTemplateKey("", "APPROVED", "bbva")).toBe("");
    expect(deriveTemplateKey("PAYMENT", "", "bbva")).toBe("");
    expect(deriveTemplateKey("   ", "   ", "bbva")).toBe("");
  });
});

describe("collectorLabel", () => {
  // An empty cell reads as missing data. A null collector is not missing — it
  // is the generic template, which is a decision worth naming.
  it("names the generic rather than rendering a blank", () => {
    expect(collectorLabel(null)).toBe("Genérica");
    expect(collectorLabel("")).toBe("Genérica");
    expect(collectorLabel("   ")).toBe("Genérica");
  });

  it("shows the collector exactly as stored", () => {
    expect(collectorLabel("bbva")).toBe("bbva");
    expect(collectorLabel(" BBVA ")).toBe("BBVA");
  });
});
