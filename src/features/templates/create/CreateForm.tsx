import type { FormEvent } from "react";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import type {
  ContractResponse,
  PreviewResponse,
  PreviewVariant,
} from "../../../api/types";
import { AvailableVariables } from "./AvailableVariables";
import { PreviewPanel } from "./PreviewPanel";
import type { CreateFormFieldErrors, CreateFormValues } from "./createForm.logic";

interface CreateFormProps {
  values: CreateFormValues;
  fieldErrors: CreateFormFieldErrors;
  generalErrors: string[];
  networkErrorMessage: string | null;
  authorEmail: string;
  isSubmitting: boolean;
  // --- variable catalogue ---
  contract: ContractResponse | null;
  isContractLoading: boolean;
  contractReady: boolean;
  unknownAction: boolean;
  // --- preview ---
  canInsertStarter: boolean;
  onInsertStarter: () => void;
  previewVariant: PreviewVariant;
  preview: PreviewResponse | null;
  previewErrorMessage: string | null;
  previewErrorDetails: string[];
  isRendering: boolean;
  canRender: boolean;
  onPreviewVariantChange: (variant: PreviewVariant) => void;
  onRenderPreview: () => void;
  // --- form ---
  onFieldChange: <K extends keyof CreateFormValues>(
    field: K,
    value: CreateFormValues[K],
  ) => void;
  onAuthorEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

// Presentational — owns no state, no fetch calls. All values/handlers come
// from the CreatePage container.
export function CreateForm({
  values,
  fieldErrors,
  generalErrors,
  networkErrorMessage,
  authorEmail,
  isSubmitting,
  contract,
  isContractLoading,
  contractReady,
  unknownAction,
  canInsertStarter,
  onInsertStarter,
  previewVariant,
  preview,
  previewErrorMessage,
  previewErrorDetails,
  isRendering,
  canRender,
  onPreviewVariantChange,
  onRenderPreview,
  onFieldChange,
  onAuthorEmailChange,
  onSubmit,
}: CreateFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md" mt="md">
        <Alert color="blue" title="Every save creates a new version">
          There is no edit-in-place: submitting this form always creates a
          brand-new version that takes effect at creation (ACTIVE now, or
          SCHEDULED if you set a future effective-from). To change an existing
          template, create another version from here instead.
        </Alert>

        {networkErrorMessage ? (
          <Alert color="orange" title="Network error">
            {networkErrorMessage}
          </Alert>
        ) : null}

        {generalErrors.length > 0 ? (
          <Alert color="red" title="Could not create template">
            <Stack gap={4}>
              {generalErrors.map((detail) => (
                <Text key={detail} size="sm">
                  {detail}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <TextInput
          label="Action"
          placeholder="ORDER"
          required
          value={values.action}
          onChange={(event) => onFieldChange("action", event.currentTarget.value)}
          error={fieldErrors.action}
        />

        <TextInput
          label="Action type"
          placeholder="CREATED"
          required
          value={values.actionType}
          onChange={(event) =>
            onFieldChange("actionType", event.currentTarget.value)
          }
          error={fieldErrors.actionType}
        />

        <TextInput
          label="Template key"
          description="Optional — derived from action + actionType when left blank."
          value={values.templateKey}
          onChange={(event) =>
            onFieldChange("templateKey", event.currentTarget.value)
          }
          error={fieldErrors.templateKey}
        />

        {/*
          The button sits in its own row rather than replacing the field's
          label. Mantine ties Textarea's `label` to the control, and moving that
          text here left the textarea with no accessible name — a screen reader
          announced a bare "text box". The component tests query by role and
          name, which is why they caught it.
        */}
        <Group justify="flex-end" gap="xs" mb={-8}>
          <Tooltip
            label={
              canInsertStarter
                ? "Fills the field with a working skeleton using this action's own variables"
                : contractReady
                  ? "Clear the body first — this would overwrite what you wrote"
                  : "Fill in action and action type first"
            }
            withArrow
            multiline
            w={260}
          >
            <span>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={!canInsertStarter}
                onClick={onInsertStarter}
              >
                Insert example
              </Button>
            </span>
          </Tooltip>
        </Group>

        <Textarea
          label="HTML body"
          description={
            'Jinja2. Extend the base layout and fill the title and content blocks: {% extends "base.html.j2" %}. Redefining header or footer is refused — branding stays with the platform.'
          }
          placeholder={'{% extends "base.html.j2" %}\n{% block content %}...{% endblock %}'}
          required
          autosize
          minRows={10}
          ff="monospace"
          value={values.html}
          onChange={(event) => onFieldChange("html", event.currentTarget.value)}
          error={fieldErrors.html}
        />

        <AvailableVariables
          contract={contract}
          isLoading={isContractLoading}
          ready={contractReady}
          unknownAction={unknownAction}
        />

        <TextInput
          label="Subject"
          description="Optional — may contain Jinja, e.g. {{ commerce.name }}. Comes back rendered in the preview."
          value={values.subject}
          onChange={(event) => onFieldChange("subject", event.currentTarget.value)}
          error={fieldErrors.subject}
        />

        <PreviewPanel
          variant={previewVariant}
          preview={preview}
          errorMessage={previewErrorMessage}
          errorDetails={previewErrorDetails}
          isRendering={isRendering}
          canRender={canRender}
          onVariantChange={onPreviewVariantChange}
          onRender={onRenderPreview}
        />

        <DateTimePicker
          label="Effective from"
          description="Optional. A future time schedules this version (SCHEDULED); leaving it blank or setting now/past makes it ACTIVE immediately."
          clearable
          value={values.effectiveFrom}
          onChange={(value) => onFieldChange("effectiveFrom", value)}
          error={fieldErrors.effectiveFrom}
        />

        <TextInput
          label="Author email"
          description="Sent as X-User-Email for auditing. Defaults to “system” when left blank."
          placeholder="admin@example.com"
          value={authorEmail}
          onChange={(event) => onAuthorEmailChange(event.currentTarget.value)}
        />

        <Group justify="flex-end" mt="sm">
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
            Create template
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
