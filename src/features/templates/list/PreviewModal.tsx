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
import type { TemplateSummary } from "../../../api/types";
import type { PreviewVariant } from "../../../preview/protocol";

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

  // Three ways this can fail, and they read differently to whoever is looking:
  // the version could not be fetched (ApiError), the engine could not start, or
  // the stored template itself does not render. Only the last one is a problem
  // with the template — which for a STORED version means it should never have
  // been published.
  const rejected = preview.error
    ? preview.error instanceof ApiError
      ? toUiError(preview.error).message
      : preview.error.message
    : null;
  const details = preview.error instanceof ApiError
    ? (toUiError(preview.error).fieldDetails ?? [])
    : [];

  const failure = preview.data && !preview.data.ok ? preview.data : null;
  const rendered = preview.data?.ok ? preview.data : null;
  const message = rejected ?? (failure ? failure.message : null);

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
              <Text size="sm" ff={failure ? "monospace" : undefined}>
                {failure?.line != null ? `line ${failure.line}: ` : ""}
                {message}
              </Text>
              {details.map((detail) => (
                <Text key={detail} size="sm" ff="monospace">
                  {detail}
                </Text>
              ))}
              {failure ? (
                <Text size="xs" c="dimmed">
                  This is a stored version, so it was saved in this state. If it
                  is published, it is failing to send.
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}

        {rendered ? (
          <RenderedEmail
            subject={rendered.subject}
            html={rendered.html}
            height={560}
          />
        ) : null}
      </Stack>
    </Modal>
  );
}
