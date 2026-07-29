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
  // Same, for the publish in flight.
  publishingId: string | null;
  onArchive: (row: TemplateSummary) => void;
  onPublish: (row: TemplateSummary) => void;
}

const STATUS_COLOR: Record<TemplateStatus, string> = {
  // Yellow, not grey: a draft is unfinished business someone has to come back
  // to, not a retired row. Grey would let it blend into the archived ones.
  DRAFT: "yellow",
  ACTIVE: "green",
  SCHEDULED: "blue",
  ARCHIVED: "gray",
};

function formatDate(value: string | null): string {
  return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "—";
}

function editDraftHref(row: TemplateSummary): string {
  return `/templates/${encodeURIComponent(row.templateKey)}/versions/${row.version}/edit`;
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
  publishingId,
  onArchive,
  onPublish,
}: TemplatesTableProps) {
  const [pendingArchive, setPendingArchive] = useState<TemplateSummary | null>(
    null,
  );
  const [pendingPublish, setPendingPublish] = useState<TemplateSummary | null>(
    null,
  );
  const [previewRow, setPreviewRow] = useState<TemplateSummary | null>(null);
  const [previewVariant, setPreviewVariant] = useState<PreviewVariant>("single");

  function confirmArchive() {
    if (pendingArchive) onArchive(pendingArchive);
    setPendingArchive(null);
  }

  function confirmPublish() {
    if (pendingPublish) onPublish(pendingPublish);
    setPendingPublish(null);
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
              const isPublishing = publishingId === id;
              const isArchived = row.status === "ARCHIVED";
              const isDraft = row.status === "DRAFT";
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
                      {/* Every status is previewable now: the row is fetched by
                          address, so there is no resolution that could skip it
                          or land on a different version. */}
                      <Tooltip
                        label="Render this version with sample data"
                        withArrow
                        multiline
                        w={280}
                      >
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => setPreviewRow(row)}
                        >
                          Preview
                        </Button>
                      </Tooltip>
                      {isDraft ? (
                        <>
                          <Button
                            size="xs"
                            variant="light"
                            component={Link}
                            to={editDraftHref(row)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            color="green"
                            loading={isPublishing}
                            onClick={() => setPendingPublish(row)}
                          >
                            Publish
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        disabled={isArchived}
                        loading={isArchiving}
                        onClick={() => setPendingArchive(row)}
                      >
                        {isDraft ? "Discard" : "Archive"}
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

      {/* The one irreversible-in-practice action in this app: from the moment
          this returns, real customers can receive this template. It gets a
          confirmation step for that reason and no other. */}
      <Modal
        opened={pendingPublish !== null}
        onClose={() => setPendingPublish(null)}
        title="Publish this version?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingPublish ? (
              <>
                <strong>{pendingPublish.templateKey}</strong> v
                {pendingPublish.version} goes live immediately, and the
                notification service will start sending it to real recipients.
              </>
            ) : null}
          </Text>
          <Text size="sm" c="dimmed">
            The version currently in effect for this template is closed at the same
            instant, so there is no overlap and no gap. Preview it first if you have
            not already — a published version can no longer be edited.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingPublish(null)}>
              Cancel
            </Button>
            <Button color="green" onClick={confirmPublish}>
              Publish
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        title={
          pendingArchive?.status === "DRAFT"
            ? "Discard this draft?"
            : "Archive this version?"
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingArchive?.status === "DRAFT"
              ? "This draft was never published, so nothing was ever sent with it. Discarding is terminal — it cannot be brought back."
              : "Archiving is terminal — an ARCHIVED version cannot be reactivated."}
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
              {pendingArchive?.status === "DRAFT" ? "Discard" : "Archive"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
