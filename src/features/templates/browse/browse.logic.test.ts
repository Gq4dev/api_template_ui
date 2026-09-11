import { describe, expect, it } from "vitest";
import type {
  CollectorsInventoryResponse,
  TemplateSummary,
} from "../../../api/types";
import type { SelectOption, TemplateGroup } from "./browse.logic";
import {
  COLLECTORS_KNOWN_ELSEWHERE,
  COLLECTORS_STORED_HERE,
  actionOptions,
  actionTypeOptions,
  catalogueCollectorData,
  catalogueCollectorGroups,
  collectorSource,
  genericDelivery,
  inventoryCollectorData,
  inventoryFreshness,
  defaultVersion,
  findGroup,
  findVersion,
  groupByTemplateKey,
  groupsWithMixedActions,
  resolutionMatchesSelection,
  resolutionOutcome,
  versionOptions,
} from "./browse.logic";

function row(
  templateKey: string,
  version: number,
  status: TemplateSummary["status"],
  action = "payment",
  actionType = "approved",
  collector: string | null = null,
): TemplateSummary {
  return {
    templateKey,
    version,
    status,
    action,
    actionType,
    collector,
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

  // A variant and its generic are two different templates that happen to share
  // an action. Merging them would hide the override entirely.
  it("keeps a collector variant as its own group, separate from the generic", () => {
    const groups = groupByTemplateKey([
      row("payment_approved", 1, "ACTIVE"),
      row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "bbva"),
    ]);

    expect(groups.map((group) => [group.templateKey, group.collector])).toEqual([
      ["payment_approved", null],
      ["payment_approved__bbva", "bbva"],
    ]);
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

describe("resolutionOutcome", () => {
  // The incident this function was written for. The collector dimension is not
  // deployed yet: the running API ignores the `collector` query parameter and
  // answers with a body that carries NEITHER key. Read as a boolean, the
  // missing flag is falsy, and the panel used to announce "santander has its
  // own version" over a response that never looked at santander at all — the
  // exact mistake the whole feature exists to prevent, and the one that ends
  // with an operator editing the generic believing it is one client's.
  it("reports UNREPORTED when the response answers neither key — the pre-collector API", () => {
    expect(resolutionOutcome({}, "santander")).toBe("UNREPORTED");
  });

  it("treats an explicit collector:null with the flag set as the fallback it is", () => {
    expect(
      resolutionOutcome({ collector: null, fallbackToGeneric: true }, "santander"),
    ).toBe("FELL_BACK");
  });

  it("reports COLLECTOR_SERVED when the variant is what goes out", () => {
    expect(
      resolutionOutcome({ collector: "bbva", fallbackToGeneric: false }, "bbva"),
    ).toBe("COLLECTOR_SERVED");
  });

  // Blank is a meaning, not a missing input: the generic was the question, so
  // the generic is a correct answer and no banner is owed. Whatever the body
  // says about the dimension cannot change that.
  it("reports GENERIC_REQUESTED for a blank collector, whatever the body says", () => {
    expect(resolutionOutcome({}, "")).toBe("GENERIC_REQUESTED");
    expect(resolutionOutcome({}, "   ")).toBe("GENERIC_REQUESTED");
    expect(
      resolutionOutcome({ collector: "bbva", fallbackToGeneric: false }, ""),
    ).toBe("GENERIC_REQUESTED");
    expect(
      resolutionOutcome({ collector: null, fallbackToGeneric: true }, ""),
    ).toBe("GENERIC_REQUESTED");
  });

  // Belt and braces: a server that names the served collector but forgets the
  // flag has still told us everything we need. We asked for santander, the
  // collector served is the generic — that is a fallback, stated by the
  // response rather than inferred from silence.
  it("infers FELL_BACK from a served collector of null even with no flag", () => {
    expect(resolutionOutcome({ collector: null }, "santander")).toBe("FELL_BACK");
  });

  // The case the rule above must NOT reach. `undefined == null` is true, so an
  // untightened `content.collector == null` fired on a body that carries no
  // collector key at all — and answered FELL_BACK over a response whose one
  // explicit statement was `fallbackToGeneric: false`. The function would be
  // contradicting the server out loud. Key PRESENCE is what makes `null` mean
  // something; silence means nothing and must be read as nothing.
  it("does not infer a fallback from a missing collector key when the flag says false", () => {
    expect(
      resolutionOutcome({ fallbackToGeneric: false }, "santander"),
    ).not.toBe("FELL_BACK");
  });

  // The mirror of the case above: the flag is missing but the key is present
  // and names a real collector, so the dimension WAS answered.
  it("infers COLLECTOR_SERVED from a named served collector even with no flag", () => {
    expect(resolutionOutcome({ collector: "bbva" }, "bbva")).toBe(
      "COLLECTOR_SERVED",
    );
  });

  // A flag set to true is an answer on its own — it does not need the collector
  // key to corroborate what it already states.
  it("trusts a raised flag even when it is the only key the response carries", () => {
    expect(resolutionOutcome({ fallbackToGeneric: true }, "santander")).toBe(
      "FELL_BACK",
    );
  });
});

describe("identity cascade", () => {
  const catalogue = groupByTemplateKey([
    row("payment_approved", 1, "ACTIVE", "payment", "approved"),
    row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "bbva"),
    row("payment_rejected", 1, "ACTIVE", "payment", "rejected"),
    row("payment_rejected__bbva", 1, "ACTIVE", "payment", "rejected", "bbva"),
    row(
      "withdrawal_create__santander",
      1,
      "ACTIVE",
      "withdrawal",
      "create",
      "santander",
    ),
  ]);

  /**
   * A group as it would arrive from a build that never heard of collectors.
   *
   * Not a contrived shape: the deployed API omits the field entirely, so the
   * key is genuinely absent rather than present-and-null. The cascade tests
   * with `== null` so absence and explicit null land in the same bucket — the
   * generic — and neither produces an `undefined` option value.
   */
  function groupWithNoCollectorKey(templateKey: string): TemplateGroup {
    return {
      templateKey,
      action: "payment",
      actionType: "approved",
      versions: [row(templateKey, 1, "ACTIVE")],
    } as TemplateGroup;
  }

  describe("actionOptions", () => {
    // The count is what makes the choice before the click: it says whether the
    // next two steps are a real branch or already decided.
    it("counts the keys each action covers and sorts them", () => {
      expect(actionOptions(catalogue)).toEqual([
        { value: "payment", label: "payment (4)" },
        { value: "withdrawal", label: "withdrawal (1)" },
      ]);
    });

    it("offers nothing for an empty catalogue", () => {
      expect(actionOptions([])).toEqual([]);
    });
  });

  describe("actionTypeOptions", () => {
    it("narrows to one action and counts what each type covers", () => {
      expect(actionTypeOptions(catalogue, "payment")).toEqual([
        { value: "approved", label: "approved (2)" },
        { value: "rejected", label: "rejected (2)" },
      ]);
    });

    // Offering another action's types would let the reader build a triple that
    // resolves to nothing, which is the whole failure this control prevents.
    it("never leaks a type belonging to a different action", () => {
      expect(actionTypeOptions(catalogue, "withdrawal")).toEqual([
        { value: "create", label: "create (1)" },
      ]);
    });

    it("offers nothing before an action is chosen", () => {
      expect(actionTypeOptions(catalogue, "")).toEqual([]);
    });

    it("offers nothing for an action the catalogue does not have", () => {
      expect(actionTypeOptions(catalogue, "refund")).toEqual([]);
    });
  });

  describe("catalogueCollectorGroups", () => {
    // The shape the whole function exists for. `bbva` has a variant stored under
    // payment/approved, so it belongs in the group that leads to versions;
    // `santander` only has one under withdrawal/create, so it is a name the
    // reader can still ask about here even though nothing is stored for it.
    //
    // Plain names, because every one of them becomes both the VALUE and the
    // LABEL of an option in a closed Select. Decorating them — a count, a
    // status — would either travel into the value the control emits, or make
    // the label disagree with the name the API is about to be asked about.
    it("splits stored-here from known-elsewhere, each sorted", () => {
      expect(catalogueCollectorGroups(catalogue, "payment", "approved")).toEqual([
        { group: COLLECTORS_STORED_HERE, items: ["bbva"] },
        { group: COLLECTORS_KNOWN_ELSEWHERE, items: ["santander"] },
      ]);
    });

    // The same catalogue read from the other end: membership of either group is
    // a statement about the PAIR on screen, never about the collector itself.
    it("re-sorts the same names into different groups for a different pair", () => {
      expect(catalogueCollectorGroups(catalogue, "withdrawal", "create")).toEqual([
        { group: COLLECTORS_STORED_HERE, items: ["santander"] },
        { group: COLLECTORS_KNOWN_ELSEWHERE, items: ["bbva"] },
      ]);
    });

    // THE REGRESSION THIS FUNCTION WAS WRITTEN FOR. Under a pair nobody has
    // authored a variant for, the old list went empty — and an empty dropdown
    // reads as "we have never heard of any collector", which is false and hides
    // exactly the names worth typing. The heading has to be the second one:
    // nothing here is stored, so the catalogue panel will have nothing to show.
    it("still offers every known name when the pair has no variant at all", () => {
      expect(catalogueCollectorGroups(catalogue, "payment", "cancelled")).toEqual([
        { group: COLLECTORS_KNOWN_ELSEWHERE, items: ["bbva", "santander"] },
      ]);
    });

    // An empty group is dropped rather than rendered, because a lone heading
    // would state the opposite of what it means: "Stored for this template" over
    // nothing claims something is stored here.
    it("omits the second group when every known collector is stored here", () => {
      const groups = groupByTemplateKey([
        row("payment_approved", 1, "ACTIVE", "payment", "approved"),
        row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "bbva"),
      ]);

      expect(catalogueCollectorGroups(groups, "payment", "approved")).toEqual([
        { group: COLLECTORS_STORED_HERE, items: ["bbva"] },
      ]);
    });

    // The server canonicalizes case, so BBVA and bbva are one client. Two
    // suggestions would let the reader pick the spelling that resolves to
    // nothing — and now that names are gathered from the WHOLE catalogue, the
    // two spellings can arrive from two different pairs.
    it("collapses collectors that differ only in case, across pairs", () => {
      const groups = groupByTemplateKey([
        row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "BBVA"),
        row("payment_rejected__bbva", 1, "ACTIVE", "payment", "rejected", "bbva"),
      ]);

      expect(catalogueCollectorGroups(groups, "payment", "approved")).toEqual([
        { group: COLLECTORS_STORED_HERE, items: ["bbva"] },
      ]);
    });

    // A name in the first group must never also sit in the second: the two
    // headings make contradictory promises about what happens after you pick,
    // so a reader seeing both would have no way to know which one applies.
    it("never repeats a stored-here name under known-elsewhere", () => {
      const groups = groupByTemplateKey([
        row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "bbva"),
        row("payment_rejected__bbva", 1, "ACTIVE", "payment", "rejected", "bbva"),
        row(
          "payment_rejected__santander",
          1,
          "ACTIVE",
          "payment",
          "rejected",
          "santander",
        ),
      ]);

      const suggestions = catalogueCollectorGroups(groups, "payment", "approved");
      const elsewhere = suggestions.find(
        (suggestion) => suggestion.group === COLLECTORS_KNOWN_ELSEWHERE,
      );

      expect(elsewhere?.items).toEqual(["santander"]);
      expect(elsewhere?.items).not.toContain("bbva");
    });

    // Blank already means generic — it is the API's own rule for an absent
    // collector — so a "Generic" entry would be a word offered for typing into
    // a field where any word is sent as a collector name.
    it("never suggests a word for the generic, because blank is the generic", () => {
      const names = catalogueCollectorGroups(
        catalogue,
        "payment",
        "approved",
      ).flatMap((suggestion) => suggestion.items);

      expect(names).not.toContain("Generic");
      expect(names).not.toContain("generic");
      expect(names).not.toContain("");
    });

    // The catalogue as it arrives today: the collector branch is unmerged, so
    // no row carries the field. Every template is generic, which is the correct
    // reading — and nothing may leak an `undefined` into either group. Absence
    // is tested here rather than an explicit null because that is the shape the
    // deployed API actually sends.
    it("treats an absent collector key exactly like an explicit null", () => {
      expect(
        catalogueCollectorGroups(
          [groupWithNoCollectorKey("payment_approved")],
          "payment",
          "approved",
        ),
      ).toEqual([]);
    });

    it("suggests nothing until both upstream steps are answered", () => {
      expect(catalogueCollectorGroups(catalogue, "", "")).toEqual([]);
      expect(catalogueCollectorGroups(catalogue, "payment", "")).toEqual([]);
      expect(catalogueCollectorGroups(catalogue, "", "approved")).toEqual([]);
    });
  });

  describe("inventoryCollectorData", () => {
    const inventory: CollectorsInventoryResponse = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      generic: {
        templateKey: "payment_approved",
        version: 1,
        status: "ACTIVE",
        servable: true,
      },
      collectors: [
        {
          collector: "bbva",
          templateKey: "payment_approved__bbva",
          version: 3,
          status: "ACTIVE",
          servable: true,
        },
        {
          collector: "galicia",
          templateKey: "payment_approved__galicia",
          version: 1,
          status: "DRAFT",
          servable: false,
        },
      ],
    };

    // The generic leads, and the collectors keep the server's order. Both halves
    // matter: blank is the value the rest of the page already treats as "the
    // generic", and the contract promises a stable sort the UI must not redo.
    it("puts the generic first and preserves the order the server sent", () => {
      expect(inventoryCollectorData(inventory.collectors)).toEqual([
        { value: "", label: "Genérica" },
        { value: "bbva", label: "bbva" },
        { value: "galicia", label: "galicia" },
      ]);
    });

    // A collector that receives the generic is still a collector somebody can
    // ask about — it is THE case worth asking about. Filtering it out would hide
    // exactly the situation `servable` was added to report.
    it("keeps a collector whose variant is not servable", () => {
      const values = inventoryCollectorData(inventory.collectors).map(
        (option) => (option as SelectOption).value,
      );
      expect(values).toContain("galicia");
    });

    // 200 with an empty list is a normal answer — every client is on the
    // generic — so the option that names the generic has to survive it.
    it("still offers the generic when no collector has a variant", () => {
      expect(inventoryCollectorData([])).toEqual([
        { value: "", label: "Genérica" },
      ]);
    });
  });

  describe("catalogueCollectorData", () => {
    // The degraded path builds the SAME first entry, so the generic never moves
    // and never changes label depending on whether the inventory answered.
    it("prepends the same generic option to the catalogue groups", () => {
      expect(catalogueCollectorData(catalogue, "payment", "approved")).toEqual([
        { value: "", label: "Genérica" },
        { group: COLLECTORS_STORED_HERE, items: ["bbva"] },
        { group: COLLECTORS_KNOWN_ELSEWHERE, items: ["santander"] },
      ]);
    });

    // A catalogue with no variants anywhere is the live case today. The control
    // must still offer the generic rather than render an empty dropdown, which
    // reads as broken.
    it("offers the generic alone when the catalogue holds no variant", () => {
      const generics = groupByTemplateKey([
        row("payment_approved", 1, "ACTIVE", "payment", "approved"),
      ]);
      expect(catalogueCollectorData(generics, "payment", "approved")).toEqual([
        { value: "", label: "Genérica" },
      ]);
    });
  });

  describe("collectorSource", () => {
    const inventory: CollectorsInventoryResponse = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      generic: null,
      collectors: [],
    };

    it("waits for the pair before claiming any source", () => {
      expect(
        collectorSource({
          action: "",
          actionType: "",
          isLoading: false,
          inventory: null,
        }),
      ).toBe("AWAITING_PAIR");
      expect(
        collectorSource({
          action: "payment",
          actionType: "",
          isLoading: true,
          inventory,
        }),
      ).toBe("AWAITING_PAIR");
    });

    it("reports INVENTORY once the endpoint has answered", () => {
      expect(
        collectorSource({
          action: "payment",
          actionType: "approved",
          isLoading: false,
          inventory,
        }),
      ).toBe("INVENTORY");
    });

    // This query is never stale-cached, so background refetches are frequent.
    // Blanking a good list for a spinner several times a session would be the
    // page flickering while it learns nothing new.
    it("keeps showing the inventory while it refetches", () => {
      expect(
        collectorSource({
          action: "payment",
          actionType: "approved",
          isLoading: true,
          inventory,
        }),
      ).toBe("INVENTORY");
    });

    it("reports LOADING only on the first fetch", () => {
      expect(
        collectorSource({
          action: "payment",
          actionType: "approved",
          isLoading: true,
          inventory: null,
        }),
      ).toBe("LOADING");
    });

    // The live case: the endpoint 404s because it is not deployed. The page has
    // to degrade to the catalogue rather than sit empty, and it has to KNOW it
    // degraded so it can say so.
    it("falls back to the catalogue when the inventory settled with nothing", () => {
      expect(
        collectorSource({
          action: "payment",
          actionType: "approved",
          isLoading: false,
          inventory: null,
        }),
      ).toBe("CATALOGUE_FALLBACK");
    });
  });

  describe("inventoryFreshness", () => {
    const inventory: CollectorsInventoryResponse = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      generic: null,
      collectors: [],
    };

    it("has nothing to date when no inventory is on screen", () => {
      expect(inventoryFreshness({ inventory: null, isError: false })).toBe(
        "NOT_APPLICABLE",
      );
    });

    it("reports FRESH while the query is succeeding", () => {
      expect(inventoryFreshness({ inventory, isError: false })).toBe("FRESH");
    });

    // THE REGRESSION THIS FUNCTION EXISTS FOR. A background refetch that fails
    // leaves the previous `data` in place and only raises `isError`, so the list
    // and the `at` next to it are pixel-identical to a fresh answer. Without
    // this branch the page states an instant it can no longer stand behind.
    it("reports STALE when data survives but the last refetch failed", () => {
      expect(inventoryFreshness({ inventory, isError: true })).toBe("STALE");
    });

    // Not the freshness question at all: with no data the page is already in
    // CATALOGUE_FALLBACK, which explains the failure in full. Reporting
    // staleness on top would be the same problem announced twice, in two
    // different registers.
    it("stays silent when the query failed with nothing to show", () => {
      expect(inventoryFreshness({ inventory: null, isError: true })).toBe(
        "NOT_APPLICABLE",
      );
    });
  });

  describe("resolutionMatchesSelection", () => {
    const asked = {
      action: "payment",
      actionType: "approved",
      collector: "bbva",
    };

    it("accepts an answer to exactly the question on screen", () => {
      expect(resolutionMatchesSelection(asked, { ...asked })).toBe(true);
    });

    // THE RACE. `resolve.reset()` clears the panel, but it cannot cancel a
    // mutationFn already in flight — the bbva answer still lands, seconds after
    // the reader moved on to santander. Read unguarded, it would repopulate the
    // panel under a cascade naming a different client, which is precisely the
    // "attributed to the wrong collector" failure this feature exists to stop.
    it("rejects an answer about a collector the reader has moved off", () => {
      expect(
        resolutionMatchesSelection(asked, { ...asked, collector: "santander" }),
      ).toBe(false);
    });

    // The generic and a named collector are opposite questions, and the
    // cheapest way to produce this race is to clear the field back to blank.
    it("rejects a named answer once the selection is back on the generic", () => {
      expect(resolutionMatchesSelection(asked, { ...asked, collector: "" })).toBe(
        false,
      );
      expect(
        resolutionMatchesSelection({ ...asked, collector: "" }, asked),
      ).toBe(false);
    });

    it("rejects an answer about another action or action type", () => {
      expect(
        resolutionMatchesSelection(asked, { ...asked, action: "withdrawal" }),
      ).toBe(false);
      expect(
        resolutionMatchesSelection(asked, { ...asked, actionType: "rejected" }),
      ).toBe(false);
    });

    // The server canonicalizes case, so `BBVA` and `bbva` are one client.
    // Comparing them literally would throw away a correct answer as if it
    // belonged to somebody else — the guard would then be causing the blank
    // panel it was written to prevent.
    it("matches the collector case-insensitively, as the server does", () => {
      expect(
        resolutionMatchesSelection(asked, { ...asked, collector: "BBVA" }),
      ).toBe(true);
    });

    // The mutation trims before sending, so the stored question is trimmed and
    // the live one may not be. A round trip must not turn that into a mismatch.
    it("ignores surrounding whitespace on every part", () => {
      expect(
        resolutionMatchesSelection(asked, {
          action: " payment ",
          actionType: " approved ",
          collector: "  bbva  ",
        }),
      ).toBe(true);
    });
  });

  describe("genericDelivery", () => {
    function withGeneric(
      generic: CollectorsInventoryResponse["generic"],
    ): CollectorsInventoryResponse {
      return {
        action: "payment",
        actionType: "approved",
        at: "2026-09-11T19:20:53Z",
        generic,
        collectors: [],
      };
    }

    it("reports SERVED when there is a servable generic to fall back to", () => {
      expect(
        genericDelivery(
          withGeneric({
            templateKey: "payment_approved",
            version: 1,
            status: "ACTIVE",
            servable: true,
          }),
        ),
      ).toBe("SERVED");
    });

    // THE case this distinction exists for. No generic means the send path
    // answers 404: nothing is delivered at all, which is a different and worse
    // situation than falling back to a baseline mail.
    it("reports MISSING when there is no generic at all", () => {
      expect(genericDelivery(withGeneric(null))).toBe("MISSING");
    });

    // Existence is not delivery. A generic that is a draft, archived or
    // scheduled for later delivers exactly as much as no generic: nothing.
    it("reports NOT_SERVABLE for a generic that exists but is not in effect", () => {
      expect(
        genericDelivery(
          withGeneric({
            templateKey: "payment_approved",
            version: 2,
            status: "DRAFT",
            servable: false,
          }),
        ),
      ).toBe("NOT_SERVABLE");
    });

    // Without an inventory the question is unanswered, and assuming the
    // comfortable answer would leave the page silent in precisely the case
    // where nothing is being delivered.
    it("claims nothing without an inventory", () => {
      expect(genericDelivery(null)).toBe("UNKNOWN");
    });
  });

  describe("findGroup", () => {
    it("resolves the triple to the one template it names", () => {
      expect(
        findGroup(catalogue, "payment", "approved", "")?.templateKey,
      ).toBe("payment_approved");
      expect(
        findGroup(catalogue, "payment", "approved", "bbva")?.templateKey,
      ).toBe("payment_approved__bbva");
    });

    // A group whose collector key never arrived is the generic. Reading it as
    // anything else would hide today's entire catalogue behind this lookup.
    it("resolves a blank collector to a group with no collector key at all", () => {
      expect(
        findGroup(
          [groupWithNoCollectorKey("payment_approved")],
          "payment",
          "approved",
          "",
        )?.templateKey,
      ).toBe("payment_approved");
    });

    // Whitespace is not a collector name. The control is a closed Select, so
    // this should be unreachable through it — but this function is not the
    // control's private helper: the resolve panel and the query-param round
    // trip both hand it values that were typed somewhere else. The API drops a
    // whitespace-only collector and answers with the generic, and this must
    // agree with that, or the catalogue would claim "no stored template" about
    // the very template the send path is about to use.
    it("reads a whitespace-only collector as the generic, as the API does", () => {
      expect(
        findGroup(catalogue, "payment", "approved", "   ")?.templateKey,
      ).toBe("payment_approved");
    });

    // The server canonicalizes case on the way in, so a case-sensitive lookup
    // would report "no such template" about a row the reader just picked.
    it("matches the collector case-insensitively, as the server does", () => {
      const groups = groupByTemplateKey([
        row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "BBVA"),
      ]);

      expect(findGroup(groups, "payment", "approved", "bbva")?.templateKey).toBe(
        "payment_approved__bbva",
      );
      expect(findGroup(catalogue, "payment", "approved", "BBVA")?.templateKey).toBe(
        "payment_approved__bbva",
      );
    });

    // Blank and a named collector are opposite instructions, and the generic
    // must never stand in for a variant that was asked for by name. This null
    // is the whole point of offering collectors the CATALOGUE does not have:
    // the inventory lists every client of the pair, servable variant or not, so
    // `santander` is pickable with nothing stored under it — and saying "there
    // is nothing here" is the answer the reader came for, not a lookup failure.
    it("returns null for a triple the catalogue does not have", () => {
      expect(findGroup(catalogue, "payment", "approved", "santander")).toBeNull();
      expect(findGroup(catalogue, "payment", "cancelled", "bbva")).toBeNull();
      expect(findGroup(catalogue, "refund", "approved", "bbva")).toBeNull();
      expect(findGroup(catalogue, "withdrawal", "create", "")).toBeNull();
    });

    // Only the first two steps can still be unanswered. Blank is no longer one
    // of them: with action and actionType known, an empty collector names the
    // generic and is looked up like any other value.
    it("returns null while action or action type is unanswered", () => {
      expect(findGroup(catalogue, "", "", "")).toBeNull();
      expect(findGroup(catalogue, "payment", "", "bbva")).toBeNull();
      expect(findGroup(catalogue, "", "approved", "bbva")).toBeNull();
    });
  });
});
