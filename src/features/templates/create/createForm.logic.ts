// Pure, framework-free logic for the create form: field validation, payload
// construction, and mapping backend VALIDATION_ERROR details back onto form
// fields. Kept separate from CreatePage/CreateForm so it is unit-testable
// without React or a DOM.
import type {
  CreateTemplateRequest,
  TemplateContentResponse,
  TemplateStatus,
  TemplateSummary,
} from "../../../api/types";
import {
  COLLECTOR_FORMAT_MESSAGE,
  isValidCollector,
  normalizeCollector,
} from "../../../lib/collector";
import {
  canonicalActionName,
  storedSpellings,
  type ActionSpelling,
} from "../../../lib/actionNames";

// No date field. Creating a template does not schedule it — it produces a DRAFT,
// and WHEN it applies is decided later, at publish time, by whoever decides to
// publish it. Asking an author for a date while they are still writing the copy
// mixed up two different decisions and put a live-now default on the risky one.
export interface CreateFormValues {
  action: string;
  actionType: string;
  /**
   * Optional per-client override. Blank is the normal case and means "the
   * generic template" — the one every client gets when they have no variant of
   * their own. It is NOT a third part of the identity: action + actionType
   * still say WHAT this mail is, and the collector only says WHO gets a
   * different version of it.
   */
  collector: string;
  templateKey: string;
  html: string;
  subject: string;
}

export const EMPTY_CREATE_FORM_VALUES: CreateFormValues = {
  action: "",
  actionType: "",
  collector: "",
  templateKey: "",
  html: "",
  subject: "",
};

/**
 * Builds the initial form values, prefilling the identity fields from the URL
 * query when present. Two flows land here:
 *
 * - plain "New version" from the list: the identity lands filled while
 *   html/subject stay blank — that version is authored from scratch;
 * - "Create from this version": the same identity params PLUS a source address
 *   (`fromKey`/`fromVersion`, see `fromVersionHref`). The identity is readable
 *   here immediately; the content (html, subject) is copied by CreatePage once
 *   the source version has been fetched, because a URL cannot carry a body.
 *
 * The READ half of a round trip whose write half is `newVersionHref` in
 * list/listFilters.logic.ts. Nothing but the parameter names ties the two
 * together, which is why they are tested against each other rather than each
 * against a hand-written URL.
 *
 * `collector` is seeded with them for one reason: "New version" of a collector
 * variant has to stay a version of THAT variant. Dropping it would silently
 * turn the flow into "author a new generic", and the author would only find out
 * after publishing it to every client.
 *
 * A MISSING parameter yields "", and that is not a fallback — it is the answer.
 * Blank is how the API spells "the generic", so a link written for a generic
 * row and a link with no `collector` at all land on the same form, which is the
 * behaviour every caller already assumes.
 */
export function initialFormValues(
  searchParams: URLSearchParams,
): CreateFormValues {
  return {
    ...EMPTY_CREATE_FORM_VALUES,
    action: searchParams.get("action") ?? "",
    actionType: searchParams.get("actionType") ?? "",
    collector: searchParams.get("collector") ?? "",
    templateKey: searchParams.get("templateKey") ?? "",
  };
}

// --- Create from an existing version ----------------------------------------

export const SOURCE_KEY_PARAM = "fromKey";
export const SOURCE_VERSION_PARAM = "fromVersion";

/** The stored version a new template is being authored from. */
export interface SourceAddress {
  templateKey: string;
  version: number;
}

/**
 * Only published versions (in effect now, or scheduled to be) offer "create
 * from". A draft is edited in place instead, and an archived version is not
 * something anyone should be starting from by accident.
 */
export function isPublishedStatus(status: TemplateStatus): boolean {
  return status === "ACTIVE" || status === "SCHEDULED";
}

/**
 * The "Create from this version" link — the WRITE half of a round trip whose
 * read half is `initialFormValues` (identity) plus `sourceAddressFromParams`
 * (what to copy). Carries the identity alongside the address so the form shows
 * the right Action/Action type/Collector before the content has arrived.
 */
export function fromVersionHref(
  row: Pick<
    TemplateSummary,
    "templateKey" | "version" | "action" | "actionType" | "collector"
  >,
): string {
  const search = new URLSearchParams({
    templateKey: row.templateKey,
    action: row.action,
    actionType: row.actionType,
    collector: row.collector ?? "",
    [SOURCE_KEY_PARAM]: row.templateKey,
    [SOURCE_VERSION_PARAM]: String(row.version),
  });
  return `/create?${search.toString()}`;
}

