import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { SelectProps } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { PageHeader } from "../../../app/PageHeader";
import { fromVersionHref, isPublishedStatus } from "../create/createForm.logic";
import {
  CATALOGUE_PAGE_SIZE,
  MAX_CATALOGUE_PAGES,
  useFullCatalogue,
} from "../../../queries/fullCatalogue";
import { useRowPreview } from "../../../queries/useRowPreview";
import { useResolveByAction } from "../../../queries/useResolveByAction";
import { useCollectorsInventories } from "../../../queries/useCollectorsInventory";
import { useArchiveTemplate } from "../../../queries/useArchiveTemplate";
import { usePublishTemplate } from "../../../queries/usePublishTemplate";
import { toUiError } from "../../../lib/errors";
import { collectorLabel, normalizeCollector } from "../../../lib/collector";
import type { PreviewVariant } from "../../../preview/protocol";
import { RenderedEmail } from "../RenderedEmail";
import { ResolutionAnswer } from "./ResolutionAnswer";
import { STATUS_COLOR, collectorBadgeColor } from "./browseStyle";
import {
  actionOptions,
  actionTypeOptions,
  catalogueCollectorData,
  catalogueCollectorNames,
  collectorFirstActionData,
  collectorFirstActionTypeData,
  collectorFirstCollectorData,
  collectorSource,
  defaultVersion,
  findGroup,
  findVersion,
  genericDelivery,
  groupByTemplateKey,
  groupsWithMixedActions,
  inventoryCollectorData,
  inventoryFreshness,
  resolutionMatchesSelection,
  resolveSpellings,
  capSpellings,
  mergeInventoryAnswers,
  MAX_QUERIED_SPELLINGS,
  selectDataValues,
  switchBrowseMode,
  versionOptions,
  type BrowseMode,
  type CollectorInventoryEntry,
} from "./browse.logic";


/**
 * The instant the inventory's rows were read, in the reader's own clock.
 *
 * Rendered rather than hidden because the list is a PHOTOGRAPH of the stored
 * decisions: a draft published or a version archived by somebody else since
 * then is not in it. "Now" would claim a freshness the rows do not have.
 *
 * Locale left to the browser (`undefined`) on purpose: pinning es-AR here would
 * print one office's format on every machine, and the instant is the same one
 * either way.
 *
 * Falls back to the raw string rather than printing "Invalid Date", which would
 * read as a broken clock instead of as a value we could not parse.
 */
