import { describe, expect, it } from "vitest";
import { canonicalActionName, storedSpellings } from "./actionNames";

describe("canonicalActionName", () => {
  // The backend's own fixtures: ORDER/CREATED derive `order_created`.
  it("lowercases, as the templateKey derivation does", () => {
    expect(canonicalActionName("ORDER")).toBe("order");
    expect(canonicalActionName("CREATED")).toBe("created");
    expect(canonicalActionName("PAYMENT")).toBe(canonicalActionName("payment"));
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalActionName("  payment  ")).toBe("payment");
  });

  it("turns every run of non-alphanumerics into ONE underscore", () => {
    expect(canonicalActionName("order.created")).toBe("order_created");
    expect(canonicalActionName("Order Created")).toBe("order_created");
    expect(canonicalActionName("order--created__now")).toBe("order_created_now");
    expect(canonicalActionName("a1-B2")).toBe("a1_b2");
  });

  it("strips leading and trailing underscores the slugging produced", () => {
    expect(canonicalActionName("__payment__")).toBe("payment");
    expect(canonicalActionName("(payment)")).toBe("payment");
  });

  // Only ASCII letters and digits survive, exactly like `[^a-z0-9]+` in Java.
  it("treats non-ASCII letters as separators", () => {
    expect(canonicalActionName("aprobádo")).toBe("aprob_do");
  });

  // The backend rejects this with a 400; here it is simply "no name".
  it("canonicalizes pure punctuation to empty", () => {
    expect(canonicalActionName("!!!")).toBe("");
    expect(canonicalActionName("   ")).toBe("");
  });

  // Parity with Java assumes a non-Turkic JVM default locale; see the doc comment.
  it("lowercases the capital I to a plain i, whatever the runtime locale", () => {
    expect(canonicalActionName("INVOICE")).toBe("invoice");
  });
});

describe("storedSpellings", () => {
  const items = [
    { action: "PAYMENT", actionType: "APPROVED" },
    { action: "PAYMENT", actionType: "APPROVED" },
    { action: "payment", actionType: "approved" },
    { action: "payment", actionType: "rejected" },
  ];

  it("lists each raw spelling of the canonical pair once, most common first", () => {
    expect(storedSpellings(items, "payment", "approved")).toEqual([
      { action: "PAYMENT", actionType: "APPROVED", count: 2 },
      { action: "payment", actionType: "approved", count: 1 },
    ]);
  });

  it("finds the pair whatever spelling it is asked in", () => {
    expect(storedSpellings(items, "Payment", " APPROVED ")).toHaveLength(2);
  });

  // Code-point order, so which spelling wins a tie never depends on the locale.
  it("breaks ties deterministically", () => {
    const tied = [
      { action: "payment", actionType: "approved" },
      { action: "PAYMENT", actionType: "APPROVED" },
    ];
    expect(storedSpellings(tied, "payment", "approved").map((s) => s.action)).toEqual([
      "PAYMENT",
      "payment",
    ]);
  });

  it("is empty for a pair the items do not hold, or a blank half", () => {
    expect(storedSpellings(items, "refund", "done")).toEqual([]);
    expect(storedSpellings(items, "payment", "")).toEqual([]);
  });
});
