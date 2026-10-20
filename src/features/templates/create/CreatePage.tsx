import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Group, Skeleton, Stack, Text } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useCreateTemplate } from "../../../queries/useCreateTemplate";
import { useVariableCatalogue } from "../../../queries/useVariableCatalogue";
import { useJinjaPreview } from "../../../queries/useJinjaPreview";
import { useVersionContent } from "../../../queries/useVersionContent";
import {
  CATALOGUE_PAGE_SIZE,
  MAX_CATALOGUE_PAGES,
  useFullCatalogue,
} from "../../../queries/fullCatalogue";
import { IdempotencyKeyManager } from "../../../lib/idempotency";
import { toUiError } from "../../../lib/errors";
import { collectorLabel } from "../../../lib/collector";
import type { PreviewVariant } from "../../../preview/protocol";
import { PageHeader } from "../../../app/PageHeader";
import { CreateForm } from "./CreateForm";
import { SourceVersionNotice } from "./SourceVersionNotice";
import {
  EMPTY_CREATE_FORM_VALUES,
  buildCreatePayload,
  buildStarterTemplate,
  detachSourceTemplateKey,
  identityMatchesSource,
  initialFormValues,
  isPublishedStatus,
  mapValidationDetails,
  pairSpellings,
  seedFromVersion,
  sourceAddressFromParams,
  spellingFor,
  spellingHints,
  validateCreateForm,
  type CreateFormFieldErrors,
  type CreateFormValues,
  type SourceAddress,
} from "./createForm.logic";

const AUTHOR_EMAIL_STORAGE_KEY = "api_template_ui.authorEmail";

