import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
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
import { useTemplatesList } from "../../../queries/useTemplatesList";
import { useRowPreview } from "../../../queries/useRowPreview";
import { useResolveByAction } from "../../../queries/useResolveByAction";
import { useCollectorsInventory } from "../../../queries/useCollectorsInventory";
import { useArchiveTemplate } from "../../../queries/useArchiveTemplate";
import { usePublishTemplate } from "../../../queries/usePublishTemplate";
import { toUiError } from "../../../lib/errors";
import { collectorLabel, normalizeCollector } from "../../../lib/collector";
import type { PreviewVariant } from "../../../preview/protocol";
import type { CollectorInventoryEntry } from "../../../api/types";
import { RenderedEmail } from "../RenderedEmail";
import {
  actionOptions,
  actionTypeOptions,
  catalogueCollectorData,
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
  resolutionOutcome,
  versionOptions,
} from "./browse.logic";

// One page big enough to hold the whole catalogue. The cascade needs every key
// at once — each step is built by counting the keys behind it, and a paginated
// list would make those counts, and the options themselves, silently partial.
const ALL = { page: 0, size: 500 } as const;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green",
  SCHEDULED: "blue",
  DRAFT: "gray",
  ARCHIVED: "dark",
};

// Two different things, so two different colours. A generic template is the
// baseline everyone gets; a collector variant is an exception carved out for one
// client. Rendering both in the same neutral badge would make the reader compare
// the text to tell them apart, which is the one thing this badge exists to spare
// them.
function collectorBadgeColor(collector: string | null): string {
  return collector ? "grape" : "gray";
}

