import { useRef, type FormEvent } from "react";
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
import type {
  CatalogueResult,
  PreviewVariant,
  RenderResult,
} from "../../../preview/protocol";
import { AvailableVariables } from "./AvailableVariables";
import { InsertBlocks } from "./InsertBlocks";
import { PreviewPanel } from "./PreviewPanel";
import { insertSnippet } from "./blockSnippets";
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

    requestAnimationFrame(() => {
      const target = htmlRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(caret, caret);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap="md" mt="md">
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

        <PreviewPanel
          variant={previewVariant}
          result={preview}
          engineErrorMessage={previewEngineErrorMessage}
          isRendering={isRendering}
          canRender={canRender}
          onVariantChange={onPreviewVariantChange}
          onRender={onRenderPreview}
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
    </form>
  );
}
