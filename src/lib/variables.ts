// Best-effort client-side extraction of `{{placeholder}}` variable names from an HTML
// (or subject) string.
//
// This is NOT authoritative: create/preview responses do not return a `variables[]`
// field back to the caller (the backend derives/stores `variables` server-side but
// only echoes it on `resolve`, not on `create`/`preview`). The UI uses this purely to
// pre-populate a bindings editor / stub JSON before the first preview call — the
// backend remains the source of truth for what a template actually needs.
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

// Handlebars control prefixes that mark a token as block/helper/comment/partial
// syntax rather than a plain variable reference. Any token starting with one of these
// is skipped.
//   #  block open      ({{#each}})
//   /  block close     ({{/each}})
//   !  comment         ({{! ... }})
//   >  partial         ({{> body}})
//   &  unescaped       ({{& html}})
//   ^  inverted block  ({{^empty}})
const CONTROL_PREFIXES = ["#", "/", "!", ">", "&", "^"];

/**
 * Returns the unique, trimmed placeholder names found in `{{ name }}` markers within
 * `source`. Order of first appearance is preserved; duplicates are removed.
 *
 * Best-effort Handlebars handling:
 * - Tokens starting with a control prefix (#, /, !, >, &, ^) are skipped.
 * - The bare `else` token is skipped.
 * - A token containing a space is treated as a helper invocation (e.g.
 *   `{{formatDate date}}`) and skipped, since its first segment is a helper name,
 *   not a variable.
 * - For a plain dotted path, only the ROOT segment before the first `.` is kept
 *   (e.g. `{{ user.name }}` -> `user`), because bindings resolve against the root
 *   object.
 */
export function extractVariables(source: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
    const token = match[1]?.trim();
    if (!token) continue;

    // Skip Handlebars block/helper/comment/partial syntax.
    if (CONTROL_PREFIXES.includes(token[0])) continue;
    if (token === "else") continue;

    // A space means a helper invocation (e.g. `formatDate date`) — skip it.
    if (/\s/.test(token)) continue;

    // Keep only the root variable name before any dotted path.
    const name = token.split(".")[0];
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}
