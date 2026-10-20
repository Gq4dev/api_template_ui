import { describe, expect, it } from "vitest";
import type { TemplateSummary } from "../../../api/types";
import type {
  CollectorsInventory,
  SelectOption,
  TemplateGroup,
} from "./browse.logic";
import {
  COLLECTORS_KNOWN_ELSEWHERE,
  COLLECTORS_STORED_HERE,
  EMPTY_BROWSE_SELECTION,
  WITHOUT_OWN_VARIANT,
  WITH_OWN_VARIANT,
  catalogueCollectorNames,
  collectorFirstActionData,
  collectorFirstActionTypeData,
  collectorFirstCollectorData,
  selectDataValues,
  switchBrowseMode,
  resolveSpellings,
  spellingSuffix,
  capSpellings,
  mergeInventoryAnswers,
  inventoryFromCatalogue,
  isServableAt,
  statusAtInstant,
  MAX_QUERIED_SPELLINGS,
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

    // BBVA and bbva are two clients to the server, each with its own key, so
    // they are two options — folding them would offer one name for two mails.
    it("keeps collectors that differ only in case apart", () => {
      const groups = groupByTemplateKey([
        row("payment_approved__BBVA", 1, "ACTIVE", "payment", "approved", "BBVA"),
        row("payment_rejected__bbva", 1, "ACTIVE", "payment", "rejected", "bbva"),
      ]);

      expect(catalogueCollectorGroups(groups, "payment", "approved")).toEqual([
        { group: COLLECTORS_STORED_HERE, items: ["BBVA"] },
        { group: COLLECTORS_KNOWN_ELSEWHERE, items: ["bbva"] },
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
    const inventory: CollectorsInventory = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      truncated: false,
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
    const inventory: CollectorsInventory = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      truncated: false,
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
    const inventory: CollectorsInventory = {
      action: "payment",
      actionType: "approved",
      at: "2026-09-11T19:20:53Z",
      truncated: false,
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

    // `BBVA` and `bbva` are two clients, so an answer about one is not an
    // answer about the other.
    it("matches the collector case-sensitively, as the server does", () => {
      expect(
        resolutionMatchesSelection(asked, { ...asked, collector: "BBVA" }),
      ).toBe(false);
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
      generic: CollectorsInventory["generic"],
    ): CollectorsInventory {
      return {
        action: "payment",
        actionType: "approved",
        at: "2026-09-11T19:20:53Z",
        truncated: false,
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

    // An incomplete catalogue cannot prove an absence: the generic may be in
    // the rows that were not read.
    it("claims nothing for a missing generic in a truncated inventory", () => {
      expect(genericDelivery({ ...withGeneric(null), truncated: true })).toBe("UNKNOWN");
    });

    it("still reads a generic that WAS found in a truncated inventory", () => {
      expect(
        genericDelivery({
          ...withGeneric({
            templateKey: "payment_approved",
            version: 2,
            status: "DRAFT",
            servable: false,
          }),
          truncated: true,
        }),
      ).toBe("NOT_SERVABLE");
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

    // The server stores and matches the collector exactly: BBVA's variant is
    // not bbva's, and finding one for the other would show the wrong mail.
    it("matches the collector case-sensitively, as the server does", () => {
      const groups = groupByTemplateKey([
        row("payment_approved__BBVA", 1, "ACTIVE", "payment", "approved", "BBVA"),
      ]);

      expect(findGroup(groups, "payment", "approved", "BBVA")?.templateKey).toBe(
        "payment_approved__BBVA",
      );
      expect(findGroup(groups, "payment", "approved", "bbva")).toBeNull();
      expect(findGroup(catalogue, "payment", "approved", "BBVA")).toBeNull();
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

describe("collector-first order", () => {
  const catalogue = groupByTemplateKey([
    row("payment_approved", 1, "ACTIVE", "payment", "approved"),
    row("payment_approved__bbva", 1, "ACTIVE", "payment", "approved", "bbva"),
    // Same name in another case: a different client to the server, so a
    // different option.
    row("payment_pending__BBVA", 1, "ARCHIVED", "payment", "pending", "BBVA"),
    // Same name with stray whitespace: trimmed, so the same client.
    row("payment_pending__bbva", 1, "ARCHIVED", "payment", "pending", " bbva "),
    row("payment_rejected", 1, "ACTIVE", "payment", "rejected"),
    row("withdrawal_create__santander", 1, "ACTIVE", "withdrawal", "create", "santander"),
    row("refund_done__blank", 1, "ACTIVE", "refund", "done", "   "),
  ]);

  describe("catalogueCollectorNames", () => {
    it("lists every distinct collector once, trimmed, sorted, without blanks", () => {
      expect(catalogueCollectorNames(catalogue)).toEqual(["bbva", "BBVA", "santander"]);
    });

    it("is empty for a catalogue of generics only", () => {
      expect(catalogueCollectorNames(groupByTemplateKey([row("a_b", 1, "ACTIVE")]))).toEqual([]);
    });
  });

  it("offers the generic first, then every stored collector", () => {
    expect(collectorFirstCollectorData(catalogue)).toEqual([
      { value: "", label: "Genérica" },
      { value: "bbva", label: "bbva" },
      { value: "BBVA", label: "BBVA" },
      { value: "santander", label: "santander" },
    ]);
  });

  describe("collectorFirstActionData", () => {
    // Every action stays: a client without a variant for an action still gets
    // mail for it, so filtering would hide most of what that client receives.
    it("lists ALL actions, split by whether the collector has a variant under any of their types", () => {
      expect(collectorFirstActionData(catalogue, "bbva")).toEqual([
        { group: WITH_OWN_VARIANT, items: [{ value: "payment", label: "payment" }] },
        {
          group: WITHOUT_OWN_VARIANT,
          items: [
            { value: "refund", label: "refund" },
            { value: "withdrawal", label: "withdrawal" },
          ],
        },
      ]);
    });

    it("matches the collector case-insensitively", () => {
      expect(collectorFirstActionData(catalogue, " BBVA ")).toEqual(
        collectorFirstActionData(catalogue, "bbva"),
      );
    });

    it("drops an empty heading instead of drawing it", () => {
      const onlyGenerics = groupByTemplateKey([row("payment_approved", 1, "ACTIVE")]);
      expect(collectorFirstActionData(onlyGenerics, "bbva")).toEqual([
        { group: WITHOUT_OWN_VARIANT, items: [{ value: "payment", label: "payment" }] },
      ]);
    });

    it("reduces to the template-first options for the generic", () => {
      expect(collectorFirstActionData(catalogue, "")).toEqual(actionOptions(catalogue));
    });
  });

  describe("collectorFirstActionTypeData", () => {
    it("lists every type of the action, marked for this exact pair", () => {
      expect(collectorFirstActionTypeData(catalogue, "bbva", "payment")).toEqual([
        {
          group: WITH_OWN_VARIANT,
          items: [
            { value: "approved", label: "approved" },
            { value: "pending", label: "pending" },
          ],
        },
        { group: WITHOUT_OWN_VARIANT, items: [{ value: "rejected", label: "rejected" }] },
      ]);
    });

    it("never leaks another action's types", () => {
      expect(selectDataValues(collectorFirstActionTypeData(catalogue, "bbva", "withdrawal"))).toEqual([
        "create",
      ]);
    });

    it("is empty before an action is chosen, and plain for the generic", () => {
      expect(collectorFirstActionTypeData(catalogue, "bbva", "")).toEqual([]);
      expect(collectorFirstActionTypeData(catalogue, "", "payment")).toEqual(
        actionTypeOptions(catalogue, "payment"),
      );
    });
  });

  it("flattens flat and grouped select data into values", () => {
    expect(
      selectDataValues([
        { value: "", label: "Genérica" },
        { group: "g", items: [{ value: "a", label: "A" }, "b"] },
      ]),
    ).toEqual(["", "a", "b"]);
  });

  describe("switchBrowseMode", () => {
    const FULL = {
      action: "payment",
      actionType: "approved",
      collector: "bbva",
      collectorPicked: false,
      version: 3,
    };

    describe("to COLLECTOR_FIRST", () => {
      it("keeps the whole triple, version included, when the collector is offered", () => {
        expect(switchBrowseMode(FULL, "COLLECTOR_FIRST", ["bbva", "santander"])).toEqual({
          ...FULL,
          collectorPicked: true,
        });
      });

      // The generic is always offered: blank is an answer once the pair is.
      it("keeps a generic triple", () => {
        const generic = { ...FULL, collector: "" };
        expect(switchBrowseMode(generic, "COLLECTOR_FIRST", [])).toEqual({
          ...generic,
          collectorPicked: true,
        });
      });

      it("adopts the offered spelling so the Select does not render blank", () => {
        expect(
          switchBrowseMode({ ...FULL, collector: " bbva " }, "COLLECTOR_FIRST", ["bbva"]).collector,
        ).toBe("bbva");
      });

      // Another case is another client, not another spelling of this one.
      it("does not adopt a collector that differs in case", () => {
        expect(
          switchBrowseMode({ ...FULL, collector: "BBVA" }, "COLLECTOR_FIRST", ["bbva"]),
        ).toEqual(EMPTY_BROWSE_SELECTION);
      });

      // An action carried into an order whose first step is empty would be a
      // filled, disabled field under an unanswered one.
      it("clears everything when the pair is unanswered", () => {
        expect(
          switchBrowseMode({ ...FULL, actionType: "", version: null }, "COLLECTOR_FIRST", ["bbva"]),
        ).toEqual(EMPTY_BROWSE_SELECTION);
      });

      it("clears everything when the collector is not offered", () => {
        expect(switchBrowseMode(FULL, "COLLECTOR_FIRST", ["santander"])).toEqual(
          EMPTY_BROWSE_SELECTION,
        );
      });
    });

    describe("to TEMPLATE_FIRST", () => {
      const PICKED = { ...FULL, collectorPicked: true };

      it("keeps the whole triple when the pair's list offers the collector", () => {
        expect(switchBrowseMode(PICKED, "TEMPLATE_FIRST", ["", "bbva"])).toEqual(FULL);
      });

      it("lands on the generic, without a version, when the collector is not offered", () => {
        expect(switchBrowseMode(PICKED, "TEMPLATE_FIRST", ["", "santander"])).toEqual({
          ...EMPTY_BROWSE_SELECTION,
          action: "payment",
          actionType: "approved",
        });
      });

      it("keeps an action alone, and drops a collector chosen ahead of it", () => {
        expect(
          switchBrowseMode(
            { ...EMPTY_BROWSE_SELECTION, action: "payment", collector: "bbva", collectorPicked: true },
            "TEMPLATE_FIRST",
            ["bbva"],
          ),
        ).toEqual({ ...EMPTY_BROWSE_SELECTION, action: "payment" });
      });

      it("clears a collector-only selection", () => {
        expect(
          switchBrowseMode(
            { ...EMPTY_BROWSE_SELECTION, collector: "bbva", collectorPicked: true },
            "TEMPLATE_FIRST",
            ["bbva"],
          ),
        ).toEqual(EMPTY_BROWSE_SELECTION);
      });
    });
  });
});

// The explicit generic is an ANSWER in the collector-first order (picked, blank),
// so a full generic triple must survive the trip back like any other.
describe("switchBrowseMode — explicit generic", () => {
  it("keeps a collector-first generic triple, version included, going template-first", () => {
    const generic = {
      action: "payment",
      actionType: "approved",
      collector: "",
      collectorPicked: true,
      version: 2,
    };
    expect(switchBrowseMode(generic, "TEMPLATE_FIRST", ["", "bbva"])).toEqual({
      ...generic,
      collectorPicked: false,
    });
  });
});

/*
  The live catalogue, reduced: the generic and bbva stored as PAYMENT/APPROVED,
  dell as payment/approved. The backend identifies all three canonically (one
  `payment_approved` family) but stores and matches the raw spelling.
*/
describe("canonical action names", () => {
  const drifted = groupByTemplateKey([
    row("payment_approved", 3, "ACTIVE", "PAYMENT", "APPROVED"),
    row("payment_approved__bbva", 1, "ACTIVE", "PAYMENT", "APPROVED", "bbva"),
    row("payment_approved__dell", 1, "ACTIVE", "payment", "approved", "dell"),
    row("payment_rejected", 1, "ACTIVE", "PAYMENT", "REJECTED"),
  ]);

  it("says nothing about a single spelling and counts several", () => {
    expect(spellingSuffix(1)).toBe("");
    expect(spellingSuffix(3)).toBe(" · 3 formas de escritura");
  });

  // Two options used to split one template's variants across two branches.
  it("offers PAYMENT and payment as ONE action, marked as written two ways", () => {
    expect(actionOptions(drifted)).toEqual([
      { value: "payment", label: "payment (4) · 2 formas de escritura" },
    ]);
  });

  it("keeps a consistently written name in the spelling it is stored in", () => {
    expect(
      actionOptions(groupByTemplateKey([row("payment_approved", 1, "ACTIVE", "PAYMENT", "APPROVED")])),
    ).toEqual([{ value: "payment", label: "PAYMENT (1)" }]);
  });

  it("narrows action types canonically, marking only the drifted one", () => {
    expect(actionTypeOptions(drifted, "payment")).toEqual([
      { value: "approved", label: "approved (3) · 2 formas de escritura" },
      { value: "rejected", label: "REJECTED (1)" },
    ]);
    expect(actionTypeOptions(drifted, "PAYMENT")).toEqual(actionTypeOptions(drifted, "payment"));
  });

  it("finds every template of the canonical pair, whatever its stored spelling", () => {
    expect(findGroup(drifted, "payment", "approved", "dell")?.templateKey).toBe(
      "payment_approved__dell",
    );
    expect(findGroup(drifted, "payment", "approved", "bbva")?.templateKey).toBe(
      "payment_approved__bbva",
    );
    expect(findGroup(drifted, "payment", "approved", "")?.templateKey).toBe("payment_approved");
  });

  it("counts a variant stored in another spelling as stored HERE", () => {
    expect(catalogueCollectorGroups(drifted, "payment", "approved")).toEqual([
      { group: COLLECTORS_STORED_HERE, items: ["bbva", "dell"] },
    ]);
  });

  it("marks collector-first options canonically", () => {
    expect(collectorFirstActionData(drifted, "dell")).toEqual([
      {
        group: WITH_OWN_VARIANT,
        items: [{ value: "payment", label: "payment · 2 formas de escritura" }],
      },
    ]);
    expect(collectorFirstActionTypeData(drifted, "dell", "payment")).toEqual([
      {
        group: WITH_OWN_VARIANT,
        items: [{ value: "approved", label: "approved · 2 formas de escritura" }],
      },
      { group: WITHOUT_OWN_VARIANT, items: [{ value: "rejected", label: "REJECTED" }] },
    ]);
  });

  // An answer asked in the stored PAYMENT spelling answers the canonical selection.
  it("matches a resolution asked in a stored spelling against the canonical selection", () => {
    const current = { action: "payment", actionType: "approved", collector: "dell" };
    expect(
      resolutionMatchesSelection({ ...current, action: "PAYMENT", actionType: "APPROVED" }, current),
    ).toBe(true);
    expect(
      resolutionMatchesSelection({ ...current, action: "PAYMENT", actionType: "REJECTED" }, current),
    ).toBe(false);
  });

  describe("resolveSpellings", () => {
    it("returns every stored spelling of the pair, most common first", () => {
      expect(resolveSpellings(drifted, "payment", "approved")).toEqual([
        { action: "PAYMENT", actionType: "APPROVED" },
        { action: "payment", actionType: "approved" },
      ]);
    });

    it("is a single call for a pair written one way", () => {
      expect(resolveSpellings(drifted, "payment", "rejected")).toEqual([
        { action: "PAYMENT", actionType: "REJECTED" },
      ]);
    });

    it("asks in the pair itself when nothing is stored, and not at all while unanswered", () => {
      expect(resolveSpellings(drifted, "refund", "done")).toEqual([
        { action: "refund", actionType: "done" },
      ]);
      expect(resolveSpellings(drifted, "payment", "")).toEqual([]);
    });
  });
});

describe("capSpellings", () => {
  const spellings = Array.from({ length: 7 }, (_, i) => ({
    action: `payment${"_".repeat(i)}`,
    actionType: "approved",
  }));

  it("queries at most MAX_QUERIED_SPELLINGS, keeping the most common first", () => {
    const { queried, omitted } = capSpellings(spellings);
    expect(MAX_QUERIED_SPELLINGS).toBe(5);
    expect(queried).toEqual(spellings.slice(0, 5));
    expect(omitted).toBe(2);
  });

  it("omits nothing at or under the cap", () => {
    expect(capSpellings(spellings.slice(0, 5))).toEqual({
      queried: spellings.slice(0, 5),
      omitted: 0,
    });
    expect(capSpellings(spellings.slice(0, 2), 5).omitted).toBe(0);
  });
});

describe("mergeInventoryAnswers", () => {
  const entry = (collector: string, version: number, servable: boolean) => ({
    collector,
    templateKey: `payment_approved__${collector}`,
    version,
    status: (servable ? "ACTIVE" : "DRAFT") as TemplateSummary["status"],
    servable,
  });
  const GENERIC = {
    templateKey: "payment_approved",
    version: 3,
    status: "ACTIVE" as const,
    servable: true,
  };
  const answer = (
    at: string,
    collectors: ReturnType<typeof entry>[],
    generic: typeof GENERIC | null = GENERIC,
    truncated = false,
  ) => ({
    data: {
      action: "PAYMENT",
      actionType: "APPROVED",
      at,
      collectors,
      generic,
      truncated,
    } as CollectorsInventory,
    isLoading: false,
    isError: false,
  });

  it("passes a single spelling's answer through untouched", () => {
    const only = answer("2026-09-15T10:00:00Z", [entry("bbva", 1, true)]);
    const merged = mergeInventoryAnswers([only]);
    expect(merged.inventory).toBe(only.data);
    expect(merged.divergentCollectors.size).toBe(0);
  });

  // The live finding: dell is only in the payment/approved answer.
  it("counts every collector once across spellings, sorted by name", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", [entry("ibm", 1, true), entry("bbva", 1, true)]),
      answer("2026-09-15T10:05:00Z", [entry("dell", 10, true), entry("bbva", 1, true)]),
    ]);
    expect(merged.inventory?.collectors.map((c) => c.collector)).toEqual(["bbva", "dell", "ibm"]);
    expect(merged.divergentCollectors.size).toBe(0);
  });

  it("flags a collector whose servable or version differs by spelling", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", [entry("bbva", 1, true), entry("ibm", 2, true)]),
      answer("2026-09-15T10:05:00Z", [entry("bbva", 1, false), entry("ibm", 3, true)]),
    ]);
    expect([...merged.divergentCollectors].sort()).toEqual(["bbva", "ibm"]);
    // The first (most common) spelling's entry is the one kept.
    expect(merged.inventory?.collectors.find((c) => c.collector === "bbva")?.servable).toBe(true);
  });

  it("dates the merge by the OLDEST answer", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", []),
      answer("2026-09-15T09:58:00Z", []),
    ]);
    expect(merged.inventory?.at).toBe("2026-09-15T09:58:00Z");
  });

  it("marks the merge as errored when any spelling failed, keeping what arrived", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", [entry("bbva", 1, true)]),
      { data: null, isLoading: false, isError: true },
    ]);
    expect(merged.isError).toBe(true);
    expect(merged.inventory?.collectors).toHaveLength(1);
  });

  it("shows nothing while any spelling is still on its first load", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", [entry("bbva", 1, true)]),
      { data: null, isLoading: true, isError: false },
    ]);
    expect(merged).toMatchObject({ inventory: null, isLoading: true });
  });

  it("has no inventory when every spelling failed", () => {
    expect(
      mergeInventoryAnswers([
        { data: null, isLoading: false, isError: true },
        { data: null, isLoading: false, isError: true },
      ]),
    ).toMatchObject({ inventory: null, isError: true });
  });

  it("takes the first generic present and flags disagreement about it", () => {
    const merged = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", [], null),
      answer("2026-09-15T10:05:00Z", [], GENERIC),
    ]);
    expect(merged.inventory?.generic).toEqual(GENERIC);
    expect(merged.genericDivergent).toBe(true);

    const agreeing = mergeInventoryAnswers([
      answer("2026-09-15T10:05:00Z", []),
      answer("2026-09-15T10:05:00Z", []),
    ]);
    expect(agreeing.genericDivergent).toBe(false);
  });

  it("is truncated when any spelling's answer is", () => {
    const complete = answer("2026-09-15T10:05:00Z", []);
    expect(
      mergeInventoryAnswers([complete, answer("2026-09-15T10:05:00Z", [], GENERIC, true)])
        .inventory?.truncated,
    ).toBe(true);
    expect(mergeInventoryAnswers([complete, complete]).inventory?.truncated).toBe(false);
  });
});

