import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import dayjs from "dayjs";
import type {
  PreviewVariant,
  TemplateStatus,
  TemplateSummary,
} from "../../../api/types";
import { PreviewModal } from "./PreviewModal";
import { rowId } from "./listFilters.logic";

interface TemplatesTableProps {
  rows: TemplateSummary[];
  isLoading: boolean;
  // Composite `${templateKey}:${version}` of the row currently being archived,
  // or null when no archive is in flight.
  archivingId: string | null;
  onArchive: (row: TemplateSummary) => void;
}

const STATUS_COLOR: Record<TemplateStatus, string> = {
  ACTIVE: "green",
  SCHEDULED: "blue",
  ARCHIVED: "gray",
};

function formatDate(value: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";
}

function newVersionHref(row: TemplateSummary): string {
  const search = new URLSearchParams({
    templateKey: row.templateKey,
    action: row.action,
    actionType: row.actionType,
  });
  return `/create?${search.toString()}`;
}

// Presentational — owns no data fetching. The confirm-archive modal is local
// view state; the actual archive call is delegated to the onArchive handler.
export function TemplatesTable({
  rows,
  isLoading,
  archivingId,
  onArchive,
}: TemplatesTableProps) {
  const [pendingArchive, setPendingArchive] = useState<TemplateSummary | null>(
    null,
  );
  const [previewRow, setPreviewRow] = useState<TemplateSummary | null>(null);
  const [previewVariant, setPreviewVariant] = useState<PreviewVariant>("single");

  function confirmArchive() {
    if (pendingArchive) onArchive(pendingArchive);
    setPendingArchive(null);
  }

  if (isLoading && rows.length === 0) {
    return (
      <Text c="dimmed" mt="md">
        Loading templates…
      </Text>
    );
  }

  if (rows.length === 0) {
    return (
      <Text c="dimmed" mt="md">
        No templates match these filters.
      </Text>
    );
  }

  return (
    <>
      <Table.ScrollContainer minWidth={900} mt="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Template key</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Action / type</Table.Th>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Effective from</Table.Th>
              <Table.Th>Effective to</Table.Th>
              <Table.Th>Created by</Table.Th>
              <Table.Th>Created at</Table.Th>
              <Table.Th>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const id = rowId(row);
              const isArchiving = archivingId === id;
              const isArchived = row.status === "ARCHIVED";
              return (
                <Table.Tr key={id}>
                  <Table.Td>{row.templateKey}</Table.Td>
                  <Table.Td>{row.version}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[row.status]} variant="light">
                      {row.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {row.action} / {row.actionType}
                  </Table.Td>
                  <Table.Td>{row.subject ?? "—"}</Table.Td>
                  <Table.Td>{formatDate(row.effectiveFrom)}</Table.Td>
                  <Table.Td>{formatDate(row.effectiveTo)}</Table.Td>
                  <Table.Td>{row.createdBy}</Table.Td>
                  <Table.Td>{formatDate(row.createdAt)}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Tooltip
                        label={
                          isArchived
                            ? "Archived versions cannot be previewed: resolution skips them, so the server would return a different version than this one."
                            : "Render this version with sample data"
                        }
                        withArrow
                        multiline
                        w={280}
                      >
                        {/* span: a disabled button fires no events, so the
                            tooltip would never show on the case that most needs
                            explaining. */}
                        <span>
                          <Button
                            size="xs"
                            variant="light"
                            disabled={isArchived}
                            onClick={() => setPreviewRow(row)}
                          >
                            Preview
                          </Button>
                        </span>
                      </Tooltip>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        disabled={isArchived}
                        loading={isArchiving}
                        onClick={() => setPendingArchive(row)}
                      >
                        Archive
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        component={Link}
                        to={newVersionHref(row)}
                      >
                        New version
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <PreviewModal
        row={previewRow}
        variant={previewVariant}
        onVariantChange={setPreviewVariant}
        onClose={() => setPreviewRow(null)}
      />

      <Modal
        opened={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        title="Archive this version?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Archiving is terminal — an ARCHIVED version cannot be reactivated.
            {pendingArchive ? (
              <>
                {" "}
                This affects <strong>{pendingArchive.templateKey}</strong> v
                {pendingArchive.version}.
              </>
            ) : null}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingArchive(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={confirmArchive}>
              Archive
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