/**
 * Reads the source address back off the URL. Anything short of a non-blank key
 * and a positive integer version is "no source" rather than an error: the form
 * is still perfectly usable from scratch, and a half-pasted link should land
 * there instead of on a broken fetch.
 */
export function sourceAddressFromParams(
  searchParams: URLSearchParams,
): SourceAddress | null {
  const templateKey = (searchParams.get(SOURCE_KEY_PARAM) ?? "").trim();
  const rawVersion = searchParams.get(SOURCE_VERSION_PARAM) ?? "";
  const version = Number(rawVersion);
  if (!templateKey || rawVersion.trim() === "") return null;
  if (!Number.isInteger(version) || version <= 0) return null;
  return { templateKey, version };
}

/** Every form field copied from the fetched source version. */
export function seedFromVersion(
  content: Pick<
    TemplateContentResponse,
    "templateKey" | "action" | "actionType" | "collector" | "html" | "subject"
  >,
): CreateFormValues {
  return {
    action: content.action ?? "",
    actionType: content.actionType ?? "",
    collector: content.collector ?? "",
    templateKey: content.templateKey,
    html: content.html,
    subject: content.subject ?? "",
  };
}

type Identity = Pick<CreateFormValues, "action" | "actionType" | "collector">;

/**
 * Whether the form still names the same template as the source.
 *
 * Compared the way the server decides identity: action and action type through
 * `canonicalActionName` — "ORDER", "order " and "order.created"-style spellings
 * derive one key — and the collector trimmed but case-sensitive, because the
 * server keeps its case: `BBVA` is a different key from `bbva`. Comparing
 * action/type raw would announce "new template" to an author who only changed
 * their case, while the server would file the save under the same key.
 */
export function identityMatchesSource(values: Identity, source: Identity): boolean {
  return (
    canonicalActionName(values.action) === canonicalActionName(source.action) &&
    canonicalActionName(values.actionType) === canonicalActionName(source.actionType) &&
    normalizeCollector(values.collector) === normalizeCollector(source.collector)
  );
}

/**
 * Keeps a copied templateKey from outliving the identity it belongs to.
 *
 * Seeded from the source, the key is correct only while the identity is the
 * source's. Once the author changes Action or Action type, sending the old key
 * would file a template for the new action under the old action's key — the
 * mixed-action key the browse view warns about. So while the key is still the
 * untouched copy it follows the identity: cleared (server derives it) when the
 * identity diverges, restored when the author changes it back. A key the author
 * typed themselves is never touched.
 */
export function detachSourceTemplateKey(
  next: CreateFormValues,
  source: CreateFormValues | null,
): CreateFormValues {
  if (!source) return next;
  const matches = identityMatchesSource(next, source);
  if (!matches && next.templateKey === source.templateKey) {
    return { ...next, templateKey: "" };
  }
  if (matches && next.templateKey === "") {
    return { ...next, templateKey: source.templateKey };
  }
  return next;
}

export type CreateFormFieldErrors = Partial<
  Record<keyof CreateFormValues, string>
>;

const REQUIRED_FIELDS = ["action", "actionType", "html"] as const;

// The field names are the ones printed on the labels above the inputs, and the
// API's own vocabulary, so they stay in English inside the Spanish sentence:
// translating them would point the author at a field that is not on screen.
const REQUIRED_MESSAGES: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  action: "Action es obligatorio.",
  actionType: "Action type es obligatorio.",
  html: "HTML body es obligatorio.",
};

/** Client-side validation, run before calling the API. */
export function validateCreateForm(
  values: CreateFormValues,
): CreateFormFieldErrors {
  const errors: CreateFormFieldErrors = {};

  for (const field of REQUIRED_FIELDS) {
    if (!values[field].trim()) {
      errors[field] = REQUIRED_MESSAGES[field];
    }
  }

  // The collector is optional, so a blank one is never an error — that is the
  // generic template, the overwhelmingly common case. But a MALFORMED one is a
  // hard 400 from the server, not a quiet degradation to the generic: "I don't
  // understand what you asked" and "this collector has no variant" are
  // deliberately different answers. Catching it here saves the round trip
  // without changing the outcome.
  if (!isValidCollector(values.collector)) {
    errors.collector = COLLECTOR_FORMAT_MESSAGE;
  }

  return errors;
}

/**
 * Builds the `POST /api/v1/templates` body. Optional empty fields are
 * omitted entirely so the backend applies its own defaults/derivation
 * (`templateKey` from action+actionType, `variables` auto-derived from
 * `html`) — the spec requires `variables` to be left off the request and
 * only used client-side as a preview.
 *
 * Never carries effective dates: the backend rejects them here with a 400.
 */