describe("inventoryFromCatalogue", () => {
  const NOW = Date.parse("2026-10-20T12:00:00Z");
  const FETCHED = Date.parse("2026-10-20T11:58:00Z");
  const version = (
    templateKey: string,
    collector: string | null,
    v: number,
    status: TemplateSummary["status"],
    effectiveFrom: string | null = null,
    effectiveTo: string | null = null,
  ): TemplateSummary => ({
    templateKey,
    version: v,
    status,
    action: "payment",
    actionType: "approved",
    collector,
    subject: null,
    effectiveFrom,
    effectiveTo,
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const PAIR = { action: "payment", actionType: "approved" };

  it("reports the version the send path would pick, not the highest number", () => {
    const rows = [
      version("payment_approved", null, 1, "ACTIVE", "2026-01-01T00:00:00Z"),
      // Published later, and scheduled for tomorrow: not what goes out today.
      version("payment_approved", null, 2, "SCHEDULED", "2026-10-21T00:00:00Z"),
      version("payment_approved", null, 3, "DRAFT"),
    ];
    const inventory = inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false);
    expect(inventory.generic).toEqual({
      templateKey: "payment_approved",
      version: 1,
      status: "ACTIVE",
      servable: true,
    });
    expect(inventory.collectors).toEqual([]);
    expect(inventory.at).toBe("2026-10-20T11:58:00.000Z");
  });

  it("breaks an effectiveFrom tie by the higher version, like the server", () => {
    const from = "2026-01-01T00:00:00Z";
    const rows = [
      version("payment_approved", null, 4, "ACTIVE", from),
      version("payment_approved", null, 5, "ACTIVE", from),
    ];
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false).generic?.version).toBe(5);
  });

  it("keeps a collector with nothing servable, at its latest version", () => {
    const rows = [
      version("payment_approved__bbva", "bbva", 1, "DRAFT"),
      version("payment_approved__bbva", "bbva", 2, "DRAFT"),
      version("payment_approved__amex", "amex", 1, "ACTIVE", "2026-01-01T00:00:00Z"),
    ];
    const inventory = inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false);
    expect(inventory.generic).toBeNull();
    expect(inventory.collectors).toEqual([
      { collector: "amex", templateKey: "payment_approved__amex", version: 1, status: "ACTIVE", servable: true },
      { collector: "bbva", templateKey: "payment_approved__bbva", version: 2, status: "DRAFT", servable: false },
    ]);
  });

  it("re-reads effectivity windows at the evaluation instant", () => {
    // Listed as SCHEDULED when fetched, live by the time the page re-renders.
    const rows = [version("payment_approved", null, 1, "SCHEDULED", "2026-10-20T11:59:00Z")];
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false).generic).toMatchObject({
      status: "ACTIVE",
      servable: true,
    });
    // effectiveTo is exclusive.
    const expired = [
      version("payment_approved", null, 1, "ACTIVE", "2026-01-01T00:00:00Z", "2026-10-20T12:00:00Z"),
    ];
    expect(inventoryFromCatalogue(expired, PAIR, FETCHED, NOW, false).generic).toMatchObject({
      status: "ARCHIVED",
      servable: false,
    });
  });

  it("matches the stored spelling exactly", () => {
    const rows = [
      { ...version("payment_approved", null, 1, "ACTIVE", "2026-01-01T00:00:00Z"), action: "PAYMENT" },
    ];
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false).generic).toBeNull();
    expect(
      inventoryFromCatalogue(rows, { action: "PAYMENT", actionType: "approved" }, FETCHED, NOW, false)
        .generic,
    ).not.toBeNull();
  });

  // The server's resolve filters on effective_from <= at, which never matches a
  // null: a published row without a start is reported as stored but never served.
  it("never serves an ACTIVE or SCHEDULED row without effectiveFrom", () => {
    const rows = [
      version("payment_approved", null, 1, "ACTIVE"),
      version("payment_approved", null, 2, "SCHEDULED"),
    ];
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false).generic).toEqual({
      templateKey: "payment_approved",
      version: 2,
      status: "SCHEDULED",
      servable: false,
    });
    expect(isServableAt(version("k", null, 1, "ACTIVE"), NOW)).toBe(false);
    expect(isServableAt(version("k", null, 1, "ACTIVE", "2026-01-01T00:00:00Z"), NOW)).toBe(true);

    // A started version still wins over a start-less one with a higher number.
    const mixed = [
      version("payment_approved", null, 1, "ACTIVE", "2026-01-01T00:00:00Z"),
      version("payment_approved", null, 2, "ACTIVE"),
    ];
    expect(inventoryFromCatalogue(mixed, PAIR, FETCHED, NOW, false).generic).toMatchObject({
      version: 1,
      servable: true,
    });
  });

  it("carries the catalogue's truncation onto the answer", () => {
    const rows = [version("payment_approved__bbva", "bbva", 1, "ACTIVE", "2026-01-01T00:00:00Z")];
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, true).truncated).toBe(true);
    expect(inventoryFromCatalogue(rows, PAIR, FETCHED, NOW, false).truncated).toBe(false);
  });

  it("takes DRAFT and ARCHIVED as reported", () => {
    expect(statusAtInstant(version("k", null, 1, "ARCHIVED", "2026-01-01T00:00:00Z"), NOW)).toBe(
      "ARCHIVED",
    );
    expect(statusAtInstant(version("k", null, 1, "DRAFT"), NOW)).toBe("DRAFT");
  });
});
