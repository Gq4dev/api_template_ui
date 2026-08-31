import { describe, expect, it } from "vitest";
import type { TemplateSummary } from "../../../api/types";
import {
  defaultVersion,
  effectiveStatus,
  findVersion,
  groupByTemplateKey,
  groupsWithMixedActions,
  templateKeyOptions,
  versionOptions,
} from "./browse.logic";

function dated(
  version: number,
  status: TemplateSummary["status"],
  effectiveFrom: string | null,
  effectiveTo: string | null,
): TemplateSummary {
  return { ...row("k", version, status), effectiveFrom, effectiveTo };
}

const NOW = new Date("2026-08-01T00:00:00Z");

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

// Mirrors TemplateVersion.statusAt in the API. These cases are the contract:
// if the server's rule changes, one of them should fail rather than the UI
// quietly disagreeing with what actually gets sent.
describe("effectiveStatus", () => {
  it("calls a superseded version ARCHIVED even though it is stored ACTIVE", () => {
    // Exactly the deployed data: payment_approved v1..v5 are stored ACTIVE and
    // closed by the next version. A build that repeats the stored field shows
    // six live versions for one action.
    const superseded = dated(1, "ACTIVE", "2026-07-22T03:00:00Z", "2026-07-24T15:27:13Z");
    expect(effectiveStatus(superseded, NOW)).toBe("ARCHIVED");
  });

  it("calls the open version ACTIVE", () => {
    const open = dated(6, "ACTIVE", "2026-07-28T19:15:51Z", null);
    expect(effectiveStatus(open, NOW)).toBe("ACTIVE");
  });

  it("calls a not-yet-started version SCHEDULED", () => {
    const future = dated(2, "ACTIVE", "2026-09-01T00:00:00Z", null);
    expect(effectiveStatus(future, NOW)).toBe("SCHEDULED");
  });

  // effectiveTo is exclusive on the server; a window closing exactly at `at` is
  // already past. Off by one here would show a version as live for the instant
  // its successor took over.
  it("treats effectiveTo as exclusive", () => {
    const closingNow = dated(3, "ACTIVE", "2026-07-01T00:00:00Z", NOW.toISOString());
    expect(effectiveStatus(closingNow, NOW)).toBe("ARCHIVED");
  });

  it("reports DRAFT and ARCHIVED as stored — they are decisions, not dates", () => {
    expect(effectiveStatus(dated(1, "DRAFT", null, null), NOW)).toBe("DRAFT");
    expect(
      effectiveStatus(dated(1, "ARCHIVED", "2026-01-01T00:00:00Z", null), NOW),
    ).toBe("ARCHIVED");
  });

  it("reports as stored when there is no effectiveFrom to reason from", () => {
    expect(effectiveStatus(dated(1, "ACTIVE", null, null), NOW)).toBe("ACTIVE");
  });
});

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