export function buildCreatePayload(
  values: CreateFormValues,
): CreateTemplateRequest {
  const payload: CreateTemplateRequest = {
    action: values.action.trim(),
    actionType: values.actionType.trim(),
    html: values.html,
  };

  const collector = values.collector.trim();
  if (collector) payload.collector = collector;

  /*
    With a collector present the templateKey is NOT ours to send.

    The server derives it (`action_actiontype__collector`) and rejects with a
    400 any templateKey that does not match what it derived. So a copy of that
    derivation travelling in the payload can do exactly one thing that omitting
    it cannot: be wrong. A trailing space, a stale value left in the field from
    before the collector was typed, a rule that tightens on the server before it
    tightens here — every one of those turns a valid create into a 400 that
    blames a field the author cannot see the point of.

    The form still SHOWS the derived key (read-only) so the author knows what
    they are creating. Showing is the job; sending is not.
  */
  const templateKey = values.templateKey.trim();
  if (!collector && templateKey) payload.templateKey = templateKey;

  const subject = values.subject.trim();
  if (subject) payload.subject = subject;

  return payload;
}

const KNOWN_FIELDS = new Set<keyof CreateFormValues>([
  "action",
  "actionType",
  // Without this, a backend detail like "collector: must match ..." lands in
  // the general banner at the top of the form — far away from the one field it
  // is about, and phrased for a machine. On the field it reads as an answer.
  "collector",
  "templateKey",
  "html",
  "subject",
]);

export interface MappedValidationDetails {
  fieldErrors: CreateFormFieldErrors;
  generalDetails: string[];
}

/**
 * Splits backend `VALIDATION_ERROR` details (e.g. `"html: must not be
 * blank"`) into per-field errors when the prefix matches a known form
 * field, and a general list for anything else (cross-field messages, or
 * fields this form doesn't render).
 *
 * The server names fields as they are on the wire, in snake_case
 * (`action_type: …`), so the prefix is camelCased before the lookup. The
 * detail itself is shown untouched: it is the server's sentence, and it names
 * the field the way the API documentation does.
 */
export function mapValidationDetails(
  details: string[],
): MappedValidationDetails {
  const fieldErrors: CreateFormFieldErrors = {};
  const generalDetails: string[] = [];

  for (const detail of details) {
    const separatorIndex = detail.indexOf(":");
    const field =
      separatorIndex >= 0
        ? detail
            .slice(0, separatorIndex)
            .trim()
            .replace(/_([a-z0-9])/g, (_, next: string) => next.toUpperCase())
        : "";

    if (KNOWN_FIELDS.has(field as keyof CreateFormValues)) {
      fieldErrors[field as keyof CreateFormValues] = detail;
    } else {
      generalDetails.push(detail);
    }
  }

  return { fieldErrors, generalDetails };
}

/**
 * A working starter template for the HTML body.
 *
 * Built from the action's own contract rather than hard-coded, so the example
 * references variables that actually exist for THIS action and renders on the
 * first try. A generic sample that fails validation teaches the wrong lesson —
 * the author starts by debugging the example instead of writing the mail.
 *
 * Three things here are structure, not decoration, and each is a way templates
 * come back wrong:
 *
 * 1. `extends` first, and everything inside a block. Anything written outside
 *    one is silently dropped by Jinja inheritance — no error, no output — which
 *    is the most common way a template comes back blank.
 *
 * 2. The header and footer partials are INCLUDED. base.html.j2 leaves both
 *    blocks empty, so a template that omits them renders as bare text on white
 *    with no branding at all. Every bundled template in the sender includes
 *    them; a starter that did not was teaching authors to produce unbranded
 *    mail, and they did.
 *
 * 3. Styles are inline. Mail clients discard <style> in the head, so a rule
 *    that is not on the element does not exist. This is why the real templates
 *    are long: there is no other place to put the styling.
 */
