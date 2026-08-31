import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Stack, Text, Title } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useCreateTemplate } from "../../../queries/useCreateTemplate";
import { useVariableCatalogue } from "../../../queries/useVariableCatalogue";
import { useJinjaPreview } from "../../../queries/useJinjaPreview";
import { IdempotencyKeyManager } from "../../../lib/idempotency";
import { toUiError } from "../../../lib/errors";
import type { PreviewVariant } from "../../../preview/protocol";
import { AppHeader } from "../../../app/AppHeader";
import { CreateForm } from "./CreateForm";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  buildStarterTemplate,
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

// Builds the initial form values, prefilling action/actionType/templateKey from
// the URL query when present. This powers the "New version" flow from the list:
// those three fields land filled while html/subject stay blank (append-only — a
// new version is authored from scratch, not copied).
function initialFormValues(searchParams: URLSearchParams): CreateFormValues {
  return {
    ...EMPTY_CREATE_FORM_VALUES,
    action: searchParams.get("action") ?? "",
    actionType: searchParams.get("actionType") ?? "",
    templateKey: searchParams.get("templateKey") ?? "",
  };
}

// Container — owns form state, the idempotency key, the mutation, and error
// mapping. Delegates all rendering to the presentational CreateForm.
export function CreatePage() {
  // Read the query params once on mount; later navigations don't re-seed state.
  const [searchParams] = useSearchParams();
  const [values, setValues] = useState<CreateFormValues>(() =>
    initialFormValues(searchParams),
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

  // --- Authoring aids -----------------------------------------------------
  const [previewVariant, setPreviewVariant] = useState<PreviewVariant>("single");
  const previewMutation = useJinjaPreview();
  // On by default: the whole point is not having to ask.
  const [live, setLive] = useState(true);

  const action = values.action.trim();
  const actionType = values.actionType.trim();
  const catalogueReady = action !== "" && actionType !== "";
  const catalogueQuery = useVariableCatalogue(action, actionType, previewVariant);

  const canRender = catalogueReady && values.html.trim() !== "";

  // Only offered on an empty body, and only for an action that HAS a production
  // template: the example is a starting point built from that action's own
  // variables, and silently replacing something an author already typed is
  // never worth it.
  const canInsertStarter =
    catalogueQuery.data?.known === true && values.html.trim() === "";

  function handleInsertStarter() {
    if (!canInsertStarter || !catalogueQuery.data) return;
    handleFieldChange("html", buildStarterTemplate(catalogueQuery.data.variables));
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

  /**
   * Live preview: re-render a beat after typing stops.
   *
   * Debounced rather than per-keystroke because every render is a full Jinja2
   * pass — cheap once Pyodide is warm, but not free, and a render mid-word
   * shows a template that is momentarily broken. 500 ms is long enough to be
   * past the end of a word and short enough to still feel like a consequence
   * of what you typed.
   *
   * The dependency list is deliberately the DEBOUNCED values, not the live
   * ones: depending on both re-runs the effect on every keystroke and defeats
   * the debounce entirely.
   */
  const [debouncedHtml] = useDebouncedValue(values.html, 500);
  const [debouncedSubject] = useDebouncedValue(values.subject, 500);

  useEffect(() => {
    if (!live || !catalogueReady || debouncedHtml.trim() === "") return;
    previewMutation.mutate({
      action,
      actionType,
      html: debouncedHtml,
      subject: debouncedSubject.trim() || undefined,
      variant: previewVariant,
    });
    // previewMutation is a stable-enough mutation object; including it would
    // re-fire on every state transition of the render it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, catalogueReady, debouncedHtml, debouncedSubject, action, actionType, previewVariant]);

  function handlePreviewVariantChange(next: PreviewVariant) {
    setPreviewVariant(next);
    // The rendered mail belongs to the variant it was rendered for. Keeping it
    // on screen under a new label would show the author the wrong email.
    previewMutation.reset();
  }

  // A rejected mutation means the ENGINE failed, not the template: a template
  // problem comes back as a resolved `ok: false` result, which the panel renders
  // with its line number. Conflating the two would tell an author their HTML is
  // broken when the real problem is that Pyodide never booted.
  const previewEngineErrorMessage = previewMutation.isError
    ? previewMutation.error.message
    : null;

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

          // INTEGRATION.md §8 scopes idempotency-key reuse to network-failure
          // retries: a NETWORK/CORS failure means the request may never have
          // reached the server, so resubmitting is a retry of the SAME attempt
          // and must keep the key. Any typed API error (VALIDATION_ERROR,
          // OBJECT_ALREADY_EXISTS, INVALID_STATE_TRANSITION, …) means the server
          // rejected this attempt; a corrected resubmit is a NEW logical create
          // and must mint a fresh key, so reset here.
          if (uiError.kind !== "NETWORK") {
            idempotencyManager.current.reset();
          }

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
        <AppHeader />
        <Title order={2}>Create template</Title>
        {/* Blue, not green. A green "success" here would read as "done", and the
            author's job is not done: nothing reaches a customer until they publish. */}
        <Alert color="blue" title="Draft saved — not live yet" mt="md">
          <Stack gap="xs">
            <Text>
              <strong>{templateKey}</strong> v{version} — status: {status}
            </Text>
            <Text size="sm">
              The notification service cannot see this version yet. Publish it from the
              templates list when you are happy with how it renders.
            </Text>
            <Text size="sm" c="dimmed">
              checksum: {checksum}
            </Text>
            <Group mt="sm">
              <Button component={Link} to={`/?templateKey=${encodeURIComponent(templateKey)}`}>
                Review and publish
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
      <AppHeader />
      <Title order={2}>Create template</Title>
      <CreateForm
        values={values}
        fieldErrors={fieldErrors}
        generalErrors={generalErrors}
        networkErrorMessage={networkErrorMessage}
        authorEmail={authorEmail}
        isSubmitting={mutation.isPending}
        catalogue={catalogueQuery.data ?? null}
        isCatalogueLoading={catalogueQuery.isFetching}
        catalogueReady={catalogueReady}
        canInsertStarter={canInsertStarter}
        onInsertStarter={handleInsertStarter}
        previewVariant={previewVariant}
        preview={previewMutation.data ?? null}
        previewEngineErrorMessage={previewEngineErrorMessage}
        isRendering={previewMutation.isPending}
        canRender={canRender}
        onPreviewVariantChange={handlePreviewVariantChange}
        onRenderPreview={handleRenderPreview}
        live={live}
        onLiveChange={setLive}
        onFieldChange={handleFieldChange}
        onAuthorEmailChange={handleAuthorEmailChange}
        onSubmit={handleSubmit}
      />
    </Container>
  );
}
