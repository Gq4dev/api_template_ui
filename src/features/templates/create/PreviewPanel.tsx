import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { PreviewResponse, PreviewVariant } from "../../../api/types";
import { RenderedEmail } from "../RenderedEmail";

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
        <RenderedEmail subject={preview.subject} html={preview.html} />
      ) : null}
    </Stack>
  );
}
