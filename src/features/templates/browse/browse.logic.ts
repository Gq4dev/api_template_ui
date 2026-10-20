// Pure shaping for the browse view: turn a flat page of versions into the
// choices the reader actually makes.
//
// Those choices mirror the resource's real identity rather than its storage
// name. A template is not a key — it is an action, an action type and a
// collector, and the key is DERIVED from that triple (see `deriveTemplateKey`
// in ../../../lib/collector). Asking for the triple asks a question the reader
// can answer from the incident in front of them; asking for the key asks them
// to already know the answer.
//
// No React and no network here so the grouping, the narrowing and the "which
// version is in effect" rule can be tested directly, which is where the subtle
// bugs live.
import type {
  TemplateContentResponse,
  TemplateStatus,
  TemplateSummary,
} from "../../../api/types";
import { normalizeCollector } from "../../../lib/collector";
import {
  canonicalActionName,
  storedSpellings,
  type ActionSpelling,
} from "../../../lib/actionNames";

export interface TemplateGroup {
  templateKey: string;
  action: string;
  actionType: string;
  /**
   * The collector this key overrides for, or null for the generic.
   *
   * Safe to hold once per group rather than per version: the collector is baked
   * into the templateKey (`payment_approved__bbva`), so every version under one
   * key necessarily shares it. That is not true of `action`, which is why that
   * one needs {@link groupsWithMixedActions} watching it.
   */
  collector: string | null;
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
      collector: row.collector ?? null,
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

/**
 * The marker for a name the catalogue writes more than one way.
 *
 * Said in the option label rather than hidden, because it is not cosmetic: the
 * backend matches action/actionType EXACTLY on /resolve, so two spellings of one
 * template are two different answers for whoever sends the mail. The reader
 * should know before picking that the send-path panel will come back with more
 * than one.
 */
export function spellingSuffix(count: number): string {
  return count > 1 ? ` · ${count} formas de escritura` : "";
}

/** One canonical name, the raw spellings stored under it, and how many keys. */
interface CanonicalBucket {
  value: string;
  /** Raw spelling → number of keys stored with it. */
  spellings: Map<string, number>;
  keys: number;
}

function bucketByCanonical(
  groups: TemplateGroup[],
  pick: (group: TemplateGroup) => string,
): CanonicalBucket[] {
  const buckets = new Map<string, CanonicalBucket>();
  for (const group of groups) {
    const raw = pick(group);
    const value = canonicalActionName(raw);
    // A name made only of punctuation has no identity — the backend refuses to
    // create one — and its "" would collide with "not answered yet".
    if (value === "") continue;
    const bucket = buckets.get(value) ?? { value, spellings: new Map(), keys: 0 };
    bucket.keys += 1;
    bucket.spellings.set(raw, (bucket.spellings.get(raw) ?? 0) + 1);
    buckets.set(value, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * The name shown for a bucket: the stored spelling when there is only one, so a
 * catalogue written consistently in PAYMENT keeps reading PAYMENT; the canonical
 * form when there are several, because picking either raw one would present the
 * other as not existing.
 */
function bucketName(bucket: CanonicalBucket): string {
  return bucket.spellings.size === 1 ? [...bucket.spellings.keys()][0] : bucket.value;
}

/**
 * The first step of the cascade: every action the catalogue knows about.
 *
 * Built from the catalogue rather than a fixed list because the catalogue is
 * the only honest source of what exists. An action offered here with nothing
 * behind it would hand the reader a dead end two clicks deep, and one missing
 * from here would hide templates behind the control whose job is to find them.
 *
 * GROUPED BY CANONICAL NAME, and the VALUE is that canonical name. The backend
 * decides identity canonically — `PAYMENT` and `payment` derive the same
 * templateKey — but stores and matches the raw spelling, and the live catalogue
 * holds both. Offering them as two actions split one template across two
 * branches of the cascade, each showing only some of its variants. One option
 * per canonical name puts every variant back under one template, and the label
 * says when that template is written more than one way.
 *
 * The count rides in the label because it is the piece of information that
 * makes the choice before the click: "payment (12)" says this branch of the
 * tree is wide, "closing (1)" says the next two steps are already decided.
 */
export function actionOptions(groups: TemplateGroup[]): SelectOption[] {
  return bucketByCanonical(groups, (group) => group.action).map((bucket) => ({
    value: bucket.value,
    label: `${bucketName(bucket)} (${bucket.keys})${spellingSuffix(bucket.spellings.size)}`,
  }));
}

/**
 * The second step: the action types recorded under one action.
 *
 * `action` is compared CANONICALLY, and the result is grouped the same way. It
 * used to be compared exactly as stored, on the theory that two spellings in
 * the catalogue were two distinct options the reader could see and choose
 * between. The live data retired that theory: the spellings are not a choice
 * anyone made, they are drift — the same template written PAYMENT by one caller
 * and payment by another — and the backend itself treats them as one identity.
 * Exact comparison hid half of a template's variants behind whichever spelling
 * the reader did not pick.
 *
 * Empty in, empty out: with no action chosen there is no subset to describe,
 * and inventing one would offer action types that belong to other actions.
 */
export function actionTypeOptions(
  groups: TemplateGroup[],
  action: string,
): SelectOption[] {
  if (action === "") return [];
  const wanted = canonicalActionName(action);

  return bucketByCanonical(
    groups.filter((group) => canonicalActionName(group.action) === wanted),
    (group) => group.actionType,
  ).map((bucket) => ({
    value: bucket.value,
    label: `${bucketName(bucket)} (${bucket.keys})${spellingSuffix(bucket.spellings.size)}`,
  }));
}

/** One dropdown heading and the names under it, in Mantine's grouped shape. */
export interface CollectorCatalogueGroup {
  group: string;
  items: string[];
}

/**
 * The two headings, named rather than inlined.
 *
 * They are exported because they are the CONTRACT of the grouping, not
 * decoration on top of it: the whole value of splitting the list is that a
 * reader can tell, before typing, which half of it leads to versions they can
 * act on. A test that re-typed the copy would pin the wording while leaving the
 * meaning free to drift; pinning the constants pins the distinction and leaves
 * one place to change if the wording ever improves.
 *
 * Each says the CONSEQUENCE of picking from it, not the mechanism that built
 * it. "Stored for this template" means the catalogue panel will have versions
 * to show — drafts, published, archived — and the buttons that edit, publish
 * and archive will be live. "Known elsewhere" means this name exists in the
 * catalogue but not under this action/actionType, so the catalogue panel has
 * nothing to show and the only question left worth asking about it is the
 * send-path one.
 */
export const COLLECTORS_STORED_HERE = "Guardados en esta plantilla";
export const COLLECTORS_KNOWN_ELSEWHERE =
  "Conocidos en otra parte — sin nada guardado aquí";

/**
 * Every collector name the CATALOGUE knows, split by whether it has anything
 * stored under the pair currently chosen.
 *
 * THE FALLBACK SOURCE, and only that. The Collector step is fed by the
 * inventory (`inventoryFromCatalogue`), which reports per collector whether its
 * variant is servable and whether a generic exists to fall back to. This
 * function is what fills the control while there is no inventory to read — the
 * catalogue still loading, or failed — and it is the less truthful answer: it
 * cannot report `servable` at all, so a draft variant is indistinguishable here
 * from one going out today.
 *
 * It used to feed a free-text Autocomplete as mere suggestions, which is why
 * the names arrive bare. They are OPTIONS now, and the two headings are what
 * keeps the reduced list honest about what each name leads to.
 *
 * WHY BOTH GROUPS, AND NOT JUST THE FIRST. This used to return only the
 * collectors holding a variant for the exact pair on screen, which sounds
 * disciplined and hides precisely the names worth typing. If `bbva` has a
 * variant for payment/rejected but not for payment/approved, then standing on
 * payment/approved the field offered NOTHING — yet `bbva` is exactly the
 * collector somebody would want to ask about there, because "what does bbva
 * actually get for payment/approved?" is the fallback question this whole
 * feature exists to answer. A suggestion list that goes empty at the moment the
 * interesting question becomes askable is worse than no list at all: it reads
 * as "we have never heard of any collector", which is false.
 *
 * The second group is therefore built from the FULL catalogue and never from
 * anything already narrowed by the selection. Narrowing it would reintroduce
 * the same blindness one level down.
 *
 * The split is not cosmetic — the two halves have different consequences, and
 * the headings above state them. Group one lands in catalogue mode with
 * versions to inspect, edit, publish or archive. Group two cannot: nothing is
 * stored under this triple, so the catalogue panel will say so and the
 * send-path panel is the only one with an answer.
 *
 * Plain names, no "(2)" counts. The counts earn their place on the two Select
 * steps above because there they describe how wide the branch behind each
 * option is. Here a count would describe how many versions were STORED, which
 * is the one thing this list must not be read as a statement about: the reader
 * is choosing a client, and "bbva (3)" invites them to conclude something about
 * what that client receives from a number that only counts rows.
 *
 * There is no "Generic" entry in either group. It is prepended once by
 * {@link catalogueCollectorData}, so both the inventory list and this one grow
 * it in exactly one place and cannot disagree about its label or its value.
 *
 * Empty in, empty out, for the same reason as {@link actionTypeOptions}: with
 * no pair chosen there is no "stored here" to split on, so the whole question
 * the grouping answers has not been asked yet.
 */
export function catalogueCollectorGroups(
  groups: TemplateGroup[],
  action: string,
  actionType: string,
): CollectorCatalogueGroup[] {
  if (action === "" || actionType === "") return [];

  // Sets keyed by the NORMALIZED (trimmed) name. Case is kept: `BBVA` and
  // `bbva` are two clients to the server, so both are offered. Deduping across
  // the whole catalogue and
  // not per group matters more here than it did before: a name can now reach
  // this list from several action/actionType pairs at once, each free to spell
  // it differently.
  //
  // `== null` and not `=== null`: the deployed API omits the field entirely, so
  // a group arrives with the key genuinely ABSENT rather than present-and-null.
  // Both readings mean the same thing — nobody overrode this template — and
  // both are silence here, since the generic needs no suggestion.
  const storedHere = new Set<string>();
  const anywhere = new Set<string>();

  for (const group of groups) {
    if (group.collector == null) continue;

    // A collector that normalizes to nothing is the generic wearing whitespace.
    // It must not become an option: its value would be the blank that already
    // means "the generic", so the list would carry two entries claiming the
    // same value, and one of them would be labelled with spaces.
    const name = normalizeCollector(group.collector);
    if (name === "") continue;

    anywhere.add(name);
    // Canonical, like the cascade that produced `action`/`actionType`: a variant
    // stored as `payment` is stored under the template the reader picked as
    // PAYMENT, and must not be relegated to "known elsewhere".
    if (
      canonicalActionName(group.action) === canonicalActionName(action) &&
      canonicalActionName(group.actionType) === canonicalActionName(actionType)
    ) {
      storedHere.add(name);
    }
  }

  const sorted = (names: string[]) =>
    names.sort((a, b) => a.localeCompare(b));

  const here = sorted([...storedHere]);
  // Subtracting group one is what keeps a name from appearing twice. A reader
  // who saw `bbva` under both headings would have to decide which one they
  // meant, and the two headings make contradictory promises about what happens
  // next — so membership of the first group is exclusive by construction.
  const elsewhere = sorted([...anywhere].filter((name) => !storedHere.has(name)));

  // An empty group is dropped rather than rendered, because Mantine would draw
  // the heading anyway: a lone "Stored for this template" with nothing beneath
  // it states that something IS stored here, which is the opposite of what an
  // empty group means.
  const suggestions: CollectorCatalogueGroup[] = [];
  if (here.length > 0) {
    suggestions.push({ group: COLLECTORS_STORED_HERE, items: here });
  }
  if (elsewhere.length > 0) {
    suggestions.push({ group: COLLECTORS_KNOWN_ELSEWHERE, items: elsewhere });
  }
  return suggestions;
}

/**
 * The blank option, defined once.
 *
 * The VALUE IS THE EMPTY STRING because that is the API's own spelling of "the
 * generic": absent or empty means the template nobody overrode, in the
 * `collector` query parameter and in `deriveTemplateKey` alike. A sentinel like
 * `__generic__` would be a second spelling of it living only in this UI, and
 * every boundary it crossed — the resolve call, the catalogue lookup, the reset
 * that clears the field — would need code to translate it back.
 *
 * The LABEL is a word rather than an empty row, for the reason `collectorLabel`
 * exists: an empty option reads as missing data, and this one is a decision.
 */
const GENERIC_COLLECTOR_OPTION: SelectOption = {
  value: "",
  label: "Genérica",
};

/** What a Mantine Select can be handed: flat options, or headed groups of them. */
export type CollectorSelectData = Array<SelectOption | CollectorCatalogueGroup>;

/**
 * The Collector options, built from the inventory.
 *
 * The generic goes FIRST and always, even when `inventory.generic` is null.
 * Its presence in the list is not a claim that a generic template exists — it
 * is the "no collector asked for" question, which stays askable and stays
 * answerable (the answer being "nothing is stored for this pair", which the
 * catalogue panel says perfectly well). Dropping the option when the generic is
 * null would remove the reader's only way to look at the baseline and find out
 * that there isn't one.
 *
 * The inventory's ORDER IS PRESERVED, not re-sorted here: it is already sorted
 * by collector name, and a second sort rule in this function would be one more
 * place to drift from it.
 *
 * Value and label are both the collector name: this is a closed list, so the
 * value that leaves the control is a name the catalogue already holds, which is
 * precisely why no format validation survives on this field. What the option
 * adds beyond the name — the version, the status, whether it is actually being
 * served — cannot live in a string label; it is rendered per option by the
 * component, from these same entries.
 */
export function inventoryCollectorData(
  entries: CollectorInventoryEntry[],
): CollectorSelectData {
  return [
    GENERIC_COLLECTOR_OPTION,
    ...entries.map((entry) => ({
      value: entry.collector,
      label: entry.collector,
    })),
  ];
}

/**
 * The same options, built from the stored catalogue instead — the degraded path.
 *
 * Identical in shape so the control does not branch on where its data came
 * from, and identical in its first entry so the generic never moves. What
 * differs is what it can KNOW, which is why the page shows a notice alongside
 * it rather than letting the two look the same: these names are the ones with
 * something authored, and nothing here reports whether any of it is servable.
 */
export function catalogueCollectorData(
  groups: TemplateGroup[],
  action: string,
  actionType: string,
): CollectorSelectData {
  return [
    GENERIC_COLLECTOR_OPTION,
    ...catalogueCollectorGroups(groups, action, actionType),
  ];
}

// --- Collector-first browsing ----------------------------------------------
//
// The same triple, asked in a different order: Collector → Action → Action type.
// It exists for the question an operator brings from a client's ticket — "what
// does bbva get?" — where the client is the one thing they know for sure and the
// action is what they still have to find. Nothing downstream changes: the
// version select, the resolution, and every button that acts on a version still
// receive exactly (action, actionType, collector). Only the ENTRY ORDER differs.

/** Which order the selection card asks its questions in. */
export type BrowseMode =
  /** Action → Action type → Collector. The default, and the original order. */
  | "TEMPLATE_FIRST"
  /** Collector → Action → Action type. */
  | "COLLECTOR_FIRST";

/**
 * The two headings the Action and Action type steps are split under once a
 * named collector is chosen.
 *
 * "Sin variante propia" and deliberately NOT "Usa la genérica". The catalogue
 * can say whether this collector has something STORED under an action; it
 * cannot say that a servable generic exists to fall back to — that is the
 * inventory's `generic` field, and the red alert on the page is where a missing
 * one is announced. A heading promising the generic would be the list claiming
 * a delivery it has no way to know about.
 *
 * "Con variante propia" means stored, not served: a draft variant counts. The
 * version select further down is where the status is read.
 */
export const WITH_OWN_VARIANT = "Con variante propia";
export const WITHOUT_OWN_VARIANT = "Sin variante propia";

/** Headed options in Mantine's grouped shape, with value/label items. */
export interface SelectOptionGroup {
  group: string;
  items: SelectOption[];
}

export type GroupedSelectData = Array<SelectOption | SelectOptionGroup>;

/**
 * Every distinct collector name in the stored catalogue, normalized and sorted.
 *
 * THE ONLY SOURCE THE COLLECTOR-FIRST ORDER HAS. The inventory answers per
 * action pair, and in this order no pair has been chosen yet, so there is no
 * pair to ask "which clients exist?" about. The catalogue is the honest answer
 * and the page says what it omits: a client nobody authored anything for is
 * absent here, exactly as it is from {@link catalogueCollectorGroups}.
 *
 * Deduped by the same rules as that function — trimmed, keeping case, because
 * `BBVA` and `bbva` are two clients, and with whitespace-only names dropped, because those
 * are the generic wearing spaces and would duplicate the blank option's value.
 */
export function catalogueCollectorNames(groups: TemplateGroup[]): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    if (group.collector == null) continue;
    const name = normalizeCollector(group.collector);
    if (name !== "") names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The first step of the collector-first order: the generic, then every name.
 *
 * The generic is first for the same reason it is first in the other order — it
 * is the one entry that is always a meaningful question — and it is the same
 * option object, so both orders agree on its value and label.
 */
export function collectorFirstCollectorData(groups: TemplateGroup[]): SelectOption[] {
  return [
    GENERIC_COLLECTOR_OPTION,
    ...catalogueCollectorNames(groups).map((name) => ({ value: name, label: name })),
  ];
}

function hasVariantFor(
  group: TemplateGroup,
  collector: string,
): boolean {
  return group.collector != null && normalizeCollector(group.collector) === collector;
}

/**
 * Splits options into the two headings, dropping an empty one.
 *
 * An empty heading is dropped for the reason given in
 * {@link catalogueCollectorGroups}: Mantine draws the heading anyway, and a lone
 * "Con variante propia" with nothing under it asserts the opposite of the truth.
 */
function markByVariant(
  options: SelectOption[],
  hasVariant: (value: string) => boolean,
): SelectOptionGroup[] {
  const withOwn: SelectOption[] = [];
  const without: SelectOption[] = [];
  for (const option of options) {
    (hasVariant(option.value) ? withOwn : without).push(option);
  }
  const data: SelectOptionGroup[] = [];
  if (withOwn.length > 0) data.push({ group: WITH_OWN_VARIANT, items: withOwn });
  if (without.length > 0) data.push({ group: WITHOUT_OWN_VARIANT, items: without });
  return data;
}

/** Canonical buckets as plain options: the name and its spelling marker, no count. */
function plainOptions(buckets: CanonicalBucket[]): SelectOption[] {
  return buckets.map((bucket) => ({
    value: bucket.value,
    label: `${bucketName(bucket)}${spellingSuffix(bucket.spellings.size)}`,
  }));
}

/**
 * The Action step once a collector is chosen.
 *
 * EVERY ACTION, not only the ones this collector has a variant for. A client
 * with no variant for an action still receives mail for it — through the
 * generic — so hiding those actions would hide most of what the client actually
 * gets, and the send-path panel is precisely the tool for asking about them.
 * The headings carry the distinction instead of the filter.
 *
 * An action lands under "Con variante propia" when the collector has a variant
 * for AT LEAST ONE of its action types; the next step says which. Grouped and
 * matched canonically, like {@link actionOptions}, so a variant stored as
 * `payment` marks the same option as one stored as `PAYMENT`.
 *
 * Plain names, no counts. The counts in {@link actionOptions} count keys across
 * every collector, which under a chosen collector would describe other clients'
 * templates and read as a statement about this one.
 *
 * The GENERIC collector reduces to the template-first options exactly: with no
 * collector there is no variant to mark, and the generic path is today's path.
 */
export function collectorFirstActionData(
  groups: TemplateGroup[],
  collector: string,
): GroupedSelectData {
  const name = normalizeCollector(collector);
  if (name === "") return actionOptions(groups);

  return markByVariant(
    plainOptions(bucketByCanonical(groups, (group) => group.action)),
    (action) =>
      groups.some(
        (group) => canonicalActionName(group.action) === action && hasVariantFor(group, name),
      ),
  );
}

/**
 * The Action type step under a chosen collector and action — same rules one
 * level down: every type of the action, marked by whether this collector has a
 * variant stored for that exact canonical pair. Empty until an action is chosen.
 */
export function collectorFirstActionTypeData(
  groups: TemplateGroup[],
  collector: string,
  action: string,
): GroupedSelectData {
  if (action === "") return [];
  const name = normalizeCollector(collector);
  if (name === "") return actionTypeOptions(groups, action);

  const wanted = canonicalActionName(action);
  const underAction = groups.filter((group) => canonicalActionName(group.action) === wanted);
  return markByVariant(
    plainOptions(bucketByCanonical(underAction, (group) => group.actionType)),
    (actionType) =>
      underAction.some(
        (group) =>
          canonicalActionName(group.actionType) === actionType && hasVariantFor(group, name),
      ),
  );
}

/** Every selectable value in flat or grouped Select data, in order. */
export function selectDataValues(
  data: Array<SelectOption | { group: string; items: Array<SelectOption | string> }>,
): string[] {
  return data.flatMap((entry) =>
    "group" in entry
      ? entry.items.map((item) => (typeof item === "string" ? item : item.value))
      : [entry.value],
  );
}

/** What the selection card holds, independent of the order it was asked in. */
export interface BrowseSelection {
  action: string;
  actionType: string;
  /** `""` is the generic, as everywhere else on this page. */
  collector: string;
  /**
   * Whether the Collector step has been answered. Only the collector-first
   * order needs it: there the collector comes FIRST, so a blank can mean either
   * "the generic" or "not asked yet", and the control has to tell them apart
   * the same way the template-first order does with its `null` value.
   */
  collectorPicked: boolean;
  version: number | null;
}

export const EMPTY_BROWSE_SELECTION: BrowseSelection = {
  action: "",
  actionType: "",
  collector: "",
  collectorPicked: false,
  version: null,
};

/**
 * What survives a switch between the two orders.
 *
 * THE RULE: keep the longest prefix of the selection that is still answered and
 * still offered IN THE NEW ORDER, and clear everything after it. The version is
 * kept only when the whole triple is.
 *
 * Why a prefix and not "keep whatever is set". Each order disables a step until
 * the one before it is answered. Carrying an action into the collector-first
 * order with no collector chosen would leave a filled, disabled field under an
 * empty one — a half-selection that looks answered and cannot be edited. The
 * prefix rule makes that state unreachable by construction.
 *
 * Concretely:
 *
 * - To COLLECTOR_FIRST the collector is the first step, and in the template
 *   order it is only an answer once the pair above it is. So: the full triple
 *   survives when the pair is answered and the collector is offered; otherwise
 *   nothing does.
 * - To TEMPLATE_FIRST the action is first. An action alone survives; an action
 *   and type survive; the collector survives on top of them only if the new
 *   order offers it. When it is not offered the collector lands on the generic —
 *   the same thing choosing an action type does in that order — rather than on a
 *   value its Select would render as a blank box.
 *
 * `availableCollectors` is what the DESTINATION order will offer for the
 * collector step: the catalogue names for the collector-first order, the pair's
 * current list for the template-first one. The kept collector is replaced by the
 * offered spelling, because a Mantine Select whose value is not one of its
 * option values renders blank even when the two differ only in case.
 */
export function switchBrowseMode(
  selection: BrowseSelection,
  to: BrowseMode,
  availableCollectors: string[],
): BrowseSelection {
  const wanted = normalizeCollector(selection.collector);
  const offered =
    wanted === ""
      ? ""
      : availableCollectors.find((name) => normalizeCollector(name) === wanted);
  const pairAnswered = selection.action !== "" && selection.actionType !== "";

  if (to === "COLLECTOR_FIRST") {
    if (!pairAnswered || offered === undefined) return EMPTY_BROWSE_SELECTION;
    return { ...selection, collector: offered, collectorPicked: true };
  }

  if (selection.action === "") return EMPTY_BROWSE_SELECTION;
  if (selection.actionType === "") {
    return { ...EMPTY_BROWSE_SELECTION, action: selection.action };
  }
  if (offered === undefined) {
    return {
      ...EMPTY_BROWSE_SELECTION,
      action: selection.action,
      actionType: selection.actionType,
    };
  }
  return { ...selection, collector: offered, collectorPicked: false };
}

/**
 * Where the Collector options are coming from — which is a statement about how
 * much the page is entitled to claim, not a loading flag.
 */
export type CollectorSource =
  /** The pair above is unanswered. There is no question to fetch an answer to. */
  | "AWAITING_PAIR"
  /** The inventory is in flight and nothing has been shown yet. */
  | "LOADING"
  /** The inventory answered. Every collector is accounted for, `servable` included. */
  | "INVENTORY"
  /**
   * The inventory could not be reached, so the options are derived from the
   * stored catalogue. STRICTLY LESS TRUTHFUL, and the page must say so: a
   * collector nobody authored anything for cannot appear at all, and no name in
   * the list can be reported as served or not served.
   */
  | "CATALOGUE_FALLBACK";

/**
 * Which of the four, from the pair and the query's state.
 *
 * `inventory` wins over `isLoading` on purpose: a background refetch (this
 * query is never stale-cached, so there are many) leaves real data on screen,
 * and swapping it for a spinner would blank a perfectly good list several times
 * a session.
 *
 * Everything that is not one of the first three is the fallback — an error, or
 * a settled query with no data. Naming the error case specifically would invite
 * the page to distinguish a 404 from a timeout, and the reader's next move is
 * the same for both: use the reduced list and know it is reduced.
 */
export function collectorSource(input: {
  action: string;
  actionType: string;
  isLoading: boolean;
  inventory: CollectorsInventory | null;
}): CollectorSource {
  if (input.action === "" || input.actionType === "") return "AWAITING_PAIR";
  if (input.inventory) return "INVENTORY";
  if (input.isLoading) return "LOADING";
  return "CATALOGUE_FALLBACK";
}

/**
 * Whether the inventory on screen is the CURRENT answer or the last one we
 * managed to get.
 */
export type InventoryFreshness =
  /** Nothing is being claimed from the inventory, so there is nothing to date. */
  | "NOT_APPLICABLE"
  /** The list on screen is what the last completed fetch returned. */
  | "FRESH"
  /**
   * There IS a list on screen, and the most recent attempt to refresh it
   * failed. The data is still useful — it was true at the `at` printed next to
   * it — but it is older than that line alone implies.
   */
  | "STALE";

/**
 * Which of the three, from the query's data and its error flag.
 *
 * THIS EXISTS BECAUSE A FAILED BACKGROUND REFETCH IS INVISIBLE. TanStack keeps
 * the last successful `data` when a refetch fails and only raises `isError`, so
 * a page reading `data` alone renders a blown refresh and a fresh answer
 * identically — same list, same `at`, no difference at all. After a blip in
 * the catalogue refetch the inventory derived from it would keep its old `at`,
 * and the reader would go on trusting a timestamp that stopped advancing.
 *
 * `data` is checked first on purpose. With no data and an error the page is
 * already in `CATALOGUE_FALLBACK`, and the catalogue error says the whole story;
 * reporting staleness on top of it would be the same failure told twice.
 */
export function inventoryFreshness(input: {
  inventory: CollectorsInventory | null;
  isError: boolean;
}): InventoryFreshness {
  if (!input.inventory) return "NOT_APPLICABLE";
  return input.isError ? "STALE" : "FRESH";
}

/**
 * What a collector with no servable variant of its own actually receives.
 *
 * The question the `generic` field exists to answer, and the one place the
 * difference between "falls back" and "gets nothing" is decided.
 */
export type GenericDelivery =
  /** No inventory, so it cannot be known from here. Claim nothing. */
  | "UNKNOWN"
  /** There is a servable generic. A collector without its own version gets it. */
  | "SERVED"
  /**
   * A generic template exists but is not servable at `at` — a draft, an
   * archived version, one scheduled for later. It delivers exactly as much as
   * no generic at all: nothing. Kept apart from MISSING because the fix is
   * different — this one is published, that one is written.
   */
  | "NOT_SERVABLE"
  /**
   * There is no generic template at all. Any collector not in the list, and any
   * collector in it with `servable: false`, gets a 404 FROM THE SEND PATH —
   * no mail is delivered. This is not the ordinary fallback and must never be
   * worded like it.
   */
  | "MISSING";

/**
 * Reads it off the inventory.
 *
 * Note it answers UNKNOWN for a missing inventory rather than assuming the
 * comfortable case. "Probably there is a generic" rendered as silence is the same class of bug as
 * reading an absent `fallbackToGeneric` as `false`: the page would be quietest
 * in exactly the situation where nothing is being delivered.
 *
 * UNKNOWN, too, for no generic in a TRUNCATED inventory: the generic may be in
 * the rows that were not read, and claiming MISSING would be a red alert built
 * on an absence the page cannot vouch for.
 */
export function genericDelivery(
  inventory: CollectorsInventory | null,
): GenericDelivery {
  if (!inventory) return "UNKNOWN";
  if (inventory.generic == null) return inventory.truncated ? "UNKNOWN" : "MISSING";
  return inventory.generic.servable ? "SERVED" : "NOT_SERVABLE";
}

/**
 * Resolves the cascade's triple to the one template it names.
 *
 * The triple IS the identity, so this is a lookup and not a search: at most one
 * group can match. The templateKey is deliberately not rebuilt from the parts
 * to find it — `deriveTemplateKey` mirrors the server's rule, and mirroring is
 * exactly what stops being true the day the server's rule changes. Matching on
 * the stored fields asks the data what it is instead of predicting what it
 * should have been called.
 *
 * Every part is compared the way the server decides IDENTITY, which is not the
 * way it stores it. The collector is compared trimmed and case-sensitive, so
 * `BBVA` and `bbva` are two clients. Action and action type are identified
 * canonically (`canonicalActionName`) — the live catalogue holds PAYMENT and
 * payment under keys derived from the same `payment_approved` — and the cascade
 * hands this function canonical names. A lookup that compared any part exactly
 * would report "no such template" about a row sitting right there in the list
 * the reader just picked from.
 *
 * A BLANK collector means the generic, and it is an ANSWER rather than a gap.
 * That is the API's rule, not ours — "collector absent or empty" is how every
 * caller has always asked for the template nobody overrode — so once action and
 * actionType are known there is no third question left waiting: an empty
 * collector names `payment_approved` exactly as `bbva` names
 * `payment_approved__bbva`. This is why the sentinel that used to stand in for
 * the generic is gone, even though the control is a closed Select again: it
 * existed only so a dropdown could tell "not answered yet" apart from "the
 * generic", and that distinction belongs to the CONTROL, not to this lookup.
 * The page draws it by handing the Select `null` while the pair above is
 * unanswered, so the placeholder shows and the state itself stays `""` — which
 * leaves this function exactly one meaning to read out of a blank.
 *
 * Returning null is therefore a real statement — "nothing is stored under this
 * triple" — and not "keep waiting". The caller renders it as the fallback
 * warning it is.
 */
export function findGroup(
  groups: TemplateGroup[],
  action: string,
  actionType: string,
  collector: string,
): TemplateGroup | null {
  if (action === "" || actionType === "") return null;

  const normalized = normalizeCollector(collector);
  const wanted = normalized === "" ? null : normalized;
  const wantedAction = canonicalActionName(action);
  const wantedType = canonicalActionName(actionType);

  return (
    groups.find((group) => {
      if (
        canonicalActionName(group.action) !== wantedAction ||
        canonicalActionName(group.actionType) !== wantedType
      ) {
        return false;
      }
      if (wanted === null) return group.collector == null;
      return (
        group.collector != null && normalizeCollector(group.collector) === wanted
      );
    }) ?? null
  );
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

/**
 * What the resolution panel is actually allowed to claim.
 *
 * Four outcomes, not two. The pair the panel used to render — "fell back" and
 * "served its own" — quietly assumed the API had answered the collector
 * question at all, and that assumption is false against the build deployed
 * today.
 */
export type ResolutionOutcome =
  /** No collector was asked for. The generic IS the answer, not a consolation. */
  | "GENERIC_REQUESTED"
  /** The collector's own variant is what the send path puts in the envelope. */
  | "COLLECTOR_SERVED"
  /** A collector was asked for; the generic is what goes out. */
  | "FELL_BACK"
  /** The API did not answer the collector question — neither yes nor no. */
  | "UNREPORTED";

/**
 * The shape this function is willing to be handed.
 *
 * Deliberately WIDER than {@link TemplateContentResponse}, whose
 * `fallbackToGeneric` is non-optional. That DTO describes the contract the API
 * team published, and it stays as it is — but the contract is not yet deployed:
 * the collector dimension lives on an unmerged backend branch, and the running
 * server drops the `collector` query parameter on the floor and answers with a
 * body carrying NEITHER `collector` NOR `fallbackToGeneric`. Typing this
 * parameter as the full response would be the UI telling itself a comforting
 * lie about bytes it has already seen arrive without those keys.
 */
export type ResolutionContent = Partial<
  Pick<TemplateContentResponse, "collector" | "fallbackToGeneric">
>;

/**
 * Decides which of the four things happened, from the response and the question.
 *
 * Lives here, pure and framework-free, because "absent is not false" is a rule
 * with branches and a regression worth pinning down in tests — which is this
 * module's entire reason to exist.
 */
export function resolutionOutcome(
  content: ResolutionContent,
  requestedCollector: string,
): ResolutionOutcome {
  // Nothing was asked about any collector, so nothing can have fallen back.
  if (requestedCollector.trim() === "") return "GENERIC_REQUESTED";

  // The server answered without ever mentioning the dimension. Key ABSENCE is
  // what is being tested here, with `in` rather than `== null`, because a
  // server that DOES implement the dimension reports a fallback as
  // `collector: null` — an explicit "the generic was served". Null is an
  // answer; a missing key is silence, and the two must not collapse into one.
  if (
    typeof content.fallbackToGeneric !== "boolean" &&
    !("collector" in content)
  ) {
    return "UNREPORTED";
  }

  if (content.fallbackToGeneric === true) return "FELL_BACK";

  // Belt and braces for a server that reports the served collector but drops
  // the flag: we asked for a named collector and what came back is the generic,
  // which is a fallback by definition regardless of what the flag says or fails
  // to say.
  //
  // The `in` check is load-bearing, not decoration. Without it this reads
  // `content.collector == null`, and `undefined == null` is true — so a body of
  // `{ fallbackToGeneric: false }`, where the server EXPLICITLY said "no, it did
  // not fall back", would be answered with FELL_BACK. That is the function
  // contradicting the only clear statement the response made. Requiring the key
  // to be present keeps the rule to what it was written for: `collector: null`
  // is the server naming the generic as the thing it served, which is proof of a
  // fallback all by itself. A key that never arrived proves nothing, and this
  // branch must not read it as evidence.
  if ("collector" in content && content.collector == null) return "FELL_BACK";

  return "COLLECTOR_SERVED";
}

/** The three cascade values a resolution was asked about, or is being read under. */
export interface ResolutionSelection {
  action: string;
  actionType: string;
  collector: string;
}

/**
 * Whether a resolution still answers the question currently on screen.
 *
 * THE RACE THIS CLOSES. The page clears the panel with `resolve.reset()` in an
 * effect keyed on the cascade, but `reset()` only wipes the observer's local
 * state at the instant it runs — TanStack does NOT cancel a `mutationFn` that
 * is already in flight, and when that promise settles it writes `data` back onto
 * the same observer. Pick `bbva`, press the button, switch to `santander` while
 * the response is slow, and the bbva answer lands seconds later under a cascade
 * that says santander. The banner then names one collector while every control
 * above it names another — which is the "attributed to the wrong collector"
 * failure this whole panel exists to prevent, arriving through the back door.
 *
 * So the result carries the question it was asked, and the page reads it as an
 * answer only while all three parts still match. A late arrival simply fails
 * this check and stays invisible; nothing has to be cancelled for the page to
 * stay honest.
 *
 * The collector is compared through {@link normalizeCollector} because the
 * value stored in the result was trimmed on the way out. Case is compared as
 * is: `BBVA` and `bbva` are two clients, so an answer about one is not an
 * answer about the other.
 * Action and action type are compared CANONICALLY. The selection on screen
 * holds canonical names, while a resolution is asked in a raw stored spelling —
 * `PAYMENT` when the catalogue writes it that way — because the send path
 * matches exactly. Both name the same template, so an exact compare would throw
 * away every answer asked in a spelling that differs from the canonical one.
 */
export function resolutionMatchesSelection(
  asked: ResolutionSelection,
  current: ResolutionSelection,
): boolean {
  return (
    canonicalActionName(asked.action) === canonicalActionName(current.action) &&
    canonicalActionName(asked.actionType) === canonicalActionName(current.actionType) &&
    normalizeCollector(asked.collector) === normalizeCollector(current.collector)
  );
}

/**
 * The raw spellings the send path must be asked in for one canonical pair.
 *
 * WHY MORE THAN ONE CALL CAN BE RIGHT. /resolve matches action/actionType
 * exactly as stored. When the catalogue holds a pair in two spellings — live,
 * the generic and most variants as PAYMENT/APPROVED, the dell variant as
 * payment/approved — a sender's answer depends on which spelling it sends:
 * PAYMENT for dell silently falls back to the generic, payment for bbva 404s.
 * Asking in only one spelling would report one of those as the truth.
 *
 * BOUNDED BY THE CATALOGUE: exactly the distinct (action, actionType) raw pairs
 * stored under the canonical pair, across every collector, most common first —
 * never a combination nobody stored. With a single spelling it is one entry and
 * the panel makes the same single call it always made.
 *
 * With nothing stored (the cascade cannot produce that, but a caller could) the
 * pair itself is returned, so the question still gets asked once.
 */
export function resolveSpellings(
  groups: TemplateGroup[],
  action: string,
  actionType: string,
): ActionSpelling[] {
  if (action === "" || actionType === "") return [];
  const stored = storedSpellings(groups, action, actionType);
  if (stored.length === 0) return [{ action, actionType }];
  return stored.map((spelling) => ({
    action: spelling.action,
    actionType: spelling.actionType,
  }));
}

/**
 * The most spellings of one pair the page will fan out to.
 *
 * Every spelling costs one /resolve call (plus a local render) and one
 * inventory derivation. The catalogue bounds that list today — the live drift is two
 * spellings — but nothing bounds the catalogue, and a pair written ten ways
 * would turn one button press into twenty requests. Five covers every realistic
 * drift and keeps the worst case small; the page says when it stopped short.
 */
export const MAX_QUERIED_SPELLINGS = 5;

/**
 * The spellings actually queried, and how many were left out.
 *
 * The most common spellings are the ones kept — the list arrives sorted that
 * way — because they are the ones the most keys, and so most senders, use.
 */
export function capSpellings(
  spellings: ActionSpelling[],
  max: number = MAX_QUERIED_SPELLINGS,
): { queried: ActionSpelling[]; omitted: number } {
  return {
    queried: spellings.slice(0, max),
    omitted: Math.max(0, spellings.length - max),
  };
}

// --- The collector inventory, derived from the catalogue -------------------
//
// The API has no endpoint that lists every collector of an action pair; the
// one this page was first built against (`GET /collectors`) never shipped. The
// question it answered is still the one the Collector step asks — who has a
// variant, whether that variant is what actually goes out, and whether there
// is a generic to fall back to — and every fact needed to answer it is already
// in the full catalogue the page loads anyway. So it is answered here, from
// those rows, by the same precedence the send path uses.

/** One collector's answer for one action pair. */
export interface CollectorInventoryEntry {
  /** The client this row is about, exactly as stored. */
  collector: string;
  templateKey: string;
  /**
   * The version that would ACTUALLY BE SERVED at `at` — never simply the
   * highest number stored. When nothing is servable, the latest version, so a
   * draft variant still shows up as the thing somebody wrote and is not sending.
   */
  version: number;
  /** Derived at the evaluation instant, see {@link statusAtInstant}. */
  status: TemplateStatus;
  /**
   * Whether this collector's own variant is what the send path would put in
   * the envelope. THE FIELD THAT MATTERS — existence is not delivery.
   *
   * A collector with nothing servable STILL APPEARS, with `servable: false`:
   * "somebody wrote something and it is not going out" and "nobody wrote
   * anything" call for opposite next moves, and dropping the row would turn
   * the first into the second.
   */
  servable: boolean;
}

export interface CollectorsInventory {
  action: string;
  actionType: string;
  /**
   * How current the answer is: the instant the catalogue behind it was READ.
   *
   * Effectivity windows are evaluated against the clock when the inventory is
   * derived, so a version scheduled for 09:00 reads as live at 09:00 without a
   * refetch. But DRAFT and ARCHIVED are decisions somebody writes, and those are
   * only as fresh as the rows — so the line that dates the list prints the
   * older of the two instants, never the comfortable "now".
   */
  at: string;
  /**
   * The fallback destination, and A SEPARATE FIELD ON PURPOSE — it is not one
   * client's override but the template every OTHER client gets, including every
   * client that does not appear in `collectors` at all.
   *
   * NULL IS THE DANGEROUS CASE AND IT IS NOT A FALLBACK: with no generic, any
   * collector without a servable version of its own gets a 404 from the send
   * path. A generic that exists but is not servable delivers exactly as much,
   * which is why `servable` is here too.
   */
  generic: Omit<CollectorInventoryEntry, "collector"> | null;
  /** One entry per collector, sorted by name in code-point order. */
  collectors: CollectorInventoryEntry[];
  /**
   * The catalogue behind this answer was not read in full (see `FullCatalogue`).
   *
   * Then an ABSENCE proves nothing: a null `generic` or a collector missing from
   * `collectors` may simply sit in the rows that were not read. What is present
   * is still true; what is missing is unknown, and must never be shown as "no
   * generic" or "no variant".
   */
  truncated: boolean;
}

/**
 * A version's status at `at`, mirroring the server's `TemplateVersion.statusAt`.
 *
 * DRAFT and ARCHIVED are decisions and are taken as reported. SCHEDULED and
 * ACTIVE are only where the clock sits against the effectivity window, so they
 * are recomputed here rather than trusted: the list reports them as of the
 * instant it was SERVED, and that instant falls further behind every minute
 * the page stays open. `effectiveTo` is exclusive, as on the server.
 *
 * An ARCHIVED row may be one that simply expired — the list says ARCHIVED for
 * both. That is safe because `at` is never earlier than the fetch: a window
 * that had closed then is still closed now.
 *
 * A published row with no `effectiveFrom` is reported as stored, as the server
 * does — but that is a STATUS, not delivery: see `isServableAt`.
 */
export function statusAtInstant(row: TemplateSummary, at: number): TemplateStatus {
  if (row.status === "DRAFT" || row.status === "ARCHIVED") return row.status;
  if (row.effectiveFrom == null) return row.status;
  if (at < Date.parse(row.effectiveFrom)) return "SCHEDULED";
  if (row.effectiveTo != null && at >= Date.parse(row.effectiveTo)) return "ARCHIVED";
  return "ACTIVE";
}

/**
 * Whether the send path would serve `row` at `at`.
 *
 * ACTIVE at `at` AND with a start. The server's resolve filters on
 * `effective_from <= at`, and that comparison never matches a null, so an
 * ACTIVE (or SCHEDULED) row stored without `effective_from` is never served —
 * even though `statusAtInstant` reports it as ACTIVE, like the server's
 * `statusAt` does.
 */
export function isServableAt(row: TemplateSummary, at: number): boolean {
  return row.effectiveFrom != null && statusAtInstant(row, at) === "ACTIVE";
}

/**
 * What one templateKey would serve at `at`: the servable version with the
 * latest `effectiveFrom`, ties broken by the higher version — the send path's
 * own order. Failing that, the latest version, reported as not servable.
 */
function inventoryEntryFor(
  versions: TemplateSummary[],
  at: number,
): Omit<CollectorInventoryEntry, "collector"> {
  let served: TemplateSummary | null = null;
  let servedFrom = Number.NEGATIVE_INFINITY;
  for (const row of versions) {
    // `isServableAt` already guarantees a start; the check narrows the type.
    if (!isServableAt(row, at) || row.effectiveFrom == null) continue;
    const from = Date.parse(row.effectiveFrom);
    if (
      served == null ||
      from > servedFrom ||
      (from === servedFrom && row.version > served.version)
    ) {
      served = row;
      servedFrom = from;
    }
  }
  if (served) {
    return {
      templateKey: served.templateKey,
      version: served.version,
      status: "ACTIVE",
      servable: true,
    };
  }

  const latest = versions.reduce((best, row) => (row.version > best.version ? row : best));
  return {
    templateKey: latest.templateKey,
    version: latest.version,
    status: statusAtInstant(latest, at),
    servable: false,
  };
}

/**
 * The inventory of one stored spelling of an action pair, out of the catalogue.
 *
 * Matches action/actionType EXACTLY, like the send path does: the caller asks
 * once per stored spelling (`resolveSpellings`) and merges the answers
 * (`mergeInventoryAnswers`), so this function must not quietly fold spellings
 * together itself.
 *
 * Covers the same set the server-side inventory would have: every collector
 * with something stored for the pair. A client with nothing stored is absent
 * here and is answered for by `generic`.
 *
 * @param fetchedAt when the rows were read — becomes `at`, see {@link CollectorsInventory.at}
 * @param now the instant the effectivity windows are evaluated at
 * @param truncated whether `rows` is an incomplete catalogue, see {@link CollectorsInventory.truncated}
 */
export function inventoryFromCatalogue(
  rows: TemplateSummary[],
  spelling: ActionSpelling,
  fetchedAt: number,
  now: number,
  truncated: boolean,
): CollectorsInventory {
  const byKey = new Map<string, TemplateSummary[]>();
  for (const row of rows) {
    if (row.action !== spelling.action || row.actionType !== spelling.actionType) continue;
    const versions = byKey.get(row.templateKey) ?? [];
    versions.push(row);
    byKey.set(row.templateKey, versions);
  }

  let generic: CollectorsInventory["generic"] = null;
  const collectors: CollectorInventoryEntry[] = [];
  for (const versions of byKey.values()) {
    const entry = inventoryEntryFor(versions, now);
    const collector = versions[0].collector;
    if (collector == null) {
      generic = entry;
    } else {
      collectors.push({ collector, ...entry });
    }
  }
  collectors.sort((a, b) =>
    a.collector < b.collector ? -1 : a.collector > b.collector ? 1 : 0,
  );

  return {
    action: spelling.action,
    actionType: spelling.actionType,
    at: new Date(fetchedAt).toISOString(),
    generic,
    collectors,
    truncated,
  };
}

/** One spelling's inventory, reduced to what the merge needs. */
export interface InventoryAnswer {
  data: CollectorsInventory | null;
  isLoading: boolean;
  isError: boolean;
}

export interface MergedInventory {
  /** Null while any spelling is still on its first load, or when none answered. */
  inventory: CollectorsInventory | null;
  /**
   * Normalized collectors whose answer DIFFERS by spelling: they appear in more
   * than one answer and disagree on `servable` or `version`.
   */
  divergentCollectors: Set<string>;
  /** The spellings that answered disagree about the generic. */
  genericDivergent: boolean;
  isLoading: boolean;
  /** Any spelling failed — the merge is missing that spelling's answer. */
  isError: boolean;
}

function instantOf(at: string): number {
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

/**
 * One Collector list out of one inventory per stored spelling.
 *
 * WHY THERE IS MORE THAN ONE ANSWER. The send path matches action/actionType
 * exactly as stored, and so does `inventoryFromCatalogue`. On the old API,
 * which stored spellings raw, asking only as PAYMENT/APPROVED left out dell,
 * whose variant was stored as payment/approved — the list showed four
 * collectors with variants when there were five. Each stored spelling is asked
 * separately (the same bounded set the resolve panel uses) and the answers are
 * merged here.
 *
 * THE MERGE RULES, each chosen so the merged list claims no more than the
 * answers behind it:
 *
 * - Collectors are merged by NORMALIZED name and counted once. The entry kept
 *   is the first spelling's (the most common one), and a collector that
 *   appears in several answers with a different `servable` or `version` is
 *   flagged: its delivery depends on how the sender spells the action, and the
 *   option says so.
 * - The generic is the first answer's non-null generic, and disagreement
 *   (present in one, absent or different in another) is flagged too.
 * - `at` is the OLDEST instant among the answers: the merged list is only as
 *   current as its least current part.
 * - Any failed spelling marks the merge as errored, which the page shows as
 *   stale — the list is missing that spelling's collectors.
 * - While any spelling is still on its FIRST load there is no merge at all, so
 *   the list never appears half-built and then grows.
 *
 * With a single spelling the answer passes through untouched.
 */
export function mergeInventoryAnswers(answers: InventoryAnswer[]): MergedInventory {
  const isLoading = answers.some((answer) => answer.isLoading);
  const isError = answers.some((answer) => answer.isError);
  const empty = {
    divergentCollectors: new Set<string>(),
    genericDivergent: false,
    isLoading,
    isError,
  };

  const arrived = answers
    .map((answer) => answer.data)
    .filter((data): data is CollectorsInventory => data != null);
  if (isLoading || arrived.length === 0) return { inventory: null, ...empty };
  if (answers.length === 1) return { inventory: arrived[0], ...empty };

  const byName = new Map<
    string,
    { entry: CollectorInventoryEntry; servable: Set<boolean>; versions: Set<number> }
  >();
  for (const data of arrived) {
    for (const entry of data.collectors) {
      const name = normalizeCollector(entry.collector);
      const seen = byName.get(name);
      if (seen) {
        seen.servable.add(entry.servable);
        seen.versions.add(entry.version);
      } else {
        byName.set(name, {
          entry,
          servable: new Set([entry.servable]),
          versions: new Set([entry.version]),
        });
      }
    }
  }

  const divergentCollectors = new Set<string>();
  for (const [name, seen] of byName) {
    if (seen.servable.size > 1 || seen.versions.size > 1) divergentCollectors.add(name);
  }

  // Re-sorted, unlike a single answer: each server list is sorted, but their
  // concatenation is not, and the option list must stay scannable.
  const collectors = [...byName.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, seen]) => seen.entry);

  const generics = arrived.map((data) => data.generic);
  const generic = generics.find((entry) => entry != null) ?? null;
  const genericDivergent = generics.some(
    (entry) =>
      (entry == null) !== (generic == null) ||
      (entry != null &&
        generic != null &&
        (entry.servable !== generic.servable || entry.version !== generic.version)),
  );

  const oldest = arrived.reduce((best, data) =>
    instantOf(data.at) < instantOf(best.at) ? data : best,
  );

  return {
    inventory: {
      ...arrived[0],
      at: oldest.at,
      collectors,
      generic,
      // Incomplete if any part is: the merge is only as complete as its parts.
      truncated: arrived.some((data) => data.truncated),
    },
    divergentCollectors,
    genericDivergent,
    isLoading,
    isError,
  };
}
