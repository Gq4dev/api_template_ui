// Pure, framework-free logic for the create form: field validation, payload
// construction, and mapping backend VALIDATION_ERROR details back onto form
// fields. Kept separate from CreatePage/CreateForm so it is unit-testable
// without React or a DOM.
import dayjs from "dayjs";
import type { CreateTemplateRequest } from "../../../api/types";

// Mantine's DateTimePicker (v9) works with naive `YYYY-MM-DD HH:mm:ss`
// strings, not Date objects. We keep that shape in form state and convert to
// a proper ISO-8601 instant only when building the request payload.
export interface CreateFormValues {
  action: string;
  actionType: string;
  templateKey: string;
  html: string;
  subject: string;
  effectiveFrom: string | null;
}

export const EMPTY_CREATE_FORM_VALUES: CreateFormValues = {
  action: "",
  actionType: "",
  templateKey: "",
  html: "",
  subject: "",
  effectiveFrom: null,
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

  if (values.effectiveFrom) {
    payload.effectiveFrom = dayjs(values.effectiveFrom).toISOString();
  }

  return payload;
}

const KNOWN_FIELDS = new Set<keyof CreateFormValues>([
  "action",
  "actionType",
  "templateKey",
  "html",
  "subject",
  "effectiveFrom",
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
 * The structure is the part worth copying, and it is the part people get wrong:
 * `extends` first, then only the `title` and `content` blocks. Anything written
 * outside a block is silently dropped by Jinja inheritance — no error, no
 * output — which is the single most common way a template comes back blank.
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

  const lines = chosen.length
    ? chosen.map((name) => `  <p>${name}: {{ ${name} }}</p>`)
    : ["  <p>Escribí el contenido del mail acá.</p>"];

  return [
    '{% extends "base.html.j2" %}',
    "",
    "{% block title %}Título del mail{% endblock %}",
    "",
    "{% block content %}",
    ...lines,
    "",
    "  {# Todo lo que esté FUERA de un block no se renderiza. #}",
    "{% endblock %}",
    "",
  ].join("\n");
}
