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
} from "../../../lib/collector";

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

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether the form still names the same template as the source. Compared
 * trimmed and case-insensitively, like the key the server derives from them:
 * "ORDER" and "order " are one template, not two.
 */
export function identityMatchesSource(values: Identity, source: Identity): boolean {
  return (
    normalizeIdentityPart(values.action) === normalizeIdentityPart(source.action) &&
    normalizeIdentityPart(values.actionType) === normalizeIdentityPart(source.actionType) &&
    normalizeIdentityPart(values.collector) === normalizeIdentityPart(source.collector)
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
 * Splits backend `VALIDATION_ERROR` `details[]` (e.g. `"html: must not be
 * blank"`) into per-field errors when the prefix matches a known form
 * field, and a general list for anything else (cross-field messages, or
 * fields this form doesn't render).
 */
export function mapValidationDetails(
  details: string[],
): MappedValidationDetails {
  const fieldErrors: CreateFormFieldErrors = {};
  const generalDetails: string[] = [];

  for (const detail of details) {
    const separatorIndex = detail.indexOf(":");
    const field =
      separatorIndex >= 0 ? detail.slice(0, separatorIndex).trim() : "";

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