export function buildStarterTemplate(variables: string[]): string {
  // Prefer scalars a reader recognises. `commerce` and `payer` are objects, so
  // printing them raw would dump a dict into the mail; they need a field.
  const preferred = ["customer_name", "currency_id", "final_amount", "link"];
  const picked = preferred.filter((name) => variables.includes(name));
  const fallback = variables
    .filter((name) => !["commerce", "payer", "payments", "details", "properties", "payload"].includes(name))
    .slice(0, 3);
  const chosen = picked.length > 0 ? picked : fallback;

  const greeting = variables.includes("customer_name")
    ? "  <p>¡Hola {{ customer_name | capitalize_words }}!</p>"
    : "  <p>¡Hola!</p>";

  const detail = chosen
    .filter((name) => name !== "customer_name")
    .map(
      (name) =>
        `      <tr><td style="font-family:Arial;font-size:13px;color:#565856;padding:4px 8px;">${name}</td>` +
        `<td style="font-family:Arial;font-size:13px;color:#1E1248;padding:4px 8px;"><strong>{{ ${name} }}</strong></td></tr>`,
    );

  const table = detail.length
    ? [
        '  <table align="center" cellpadding="0" cellspacing="0"',
        '         style="margin:0 auto;background-color:#f4f4f2;border-radius:7px;padding:15px;">',
        "    <tbody>",
        ...detail,
        "    </tbody>",
        "  </table>",
      ]
    : ["  <p>Escribí el contenido del mail acá.</p>"];

  return [
    '{% extends "base.html.j2" %}',
    "",
    "{% block title %}Título del mail{% endblock %}",
    "",
    "{# Branding de la plataforma. Sin estos includes el mail sale sin header ni footer. #}",
    "{% block header %}",
    '  {% include "partials/header.html.j2" %}',
    "{% endblock %}",
    "",
    "{% block content %}",
    '<div style="padding:15px 30px;font-family:Arial;font-size:13px;color:#565856;text-align:center;">',
    '  <p style="font-size:18px;font-weight:bold;color:#1E1248;margin:0 0 12px;">Título del mail</p>',
    greeting,
    ...table,
    "",
    "  {# Todo lo que esté FUERA de un block no se renderiza. #}",
    "  {# Los estilos van inline: los clientes de mail descartan el CSS del head. #}",
    "</div>",
    "{% endblock %}",
    "",
    "{% block footer %}",
    '  {% include "partials/footer.html.j2" %}',
    "{% endblock %}",
    "",
  ].join("\n");
}

// --- Spelling sent to the API -----------------------------------------------
//
// THE PROBLEM THIS EXISTS FOR. api-template canonicalizes only the collector.
// action/actionType are stored exactly as sent and matched exactly by /resolve
// and /collectors; only the templateKey is derived from their canonical form
// (see `canonicalActionName`). Verified against the live API (2026-09-15): the
// generic `payment_approved` and most variants are stored as PAYMENT/APPROVED,
// `payment_approved__dell` as payment/approved — so a sender asking for PAYMENT
// silently gets the generic for dell, and one asking for payment gets a 404 for
// bbva. And a key accepts ONE raw spelling: a new version sent in another
// spelling is a 400 (TemplateKeyIdentityGuard).
//
// Lowercasing on the way out would therefore make it WORSE: every new version
// of a PAYMENT key would 400, and a new bbva version would vanish for PAYMENT
// senders. The UI cannot repair the data. What it can do is stop adding drift,
// by sending the spelling the catalogue already uses for this identity.

/** Which rule picked the spelling — also what the author is told about it. */
export type SpellingRule =
  /** The key being written already exists: its reserved spelling, or a 400. */
  | "EXISTING_KEY"
  /** A new variant under an existing generic: the generic's spelling. */
  | "GENERIC"
  /** No generic, but other variants of the pair: their most common spelling. */
  | "SIBLINGS"
  /** Nothing stored for the pair: the canonical form, the one spelling that cannot drift. */
  | "CANONICAL"
  /** The catalogue has not loaded (or a half is blank): exactly what was typed. */
  | "TYPED";

export interface SentSpelling extends ActionSpelling {
  rule: SpellingRule;
}

type CatalogueRow = Pick<
  TemplateSummary,
  "templateKey" | "version" | "action" | "actionType" | "collector"
>;

/** One row per templateKey — its highest version, whose spelling the key reserves. */
function latestPerKey(rows: CatalogueRow[]): CatalogueRow[] {
  const byKey = new Map<string, CatalogueRow>();
  for (const row of rows) {
    const existing = byKey.get(row.templateKey);
    if (!existing || row.version > existing.version) byKey.set(row.templateKey, row);
  }
  return [...byKey.values()];
}

/**
 * Every raw spelling the catalogue stores for the canonical pair being typed,
 * most common first, one vote per key. Empty while the catalogue is not loaded.
 * More than one entry means the catalogue has already drifted, which the form
 * tells the author.
 */
export function pairSpellings(
  identity: Identity,
  catalogue: CatalogueRow[] | null,
): ActionSpelling[] {
  if (!catalogue) return [];
  return storedSpellings(latestPerKey(catalogue), identity.action, identity.actionType).map(
    (spelling) => ({ action: spelling.action, actionType: spelling.actionType }),
  );
}

