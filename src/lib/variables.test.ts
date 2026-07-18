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

  it("trims whitespace around a plain token", () => {
    expect(extractVariables("{{   name   }}")).toEqual(["name"]);
  });

  it("skips Handlebars block open/close tokens (#each, /each)", () => {
    const result = extractVariables("{{#each items}}<li>{{name}}</li>{{/each}}");
    expect(result).not.toContain("#each");
    expect(result).not.toContain("/each");
    // `#each items` starts with `#`, so the whole token (including `items`) is
    // skipped — acceptable best-effort behavior.
    expect(result).not.toContain("items");
  });

  it("emits nothing for an if/else/if block with no plain variables", () => {
    expect(extractVariables("{{#if x}}{{else}}{{/if}}")).toEqual([]);
  });

  it("collapses dotted paths to their root variable and dedupes", () => {
    expect(extractVariables("{{ user.name }} / {{user.email}}")).toEqual(["user"]);
  });

  it("skips Handlebars comment tokens", () => {
    expect(extractVariables("{{! this is a comment }}")).toEqual([]);
  });

  it("skips helper invocations (token containing a space)", () => {
    expect(extractVariables("{{formatDate date}}")).toEqual([]);
  });
});
