import type { FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
import type { CreateFormFieldErrors, CreateFormValues } from "./createForm.logic";

interface CreateFormProps {
  values: CreateFormValues;
  fieldErrors: CreateFormFieldErrors;
  generalErrors: string[];
  networkErrorMessage: string | null;
  detectedVariables: string[];
  authorEmail: string;
  isSubmitting: boolean;
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
  detectedVariables,
  authorEmail,
  isSubmitting,
  onFieldChange,
  onAuthorEmailChange,
  onSubmit,
}: CreateFormProps) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md" mt="md">
        <Alert color="blue" title="Every save creates a new version">
          There is no edit-in-place: submitting this form always creates a
          brand-new DRAFT version. To change an existing template, create
          another version from here instead.
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

        <Textarea
          label="HTML body"
          description="Full HTML body. Use {{placeholder}} for variables the template needs."
          placeholder="<html>...</html>"
          required
          autosize
          minRows={10}
          ff="monospace"
          value={values.html}
          onChange={(event) => onFieldChange("html", event.currentTarget.value)}
          error={fieldErrors.html}
        />

        <div>
          <Text size="sm" fw={500} mb={4}>
            Detected variables
          </Text>
          {detectedVariables.length > 0 ? (
            <Group gap="xs">
              {detectedVariables.map((name) => (
                <Badge key={name} variant="light">
                  {name}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed">
              No {"{{placeholders}}"} detected yet — this is a best-effort
              preview only; the backend derives the real variable list.
            </Text>
          )}
        </div>

        <TextInput
          label="Subject"
          description="Optional — may contain {{placeholders}}."
          value={values.subject}
          onChange={(event) => onFieldChange("subject", event.currentTarget.value)}
          error={fieldErrors.subject}
        />

        <DateTimePicker
          label="Effective from"
          description="Optional now — required later to publish this version."
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
