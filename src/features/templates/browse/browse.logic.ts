// Pure shaping for the browse view: turn a flat page of versions into the two
// choices the reader actually makes.
//
// No React and no network here so the grouping and the "which version is in
// effect" rule can be tested directly, which is where the subtle bugs live.
import type { TemplateSummary } from "../../../api/types";

export interface TemplateGroup {
  templateKey: string;
  action: string;
  actionType: string;
  /** Every stored version of this key, newest version first. */
  versions: TemplateSummary[];
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Groups versions by templateKey.
 *
 * The key is derived server-side from action + actionType, so in practice one
 * key means one action — but that is the server's convention, not an invariant
 * we can enforce from here. The first row's action wins and the rest are not
 * silently merged away: {@link groupsWithMixedActions} can report them.
 */
export function groupByTemplateKey(rows: TemplateSummary[]): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();

  for (const row of rows) {
    const existing = groups.get(row.templateKey);
    if (existing) {
      existing.versions.push(row);
      continue;
    }
    groups.set(row.templateKey, {
      templateKey: row.templateKey,
      action: row.action,
      actionType: row.actionType,
      versions: [row],
    });
  }

  for (const group of groups.values()) {
    group.versions.sort((a, b) => b.version - a.version);
  }

  return [...groups.values()].sort((a, b) =>
    a.templateKey.localeCompare(b.templateKey),
  );
}

/** Keys whose rows disagree about the action — never expected, worth surfacing. */
export function groupsWithMixedActions(rows: TemplateSummary[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = seen.get(row.templateKey) ?? new Set<string>();
    set.add(`${row.action}/${row.actionType}`);
    seen.set(row.templateKey, set);
  }
  return [...seen].filter(([, set]) => set.size > 1).map(([key]) => key);
}

/** Options for the template-key select, annotated with the action they carry. */
export function templateKeyOptions(groups: TemplateGroup[]): SelectOption[] {
  return groups.map((group) => ({
    value: group.templateKey,
    label: `${group.templateKey} — ${group.action}/${group.actionType}`,
  }));
}

/**
 * Options for the version select of one key.
 *
 * The status travels in the label because it is the whole reason to pick one
 * version over another: ACTIVE is what customers get right now, DRAFT is not
 * reachable by the send path at all, ARCHIVED is history.
 */
export function versionOptions(group: TemplateGroup | null): SelectOption[] {
  if (!group) return [];
  return group.versions.map((version) => ({
    value: String(version.version),
    label: `v${version.version} · ${version.status}`,
  }));
}

/**
 * The version to select when a key is picked.
 *
 * ACTIVE first — the reader almost always means "what are we sending today".
 * Falling back to the highest version number keeps the choice deterministic for
 * keys that have no active version (all archived, or nothing published yet).
 */
export function defaultVersion(group: TemplateGroup | null): TemplateSummary | null {
  if (!group || group.versions.length === 0) return null;
  return (
    group.versions.find((version) => version.status === "ACTIVE") ??
    group.versions[0]
  );
}

/** Looks one version up inside a group. */
export function findVersion(
  group: TemplateGroup | null,
  version: number | null,
): TemplateSummary | null {
  if (!group || version == null) return null;
  return group.versions.find((row) => row.version === version) ?? null;
}