/**
 * The instant the inventory was computed at, in the reader's own clock.
 *
 * Rendered rather than hidden because the list is a PHOTOGRAPH: `status` and
 * `servable` are derived against this instant, so an answer fetched two minutes
 * ago can already describe a version that has since gone live or expired. "Now"
 * would be the page's own guess about when the server looked; this is what the
 * server actually reported, which is why the endpoint echoes it back at all.
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
  const listQuery = useTemplatesList(ALL);
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

    `GET /collectors` answers for EVERY client of this action pair in one
    response — the ones with a servable variant, the ones whose variant exists
    but is not going out, and, through `generic`, everyone else. That last part
    is what a list built from the catalogue never had: the catalogue can only
    name collectors somebody authored something for, so a closed list built from
    it could not express "santander, which has no variant" and the control had
    to be free text to stay useful.

    Asked without `at`, which means now. A picker for historical instants is the
    next work item; the hook and the key already take one.
  */
  const inventoryQuery = useCollectorsInventory(action, actionType);
  const inventory = inventoryQuery.data ?? null;

  // Where the options came from, and therefore what the page may claim about
  // them. See `collectorSource` — the fallback is not an error state.
  const source = collectorSource({
    action,
    actionType,
    isLoading: inventoryQuery.isLoading,
    inventory,
  });

  // Whether the list on screen is the current answer or the last one that
  // arrived. See `inventoryFreshness` — a failed BACKGROUND refetch keeps the
  // previous data and looks identical to a successful one, so the page has to
  // read `isError` to be able to tell the reader which of the two they have.
  const freshness = inventoryFreshness({
    inventory,
    isError: inventoryQuery.isError,
  });

  // What a collector with no servable version of its own actually receives.
  // UNKNOWN whenever the inventory is not there: the page must not imply a
  // fallback it has not been told about.
  const generic = genericDelivery(inventory);

  /*
    One shape, two sources. When the inventory answered it IS the list; when it
    did not, the catalogue-derived names stand in — the same list this control
    offered before the endpoint existed, and the notice below says so.

    The fallback list is also what fills the control while the first fetch is in
    flight, which is harmless because the control is disabled until it settles:
    the reader never picks from a provisional list that is about to be replaced.
  */
  const collectorData = useMemo(
    () =>
      inventory
        ? inventoryCollectorData(inventory.collectors)
        : catalogueCollectorData(groups, action, actionType),
    [inventory, groups, action, actionType],
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
   * `servable` is the field this endpoint was added for, and it would be wasted
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
  function chooseAction(value: string) {
    setAction(value);
    setActionType("");
    setCollector("");
    setVersion(null);
  }

  function chooseActionType(value: string) {
    setActionType(value);
    setCollector("");
    setVersion(null);
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
    resolve.mutate({
      action: action.trim(),
      actionType: actionType.trim(),
      collector,
      variant,
    });
  }

  const canResolve = cascadeAnswered;

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

  // Computed once, read by every banner below. See the block comment above the
  // banners for why this is a four-way question and not a boolean.
  const outcome = resolved
    ? resolutionOutcome(resolved.content, resolved.requestedCollector)
    : null;

  /*
    Three states, not two, and the third is the one worth naming: the API
    answered and the LOCAL engine did not run. `render` is null exactly then,
    and `engineErrorMessage` says why — see useResolveByAction. Everything else
    on this panel is built from `content`, so it keeps rendering: the reader
    still learns which version the send path picks and whether it fell back,
    and only the mail itself is missing.
  */
  const resolvedRender = resolved?.render?.ok ? resolved.render : null;
  const resolvedFailure =
    resolved?.render && !resolved.render.ok ? resolved.render : null;
  const resolvedEngineError = resolved?.engineErrorMessage ?? null;

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
        <Group align="flex-end" gap="md" wrap="wrap">
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

            `GET /collectors` retires that objection. It reports every collector
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

          The endpoint echoes `at` back precisely because `status` and
          `servable` are derived against it, and this query is deliberately not
          stale-cached for the same reason: a version scheduled for 09:00 goes
          live at 09:00 with nobody writing anything. Even so, what is on screen
          was true when it was fetched, and the honest way to say that is to
          print the server's instant rather than the word "ahora".
        */}
        {source === "INVENTORY" && inventory ? (
          <Text size="xs" c="dimmed" mt="sm">
            Inventario de collectors vigente al {formatInstant(inventory.at)}
            {inventory.collectors.length === 1
              ? " · 1 collector con variante propia"
              : ` · ${inventory.collectors.length} collectors con variante propia`}
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
          THE DEGRADED PATH — an expected state, not a failure.

          The endpoint is not on the deployed backend yet, so it 404s (and the
          ingress may answer with a bare non-JSON body). The page must stay
          fully usable: the cascade keeps working, the two panels keep working,
          and the Collector step falls back to the names the catalogue already
          loaded.

          Neutral and grey, in the same register as the UNREPORTED banner below:
          nothing is broken and nothing needs fixing here. What it must say is
          precisely WHAT THE LIST NOW OMITS — collectors nobody authored
          anything for cannot appear at all, and no name in it can be reported
          as served or not served — because a shorter list that looks the same
          as the complete one is the failure mode worth spending words on.
        */}
        {source === "CATALOGUE_FALLBACK" ? (
          <Alert
            color="gray"
            variant="light"
            title="Esta versión de la API no provee el inventario de collectors"
            mt="sm"
          >
            <Stack gap={4}>
              <Text size="sm">
                La lista de collectors se deriva del catálogo guardado, no del
                inventario. Solo incluye collectors que tienen alguna versión
                escrita para alguna terna, y no puede indicar cuáles reciben su
                propia plantilla y cuáles caen en la genérica. Un cliente sin
                nada escrito no aparece, aunque exista y esté recibiendo mails.
              </Text>
              <Text size="xs" c="dimmed">
                Es lo esperable hasta que se despliegue el endpoint de
                inventario en el backend. Para preguntar por un collector que no
                figura en la lista, usa el panel “¿Qué elige el envío?”.
              </Text>
            </Stack>
          </Alert>
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

          {/* The server's own 400 on a malformed collector. It is shown as a
              validation error and NEVER as a template: the API refuses to guess
              what was meant, and showing the generic here would answer a
              question nobody asked. */}
          {resolveError ? (
            <Alert
              color="red"
              title={
                resolveError.kind === "VALIDATION_ERROR"
                  ? "Esa consulta no es válida"
                  : "No se pudo resolver"
              }
            >
              <Stack gap={4}>
                <Text size="sm">{resolveError.message}</Text>
                {(resolveError.fieldDetails ?? []).map((detail) => (
                  <Text key={detail} size="sm" ff="monospace">
                    {detail}
                  </Text>
                ))}
                {resolveError.kind === "TEMPLATE_NOT_FOUND" ? (
                  <Text size="xs" c="dimmed">
                    No hay nada vigente para esta Action, ni siquiera una
                    plantilla genérica. Que falte una variante de collector nunca
                    llegaría hasta aquí por sí solo.
                  </Text>
                ) : null}
              </Stack>
            </Alert>
          ) : null}

          {/*
            ABSENT IS NOT FALSE — which is why these banners switch on a
            four-way outcome instead of reading one boolean.

            These used to be two mutually exclusive ternaries on
            `content.fallbackToGeneric`, so a response that simply lacked the
            field was read as "false", and "false" was rendered as "no, it did
            not fall back — this collector has its own version". That is the
            single most dangerous sentence this panel can print, and it was
            printed over live traffic: the collector dimension is not deployed
            yet, the running API ignores the `collector` parameter outright, and
            it answers with a body carrying neither `collector` nor
            `fallbackToGeneric`. The badge row below, which derives from
            `content.collector`, correctly read GENERIC while the banner
            immediately above it claimed the opposite.

            "I did not answer your question" is its own outcome, and it gets its
            own banner that claims nothing.
          */}

          {/*
            The single most important element in this feature.

            An operator who asked for Santander and is shown the generic without
            being told will go and fix the wrong document — and the fix will
            land on every client instead of the one they meant. So this names
            both halves explicitly: the collector they asked for, and the
            template they are in fact looking at. A version that is DRAFT,
            archived, or scheduled for next month is not servable and falls back
            exactly like one that was never authored, which is why the reason is
            spelled out rather than left to be inferred from a missing row.
          */}
          {resolved && outcome === "FELL_BACK" ? (
            <Alert
              color="yellow"
              title={`No hay plantilla vigente para “${normalizeCollector(resolved.requestedCollector)}” — se muestra la genérica`}
            >
              <Stack gap={4}>
                <Text size="sm">
                  Pediste{" "}
                  <strong>
                    {normalizeCollector(resolved.requestedCollector)}
                  </strong>
                  , que ahora mismo no tiene ninguna versión publicada y vigente.
                  Lo que aparece abajo es la plantilla GENÉRICA{" "}
                  <strong>{resolved.content.templateKey}</strong>: la que recibe
                  todo cliente que no tenga una versión propia, y la que hoy se le
                  está enviando a ese cliente.
                </Text>
                <Text size="xs" c="dimmed">
                  Una variante puede existir y aun así no enviarse: un borrador,
                  una versión archivada o una programada para más adelante caen
                  todas en la genérica igual. Si editas lo que aparece abajo,
                  cambias el mail de todos, no solo el de{" "}
                  {normalizeCollector(resolved.requestedCollector)}.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {resolved && outcome === "COLLECTOR_SERVED" ? (
            <Alert
              color="teal"
              title={`${normalizeCollector(resolved.requestedCollector)} tiene su propia versión`}
            >
              <Text size="sm">
                A este collector se le está enviando{" "}
                <strong>{resolved.content.templateKey}</strong>, no la genérica.
                Si la editas, solo lo afectas a él.
              </Text>
            </Alert>
          ) : null}

          {/*
            The honest "I don't know". It must not be mistaken for either of the
            two banners above, which is why it is neither yellow nor teal and
            why every sentence in it is about the API rather than about the
            template: the one thing this build cannot tell the reader is whether
            this collector has a variant, and pretending otherwise in either
            direction is the bug.
          */}
          {resolved && outcome === "UNREPORTED" ? (
            <Alert
              color="orange"
              title={`Esta versión de la API no puede responder por “${normalizeCollector(resolved.requestedCollector)}”`}
            >
              <Stack gap={4}>
                <Text size="sm">
                  El servidor no informó la dimensión collector en absoluto.
                  Ignoró el collector que pediste —{" "}
                  <strong>
                    {normalizeCollector(resolved.requestedCollector)}
                  </strong>{" "}
                  — y respondió como si no se hubiera pedido ninguno, así que lo
                  que aparece abajo es la plantilla GENÉRICA{" "}
                  <strong>{resolved.content.templateKey}</strong>. Desde aquí no
                  se puede saber si este collector tiene una versión propia:
                  tómalo como desconocido, no como un no.
                </Text>
                <Text size="xs" c="dimmed">
                  Es lo esperable hasta que se despliegue el soporte de collector
                  en el backend. La resolución de abajo es el comportamiento
                  previo a collector: la misma respuesta que daba este endpoint
                  antes de que existiera la dimensión.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {/*
            Badges only — no Edit draft, no Publish, no Archive, and this is not
            an omission to be tidied up later.

            On a fallback the version on screen is the GENERIC one. Offering to
            edit it right where the reader asked about santander is precisely the
            mistake the yellow banner above exists to prevent: they came to fix
            one client's mail and the button under their cursor would change
            everybody's. Acting on a version is the catalogue's job, where what is
            named on screen is what the buttons touch — so the reader goes back up
            and names the template they actually mean.
          */}
          {resolved ? (
            <Group gap="xs" align="center">
              <Badge
                color={STATUS_COLOR[resolved.content.status] ?? "gray"}
                variant="light"
              >
                {resolved.content.status}
              </Badge>
              <Badge
                color={collectorBadgeColor(resolved.content.collector)}
                variant={resolved.content.collector ? "filled" : "light"}
              >
                {collectorLabel(resolved.content.collector)}
              </Badge>
              <Text size="sm" c="dimmed">
                {resolved.content.templateKey} · v{resolved.content.version} ·{" "}
                {resolved.content.action}/{resolved.content.actionType}
              </Text>
            </Group>
          ) : null}

          {resolvedFailure ? (
            <Alert
              color="red"
              title={`No se pudo renderizar — ${resolvedFailure.kind}`}
            >
              <Stack gap={4}>
                <Text size="sm" ff="monospace">
                  {resolvedFailure.line != null
                    ? `línea ${resolvedFailure.line}: `
                    : ""}
                  {resolvedFailure.message}
                </Text>
                <Text size="xs" c="dimmed">
                  Esta es la versión a la que resuelve el envío. Si no puede
                  renderizarse aquí, está fallando al enviarse.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {/*
            THE ENGINE, NOT THE TEMPLATE, AND NOT THE SERVER.

            Scoped to the rendered-mail area on purpose: the resolution above it
            is a complete, correct answer that the API already gave, and the
            badges and banners are still saying what the send path would do. The
            only thing missing is the picture of the mail, so that is the only
            thing this reports.

            Red, but worded away from the template. A version that cannot render
            because of its own Jinja arrives as `resolvedFailure` above, with a
            line number; this one means Pyodide never booted or the worker died,
            and sending the reader to look for the fault in perfectly good HTML
            would cost them an afternoon.
          */}
          {resolvedEngineError ? (
            <Alert color="red" title="No se pudo arrancar el motor de vista previa">
              <Stack gap={4}>
                <Text size="sm">
                  La resolución de arriba es correcta: el servidor respondió y
                  esa es la versión que se envía. Lo que falló es el motor que
                  renderiza el mail en este navegador, así que no se puede
                  mostrar cómo se ve.
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {resolvedEngineError}
                </Text>
                <Text size="xs" c="dimmed">
                  No es un problema de la plantilla. Recarga la página para
                  volver a arrancar el motor.
                </Text>
              </Stack>
            </Alert>
          ) : null}

          {resolvedRender ? (
            <RenderedEmail
              subject={resolvedRender.subject}
              html={resolvedRender.html}
              height={520}
            />
          ) : null}

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
