import { describe, expect, it } from "vitest";
import {
  BLOCK_SNIPPETS,
  insertSnippet,
  variableSnippet,
} from "./blockSnippets";

describe("insertSnippet", () => {
  // Blocks are separated by a blank line, not a bare newline: these snippets are
  // multi-line HTML, and packed together they read as one tangled element.
  it("puts the snippet where the caret is, spaced off from its neighbours", () => {
    const { text } = insertSnippet("uno\ntres", "dos", 4);
    expect(text).toBe("uno\n\ndos\n\ntres");
  });

  it("leaves the caret at the end of what it inserted, ready to keep typing", () => {
    const { text, caret } = insertSnippet("uno\ntres", "dos", 4);
    expect(text.slice(caret)).toBe("\n\ntres");
    expect(text.slice(0, caret).endsWith("dos")).toBe(true);
  });

  it("replaces the selection rather than inserting beside it", () => {
    const { text } = insertSnippet("uno VIEJO tres", "NUEVO", 4, 9);
    expect(text).toContain("NUEVO");
    expect(text).not.toContain("VIEJO");
  });

  // Clicking a button twice is the normal way to use this, and it must not open
  // a growing gap between the blocks.
  it("does not stack blank lines when inserting twice in a row", () => {
    const first = insertSnippet("", "<p>a</p>", 0);
    const second = insertSnippet(first.text, "<p>b</p>", first.caret);
    expect(second.text).not.toMatch(/\n{3}/);
    expect(second.text.indexOf("<p>a</p>")).toBeLessThan(
      second.text.indexOf("<p>b</p>"),
    );
  });

  it("does not open with a stray newline at the very start", () => {
    const { text } = insertSnippet("", "<p>a</p>", 0);
    expect(text.startsWith("<p>a</p>")).toBe(true);
  });

  it("separates from surrounding text instead of gluing onto it", () => {
    const { text } = insertSnippet("<p>antes</p>", "<p>nuevo</p>", 12);
    expect(text).toBe("<p>antes</p>\n\n<p>nuevo</p>\n");
  });

  // A caret past the end arrives from a stale selection after the value
  // changed. Appending is the harmless reading; throwing or writing at 0 both
  // lose the author's text.
  it("clamps a caret that is out of range", () => {
    const { text } = insertSnippet("abc", "X", 999);
    expect(text).toContain("abc");
    expect(text).toContain("X");
    expect(text.indexOf("abc")).toBeLessThan(text.indexOf("X"));
  });

  it("treats a missing selection end as a plain caret", () => {
    const { text } = insertSnippet("ab", "X", 1);
    expect(text).toBe("a\n\nX\n\nb");
  });
});

describe("BLOCK_SNIPPETS", () => {
  it("has unique ids, since they key the buttons", () => {
    const ids = BLOCK_SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The whole point of offering these. A snippet without inline styling would
  // hand the author the exact bug this feature exists to prevent, because mail
  // clients discard the CSS in the head.
  it("styles every layout snippet inline", () => {
    const layout = BLOCK_SNIPPETS.filter(
      (s) => !["loop", "condition"].includes(s.id),
    );
    expect(layout.length).toBeGreaterThan(0);
    for (const snippet of layout) {
      expect(snippet.text, `${snippet.id} has no inline style`).toContain(
        "style=",
      );
    }
  });

  it("never uses a <style> block or a <button> element", () => {
    for (const snippet of BLOCK_SNIPPETS) {
      expect(snippet.text).not.toContain("<style");
      // Mail clients do not render <button>; a call to action is a styled <a>.
      expect(snippet.text).not.toContain("<button");
    }
  });

  it("closes every Jinja tag it opens", () => {
    for (const snippet of BLOCK_SNIPPETS) {
      const opens = (snippet.text.match(/\{%\s*(for|if)\b/g) ?? []).length;
      const closes = (snippet.text.match(/\{%\s*end(for|if)\s*%\}/g) ?? []).length;
      expect(closes, `${snippet.id} leaves a Jinja tag open`).toBe(opens);
    }
  });
});

describe("variableSnippet", () => {
  it("wraps a name as a Jinja interpolation", () => {
    expect(variableSnippet("customer_name")).toBe("{{ customer_name }}");
  });
});