const IDENTITY_FIELDS = new Set<keyof CreateFormValues>([
  "action",
  "actionType",
  "collector",
]);

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
  // Read the query params once on mount; later navigations don't re-seed state.
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [values, setValues] = useState<CreateFormValues>(() =>
    initialFormValues(searchParams),
  );
  const [fieldErrors, setFieldErrors] = useState<CreateFormFieldErrors>({});
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [networkErrorMessage, setNetworkErrorMessage] = useState<
    string | null
  >(null);
  const [authorEmail, setAuthorEmail] = useState<string>(readStoredAuthorEmail);

  // --- Create from an existing version ------------------------------------
  // State rather than a constant so "Crear otra" can drop it: the next,
  // unrelated create must not keep claiming it is based on this version.
  const [source, setSource] = useState<SourceAddress | null>(() =>
    sourceAddressFromParams(searchParams),
  );
  const sourceQuery = useVersionContent(
    source?.templateKey ?? "",
    source?.version ?? 0,
  );
  const sourceContent = source ? sourceQuery.data : undefined;
  // What was copied, kept to compare the live identity against.
  const [seed, setSeed] = useState<CreateFormValues | null>(null);

  // Seeds the form ONCE per source address — same guard as EditDraftPage. The
  // templates key space is invalidated by mutations, which refetches the source
  // and hands back a new object; without the ref that refetch would overwrite
  // everything the author has changed since the copy.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!sourceContent) return;
    const address = `${sourceContent.templateKey}:${sourceContent.version}`;
    if (seededFor.current === address) return;
    seededFor.current = address;

    // Only published content is a starting point. The link is only offered on
    // ACTIVE/SCHEDULED rows, but a URL can be pasted: a draft is edited in
    // place and an archived version is retired, so copying either would start
    // the author from the wrong place. The notice explains; the form keeps the
    // identity from the URL and nothing else.
    if (!isPublishedStatus(sourceContent.status)) return;

    const seeded = seedFromVersion(sourceContent);
    setSeed(seeded);
    setValues(seeded);
  }, [sourceContent]);

  const isSourceLoading = source !== null && sourceQuery.isLoading;
  const unusableSourceStatus =
    sourceContent && !isPublishedStatus(sourceContent.status)
      ? sourceContent.status
      : null;
  const sourceErrorMessage =
    source !== null && sourceQuery.isError
      ? toUiError(sourceQuery.error).message
      : null;

  // One manager per "logical" create attempt: current() mints a key on first
  // use and returns the same key across retries; reset() is called only on
  // success (see IdempotencyKeyManager docs).
  const idempotencyManager = useRef(new IdempotencyKeyManager());
  const mutation = useCreateTemplate();

  // --- Spelling sent --------------------------------------------------------
  // The stored catalogue decides how action/actionType are SPELLED on the wire,
  // so a save neither 400s on an existing key nor adds a new spelling of a
  // template; see `spellingFor`. Same query as the browse page, so both share
  // one cache entry. The "create from version" flow needs nothing extra: its
  // seeded source spelling is the existing key's, which rule 1 returns as-is.
  //
  // The rule is never skipped SILENTLY. While the catalogue is on its first
  // load the submit is blocked (a click that beat the fetch would send the typed
  // spelling and could 400 or add drift). If it cannot be read, the author is
  // told the typed spelling will go out unchecked and may still save — the
  // backend's identity guard remains the last line of defence. A truncated
  // catalogue is used, and flagged.
  const storedCatalogueQuery = useFullCatalogue();
  const catalogueRows = storedCatalogueQuery.data?.content ?? null;
  const catalogueLoading = !storedCatalogueQuery.data && !storedCatalogueQuery.isError;
  const catalogueFailed = !storedCatalogueQuery.data && storedCatalogueQuery.isError;
  const catalogueTruncated = storedCatalogueQuery.data?.truncated ?? false;
  const sentSpelling = spellingFor(values, catalogueRows);
  const spellingNotes = spellingHints(
    values,
    sentSpelling,
    pairSpellings(values, catalogueRows),
  );

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
    setValues((prev) => {
      const next = { ...prev, [field]: value };
      // Only identity edits can make a copied templateKey wrong.
      return IDENTITY_FIELDS.has(field) ? detachSourceTemplateKey(next, seed) : next;
    });
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
    // The button is disabled meanwhile; this also covers Enter in a field.
    if (catalogueLoading) return;

    mutation.mutate(
      {
        // Validated as typed, sent as spelled: see `spellingFor`.
        payload: buildCreatePayload({
          ...values,
          action: sentSpelling.action,
          actionType: sentSpelling.actionType,
        }),
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
    setSource(null);
    setSeed(null);
    // Drop the source (and its identity) from the URL too. State is read from
    // the query only on mount, so this does not re-seed now — but left in
    // place, a reload would bring the old version back into the blank form.
    navigate("/create", { replace: true });
  }

  const header = (
    <PageHeader
      title="Crear plantilla"
      description="Escribe una plantilla nueva o una nueva versión. Todo se guarda como borrador hasta que lo publiques."
    />
  );

  if (mutation.isSuccess && mutation.data) {
    const { templateKey, version, status, checksum } = mutation.data;

    return (
      <>
        {header}
        {/* Blue, not green. A green "success" here would read as "done", and the
            author's job is not done: nothing reaches a customer until they publish. */}
        <Alert color="blue" title="Borrador guardado — todavía no está en vivo" maw={720}>
          <Stack gap="xs">
            {/* The collector rides next to the key, and says "Generic" when
                there is none. Two drafts whose keys differ only by a
                `__collector` suffix are one glance apart, and the difference
                between them is who receives the mail — worth stating in words
                rather than leaving to be spotted in a string. The value comes
                from the form rather than the response because create/commit
                answer with the key, not the dimension that produced it. */}
            <Text>
              <strong>{templateKey}</strong> v{version} — status: {status} —
              collector: {collectorLabel(values.collector)}
            </Text>
            <Text size="sm">
              El servicio de notificaciones todavía no ve esta versión. Publícala
              desde el listado de plantillas cuando estés conforme con cómo
              renderiza.
            </Text>
            <Text size="sm" c="dimmed">
              checksum: {checksum}
            </Text>
            <Group mt="sm">
              <Button component={Link} to={`/?templateKey=${encodeURIComponent(templateKey)}`}>
                Revisar y publicar
              </Button>
              <Button variant="default" onClick={handleCreateAnother}>
                Crear otra
              </Button>
            </Group>
          </Stack>
        </Alert>
      </>
    );
  }

  return (
    <>
      {header}
      {catalogueFailed ? (
        <Alert color="yellow" title="No se pudo leer el catálogo" mb="md">
          No se pudo leer el catálogo: se enviará Action/Action type tal como los
          escribiste, sin comprobar cómo están guardados.
        </Alert>
      ) : null}
      {catalogueTruncated && storedCatalogueQuery.data ? (
        <Alert color="yellow" title="No se leyó el catálogo completo" mb="md">
          Se leyeron {storedCatalogueQuery.data.content.length} de{" "}
          {storedCatalogueQuery.data.totalElements} versiones (se leen como máximo{" "}
          {MAX_CATALOGUE_PAGES * CATALOGUE_PAGE_SIZE}). La forma de escritura que
          se envía se eligió con un catálogo incompleto y puede no coincidir con
          la guardada.
        </Alert>
      ) : null}
      {source ? (
        <SourceVersionNotice
          source={source}
          isLoading={isSourceLoading}
          errorMessage={sourceErrorMessage}
          unusableStatus={unusableSourceStatus}
          identityMatches={seed ? identityMatchesSource(values, seed) : null}
        />
      ) : null}
      {/* Skeleton instead of an editable form while the copy is on its way:
          anything typed now would be overwritten by the seed a moment later. */}
      {isSourceLoading ? (
        <Stack gap="md" mt="md" aria-busy="true">
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={220} />
        </Stack>
      ) : (
        <CreateForm
          submitBlockedReason={catalogueLoading ? "Comprobando el catálogo…" : null}
          actionHint={spellingNotes.action}
          actionTypeHint={spellingNotes.actionType}
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
      )}
    </>
  );
}
