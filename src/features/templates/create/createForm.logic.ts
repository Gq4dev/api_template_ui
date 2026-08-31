// Pure, framework-free logic for the create form: field validation, payload
// construction, and mapping backend VALIDATION_ERROR details back onto form
// fields. Kept separate from CreatePage/CreateForm so it is unit-testable
// without React or a DOM.
import type { CreateTemplateRequest } from "../../../api/types";

// No date field. Creating a template does not schedule it — it produces a DRAFT,
// and WHEN it applies is decided later, at publish time, by whoever decides to
// publish it. Asking an author for a date while they are still writing the copy
// mixed up two different decisions and put a live-now default on the risky one.
export interface CreateFormValues {
  action: string;
  actionType: string;
  templateKey: string;
  html: string;
  subject: string;
}

export const EMPTY_CREATE_FORM_VALUES: CreateFormValues = {
  action: "",
  actionType: "",
  templateKey: "",
  html: "",
  subject: "",
};

export type CreateFormFieldErrors = Partial<
  Record<keyof CreateFormValues, string>
>;

const REQUIRED_FIELDS = ["action", "actionType", "html"] as const;

const REQUIRED_MESSAGES: Record<(typeof REQUIRED_FIELDS)[number], string> = {
  action: "Action is required.",
  actionType: "Action type is required.",
  html: "HTML body is required.",
};

/** Client-side required-field validation, run before calling the API. */
export function validateCreateForm(
  values: CreateFormValues,
): CreateFormFieldErrors {
  const errors: CreateFormFieldErrors = {};

  for (const field of REQUIRED_FIELDS) {
    if (!values[field].trim()) {
      errors[field] = REQUIRED_MESSAGES[field];
    }
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

  const templateKey = values.templateKey.trim();
  if (templateKey) payload.templateKey = templateKey;

  const subject = values.subject.trim();
  if (subject) payload.subject = subject;

  return payload;
}

const KNOWN_FIELDS = new Set<keyof CreateFormValues>([
  "action",
  "actionType",
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
