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
