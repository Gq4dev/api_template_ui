import { describe, expect, it } from "vitest";
import type { TemplateSummary } from "../../../api/types";
import {
  defaultVersion,
  findVersion,
  groupByTemplateKey,
  groupsWithMixedActions,
  templateKeyOptions,
  versionOptions,
} from "./browse.logic";

function row(
  templateKey: string,
  version: number,
  status: TemplateSummary["status"],
  action = "payment",
  actionType = "approved",
): TemplateSummary {
  return {
    templateKey,
    version,
    status,
    action,
    actionType,
    subject: null,
    effectiveFrom: null,
    effectiveTo: null,
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00Z",
  } as TemplateSummary;
}

describe("groupByTemplateKey", () => {
  it("groups versions and sorts them newest first", () => {
    const groups = groupByTemplateKey([
      row("payment_approved", 1, "ARCHIVED"),
      row("payment_approved", 3, "ACTIVE"),
      row("payment_approved", 2, "ARCHIVED"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("sorts keys alphabetically so the dropdown is scannable", () => {
    const groups = groupByTemplateKey([
      row("withdrawal_create", 1, "ACTIVE"),
      row("closing_period", 1, "ACTIVE"),
      row("payment_approved", 1, "ACTIVE"),
    ]);

    expect(groups.map((g) => g.templateKey)).toEqual([
      "closing_period",
      "payment_approved",
      "withdrawal_create",
    ]);
  });

  it("returns nothing for an empty page", () => {
    expect(groupByTemplateKey([])).toEqual([]);
  });
});

describe("groupsWithMixedActions", () => {
  it("stays quiet when each key carries one action", () => {
    expect(
      groupsWithMixedActions([
        row("payment_approved", 1, "ACTIVE", "payment", "approved"),
        row("payment_approved", 2, "ACTIVE", "payment", "approved"),
      ]),
    ).toEqual([]);
  });

  // The key is derived from action + actionType server-side, so this should be
  // impossible. If it ever happens the dropdown would silently show one action
  // and render with another, which is exactly the kind of quiet wrong answer
  // this whole preview exists to prevent.
  it("names a key whose rows disagree about the action", () => {
    expect(
      groupsWithMixedActions([
        row("shared_key", 1, "ACTIVE", "payment", "approved"),
        row("shared_key", 2, "ACTIVE", "payment", "rejected"),
      ]),
    ).toEqual(["shared_key"]);
  });
});

describe("defaultVersion", () => {
  it("prefers ACTIVE — what customers get today is the usual question", () => {
    const [group] = groupByTemplateKey([
      row("k", 5, "DRAFT"),
      row("k", 4, "ACTIVE"),
      row("k", 3, "ARCHIVED"),
    ]);

    expect(defaultVersion(group)?.version).toBe(4);
  });

  it("falls back to the highest version when none is active", () => {
    const [group] = groupByTemplateKey([
      row("k", 2, "ARCHIVED"),
      row("k", 7, "DRAFT"),
    ]);

    expect(defaultVersion(group)?.version).toBe(7);
  });

  it("returns null with no group", () => {
    expect(defaultVersion(null)).toBeNull();
  });
});

describe("option builders", () => {
  it("annotates each key with the action it carries", () => {
    const groups = groupByTemplateKey([
      row("payment_approved", 1, "ACTIVE", "payment", "approved"),
    ]);

    expect(templateKeyOptions(groups)).toEqual([
      { value: "payment_approved", label: "payment_approved — payment/approved" },
    ]);
  });

  it("puts the status in the version label, since that is why you pick one", () => {
    const [group] = groupByTemplateKey([
      row("k", 2, "ACTIVE"),
      row("k", 1, "ARCHIVED"),
    ]);

    expect(versionOptions(group)).toEqual([
      { value: "2", label: "v2 · ACTIVE" },
      { value: "1", label: "v1 · ARCHIVED" },
    ]);
  });

  it("offers no versions before a template is chosen", () => {
    expect(versionOptions(null)).toEqual([]);
  });
});

describe("findVersion", () => {
  it("finds a version inside its group", () => {
    const [group] = groupByTemplateKey([row("k", 1, "ACTIVE"), row("k", 2, "DRAFT")]);
    expect(findVersion(group, 1)?.status).toBe("ACTIVE");
  });

  it("returns null for a version the group does not have", () => {
    const [group] = groupByTemplateKey([row("k", 1, "ACTIVE")]);
    expect(findVersion(group, 99)).toBeNull();
    expect(findVersion(group, null)).toBeNull();
  });
});
