import { describe, expect, it } from "vitest";
import { extractVariables } from "./variables";

describe("extractVariables", () => {
  it("returns unique, trimmed placeholder names in order of first appearance", () => {
    const html = "<p>Hi {{ firstName }}, your order {{orderId}} shipped to {{  firstName}}.</p>";
    expect(extractVariables(html)).toEqual(["firstName", "orderId"]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractVariables("<p>No variables here.</p>")).toEqual([]);
  });

  it("ignores empty placeholder markers", () => {
    expect(extractVariables("{{ }}{{}}")).toEqual([]);
  });
});
