import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { PreviewVariant, RenderResult } from "../../../preview/protocol";
import { RenderedEmail } from "../RenderedEmail";

interface PreviewPanelProps {
  variant: PreviewVariant;
  result: RenderResult | null;
  /** The engine itself failed — Pyodide did not boot, an asset is missing. */
  engineErrorMessage: string | null;
  isRendering: boolean;
  canRender: boolean;
  onVariantChange: (variant: PreviewVariant) => void;
  onRender: () => void;
}

const FAILURE_TITLES: Record<string, string> = {
  SYNTAX: "This template does not parse",
  TEMPLATE_NOT_FOUND: "A referenced template is missing",
  RENDER: "It parsed, then failed while rendering",
  ENGINE: "The preview engine is unavailable",
};

// Presentational — owns no state and makes no calls.
export function PreviewPanel({
  variant,
  result,
  engineErrorMessage,
  isRendering,
  canRender,
  onVariantChange,
  onRender,
}: PreviewPanelProps) {
  const failure = result && !result.ok ? result : null;
  const success = result && result.ok ? result : null;

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="sm" fw={500}>
            Preview
          </Text>
          <Text size="xs" c="dimmed">
            Rendered in your browser by the same Jinja2 render core the sender
            uses, with sample data derived from this action's template. A field
            that will arrive empty is shown empty — this is what the recipient
            gets, not a guarantee that the data will be there.
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={variant}
            onChange={(value) => onVariantChange(value as PreviewVariant)}
            data={[
              { label: "Single", value: "single" },
              { label: "Multi", value: "multi" },
            ]}
          />
          <Button
            size="xs"
            variant="default"
            onClick={onRender}
            loading={isRendering}
            disabled={!canRender || isRendering}
          >
            Render preview
          </Button>
        </Group>
      </Group>

      {!canRender ? (
        <Text size="sm" c="dimmed">
          Fill in action, action type and the HTML body to render a preview.
        </Text>
      ) : null}

      {engineErrorMessage ? (
        <Alert color="red" title={FAILURE_TITLES.ENGINE}>
          <Stack gap={4}>
            <Text size="sm">{engineErrorMessage}</Text>
            <Text size="xs" c="dimmed">
              Nothing is wrong with your template — the browser could not start
              the renderer. Try reloading; if it persists, the staged runtime may
              be missing (npm run setup:pyodide).
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {failure ? (
        <Alert color="red" title={FAILURE_TITLES[failure.kind] ?? "Could not render"}>
          <Stack gap={4}>
            <Text size="sm" ff="monospace">
              {failure.line != null ? `line ${failure.line}: ` : ""}
              {failure.message}
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {/* A stale render core is the one way this preview can silently disagree
          with what gets sent, so it is an error, not a note. */}
      {success && success.unknownFilters.length > 0 ? (
        <Alert color="red" title="This template uses filters the renderer does not have">
          <Text size="sm" ff="monospace">
            {success.unknownFilters.join(", ")}
          </Text>
          <Text size="xs" mt={4}>
            The preview below rendered them as-is, but sending would fail. Either
            the filter name is a typo, or the vendored render core is out of date
            (npm run sync:render-core).
          </Text>
        </Alert>
      ) : null}

      {success?.actionProblem ? (
        <Alert color="yellow" title="Unrecognised action">
          <Text size="sm">{success.actionProblem.message}</Text>
          <Text size="xs" mt={4}>
            The body below still rendered, but the sample data comes only from
            what this draft references — there is no production template for this
            action to compare against.
          </Text>
        </Alert>
      ) : null}

      {success?.subjectProblem ? (
        <Alert color="yellow" title="The subject line does not render">
          <Text size="sm" ff="monospace">
            {success.subjectProblem.line != null
              ? `line ${success.subjectProblem.line}: `
              : ""}
            {success.subjectProblem.message}
          </Text>
        </Alert>
      ) : null}

      {success ? (
        <RenderedEmail subject={success.subject} html={success.html} />
      ) : null}
    </Stack>
  );
}
