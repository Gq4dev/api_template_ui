import { useRef, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Grid,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import type {
  CatalogueResult,
  PreviewVariant,
  RenderResult,
} from "../../../preview/protocol";
import { deriveTemplateKey } from "../../../lib/collector";
import { AvailableVariables } from "./AvailableVariables";
import { FormatToolbar } from "./FormatToolbar";
import { InsertBlocks } from "./InsertBlocks";
import { PreviewPanel } from "./PreviewPanel";
import { insertSnippet, wrapSelection } from "./blockSnippets";
import type { CreateFormFieldErrors, CreateFormValues } from "./createForm.logic";

interface CreateFormProps {
  /**
   * "create" authors a brand-new draft; "edit" rewrites an existing one in place.
   * The difference is not cosmetic: in edit mode the version already exists, so
   * what it is FOR (action, actionType, templateKey) is settled and locked — only
   * what it SAYS can still change.
   */
  mode?: "create" | "edit";
  values: CreateFormValues;
  fieldErrors: CreateFormFieldErrors;
  generalErrors: string[];
  networkErrorMessage: string | null;
  authorEmail: string;
  isSubmitting: boolean;
  // --- variable catalogue ---
  catalogue: CatalogueResult | null;
  isCatalogueLoading: boolean;
  catalogueReady: boolean;
  // --- preview ---
  canInsertStarter: boolean;
  onInsertStarter: () => void;
  previewVariant: PreviewVariant;
  preview: RenderResult | null;
  previewEngineErrorMessage: string | null;
  isRendering: boolean;
  canRender: boolean;
  onPreviewVariantChange: (variant: PreviewVariant) => void;
  onRenderPreview: () => void;
  /** Live preview: re-renders on its own a moment after you stop typing. */
  live: boolean;
  onLiveChange: (live: boolean) => void;
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
  mode = "create",
  values,
  fieldErrors,
  generalErrors,
  networkErrorMessage,
  authorEmail,
  isSubmitting,
  catalogue,
  isCatalogueLoading,
  catalogueReady,
  canInsertStarter,
  onInsertStarter,
  previewVariant,
  preview,
  previewEngineErrorMessage,
  isRendering,
  canRender,
  onPreviewVariantChange,
  onRenderPreview,
  live,
  onLiveChange,
  onFieldChange,
  onAuthorEmailChange,
  onSubmit,
}: CreateFormProps) {
  const isEdit = mode === "edit";
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  /*
    A collector turns the template key from something you may type into
    something you may only READ.

    With no collector the key stays exactly as it always was: free text,
    optional, derived server-side when left blank. There is no reason to take
    that away from anyone who has been using it.

    With a collector it is a different field. The server derives the key from
    action + actionType + collector and rejects any templateKey that does not
    match what it derived — so a typed value here has one possible outcome that
    a derived one does not, and that outcome is a 400. Making it read-only and
    computing it live turns the field into what it actually is at that point:
    confirmation of what is about to be created, updated as you type, rather
    than a decision anyone still gets to make.
  */
  const hasCollector = values.collector.trim() !== "";
  const derivedTemplateKey = deriveTemplateKey(
    values.action,
    values.actionType,
    values.collector,
  );

  /**
   * Splices a snippet in at the caret and puts the caret back after it.
   *
   * The restore is the whole reason this lives here rather than in the page.
   * The textarea is controlled, so React repaints it from `values.html` on the
   * next render and the browser drops the selection to the end — insert three
   * blocks in a row and the third lands nowhere near the second. Setting it
   * after paint keeps the author where they were working.
   */
  function handleInsertBlock(snippet: string) {
    const el = htmlRef.current;
    const at = el ? el.selectionStart : values.html.length;
    const to = el ? el.selectionEnd : at;

    const { text, caret } = insertSnippet(values.html, snippet, at, to);
    onFieldChange("html", text);

    restoreSelection(caret, caret);
  }

  /**
   * Wraps the selection in `open`/`close`. With nothing selected it drops the
   * pair around a placeholder and SELECTS it, so the next keystroke replaces it
   * instead of landing after a word the author never asked for.
   */
  function handleWrap(open: string, close: string, placeholder?: string) {
    const el = htmlRef.current;
    const at = el ? el.selectionStart : values.html.length;
    const to = el ? el.selectionEnd : at;

    const next = wrapSelection(values.html, open, close, at, to, placeholder);
    onFieldChange("html", next.text);
    restoreSelection(next.selectionStart, next.selectionEnd);
  }

  function restoreSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      const target = htmlRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(start, end);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {/*
        Two columns: what you write on the left, what the recipient gets on the
        right, both on screen at once. The preview used to sit below the fold,
        so checking a change meant scrolling away from the thing you changed —
        and the errors this catches are visual ones, invisible in the source.
        A <div> nested in a <p> renders as valid Jinja and silently drops the
        paragraph's styling; you only ever see that in the rendered mail.

        The right column sticks so it stays in view while the left one scrolls.
        The Grid must NOT align to flex-start for that: a column sized to its own
        content gives the sticky element no room to travel, and it scrolls away
        with everything else.
        Below `lg` they stack, because a 400px-wide preview of an email is not
        a preview of anything.
      */}
      <Grid gap="lg" mt="md">
        <Grid.Col span={{ base: 12, lg: 7 }}>
      <Stack gap="md">
        {isEdit ? (
          <Alert color="yellow" title="Estás editando un borrador">
            Guardar sobrescribe este borrador en el lugar: mismo número de
            versión, no se crea una versión nueva. Nada llega a los clientes
            hasta que lo publiques.
          </Alert>
        ) : (
          <Alert color="blue" title="Cada guardado aquí crea una versión nueva">
            Enviar este formulario crea una versión completamente nueva como
            borrador. Para cambiar un borrador que ya guardaste, edítalo desde el
            listado de plantillas: así conserva el mismo número de versión.
          </Alert>
        )}

        {networkErrorMessage ? (
          <Alert color="orange" title="Error de red">
            {networkErrorMessage}
          </Alert>
        ) : null}

        {generalErrors.length > 0 ? (
          <Alert
            color="red"
            title={
              isEdit
                ? "No se pudo guardar el borrador"
                : "No se pudo crear la plantilla"
            }
          >
            <Stack gap={4}>
              {generalErrors.map((detail) => (
                <Text key={detail} size="sm">
                  {detail}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {/* Locked in edit mode: these identify the version, and the API takes no
            such fields on an update. Rendering them editable would let someone
            change what looks like the target and then watch the save ignore it. */}
        <TextInput
          label="Action"
          placeholder="ORDER"
          required
          disabled={isEdit}
          value={values.action}
          onChange={(event) => onFieldChange("action", event.currentTarget.value)}
          error={fieldErrors.action}
        />

        <TextInput
          label="Action type"
          placeholder="CREATED"
          required
          disabled={isEdit}
          value={values.actionType}
          onChange={(event) =>
            onFieldChange("actionType", event.currentTarget.value)
          }
          error={fieldErrors.actionType}
        />

        {/* Locked in edit mode with the rest of the identity: the version
            already exists, and which clients it overrides is settled. */}
        <TextInput
          label="Collector"
          description="Opcional: una versión propia para un cliente. Déjalo en blanco para la plantilla genérica, que es la que recibe todo cliente que no tenga una versión propia."
          placeholder="bbva"
          disabled={isEdit}
          value={values.collector}
          onChange={(event) =>
            onFieldChange("collector", event.currentTarget.value)
          }
          error={fieldErrors.collector}
        />

        <TextInput
          label="Template key"
          description={
            isEdit
              ? "Fijo para esta versión."
              : hasCollector
                ? "Se deriva de Action + Action type + Collector. Es de solo lectura mientras haya un Collector: el servidor deriva esta key y rechaza cualquier otra."
                : "Opcional: si lo dejas en blanco, se deriva de Action + Action type."
          }
          disabled={isEdit}
          // readOnly rather than disabled: a disabled input is dropped from the
          // accessibility tree and greys out to the point of looking absent,
          // and this value is the one thing on screen confirming what is about
          // to be created. It has to stay readable and selectable.
          readOnly={!isEdit && hasCollector}
          variant={!isEdit && hasCollector ? "filled" : "default"}
          value={hasCollector ? derivedTemplateKey : values.templateKey}
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
                ? "Rellena el campo con un esqueleto que funciona, usando las variables propias de esta Action"
                : catalogueReady
                  ? "Vacía primero el cuerpo: esto sobrescribiría lo que escribiste"
                  : "Completa primero Action y Action type"
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
                Insertar ejemplo
              </Button>
            </span>
          </Tooltip>
        </Group>

        <InsertBlocks
          variables={catalogue?.variables ?? []}
          onInsert={handleInsertBlock}
        />

        <FormatToolbar onWrap={handleWrap} onInsert={handleInsertBlock} />

        <Textarea
          ref={htmlRef}
          label="HTML body"
          description={
            'Jinja2. Extiende el layout base y rellena sus bloques: {% extends "base.html.j2" %}. Incluye partials/header.html.j2 y partials/footer.html.j2 para el branding de la plataforma: base deja esos bloques vacíos, así que una plantilla sin ellos se renderiza como texto pelado. Los estilos van inline: los clientes de mail descartan <style>.'
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
          catalogue={catalogue}
          isLoading={isCatalogueLoading}
          ready={catalogueReady}
        />

        <TextInput
          label="Subject"
          description="Opcional: puede contener Jinja, por ejemplo {{ commerce.name }}. Vuelve renderizado en la vista previa."
          value={values.subject}
          onChange={(event) => onFieldChange("subject", event.currentTarget.value)}
          error={fieldErrors.subject}
        />

        <TextInput
          label="Author email"
          description="Se envía como X-User-Email para auditoría. Si lo dejas en blanco, se usa “system”."
          placeholder="admin@example.com"
          value={authorEmail}
          onChange={(event) => onAuthorEmailChange(event.currentTarget.value)}
        />

        <Alert color="blue" variant="light" title="Esto guarda un borrador">
          Todavía no se envía nada a los clientes. La versión queda guardada como
          un borrador que puedes seguir editando, y el servicio de notificaciones
          no la ve hasta que la publiques desde el listado de plantillas.
        </Alert>

        <Group justify="flex-end" mt="sm">
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
            {isEdit ? "Guardar cambios" : "Guardar borrador"}
          </Button>
        </Group>
      </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Box style={{ position: "sticky", top: 16 }}>
            <PreviewPanel
              variant={previewVariant}
              result={preview}
              engineErrorMessage={previewEngineErrorMessage}
              isRendering={isRendering}
              canRender={canRender}
              onVariantChange={onPreviewVariantChange}
              onRender={onRenderPreview}
              live={live}
              onLiveChange={onLiveChange}
            />
          </Box>
        </Grid.Col>
      </Grid>
    </form>
  );
}
