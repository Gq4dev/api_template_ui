// Best-effort client-side extraction of `{{placeholder}}` variable names from an HTML
// (or subject) string.
//
// This is NOT authoritative: create/preview responses do not return a `variables[]`
// field back to the caller (the backend derives/stores `variables` server-side but
// only echoes it on `resolve`, not on `create`/`preview`). The UI uses this purely to
// pre-populate a bindings editor / stub JSON before the first preview call — the
// backend remains the source of truth for what a template actually needs.
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * Returns the unique, trimmed placeholder names found in `{{ name }}` markers within
 * `source`. Order of first appearance is preserved; duplicates are removed.
 */
export function extractVariables(source: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1]?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }

  return result;
}