/**
 * The action/actionType spelling to SEND for the identity being authored.
 *
 * The author types freely; this decides what goes on the wire, in order:
 *
 * 1. EXISTING_KEY — a stored key names this exact identity (canonical pair plus
 *    collector). Its spelling is not a preference but a requirement: the key
 *    reserves one raw spelling and rejects any other with a 400. Taken from the
 *    key's latest version.
 * 2. GENERIC — a new variant under an existing generic. The generic's spelling,
 *    so that a sender resolving in the generic's spelling — the one every client
 *    already works with — finds the new variant instead of falling back past it.
 * 3. SIBLINGS — no generic, but other variants exist. Their most common
 *    spelling (one vote per key, ties broken by code-point order), for the same
 *    reason one level down.
 * 4. CANONICAL — nothing stored for the pair: the canonical lowercase form. A
 *    brand-new template has no spelling to agree with, and the canonical one is
 *    the only spelling a future author cannot get "wrong".
 *
 * TYPED when the catalogue is not available: sending what the author typed is
 * exactly the old behaviour, and a guess made without the catalogue could
 * cause the very 400 rule 1 exists to avoid. That fallback is never silent in
 * the page: CreatePage blocks the submit while the catalogue is on its first
 * load, and warns when it could not be read or was truncated.
 */
export function spellingFor(
  identity: Identity,
  catalogue: CatalogueRow[] | null,
): SentSpelling {
  const typed = { action: identity.action.trim(), actionType: identity.actionType.trim() };
  const canonicalAction = canonicalActionName(typed.action);
  const canonicalType = canonicalActionName(typed.actionType);
  if (!catalogue || canonicalAction === "" || canonicalType === "") {
    return { ...typed, rule: "TYPED" };
  }

  const pair = latestPerKey(catalogue).filter(
    (row) =>
      canonicalActionName(row.action) === canonicalAction &&
      canonicalActionName(row.actionType) === canonicalType,
  );
  const pick = (row: CatalogueRow, rule: SpellingRule): SentSpelling => ({
    action: row.action,
    actionType: row.actionType,
    rule,
  });
  const newest = (rows: CatalogueRow[]) =>
    rows.reduce((best, row) => (row.version > best.version ? row : best));

  const collector = normalizeCollector(identity.collector);
  const sameKey = pair.filter((row) => normalizeCollector(row.collector ?? "") === collector);
  if (sameKey.length > 0) return pick(newest(sameKey), "EXISTING_KEY");

  const generic = pair.filter((row) => normalizeCollector(row.collector ?? "") === "");
  if (generic.length > 0) return pick(newest(generic), "GENERIC");

  const [mostCommon] = storedSpellings(pair, typed.action, typed.actionType);
  if (mostCommon) {
    return { action: mostCommon.action, actionType: mostCommon.actionType, rule: "SIBLINGS" };
  }

  return { action: canonicalAction, actionType: canonicalType, rule: "CANONICAL" };
}

const SPELLING_REASON: Record<Exclude<SpellingRule, "TYPED">, string> = {
  EXISTING_KEY: "para coincidir con la plantilla existente",
  GENERIC: "para coincidir con la plantilla genérica",
  SIBLINGS: "para coincidir con las variantes existentes",
  CANONICAL: "en su forma canónica",
};

export interface SpellingHints {
  action: string | null;
  actionType: string | null;
}

/**
 * The quiet notes under Action and Action type.
 *
 * Only when there is something to say: the value sent differs from the one
 * typed (the author must not discover in the catalogue that "payment" was saved
 * as PAYMENT), or the catalogue already holds this pair in more than one
 * spelling (the author should know the send path gives different answers
 * depending on how the sender writes it). Nothing while the catalogue is not
 * loaded — TYPED sends what is on screen, so there is no difference to report.
 */
export function spellingHints(
  identity: Identity,
  sent: SentSpelling,
  spellings: ActionSpelling[],
): SpellingHints {
  const noteFor = (typed: string, value: string): string | null =>
    sent.rule !== "TYPED" && value !== typed.trim()
      ? `Se enviará como ${value} ${SPELLING_REASON[sent.rule]}.`
      : null;

  const actionNote = noteFor(identity.action, sent.action);
  const conflictNote =
    spellings.length > 1
      ? `El catálogo ya tiene esta plantilla escrita de ${spellings.length} formas (${spellings
          .map((spelling) => `${spelling.action}/${spelling.actionType}`)
          .join(", ")}): el envío responde distinto según cuál use el emisor.`
      : null;

  const action = [actionNote, conflictNote].filter(Boolean).join(" ");
  return {
    action: action === "" ? null : action,
    actionType: noteFor(identity.actionType, sent.actionType),
  };
}