function formatInstant(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Browse: name a template, then ask either of the two questions about it.
 *
 * Replaces the filter-and-scan table as the way in. The table asked the reader
 * to find a row among dozens before they could look at anything; here the
 * choices that identify a template ARE the interface, and the answers sit
 * underneath them where answers belong.
 *
 * Those choices are a CASCADE — action, then action type, then collector —
 * because that triple is the template's real identity and the templateKey is
 * merely derived from it (`payment_approved__bbva`, see lib/collector). A flat
 * list of every key asked the reader to already know the key they wanted, which
 * is the one thing someone opening this page does not have. Asking for the
 * triple asks the question they can answer from the incident in front of them,
 * and it puts the collector on screen as the third axis it is rather than as a
 * suffix buried at the end of a long string.
 *
 * ONE SET OF CONTROLS, TWO QUESTIONS. The page used to carry a second panel with
 * its own Action / Action type / Collector inputs, because the two questions it
 * answers are genuinely different:
 *
 *   - the CATALOGUE question — "what have we authored?" — which reaches every
 *     stored version, drafts and archives included, and is the only one whose
 *     answer you can edit, publish or archive;
 *   - the SEND-PATH question — "what does this client actually get right now?" —
 *     which reaches exactly one version, the one the notification service would
 *     put in the envelope, and which is worth asking hardest about a collector
 *     that has no variant at all.
 *
 * Two questions never justified two copies of the same three inputs. What forced
 * the duplication was the collector CONTROL: a closed Select built from the
 * VARIANTS THAT EXIST cannot offer a name nobody authored, so "what does
 * santander get?" was unaskable from the cascade. That was solved first by
 * making the control free text, and is now solved properly: the control is a
 * closed Select again, but over the collector INVENTORY rather than over the
 * catalogue, and the inventory answers for every client of the pair — the ones
 * it lists and, through `generic`, the ones it does not. The two questions share
 * one triple and are told apart by which panel answers them.
 */
export function BrowsePage() {
  // The whole catalogue, every page. The cascade needs every key at once — each
  // step is built by counting the keys behind it, and a partial list would make
  // those counts, and the options themselves, silently partial. Truncation (the
  // page cap) is reported below rather than hidden.
  const listQuery = useFullCatalogue();
  const preview = useRowPreview();
  const resolve = useResolveByAction();
  const archiveMutation = useArchiveTemplate();
  const publishMutation = usePublishTemplate();

  // The three steps of the cascade. `""` means "not answered yet" for the first
  // two — and for the collector it means GENERIC, which is not the same thing
  // and is the reason the old `(generic)` sentinel is gone. Absent or empty is
  // how the API itself spells "the template nobody overrode", so an empty field
  // already says it and a sentinel would only be a second spelling to keep in
  // sync with the server's.
  const [action, setAction] = useState("");
  const [actionType, setActionType] = useState("");
  const [collector, setCollector] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [variant, setVariant] = useState<PreviewVariant>("single");
  // The order the card asks in. Not persisted: nothing else on this page lives
  // in the URL, and one setting that did would be the odd one out.
  const [mode, setMode] = useState<BrowseMode>("TEMPLATE_FIRST");
  // Collector-first only: whether the Collector step, which comes first there,
  // has been answered. See `BrowseSelection.collectorPicked`.
  const [collectorPicked, setCollectorPicked] = useState(false);

  const rows = useMemo(() => listQuery.data?.content ?? [], [listQuery.data]);
  const groups = useMemo(() => groupByTemplateKey(rows), [rows]);
  const mixed = useMemo(() => groupsWithMixedActions(rows), [rows]);

  const actions = useMemo(() => actionOptions(groups), [groups]);
  const actionTypes = useMemo(
    () => actionTypeOptions(groups, action),
    [groups, action],
  );
  /*
    THE COLLECTOR STEP'S SOURCE OF TRUTH.

    The inventory answers for EVERY client of this action pair — the ones with
    a servable variant, the ones whose variant exists but is not going out, and,
    through `generic`, everyone else. It is derived from the catalogue by the
    send path's own precedence (see `inventoryFromCatalogue`): the API has no
    endpoint for it.

    Evaluated at now. A picker for historical instants would only need to pass a
    different instant to the derivation.
  */
  /*
    ASKED IN A STORED SPELLING, NOT IN THE CANONICAL NAME ON SCREEN.

    The selection holds canonical names (see `actionOptions`), but the send
    path matches action/actionType exactly as stored, and so does the inventory:
    a pair stored as both `PAYMENT` and `payment` has two answers, and asking in
    one spelling silently drops the collectors stored in the other. So the
    inventory is derived once per stored spelling — the same bounded, capped set
    the send-path panel resolves in — and the answers are merged by collector
    (`mergeInventoryAnswers`).

    Asked in BOTH browse orders. The collector-first list does not read it, but
    the delivery notices under the controls — no generic, no variants — do, and
    they are just as true whichever order the triple was entered in. The
    freshness line follows the same rule, so none of them appears undated.
  */
  const allSpellings = useMemo(
    () => resolveSpellings(groups, action, actionType),
    [groups, action, actionType],
  );
  // Capped: see MAX_QUERIED_SPELLINGS. `spellings` is what is actually queried.
  const { queried: spellings, omitted: omittedSpellings } = useMemo(
    () => capSpellings(allSpellings),
    [allSpellings],
  );
  const omittedSpellingsNote =
    omittedSpellings > 0
      ? `Esta plantilla tiene ${omittedSpellings} ${
          omittedSpellings === 1 ? "forma" : "formas"
        } de escritura más que no se consultaron: se consultan como máximo ${MAX_QUERIED_SPELLINGS}.`
      : null;
  const mergedInventory = mergeInventoryAnswers(useCollectorsInventories(spellings));
  const inventory = mergedInventory.inventory;
  const divergentCollectors = mergedInventory.divergentCollectors;

  // Where the options came from, and therefore what the page may claim about
  // them. See `collectorSource` — the fallback is not an error state.
  const source = collectorSource({
    action,
    actionType,
    isLoading: mergedInventory.isLoading,
    inventory,
  });

  // Whether the list on screen is the current answer or the last one that
  // arrived. See `inventoryFreshness` — a failed BACKGROUND refetch keeps the
  // previous data and looks identical to a successful one, so the page has to
  // read `isError` to be able to tell the reader which of the two they have.
  const freshness = inventoryFreshness({
    inventory,
    // Any spelling's failure: the merged list is missing that spelling's answer.
    isError: mergedInventory.isError,
  });

  // What a collector with no servable version of its own actually receives.
  // UNKNOWN whenever the inventory is not there: the page must not imply a
  // fallback it has not been told about.
  const generic = genericDelivery(inventory);

  /*
    One shape, two sources. When there is an inventory it IS the list; while
    there is none (the catalogue still loading, or failed) the bare
    catalogue-derived names stand in. That is harmless because the control is
    disabled until the catalogue settles: the reader never picks from a
    provisional list that is about to be replaced.
  */
  const collectorData = useMemo(
    () =>
      inventory
        ? inventoryCollectorData(inventory.collectors)
        : catalogueCollectorData(groups, action, actionType),
    [inventory, groups, action, actionType],
  );

  // The collector-first order's options. Catalogue-derived by necessity — see
  // `catalogueCollectorNames` — and the page says so under the controls.
  const catalogueCollectors = useMemo(() => catalogueCollectorNames(groups), [groups]);
  const collectorFirstCollectors = useMemo(
    () => collectorFirstCollectorData(groups),
    [groups],
  );
  const collectorFirstActions = useMemo(
    () => (collectorPicked ? collectorFirstActionData(groups, collector) : []),
    [groups, collector, collectorPicked],
  );
  const collectorFirstActionTypes = useMemo(
    () => collectorFirstActionTypeData(groups, collector, action),
    [groups, collector, action],
  );

  // The entry behind each option, for the option renderer. Keyed rather than
  // carried on the option itself so nothing depends on Mantine preserving extra
  // properties through its own data parsing.
  const inventoryByCollector = useMemo(() => {
    const byName = new Map<string, CollectorInventoryEntry>();
    for (const entry of inventory?.collectors ?? []) {
      byName.set(entry.collector, entry);
    }
    return byName;
  }, [inventory]);

  /**
   * WHAT EACH CLIENT ACTUALLY RECEIVES, SHOWN WHILE CHOOSING.
   *
   * `servable` is the field the inventory exists for, and it would be wasted
   * if the reader only learned it after picking. A collector whose variant is a
   * draft is receiving the generic RIGHT NOW while everyone assumes it has its
   * own mail — that is the misconception the whole feature exists to break, and
   * breaking it a click later is breaking it too late.
   *
   * So each option carries the version and status it resolves to, plus a badge
   * naming the consequence: "se envía la suya", "recibe la genérica", or — when
   * there is no servable generic to fall back to — "no recibe nada", which is a
   * 404 from the send path and not a fallback at all.
   *
   * Only installed on the inventory path. The catalogue fallback knows none of
   * this, and a badge there would be invented.
   */
  const renderCollectorOption: SelectProps["renderOption"] = ({ option }) => {
    const isGeneric = option.value === "";
    const entry = isGeneric
      ? (inventory?.generic ?? null)
      : (inventoryByCollector.get(option.value) ?? null);

    /*
      No entry behind the generic option is not a gap — it is `generic: null`,
      the inventory stating that no baseline template exists at all. The option
      stays (it is still the way to ask about the baseline and find out there
      isn't one) and says so where the reader is looking, so the choice is
      informed before the red warning below is even read.

      For a named collector this branch should be unreachable: the option list
      and this lookup are built from the same response. Rendering the bare name
      rather than throwing keeps a future third source from taking the whole
      page down over a missing badge.
    */
    if (!entry) {
      return (
        <Group justify="space-between" gap="xs" wrap="nowrap" w="100%">
          <Text size="sm">{option.label}</Text>
          {isGeneric ? (
            <Badge size="xs" color="red" variant="light">
              No existe
            </Badge>
          ) : null}
        </Group>
      );
    }

    const badge = entry.servable
      ? { color: "teal", text: isGeneric ? "Vigente" : "Se envía la suya" }
      : isGeneric
        ? { color: "red", text: "No vigente" }
        : generic === "SERVED"
          ? { color: "yellow", text: "Recibe la genérica" }
          : { color: "red", text: "No recibe nada" };

    return (
      <Group justify="space-between" gap="xs" wrap="nowrap" w="100%">
        <Text size="sm">{option.label}</Text>
        <Group gap={6} wrap="nowrap">
          {/* nowrap: "v3 · ACTIVE" broken across two lines turns a one-line
              option into a two-line one and reads as two separate facts. */}
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            v{entry.version} · {entry.status}
          </Text>
          {/* The version/status shown is the most common spelling's; this
              collector gets something else when the sender spells the action
              another way. */}
          {divergentCollectors.has(normalizeCollector(option.value)) ? (
            <Badge size="xs" color="orange" variant="light">
              según escritura
            </Badge>
          ) : null}
          <Badge size="xs" color={badge.color} variant="light">
            {badge.text}
          </Badge>
        </Group>
      </Group>
    );
  };

  const group = useMemo(
    () => findGroup(groups, action, actionType, collector),
    [groups, action, actionType, collector],
  );
  const selected = findVersion(group, version);

  /*
    CASCADING RESETS — the reason this control exists at all.

    Each step narrows the next, so a downstream value that was chosen under a
    different upstream one is a value pointing at a combination that may no
    longer exist. Keeping it would be worse than merely stale: a Mantine Select
    whose `value` is absent from its own `data` renders BLANK — it does not fall
    back to the placeholder and it does not complain — so the page would sit
    there with an empty-looking box while `findGroup` quietly returns null and
    the badges, the version select and the rendered mail below all disagree
    about which template is on screen. Worse still, a version number left over
    from another key could be inherited by the next selection, labelling one
    template's mail with another's version.

    So every step clears everything below it, always, even when the old value
    happens to survive in the new list: "it is still there" is a coincidence of
    today's catalogue, not a rule, and a reset nobody notices costs nothing.

    The collector needs clearing for the same reason and one of its own. Its
    options are fetched PER PAIR — `useCollectorsInventory` is keyed on action
    and actionType — so a name chosen under one pair may be absent from the list
    that arrives for the next, and Mantine renders a value missing from its own
    `data` as a blank box rather than as an error. Clearing it lands on the
    generic instead, which is a legitimate answer and not an empty control.
  */
  /*
    In the collector-first order the collector sits ABOVE action and action type,
    so those two steps must not clear it — the reset still runs downward, it is
    only the direction of "downward" that changed. Changing the collector there
    keeps action and action type: every action is offered under every collector,
    so both are still valid, and only the version (which belongs to one stored
    key) has to go.
  */
  function chooseAction(value: string) {
    setAction(value);
    setActionType("");
    if (mode === "TEMPLATE_FIRST") setCollector("");
    setVersion(null);
  }

  function chooseActionType(value: string) {
    setActionType(value);
    if (mode === "TEMPLATE_FIRST") setCollector("");
    setVersion(null);
  }

  function chooseCollectorFirst(value: string) {
    setCollector(value);
    setCollectorPicked(true);
    setVersion(null);
  }

  // What survives the switch is decided by `switchBrowseMode`; the page only
  // tells it what the destination order will offer for the collector step.
  function chooseMode(next: BrowseMode) {
    if (next === mode) return;
    const kept = switchBrowseMode(
      { action, actionType, collector, collectorPicked, version },
      next,
      next === "COLLECTOR_FIRST" ? catalogueCollectors : selectDataValues(collectorData),
    );
    setMode(next);
    setAction(kept.action);
    setActionType(kept.actionType);
    setCollector(kept.collector);
    setCollectorPicked(kept.collectorPicked);
    setVersion(kept.version);
  }

  /*
    AUTO-SELECT A SOLE OPTION — deliberate, not a shortcut.

    A dropdown with exactly one entry asks a question that has only one answer.
    Against today's catalogue that is the common case: most actions carry a
    single action type, so the cascade would cost a click to say what the
    previous one already said, which is exactly the tax that made the old flat
    list feel faster than it was.

    It follows the page's existing philosophy — picking a template already
    auto-picks its default version for the same reason.

    The collector step has no equivalent and must not grow one. There is nothing
    to auto-pick when blank is already a valid, meaningful answer: leaving the
    field empty selects the generic, and typing into it is how the reader says
    otherwise.

    The effect keys off the OPTIONS, not off the upstream value, so it fires
    again whenever an upstream change rebuilds the list. The equality guard is
    what stops that from looping: `setState` with the value already in state is
    a no-op, but re-running it on every render while the list is referentially
    fresh would still be noise.
  */
  useEffect(() => {
    if (actionTypes.length !== 1) return;
    if (actionType === actionTypes[0].value) return;
    chooseActionType(actionTypes[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionTypes, actionType]);

  // Choosing a key implies a version — asking for both before showing anything
  // would make the common case ("what are we sending today") two clicks instead
  // of one. The reader can still override it.
  useEffect(() => {
    if (!group) return;
    setVersion(defaultVersion(group)?.version ?? null);
  }, [group]);

  // Never carry one template's render under another's name. Resetting on every
  // change of selection is cheaper to reason about than proving each path clears
  // it, and a stale preview here is a lie about what a customer receives.
  useEffect(() => {
    preview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.templateKey, version, variant]);

  /*
    The resolution answers a question made of these exact four values, so it
    dies with any of them. It used to survive changes to its own inputs, because
    those inputs were its own and a half-typed collector should not wipe an
    answer already on screen — but the inputs are shared now, and an answer about
    santander left sitting under a triple that says bbva is not stale, it is
    false. The reader has no way to tell which question the mail below belongs
    to, which is precisely the confusion the fallback warning exists to prevent.

    `variant` is in here for the older reason, unchanged: a mail rendered for
    "single" displayed under a "multi" label is a lie about what a customer
    receives.
  */
  useEffect(() => {
    resolve.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actionType, collector, variant]);

  /*
    NO FORMAT VALIDATION ON THIS FIELD ANY MORE, and its absence is the point.

    `isValidCollector` used to run on every keystroke here because the control
    was free text and a malformed name is a hard 400 from the server. A closed
    list cannot produce one: every value the Select can emit is either blank —
    the generic — or a name the server itself just sent us. Keeping the check
    would be the page validating the API's own output against its own guess at
    the API's rule, and the first thing it would do on a disagreement is refuse
    to ask about a collector that demonstrably exists.

    The rule still lives in lib/collector and is still used by the create form,
    which is the one place a collector name is TYPED — authoring the first
    variant for a brand-new client means naming something that exists nowhere
    yet, so that control cannot be closed and that check cannot go.
  */

  const cascadeAnswered = action !== "" && actionType !== "";

  /*
    Nothing is stored under this triple.

    A normal state, not a failure: asking about a collector nobody has authored
    a variant for is the most useful question on the page, and "there is no such
    template" is its answer, not an error in reaching it.

    It no longer has to exclude a malformed collector: the control is closed, so
    there is no typo to complain about twice.
  */
  const noStoredTemplate = cascadeAnswered && !group;

  /**
   * Asks the API which version this client would actually be served.
   *
   * EXPLICIT TRIGGER, never debounced and never fired as the reader types. A
   * resolution that chased the keystrokes would announce "no servable template
   * for 'san'" while somebody is three letters into "santander" — a sentence
   * that is false, alarming, and shaped exactly like the warning that means a
   * real fallback. The catalogue above can afford to narrow live because it only
   * ever offers what exists; this call answers about what does not, so it has to
   * wait until the reader says they have finished asking.
   */
  function handleResolve() {
    // Every stored spelling of the pair rather than the canonical name on
    // screen: the send path matches exactly. See `resolveSpellings`.
    resolve.mutate({ spellings, collector, variant });
  }

  const canResolve = cascadeAnswered && spellings.length > 0;

  const resolveError = resolve.error ? toUiError(resolve.error) : null;

  /*
    THE GUARD THAT ACTUALLY PREVENTS A MISMATCHED ANSWER.

    The effect above calls `resolve.reset()` on every cascade change, and that
    is NOT enough on its own: `reset()` clears the observer's state at the
    instant it runs, but TanStack has no way to cancel a `mutationFn` that is
    already in flight, and when that promise settles it writes `data` straight
    back onto the same observer. So the sequence "ask about bbva → change the
    Collector to santander → the slow bbva response arrives" repopulates a panel
    the page had already cleared, under a cascade that now says santander.

    Reading `resolve.data` only while it still matches the live selection is
    what closes that window. The late answer is simply not read — no
    cancellation, no cleanup, and nothing on screen that the controls above do
    not agree with.
  */
  const resolved =
    resolve.data &&
    resolutionMatchesSelection(
      {
        action: resolve.data.requestedAction,
        actionType: resolve.data.requestedActionType,
        collector: resolve.data.requestedCollector,
      },
      { action, actionType, collector },
    )
      ? resolve.data
      : null;

  // Each answer's banners, badges and render are decided inside
  // ResolutionAnswer, once per stored spelling.

  const listError = listQuery.error ? toUiError(listQuery.error) : null;
  const previewError = preview.error ? toUiError(preview.error) : null;
  const archiveError = archiveMutation.error ? toUiError(archiveMutation.error) : null;
  const publishError = publishMutation.error ? toUiError(publishMutation.error) : null;

  const result = preview.data;
  const failure = result && !result.ok ? result : null;
  const rendered = result && result.ok ? result : null;

  return (
    <>
      <PageHeader
        title="Templates"
        description="Identifica una plantilla por su terna y pregunta qué tenemos escrito o qué se envía hoy."
        actions={
          <Button
            component={Link}
            to="/create"
            leftSection={<IconPlus size={16} stroke={1.8} />}
          >
            Nueva plantilla
          </Button>
        }
      />

      {/*
        The question, asked once. Everything below is an answer to it, and each
        answer lives in a panel of its own that says which question it answered.
      */}
      <Paper withBorder p="md" radius="md">
        <Group gap="sm" mb="md">
          <Text size="sm" c="dimmed">
            Buscar
          </Text>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(value) => chooseMode(value as BrowseMode)}
            data={[
              { label: "Por plantilla", value: "TEMPLATE_FIRST" },
              { label: "Por collector", value: "COLLECTOR_FIRST" },
            ]}
          />
        </Group>
        <Group align="flex-end" gap="md" wrap="wrap">
          {mode === "TEMPLATE_FIRST" ? (
            <>
          {/*
            An empty catalogue and a catalogue still loading look identical in a
            dropdown — both are a box with nothing in it — and the reader's next
            move is opposite in each case: wait, or go and find out why the list
            is empty. So the placeholder says which one it is instead of leaving
            a loaded-but-empty page looking permanently pending.
          */}
          <Select
            label="Action"
            placeholder={
              listQuery.isLoading
                ? "Cargando…"
                : actions.length === 0
                  ? "No hay plantillas en el catálogo"
                  : "Selecciona una acción"
            }
            description={
              listQuery.isLoading
                ? "Cargando el catálogo"
                : `${groups.length} plantillas`
            }
            data={actions}
            value={action === "" ? null : action}
            onChange={(value) => chooseAction(value ?? "")}
            searchable
            allowDeselect={false}
            nothingFoundMessage="Ninguna acción coincide"
            disabled={listQuery.isLoading || actions.length === 0}
            w={220}
          />
          <Select
            label="Action type"
            placeholder={
              action === "" ? "Selecciona primero Action" : "Selecciona un tipo"
            }
            data={actionTypes}
            value={actionType === "" ? null : actionType}
            onChange={(value) => chooseActionType(value ?? "")}
            searchable
            allowDeselect={false}
            nothingFoundMessage="Ningún tipo coincide"
            disabled={action === ""}
            w={220}
          />
          {/*
            The third axis of the identity — and a CLOSED Select again, which is
            the change the rest of this page is built around.

            It was free text for a real reason: the question worth asking hardest
            is about a collector that has no variant ("what does santander get
            today?"), and a dropdown built from the templates somebody authored
            can never put that name on screen. The objection was not that a
            closed list is worse in principle — it is that no authoritative list
            existed to close it over.

            The inventory retires that objection. It reports every collector
            of this action pair whether or not its variant is servable, and it
            reports `generic` alongside them, so one response answers for every
            client INCLUDING the ones it does not list: they all get the generic,
            or — when `generic` is null — they get nothing. The list is therefore
            complete in the only sense that matters, and closing it buys back
            everything free text cost: no typos, no invalid names, no round trip
            to discover that a name was never a collector, and, above all, the
            servable state visible while choosing instead of after.

            Blank is an ANSWER and not an empty field: it means the generic, and
            it is the first option for that reason. That is the API's own rule
            for an absent or empty collector, so the value the control carries is
            the value the API already understands and there is no sentinel to
            translate at any boundary.
          */}
          <Select
            label="Collector"
            /*
              The value goes to null — not to "" — while the pair is unanswered,
              so the PLACEHOLDER shows instead of the label of an option the
              reader never chose. Blank means the generic, and a disabled control
              announcing "Genérica" before anything has been asked would be an
              answer to a question that has not been put yet. The state itself
              stays "", so nothing downstream has a third case to handle.
            */
            value={cascadeAnswered ? collector : null}
            placeholder={
              action === ""
                ? "Selecciona primero Action"
                : actionType === ""
                  ? "Selecciona primero Action type"
                  : source === "LOADING"
                    ? "Cargando collectors…"
                    : "Genérica"
            }
            data={collectorData}
            onChange={(value) => {
              // Never null in practice — `allowDeselect={false}` and every
              // option has a value — but the blank option's value IS "", so the
              // usual `value ?? ""` would be indistinguishable from deselection.
              // Coalescing to "" is right either way: both mean the generic.
              setCollector(value ?? "");
              setVersion(null);
            }}
            renderOption={
              source === "INVENTORY" ? renderCollectorOption : undefined
            }
            /*
              The DROPDOWN is wider than the input, deliberately. The input keeps
              w={220} so the controls row stays a row of equal boxes; the list
              has to carry a name, a version, a status and a badge on one line,
              and at 220 the badge truncated to "SE ENVÍA LA S…" — which is the
              one piece of information this list was rebuilt to deliver, ellipsed
              away. A wider panel costs nothing: it opens over the page and
              closes again.
            */
            comboboxProps={{ width: 340, position: "bottom-start" }}
            /*
              Disabled while the first fetch is in flight, not just before the
              pair is named. The control is filled with the catalogue-derived
              fallback in the meantime, and letting somebody pick from a list
              that is about to be replaced wholesale would leave the field
              holding a value the new list may not contain — which Mantine
              renders as an empty box rather than as an error.
            */
            disabled={source === "AWAITING_PAIR" || source === "LOADING"}
            searchable
            allowDeselect={false}
            nothingFoundMessage="Ningún collector coincide"
            w={220}
          />
            </>
          ) : (
            <>
              {/*
                COLLECTOR FIRST. Same three values, asked in the other order.
                The collector list is catalogue-derived (no endpoint lists every
                client), which the hint under the row says out loud.
              */}
              <Select
                label="Collector"
                placeholder={listQuery.isLoading ? "Cargando…" : "Selecciona un collector"}
                data={collectorFirstCollectors}
                value={collectorPicked ? collector : null}
                onChange={(value) => chooseCollectorFirst(value ?? "")}
                searchable
                allowDeselect={false}
                nothingFoundMessage="Ningún collector coincide"
                disabled={listQuery.isLoading}
                w={220}
              />
              {/* Wider dropdown for the same reason as the collector list in the
                  other order: the headings must not be ellipsed away. */}
              <Select
                label="Action"
                // Same empty-catalogue wording as the other order: an empty
                // box would read as "still loading" forever.
                placeholder={
                  !listQuery.isLoading && actions.length === 0
                    ? "No hay plantillas en el catálogo"
                    : collectorPicked
                      ? "Selecciona una acción"
                      : "Selecciona primero Collector"
                }
                data={collectorFirstActions}
                value={action === "" ? null : action}
                onChange={(value) => chooseAction(value ?? "")}
                searchable
                allowDeselect={false}
                nothingFoundMessage="Ninguna acción coincide"
                disabled={!collectorPicked || actions.length === 0}
                comboboxProps={{ width: 280, position: "bottom-start" }}
                w={220}
              />
              <Select
                label="Action type"
                placeholder={
                  action === "" ? "Selecciona primero Action" : "Selecciona un tipo"
                }
                data={collectorFirstActionTypes}
                value={actionType === "" ? null : actionType}
                onChange={(value) => chooseActionType(value ?? "")}
                searchable
                allowDeselect={false}
                nothingFoundMessage="Ningún tipo coincide"
                disabled={action === ""}
                comboboxProps={{ width: 280, position: "bottom-start" }}
                w={220}
              />
            </>
          )}
          {/*
            Placeholders, not an empty box. A version select with nothing in it
            reads as a control that is broken or still loading; these two say
            which of the two real situations it is — the triple is incomplete, or
            the triple is complete and names nothing stored.
          */}
          <Select
            label="Version"
            placeholder={
              !cascadeAnswered
                ? "Identifica primero una plantilla"
                : group
                  ? "Selecciona una versión"
                  : "No hay nada guardado para este collector"
            }
            data={versionOptions(group)}
            value={version == null ? null : String(version)}
            onChange={(value) => setVersion(value == null ? null : Number(value))}
            disabled={!group}
            allowDeselect={false}
            w={220}
          />
          {/*
            Shared by both answers below, because it is part of the question: a
            render is for a single-item mail or a multi-item one, and neither
            panel gets to assume a different one than the reader asked for.
          */}
          <SegmentedControl
            value={variant}
            onChange={(value) => setVariant(value as PreviewVariant)}
            data={[
              { label: "Individual", value: "single" },
              { label: "Múltiple", value: "multi" },
            ]}
          />
        </Group>

        {/* Below the row, not as the field's description, for the alignment
            reason spelled out in the next comment. */}
        {cascadeAnswered && omittedSpellingsNote ? (
          <Text size="xs" c="dimmed" mt="sm">
            {omittedSpellingsNote}
          </Text>
        ) : null}

        {mode === "COLLECTOR_FIRST" ? (
          <Text size="xs" c="dimmed" mt="sm">
            Solo se listan los collectors con al menos una variante guardada en el
            catálogo: un cliente sin nada escrito no aparece en esta lista.
          </Text>
        ) : null}

        {/*
          EVERYTHING THE COLLECTOR STEP HAS TO SAY LIVES OUT HERE, NOT IN THE
          FIELD'S `description`.

          That is not a stylistic preference. The controls row is
          `align="flex-end"`, so anything rendered under one input makes that
          field taller at the bottom and lifts its input above the others. The
          description this replaces ran to five lines at w={220} and broke the
          alignment of the whole row — the input sat visibly higher than Action,
          Action type and Version. Out here the notices are as long as they need
          to be and the row stays bottom-aligned no matter what they say.
        */}

        {/*
          WHEN the answer was computed, next to the answer.

          Effectivity windows are re-evaluated on every render, so a version
          scheduled for 09:00 reads as live at 09:00 with nobody writing
          anything. The stored decisions behind them — drafts, archives — are
          only as fresh as the catalogue, so the instant printed is when it was
          read, never the word "ahora".
        */}
        {/*
          ONE RULE FOR THE TIMESTAMP: it follows the inventory, not the mode.
          The inventory is fetched in both orders because the delivery notices
          below — the red "no generic" alert and the empty-inventory line —
          read it in both, and neither may appear without the instant it was
          true at and whether a refresh has failed since.
        */}
        {source === "INVENTORY" && inventory ? (
          <Text size="xs" c="dimmed" mt="sm">
            Inventario de collectors vigente al {formatInstant(inventory.at)}
            {inventory.collectors.length === 1
              ? " · 1 collector con variante propia"
              : ` · ${inventory.collectors.length} collectors con variante propia`}
            {/* Merged answers are dated by the OLDEST of them. */}
            {spellings.length > 1
              ? `, reunidos de ${spellings.length} formas de escritura${
                  mergedInventory.genericDivergent
                    ? " (la genérica también difiere según la escritura)"
                    : ""
                }`
              : ""}
            .
            {/*
              THE DIFFERENCE BETWEEN "AS OF HH:MM" AND "AS OF HH:MM AND I COULD
              NOT REFRESH IT", said out loud.

              The line above is a photograph with its timestamp printed on it,
              which is honest right up until the refresh behind it starts
              failing: TanStack keeps the last good `data` and only raises
              `isError`, so the list and the instant stay exactly as they were
              and nothing on screen moves. The reader is then trusting a clock
              that stopped.

              Deliberately not red and not an Alert. Nothing is broken and there
              is nothing to fix — the answer is still the last true one we had,
              and `status`/`servable` only drift as time passes rather than going
              wrong all at once. What changes is how far the reader should trust
              the instant next to it, which is one extra sentence, not a banner.
            */}
            {freshness === "STALE" ? (
              <>
                {" "}
                No se pudo actualizar desde entonces, así que puede haber
                quedado atrasado: vuelve a cargar la página para reintentarlo.
              </>
            ) : null}
          </Text>
        ) : null}

        {/*
          NO GENERIC — AND THIS IS NOT THE FALLBACK NOTICE.

          Every other message on this page about a collector without its own
          version says it receives the generic. When there is no servable
          generic, that sentence stops being true and the truth is worse: the
          send path answers 404 and NO MAIL IS DELIVERED. So this is red, it
          states the 404 in those words, and it never uses the word "genérica"
          as a reassurance.

          Two causes, kept apart because the fix differs. MISSING means nobody
          ever wrote the baseline template; NOT_SERVABLE means somebody wrote it
          and it is not in effect — a draft, an archived version, one scheduled
          for later — which delivers exactly as much: nothing.
        */}
        {source === "INVENTORY" &&
        (generic === "MISSING" || generic === "NOT_SERVABLE") ? (
          <Alert
            color="red"
            title={
              generic === "MISSING"
                ? `No existe plantilla genérica para ${action}/${actionType}`
                : `La plantilla genérica de ${action}/${actionType} no está vigente`
            }
            mt="sm"
          >
            <Stack gap={4}>
              <Text size="sm">
                {generic === "MISSING" ? (
                  <>
                    No hay ninguna plantilla de base para esta terna, así que no
                    hay adónde caer.
                  </>
                ) : (
                  <>
                    La plantilla genérica{" "}
                    <strong>{inventory?.generic?.templateKey}</strong> existe (v
                    {inventory?.generic?.version} ·{" "}
                    {inventory?.generic?.status}) pero no está publicada y
                    vigente, así que tampoco se envía.
                  </>
                )}{" "}
                Todo collector que no tenga una versión propia enviable —
                incluidos los que ni siquiera figuran en esta lista — recibe un{" "}
                <strong>404 del envío</strong>: no se entrega ningún mail. No es
                el caso habitual de caer en la genérica.
              </Text>
              <Text size="xs" c="dimmed">
                Los collectors marcados como “No recibe nada” en la lista de
                arriba están exactamente en esta situación.
              </Text>
            </Stack>
          </Alert>
        ) : null}

        {/*
          An empty list is a NORMAL 200, not an error: nobody has carved out an
          exception for this action pair. Said out loud because an empty
          dropdown with one entry in it invites the reader to suspect the list
          failed to load, and the answer is the opposite — it loaded and there
          is nothing in it.

          Worded on what it MEANS for delivery, which depends on whether there
          is a generic to deliver: with no servable generic the red alert above
          is already saying what happens, and repeating "todos reciben la
          genérica" here would contradict it.
        */}
        {source === "INVENTORY" && inventory?.collectors.length === 0 ? (
          <Text size="sm" c="dimmed" mt="xs">
            {generic === "SERVED"
              ? "No hay ninguna variante por collector para esta terna: todos los clientes reciben la genérica."
              : "No hay ninguna variante por collector para esta terna."}
          </Text>
        ) : null}
      </Paper>

      {mixed.length ? (
        <Alert
          color="yellow"
          title="Hay template keys con más de una Action"
          mt="md"
        >
          {mixed.join(", ")} — la key debería identificar una sola Action, así que
          conviene revisarlo.
        </Alert>
      ) : null}

      {/* Never a silent partial list: every option and count above is built
          from these rows. */}
      {listQuery.data?.truncated ? (
        <Alert color="yellow" title="No se leyó el catálogo completo" mt="md">
          Se leyeron {listQuery.data.content.length} de{" "}
          {listQuery.data.totalElements} versiones (se leen como máximo{" "}
          {MAX_CATALOGUE_PAGES * CATALOGUE_PAGE_SIZE}). Las opciones y los
          recuentos de arriba pueden estar incompletos.
        </Alert>
      ) : null}

      {listError ? (
        <Alert color="red" title="No se pudieron cargar las plantillas" mt="md">
          {listError.message}
        </Alert>
      ) : null}

      {/*
        ANSWER ONE — the catalogue.

        Titled, described and given its own trigger button, in the same shape as
        the send-path panel below, so the two read as parallel answers to two
        stated questions rather than as one long page of results whose halves
        have to be told apart by inference. Everything that CHANGES a template
        lives in this panel and only in this panel: the versions here are stored
        rows, named by the triple above, and editing one is an act on exactly the
        thing on screen.
      */}
      <Paper withBorder p="md" radius="md" mt="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Title order={4}>¿Qué tenemos escrito?</Title>
              <Text size="sm" c="dimmed">
                El catálogo guardado para esta terna: todas las versiones,
                borradores y archivadas incluidos. Lo que editas, publicas o
                archivas está aquí.
              </Text>
            </div>
            <Button
              onClick={() => selected && preview.mutate({ row: selected, variant })}
              loading={preview.isPending}
              disabled={!selected || preview.isPending}
            >
              Ver vista previa
            </Button>
          </Group>

          {!cascadeAnswered ? (
            <Text size="sm" c="dimmed">
              Selecciona Action y Action type para identificar una plantilla.
            </Text>
          ) : null}

          {/*
            Not an error, and deliberately not coloured like one. Nothing is
            wrong: the reader asked about a collector nobody has overridden, and
            that is the answer. The next move is the other question, so the text
            points straight at the panel that answers it — this panel has nothing
            more to say, and the one below has the only version that is actually
            going out.
          */}
          {noStoredTemplate ? (
            <Alert
              color="gray"
              variant="light"
              title={
                collector.trim() === ""
                  ? `No hay plantilla genérica para ${action}/${actionType}`
                  : `No hay ninguna plantilla guardada para “${normalizeCollector(collector)}”`
              }
            >
              <Stack gap={4}>
                {collector.trim() === "" ? (
                  <Text size="sm">
                    Todas las plantillas guardadas para este par son variantes de
                    algún collector, así que no hay una versión de base que
                    mostrar aquí ni nada que editar, publicar o archivar.
                  </Text>
                ) : (
                  <Text size="sm">
                    No se creó nada para{" "}
                    <strong>{normalizeCollector(collector)}</strong> en{" "}
                    {action}/{actionType}: ni un borrador, ni una versión
                    publicada, ni una archivada. Al enviar, este collector cae en
                    la plantilla genérica.
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  Este panel solo puede mostrar lo que está guardado. Usa “¿Qué se
                  envía ahora?” más abajo para ver la versión que realmente sale.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {selected ? (
            <Group gap="xs" align="center">
              <Badge color={STATUS_COLOR[selected.status] ?? "gray"} variant="light">
                {selected.status}
              </Badge>
              <Badge
                color={collectorBadgeColor(selected.collector)}
                variant={selected.collector ? "filled" : "light"}
              >
                {collectorLabel(selected.collector)}
              </Badge>
              {/*
                The templateKey, back where it can still be read.

                It left the search row with the Template select, and it is the one
                string an operator quotes in a ticket, pastes into a log search or
                hands to the API team — the triple above is how you FIND the
                template, the key is how you TALK about it. It is taken from the
                stored row rather than rebuilt from the three parts: a client-side
                re-derivation is a guess at the server's naming rule, and a guess
                printed in monospace next to real data reads exactly like a fact.
              */}
              <Text size="sm" c="dimmed">
                <Text span ff="monospace">
                  {selected.templateKey}
                </Text>{" "}
                · {selected.action}/{selected.actionType} · v{selected.version} ·
                por {selected.createdBy}
              </Text>
              <Group gap="xs" ml="auto">
                {selected.status === "DRAFT" ? (
                  <>
                    <Button
                      size="xs"
                      variant="light"
                      component={Link}
                      to={`/templates/${selected.templateKey}/versions/${selected.version}/edit`}
                    >
                      Editar borrador
                    </Button>
                    <Button
                      size="xs"
                      onClick={() =>
                        publishMutation.mutate({
                          templateKey: selected.templateKey,
                          version: selected.version,
                        })
                      }
                      loading={publishMutation.isPending}
                    >
                      Publicar
                    </Button>
                  </>
                ) : null}
                {/* Published content is frozen, so the way to build on it is a
                    copy: same identity → next version, changed → new template. */}
                {isPublishedStatus(selected.status) ? (
                  <Button
                    size="xs"
                    variant="default"
                    component={Link}
                    to={fromVersionHref(selected)}
                  >
                    Crear a partir de esta versión
                  </Button>
                ) : null}
                {selected.status !== "ARCHIVED" ? (
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    onClick={() =>
                      archiveMutation.mutate({
                        templateKey: selected.templateKey,
                        version: selected.version,
                      })
                    }
                    loading={archiveMutation.isPending}
                  >
                    Archivar
                  </Button>
                ) : null}
              </Group>
            </Group>
          ) : null}

          {publishError ? (
            <Alert color="red" title="No se pudo publicar la versión">
              {publishError.message}
            </Alert>
          ) : null}

          {archiveError ? (
            <Alert color="red" title="No se pudo archivar la versión">
              {archiveError.message}
            </Alert>
          ) : null}

          {publishMutation.isSuccess && publishMutation.data ? (
            <Alert color="green" title="Versión publicada">
              <strong>{publishMutation.data.templateKey}</strong> v
              {publishMutation.data.version} ahora está en{" "}
              {publishMutation.data.status}.
            </Alert>
          ) : null}

          {preview.isPending ? (
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                Renderizando — el motor arranca en el primer uso.
              </Text>
            </Group>
          ) : null}

          {/*
            Split deliberately. A fetch that never returned content is not a
            template that failed to render, and saying so sends the reader to the
            server instead of into perfectly good Jinja.
          */}
          {previewError ? (
            <Alert color="red" title="No se pudo obtener esta versión">
              {previewError.message}
            </Alert>
          ) : null}

          {failure ? (
            <Alert color="red" title={`No se pudo renderizar — ${failure.kind}`}>
              <Stack gap={4}>
                <Text size="sm" ff="monospace">
                  {failure.line != null ? `línea ${failure.line}: ` : ""}
                  {failure.message}
                </Text>
                <Text size="xs" c="dimmed">
                  Esta es una versión guardada, así que se guardó en este estado.
                  Si está publicada, está fallando al enviarse.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {rendered ? (
            <>
              {rendered.actionProblem ? (
                <Alert
                  color="yellow"
                  title="No hay plantilla incluida para esta Action"
                >
                  {rendered.actionProblem.message} El borrador igual se renderizó,
                  pero no se pudo resolver desde la Action el layout que extiende.
                </Alert>
              ) : null}
              {rendered.unknownFilters.length ? (
                <Alert color="yellow" title="Filtros desconocidos">
                  {rendered.unknownFilters.join(", ")} — el render core incluido
                  está más atrasado que el que envía. Ejecuta: npm run
                  sync:render-core
                </Alert>
              ) : null}
              <RenderedEmail
                subject={rendered.subject}
                html={rendered.html}
                height={620}
              />
            </>
          ) : null}

          {!preview.isPending && !result && !previewError && selected ? (
            <Text size="sm" c="dimmed">
              Pide la vista previa para ver qué envía esta versión.
            </Text>
          ) : null}
        </Stack>
      </Paper>

      {/*
        ANSWER TWO — the send path.

        The catalogue above answers "what have we authored". This answers a
        different question that operators keep having to answer by reading keys
        and guessing: "what does THIS client actually get when we send them
        this?" — which is the only question whose wrong answer ends with
        somebody editing a template nobody receives.

        It is available whenever the action and the action type are set,
        regardless of whether the collector has a stored variant, because both
        questions are worth asking about the SAME collector: bbva can have a
        variant that is a draft or archived, so it shows up in the catalogue
        above and still falls back at send time. Gating this button on a stored
        template would hide the answer in exactly the case where the two disagree.
      */}
      <Paper withBorder p="md" radius="md" mt="md">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Title order={4}>¿Qué elige el envío?</Title>
              <Text size="sm" c="dimmed">
                Ejecuta la misma resolución que ejecuta el servicio de
                notificaciones. Un collector sin ninguna versión enviable cae en
                la plantilla genérica.
              </Text>
            </div>
            <Button
              onClick={handleResolve}
              loading={resolve.isPending}
              disabled={!canResolve || resolve.isPending}
            >
              ¿Qué se envía ahora?
            </Button>
          </Group>

          {!cascadeAnswered ? (
            <Text size="sm" c="dimmed">
              Selecciona Action y Action type para poder preguntar.
            </Text>
          ) : null}

          {/* The server's own 400 on a malformed collector, or any failure of
              the single-spelling call, rendered by the same component that
              renders an answer — see ResolutionAnswer. With several spellings
              the mutation never rejects: each spelling's failure is reported
              under its own heading, so one 404 cannot hide another spelling's
              perfectly good answer. */}
          {resolve.error ? (
            <ResolutionAnswer result={null} error={resolve.error} />
          ) : null}

          {/*
            MORE THAN ONE STORED SPELLING — the catalogue's drift, made visible.

            The backend stores action/actionType exactly as they were sent and
            matches them exactly on /resolve; only the templateKey is derived
            canonically. So `PAYMENT/APPROVED` and `payment/approved` are ONE
            template on this page and TWO questions to the send path. Live, the
            dell variant stored as `payment` is invisible to a sender asking for
            `PAYMENT`, who silently receives the generic. There is no single
            honest answer, so the panel asks once per stored spelling — never
            more than the spellings the catalogue holds for this pair — and
            shows each answer under the spelling that produced it.
          */}
          {resolved && resolved.answers.length > 1 ? (
            <Alert
              color="yellow"
              title="Esta plantilla está escrita de más de una forma en el catálogo; el resultado depende de cómo la pida el emisor"
            >
              <Text size="sm">
                El servicio de envío compara Action y Action type tal como
                llegan, sin normalizarlos. Abajo va una respuesta por cada forma
                guardada: lo que recibe un cliente depende de cuál de ellas use
                quien envía el mail.
              </Text>
            </Alert>
          ) : null}

          {resolved && omittedSpellingsNote ? (
            <Text size="xs" c="dimmed">
              {omittedSpellingsNote}
            </Text>
          ) : null}

          {resolved && resolved.answers.length === 1 ? (
            <ResolutionAnswer
              result={resolved.answers[0].result}
              error={resolved.answers[0].error}
            />
          ) : null}

          {resolved && resolved.answers.length > 1
            ? resolved.answers.map((answer) => (
                <Paper
                  key={`${answer.spelling.action} ${answer.spelling.actionType}`}
                  withBorder
                  p="sm"
                >
                  <Stack gap="sm">
                    <Text size="sm" fw={500}>
                      Pedida como <Code>{answer.spelling.action}</Code> /{" "}
                      <Code>{answer.spelling.actionType}</Code>
                    </Text>
                    <ResolutionAnswer result={answer.result} error={answer.error} />
                  </Stack>
                </Paper>
              ))
            : null}

          {cascadeAnswered && !resolved && !resolveError && !resolve.isPending ? (
            <Text size="sm" c="dimmed">
              Todavía no preguntaste nada. Esto solo se ejecuta cuando pulsas el
              botón: resolver mientras escribes anunciaría una plantilla
              inexistente por cada nombre de collector a medio escribir.
            </Text>
          ) : null}
        </Stack>
      </Paper>
    </>
  );
}
