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
          <Alert color="yellow" title="Editing a draft">
            Saving overwrites this draft in place — same version number, no new
            version created. Nothing reaches customers until you publish it.
          </Alert>
        ) : (
          <Alert color="blue" title="Each save here creates a new version">
            Submitting this form creates a brand-new version as a draft. To change
            a draft you already saved, edit it from the templates list instead —
            that keeps the same version number.
          </Alert>
        )}

        {networkErrorMessage ? (
          <Alert color="orange" title="Network error">
            {networkErrorMessage}
          </Alert>
        ) : null}

        {generalErrors.length > 0 ? (
          <Alert
            color="red"
            title={isEdit ? "Could not save the draft" : "Could not create template"}
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

        <TextInput
          label="Template key"
          description={
            isEdit
              ? "Fixed for this version."
              : "Optional — derived from action + actionType when left blank."
          }
          disabled={isEdit}
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
                : catalogueReady
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

        <InsertBlocks
          variables={catalogue?.variables ?? []}
          onInsert={handleInsertBlock}
        />

        <FormatToolbar onWrap={handleWrap} onInsert={handleInsertBlock} />

        <Textarea
          ref={htmlRef}
          label="HTML body"
          description={
            'Jinja2. Extend the base layout and fill its blocks: {% extends "base.html.j2" %}. Include partials/header.html.j2 and partials/footer.html.j2 for the platform branding — base leaves those blocks empty, so a template without them renders as bare text. Style inline: mail clients discard <style>.'
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
          description="Optional — may contain Jinja, e.g. {{ commerce.name }}. Comes back rendered in the preview."
          value={values.subject}
          onChange={(event) => onFieldChange("subject", event.currentTarget.value)}
          error={fieldErrors.subject}
        />

        <TextInput
          label="Author email"
          description="Sent as X-User-Email for auditing. Defaults to “system” when left blank."
          placeholder="admin@example.com"
          value={authorEmail}
          onChange={(event) => onAuthorEmailChange(event.currentTarget.value)}
        />

        <Alert color="blue" variant="light" title="This saves a draft">
          Nothing is sent to customers yet. The version is stored as a draft you can keep
          editing, and it stays invisible to the notification service until you publish it
          from the templates list.
        </Alert>

        <Group justify="flex-end" mt="sm">
          <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
            {isEdit ? "Save changes" : "Save draft"}
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
