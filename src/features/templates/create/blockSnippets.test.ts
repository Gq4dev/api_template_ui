import { describe, expect, it } from "vitest";
import {
  BLOCK_SNIPPETS,
  BRAND_COLORS,
  alignWrap,
  colorWrap,
  imageSnippet,
  insertSnippet,
  variableSnippet,
  wrapSelection,
} from "./blockSnippets";
import { ALL_ASSET_PATHS } from "./emailAssets";

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

describe("wrapSelection", () => {
  it("wraps what is selected", () => {
    const out = wrapSelection("hola mundo", "<strong>", "</strong>", 5, 10);
    expect(out.text).toBe("hola <strong>mundo</strong>");
  });

  it("leaves the caret after the wrap when there was a selection", () => {
    const out = wrapSelection("hola mundo", "<strong>", "</strong>", 5, 10);
    expect(out.selectionStart).toBe(out.text.length);
    expect(out.selectionEnd).toBe(out.text.length);
  });

  // With nothing selected the placeholder is the thing the author is about to
  // overwrite, so it comes back SELECTED — otherwise they have to hunt for it
  // and delete it by hand every single time.
  it("selects the placeholder when nothing was selected", () => {
    const out = wrapSelection("", "<strong>", "</strong>", 0, 0);
    expect(out.text).toBe("<strong>texto</strong>");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("texto");
  });

  it("honours a custom placeholder", () => {
    const out = wrapSelection("", "<div>", "</div>", 0, 0, "contenido");
    expect(out.text.slice(out.selectionStart, out.selectionEnd)).toBe("contenido");
  });

  it("clamps a selection that runs past the end", () => {
    const out = wrapSelection("ab", "<i>", "</i>", 1, 999);
    expect(out.text).toBe("a<i>b</i>");
  });
});

describe("format helpers", () => {
  it("colours with a span, which is inline like the text it wraps", () => {
    expect(colorWrap("#1E1248").open).toBe('<span style="color:#1E1248;">');
  });

  // text-align does nothing on an inline element, so alignment has to wrap in a
  // block. An author who centred something and saw no change would conclude the
  // tool is broken — and be right.
  it("aligns with a div, because text-align needs a block", () => {
    const wrap = alignWrap("center");
    expect(wrap.open).toContain("<div");
    expect(wrap.open).toContain("text-align:center");
  });

  it("offers only colours the platform templates already use", () => {
    for (const color of BRAND_COLORS) {
      expect(color.value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(BRAND_COLORS.map((c) => c.value)).toContain("#1E1248");
  });
});

describe("imageSnippet", () => {
  it("routes through resources_base_url rather than hard-coding a host", () => {
    const out = imageSnippet("img/logo-pagotic.svg");
    expect(out).toContain("{{ resources_base_url }}/img/logo-pagotic.svg");
    expect(out).not.toContain("https://");
  });

  it("carries the attributes a mail client needs", () => {
    const out = imageSnippet("img/logo-pagotic.svg", "logo");
    expect(out).toContain('alt="logo"');
    // border:0 kills the blue link border Outlook draws around a linked image.
    expect(out).toContain("border:0");
    expect(out).toContain("max-width:100%");
  });
});

describe("EMAIL_ASSETS", () => {
  it("lists no duplicates", () => {
    expect(new Set(ALL_ASSET_PATHS).size).toBe(ALL_ASSET_PATHS.length);
  });

  // The regex that harvested these caught two CSS background fragments
  // ("img/billetes.png) right center no-repeat; …"). Anything with a paren or a
  // semicolon in it is not a path and would render as a broken image.
  it("holds paths, not the CSS they were extracted from", () => {
    for (const path of ALL_ASSET_PATHS) {
      expect(path, path).not.toMatch(/[)\s;]/);
      expect(path, path).toMatch(/\.(png|svg|jpg|gif)$/);
    }
  });
});
