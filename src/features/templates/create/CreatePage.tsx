import { type FormEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { useCreateTemplate } from "../../../queries/useCreateTemplate";
import { IdempotencyKeyManager } from "../../../lib/idempotency";
import { extractVariables } from "../../../lib/variables";
import { toUiError } from "../../../lib/errors";
import { CreateForm } from "./CreateForm";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  mapValidationDetails,
  validateCreateForm,
  type CreateFormFieldErrors,
  type CreateFormValues,
} from "./createForm.logic";

const AUTHOR_EMAIL_STORAGE_KEY = "api_template_ui.authorEmail";

function readStoredAuthorEmail(): string {
  try {
    return window.localStorage.getItem(AUTHOR_EMAIL_STORAGE_KEY) ?? "";
  } catch {
    // localStorage unavailable (private browsing, disabled storage, SSR) —
    // just fall back to an empty author field.
    return "";
  }
}

function persistAuthorEmail(value: string): void {
  try {
    if (value) {
      window.localStorage.setItem(AUTHOR_EMAIL_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(AUTHOR_EMAIL_STORAGE_KEY);
    }
  } catch {
    // Not fatal — the field just won't be prefilled next time.
  }
}

// Container — owns form state, the idempotency key, the mutation, and error
// mapping. Delegates all rendering to the presentational CreateForm.
export function CreatePage() {
  const [values, setValues] = useState<CreateFormValues>(
    EMPTY_CREATE_FORM_VALUES,
  );
  const [fieldErrors, setFieldErrors] = useState<CreateFormFieldErrors>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<
    string | null
  >(null);
  const [authorEmail, setAuthorEmail] = useState<string>(readStoredAuthorEmail);

  // One manager per "logical" create attempt: current() mints a key on first
  // use and returns the same key across retries; reset() is called only on
  // success (see IdempotencyKeyManager docs).
  const idempotencyManager = useRef(new IdempotencyKeyManager());
  const mutation = useCreateTemplate();

  const detectedVariables = useMemo(
    () => extractVariables(values.html),
    [values.html],
  );

  function handleFieldChange<K extends keyof CreateFormValues>(
    field: K,
    value: CreateFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleAuthorEmailChange(value: string) {
    setAuthorEmail(value);
    persistAuthorEmail(value.trim());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validateCreateForm(values);
    setFieldErrors(errors);
    setGeneralErrors([]);
    setNetworkErrorMessage(null);

    if (Object.keys(errors).length > 0) return;

    mutation.mutate(
      {
        payload: buildCreatePayload(values),
        opts: {
          author: authorEmail.trim() || undefined,
          idempotencyKey: idempotencyManager.current.current(),
        },
      },
      {
        onSuccess: () => {
          // Fresh key for the next, unrelated create attempt.
          idempotencyManager.current.reset();
        },
        onError: (error) => {
          const uiError = toUiError(error);

          if (uiError.kind === "VALIDATION_ERROR") {
            const { fieldErrors: mapped, generalDetails } =
              mapValidationDetails(uiError.fieldDetails ?? []);
            setFieldErrors(mapped);
            setGeneralErrors(
              generalDetails.length ? generalDetails : [uiError.message],
            );
            return;
          }

          if (uiError.kind === "NETWORK") {
            setNetworkErrorMessage(uiError.message);
            return;
          }

          // OBJECT_ALREADY_EXISTS and any other mapped kind: surfaced as a
          // general banner using the mapper's message.
          setGeneralErrors([uiError.message]);
        },
      },
    );
  }

  function handleCreateAnother() {
    mutation.reset();
    setValues(EMPTY_CREATE_FORM_VALUES);
    setFieldErrors({});
    setGeneralErrors([]);
    setNetworkErrorMessage(null);
  }

  if (mutation.isSuccess && mutation.data) {
    const { templateKey, version, status, checksum } = mutation.data;

    return (
      <Container size="sm" py="xl">
        <Title order={2}>Create template</Title>
        <Alert color="green" title="Draft created" mt="md">
          <Stack gap="xs">
            <Text>
              <strong>{templateKey}</strong> v{version} — status: {status}
            </Text>
            <Text size="sm" c="dimmed">
              checksum: {checksum}
            </Text>
            <Group mt="sm">
              <Button component={Link} to={`/${templateKey}/${version}/preview`}>
                Preview this version
              </Button>
              <Button variant="default" onClick={handleCreateAnother}>
                Create another
              </Button>
            </Group>
          </Stack>
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <Title order={2}>Create template</Title>
      <CreateForm
        values={values}
        fieldErrors={fieldErrors}
        generalErrors={generalErrors}
        networkErrorMessage={networkErrorMessage}
        detectedVariables={detectedVariables}
        authorEmail={authorEmail}
        isSubmitting={mutation.isPending}
        onFieldChange={handleFieldChange}
        onAuthorEmailChange={handleAuthorEmailChange}
        onSubmit={handleSubmit}
      />
    </Container>
  );
}
