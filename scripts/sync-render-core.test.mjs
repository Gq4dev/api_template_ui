// @vitest-environment node
//
// The guard that makes the vendored render core trustworthy.
//
// A copy of production code is only safe while it is provably the same copy.
// These tests are what turn "we synced it once" into "it is still in sync", and
// they are meant to FAIL the build rather than warn — a stale render core means
// the preview lies to whoever is about to publish a template.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  diffHashes,
  hashSource,
  hashText,
  hashVendored,
  paths,
  readManifest,
  senderRepoAvailable,
} from "./sync-render-core.mjs";

describe("render core manifest", () => {
  it("exists and lists the modules and templates", () => {
    const manifest = readManifest();
    expect(manifest, "no manifest — run: npm run sync:render-core").not.toBeNull();

    const keys = Object.keys(manifest.files);
    // renderer is the entry point; base.html.j2 is what every template extends.
    expect(keys).toContain("renderer.py");
    expect(keys).toContain("templates/base.html.j2");
    expect(keys.filter((k) => k.startsWith("templates/")).length).toBeGreaterThan(40);
  });

  it("matches the vendored copy under public/py/render_core", () => {
    const manifest = readManifest();
    const drift = diffHashes(manifest.files, hashVendored());
    expect(
      drift,
      `public/py/render_core is generated and was edited by hand: ` +
        `${drift.map((d) => `${d.reason} ${d.key}`).join(", ")}`,
    ).toEqual([]);
  });

  // Skipped rather than failed when the sibling checkout is absent: CI may build
  // the UI alone. The vendored-copy check above still runs, so a hand-edit is
  // caught either way — only upstream drift goes unnoticed.
  it.skipIf(!senderRepoAvailable())(
    "matches the sender repo it was synced from",
    () => {
      const manifest = readManifest();
      const drift = diffHashes(manifest.files, hashSource());
      expect(
        drift,
        `${paths.SOURCE_DIR} moved since the last sync — the preview would ` +
          `render with stale code. Run: npm run sync:render-core. Drift: ` +
          `${drift.map((d) => `${d.reason} ${d.key}`).join(", ")}`,
      ).toEqual([]);
    },
  );
});

// The manifest is written on one machine and verified on another. Git stores
// this repo's text as LF (`* text=auto eol=lf`) but hands a Windows working
// copy CRLF, so a byte-for-byte hash would record CRLF on a Windows sync and
// then report the WHOLE core as drifted on the first fresh clone. Nobody reads
// 69 drift lines and concludes "line endings" — they re-sync or delete the
// check, and the guard is gone precisely when it starts mattering.
describe("hashText", () => {
  const dir = mkdtempSync(join(tmpdir(), "render-core-eol-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("ignores line endings, so a Windows sync verifies on Linux", () => {
    const crlf = join(dir, "crlf.j2");
    const lf = join(dir, "lf.j2");
    writeFileSync(crlf, "{% extends 'base.html.j2' %}\r\n<p>hola</p>\r\n");
    writeFileSync(lf, "{% extends 'base.html.j2' %}\n<p>hola</p>\n");

    expect(hashText(crlf)).toBe(hashText(lf));
  });

  it("still notices a real content change", () => {
    const before = join(dir, "before.j2");
    const after = join(dir, "after.j2");
    writeFileSync(before, "<p>hola</p>\n");
    writeFileSync(after, "<p>chau</p>\n");

    expect(hashText(before)).not.toBe(hashText(after));
  });
});

describe("diffHashes", () => {
  it("reports nothing for identical maps", () => {
    expect(diffHashes({ a: "1", b: "2" }, { a: "1", b: "2" })).toEqual([]);
  });

  it("distinguishes modified, missing and unexpected files", () => {
    const drift = diffHashes({ a: "1", b: "2" }, { a: "9", c: "3" });
    expect(drift).toEqual([
      { key: "a", reason: "modified" },
      { key: "b", reason: "missing" },
      { key: "c", reason: "unexpected" },
    ]);
  });
});
