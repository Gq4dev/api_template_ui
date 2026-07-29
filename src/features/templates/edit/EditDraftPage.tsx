import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { useUpdateDraft } from "../../../queries/useUpdateDraft";
import { useVersionContent } from "../../../queries/useVersionContent";
import { useContract } from "../../../queries/useContract";
import { usePreview } from "../../../queries/usePreview";
import { toUiError } from "../../../lib/errors";
import { ApiError } from "../../../api/templatesClient";
import type { PreviewVariant } from "../../../api/types";
import { AppHeader } from "../../../app/AppHeader";
import { CreateForm } from "../create/CreateForm";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildStarterTemplate,
  mapValidationDetails,
  validateCreateForm,
  type CreateFormFieldErrors,
  type CreateFormValues,
} from "../create/createForm.logic";

const AUTHOR_EMAIL_STORAGE_KEY = "api_template_ui.authorEmail";

function readStoredAuthorEmail(): string {
  try {
    return window.localStorage.getItem(AUTHOR_EMAIL_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Rewrite a DRAFT in place. Reuses CreateForm in "edit" mode — the authoring
 * surface (variable catalogue, starter template, preview) is the same job, and
 * having two of it would guarantee they drift.
 *
 * The route is only reachable from a DRAFT row, but that is a UI convention, not
 * a guarantee: someone can paste the URL. So this screen checks the loaded
 * version's status itself and refuses rather than letting the author write a
 * whole revision that the API will reject with a 409 on save.
 */
export function EditDraftPage() {
  const params = useParams<{ templateKey: string; version: string }>();
  const templateKey = params.templateKey ?? "";
  const version = Number(params.version);

  const contentQuery = useVersionContent(templateKey, version);
  const mutation = useUpdateDraft();

  const [values, setValues] = useState<CreateFormValues>(EMPTY_CREATE_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<CreateFormFieldErrors>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<string | null>(null);
  const [authorEmail, setAuthorEmail] = useState<string>(readStoredAuthorEmail);
  const [previewVariant, setPreviewVariant] = useState<PreviewVariant>("single");

  const previewMutation = usePreview();
  const loaded = contentQuery.data;

  // Seeds the form ONCE per version, when the stored content arrives — not on
  // mount, because the fetch resolves after the first render.
  //
  // The guard is load-bearing. Saving invalidates the whole templates key space,
  // which refetches this query and hands back a new object; without the ref, the
  // effect would fire again and reset the textarea to the server's copy. Anything
  // the author typed while the save was in flight would vanish under their
  // cursor — the one failure mode an author would never forgive.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const address = `${loaded.templateKey}:${loaded.version}`;
    if (seededFor.current === address) return;
    seededFor.current = address;

    setValues({
      action: loaded.action ?? "",
      actionType: loaded.actionType ?? "",
      templateKey: loaded.templateKey,
      html: loaded.html,
      subject: loaded.subject ?? "",
    });
  }, [loaded]);

  const action = values.action.trim();
  const actionType = values.actionType.trim();
  const contractReady = action !== "" && actionType !== "";
  const contractQuery = useContract(action, actionType, previewVariant);

  const unknownAction =
    contractQuery.isError &&
    contractQuery.error instanceof ApiError &&
    contractQuery.error.status === 404;

  const canRender = contractReady && values.html.trim() !== "";
  const canInsertStarter = contractQuery.data != null && values.html.trim() === "";

  function handleInsertStarter() {
    if (!canInsertStarter || !contractQuery.data) return;
    handleFieldChange("html", buildStarterTemplate(contractQuery.data.variables));
  }

  function handleRenderPreview() {
    if (!canRender) return;
    previewMutation.mutate({
      action,
      actionType,
      html: values.html,
      subject: values.subject.trim() || undefined,
      variant: previewVariant,
    });
  }

  function handlePreviewVariantChange(next: PreviewVariant) {
    setPreviewVariant(next);
    previewMutation.reset();
  }

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
    try {
      if (value.trim()) {
        window.localStorage.setItem(AUTHOR_EMAIL_STORAGE_KEY, value.trim());
      }
    } catch {
      // Not fatal — the field just won't be prefilled next time.
    }
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
        templateKey,
        version,
        payload: {
          html: values.html,
          subject: values.subject.trim() || undefined,
        },
        author: authorEmail.trim() || undefined,
      },
      {
        onError: (error) => {
          const uiError = toUiError(error);

          if (uiError.kind === "VALIDATION_ERROR") {
            const { fieldErrors: mapped, generalDetails } = mapValidationDetails(
              uiError.fieldDetails ?? [],
            );
            setFieldErrors(mapped);
            setGeneralErrors(generalDetails.length ? generalDetails : [uiError.message]);
            return;
          }

          if (uiError.kind === "NETWORK") {
            setNetworkErrorMessage(uiError.message);
            return;
          }

          setGeneralErrors([uiError.message]);
        },
      },
    );
  }

  const backToList = (
    <Button component={Link} to={`/?templateKey=${encodeURIComponent(templateKey)}`}>
      Back to list
    </Button>
  );

  if (contentQuery.isLoading) {
    return (
      <Container size="sm" py="xl">
        <AppHeader />
        <Text c="dimmed">Loading draft…</Text>
      </Container>
    );
  }

  if (contentQuery.isError || !loaded) {
    return (
      <Container size="sm" py="xl">
        <AppHeader />
        <Alert color="red" title="Could not load this version" mt="md">
          <Stack gap="sm">
            <Text size="sm">
              {contentQuery.error
                ? toUiError(contentQuery.error).message
                : "That version does not exist."}
            </Text>
            <Group>{backToList}</Group>
          </Stack>
        </Alert>
      </Container>
    );
  }

  if (loaded.status !== "DRAFT") {
    return (
      <Container size="sm" py="xl">
        <AppHeader />
        <Alert color="yellow" title="This version is no longer editable" mt="md">
          <Stack gap="sm">
            <Text size="sm">
              <strong>{loaded.templateKey}</strong> v{loaded.version} is{" "}
              {loaded.status}. Published content is frozen, because something may
              already have been sent with it. Create a new version instead.
            </Text>
            <Group>
              {backToList}
              <Button
                variant="default"
                component={Link}
                to={`/create?templateKey=${encodeURIComponent(loaded.templateKey)}&action=${encodeURIComponent(loaded.action ?? "")}&actionType=${encodeURIComponent(loaded.actionType ?? "")}`}
              >
                New version
              </Button>
            </Group>
          </Stack>
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="sm" py="xl">
      <AppHeader />
      <Title order={2}>
        Edit draft — {loaded.templateKey} v{loaded.version}
      </Title>

      {mutation.isSuccess ? (
        <Alert color="green" title="Draft saved" mt="md">
          <Stack gap="sm">
            <Text size="sm">
              Still a draft, still not live. Publish it from the list when you are
              ready.
            </Text>
            <Group>{backToList}</Group>
          </Stack>
        </Alert>
      ) : null}

      <CreateForm
        mode="edit"
        values={values}
        fieldErrors={fieldErrors}
        generalErrors={generalErrors}
        networkErrorMessage={networkErrorMessage}
        authorEmail={authorEmail}
        isSubmitting={mutation.isPending}
        contract={contractQuery.data ?? null}
        isContractLoading={contractQuery.isFetching}
        contractReady={contractReady}
        unknownAction={unknownAction}
        canInsertStarter={canInsertStarter}
        onInsertStarter={handleInsertStarter}
        previewVariant={previewVariant}
        preview={previewMutation.data ?? null}
        previewErrorMessage={
          previewMutation.isError ? toUiError(previewMutation.error).message : null
        }
        previewErrorDetails={
          previewMutation.isError
            ? (toUiError(previewMutation.error).fieldDetails ?? [])
            : []
        }
        isRendering={previewMutation.isPending}
        canRender={canRender}
        onPreviewVariantChange={handlePreviewVariantChange}
        onRenderPreview={handleRenderPreview}
        onFieldChange={handleFieldChange}
        onAuthorEmailChange={handleAuthorEmailChange}
        onSubmit={handleSubmit}
      />
    </Container>
  );
}
