import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { PreviewResponse, PreviewVariant } from "../../../api/types";

interface PreviewPanelProps {
  variant: PreviewVariant;
  preview: PreviewResponse | null;
  errorMessage: string | null;
  errorDetails: string[];
  isRendering: boolean;
  canRender: boolean;
  onVariantChange: (variant: PreviewVariant) => void;
  onRender: () => void;
}

// Presentational — owns no state and makes no calls.
export function PreviewPanel({
  variant,
  preview,
  errorMessage,
  errorDetails,
  isRendering,
  canRender,
  onVariantChange,
  onRender,
}: PreviewPanelProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="sm" fw={500}>
            Preview
          </Text>
          <Text size="xs" c="dimmed">
            Rendered with the same engine and sample data that sending uses. A
            field that will arrive empty is shown empty — this is what the
            recipient gets, not a validity check.
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

      {errorMessage ? (
        <Alert color="red" title="Could not render">
          <Stack gap={4}>
            <Text size="sm">{errorMessage}</Text>
            {errorDetails.map((detail) => (
              <Text key={detail} size="sm" ff="monospace">
                {detail}
              </Text>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {preview ? (
        <Stack gap="xs">
          <Group gap="xs" align="center">
            <Badge variant="light">Subject</Badge>
            <Text size="sm">{preview.subject ?? "(no subject)"}</Text>
          </Group>
          <Paper withBorder radius="sm" p={0} style={{ overflow: "hidden" }}>
            {/*
              srcDoc + a fully restrictive sandbox. The HTML here was typed by
              someone else and is being rendered on our own origin, so it runs
              with NO script execution, NO same-origin access, NO form
              submission, NO top-level navigation. Mail clients do not run
              scripts either, so nothing legitimate is lost — and an author who
              pastes a <script> tag learns that here rather than in production.
            */}
            <iframe
              title="Rendered email preview"
              srcDoc={preview.html}
              sandbox=""
              style={{ width: "100%", height: 480, border: 0, background: "#fff" }}
            />
          </Paper>
        </Stack>
      ) : null}
    </Stack>
  );
}
