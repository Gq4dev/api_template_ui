import { useEffect } from "react";
import {
  Alert,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { useRowPreview } from "../../../queries/useRowPreview";
import { toUiError } from "../../../lib/errors";
import { ApiError } from "../../../api/templatesClient";
import { RenderedEmail } from "../RenderedEmail";
import type { PreviewVariant, TemplateSummary } from "../../../api/types";

interface PreviewModalProps {
  row: TemplateSummary | null;
  variant: PreviewVariant;
  onVariantChange: (variant: PreviewVariant) => void;
  onClose: () => void;
}

// Container for one row's preview. Renders on open and on variant change; the
// mutation is reset on close so reopening another row never flashes the
// previous row's mail.
export function PreviewModal({
  row,
  variant,
  onVariantChange,
  onClose,
}: PreviewModalProps) {
  const preview = useRowPreview();
  const { mutate, reset } = preview;

  useEffect(() => {
    if (!row) {
      reset();
      return;
    }
    mutate({ row, variant });
  }, [row, variant, mutate, reset]);

  // Our own guard errors are not ApiErrors, and their message is the whole
  // point — toUiError would flatten them into a generic network message.
  const message = preview.error
    ? preview.error instanceof ApiError
      ? toUiError(preview.error).message
      : preview.error.message
    : null;
  const details = preview.error instanceof ApiError
    ? (toUiError(preview.error).fieldDetails ?? [])
    : [];

  return (
    <Modal
      opened={row !== null}
      onClose={onClose}
      size="xl"
      centered
      title={
        row ? (
          <Group gap="xs">
            <Text fw={600}>
              {row.templateKey} v{row.version}
            </Text>
            <Text size="sm" c="dimmed">
              {row.action} / {row.actionType}
            </Text>
          </Group>
        ) : null
      }
    >
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed" maw="60%">
            Rendered with the same engine and sample data that sending uses. An
            optional field that arrives empty is shown empty.
          </Text>
          <SegmentedControl
            size="xs"
            value={variant}
            onChange={(value) => onVariantChange(value as PreviewVariant)}
            data={[
              { label: "Single", value: "single" },
              { label: "Multi", value: "multi" },
            ]}
          />
        </Group>

        {preview.isPending ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Rendering…
            </Text>
          </Group>
        ) : null}

        {message ? (
          <Alert color="red" title="Could not render this version">
            <Stack gap={4}>
              <Text size="sm">{message}</Text>
              {details.map((detail) => (
                <Text key={detail} size="sm" ff="monospace">
                  {detail}
                </Text>
              ))}
            </Stack>
          </Alert>
        ) : null}

        {preview.data ? (
          <RenderedEmail
            subject={preview.data.subject}
            html={preview.data.html}
            height={560}
          />
        ) : null}
      </Stack>
    </Modal>
  );
}
