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
import type { TemplateStatus, TemplateSummary } from "../../../api/types";
import { collectorLabel } from "../../../lib/collector";
import type { PreviewVariant } from "../../../preview/protocol";
import { PreviewModal } from "./PreviewModal";
import { newVersionHref, rowId } from "./listFilters.logic";

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
        Cargando plantillas…
      </Text>
    );
  }

  if (rows.length === 0) {
    return (
      <Text c="dimmed" mt="md">
        Ninguna plantilla coincide con estos filtros.
      </Text>
    );
  }

  return (
    <>
      {/* Widened with the collector column: below this the columns compress
          until the dates wrap, and a horizontal scroll is easier to read than
          a squeezed table. */}
      <Table.ScrollContainer minWidth={1000} mt="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Template key</Table.Th>
              <Table.Th>Version</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Action / type</Table.Th>
              <Table.Th>Collector</Table.Th>
              <Table.Th>Subject</Table.Th>
              <Table.Th>Effective from</Table.Th>
              <Table.Th>Effective to</Table.Th>
              <Table.Th>Created by</Table.Th>
              <Table.Th>Created at</Table.Th>
              <Table.Th>Acciones</Table.Th>
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
                  {/*
                    Never a bare cell. A null collector is a decision — "this is
                    the generic, the template every client falls back to" — and
                    a blank would read as data somebody forgot to fill in.

                    The draft note is quiet on purpose. A DRAFT variant is a
                    real trap: it exists, so the catalogue shows the collector
                    has "a template", but it is not servable, so that client is
                    silently receiving the generic instead. Still, the Status
                    column already says DRAFT one cell away, so this only has to
                    connect the two facts — a second red badge here would shout
                    over the status and make every unpublished variant look
                    broken rather than unfinished.
                  */}
                  <Table.Td>
                    <Stack gap={0}>
                      <Text size="sm">{collectorLabel(row.collector)}</Text>
                      {isDraft && row.collector ? (
                        <Text size="xs" c="dimmed">
                          no se envía — cae en la genérica
                        </Text>
                      ) : null}
                    </Stack>
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
                        label="Renderiza esta versión con datos de ejemplo"
                        withArrow
                        multiline
                        w={280}
                      >
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => setPreviewRow(row)}
                        >
                          Vista previa
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
                            Editar
                          </Button>
                          <Button
                            size="xs"
                            color="green"
                            loading={isPublishing}
                            onClick={() => setPendingPublish(row)}
                          >
                            Publicar
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
                        {isDraft ? "Descartar" : "Archivar"}
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        component={Link}
                        to={newVersionHref(row)}
                      >
                        Nueva versión
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
        title="¿Publicar esta versión?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingPublish ? (
              <>
                <strong>{pendingPublish.templateKey}</strong> v
                {pendingPublish.version} pasa a estar en vivo de inmediato, y el
                servicio de notificaciones empieza a enviarla a destinatarios
                reales.
              </>
            ) : null}
          </Text>
          <Text size="sm" c="dimmed">
            La versión que está vigente ahora para esta plantilla se cierra en el
            mismo instante, así que no hay solapamiento ni hueco. Si todavía no lo
            hiciste, mira antes la vista previa: una versión publicada ya no se
            puede editar.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingPublish(null)}>
              Cancelar
            </Button>
            <Button color="green" onClick={confirmPublish}>
              Publicar
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={pendingArchive !== null}
        onClose={() => setPendingArchive(null)}
        title={
          pendingArchive?.status === "DRAFT"
            ? "¿Descartar este borrador?"
            : "¿Archivar esta versión?"
        }
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {pendingArchive?.status === "DRAFT"
              ? "Este borrador nunca se publicó, así que nunca se envió nada con él. Descartarlo es definitivo: no se puede recuperar."
              : "Archivar es definitivo: una versión ARCHIVED no se puede reactivar."}
            {pendingArchive ? (
              <>
                {" "}
                Esto afecta a <strong>{pendingArchive.templateKey}</strong> v
                {pendingArchive.version}.
              </>
            ) : null}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingArchive(null)}>
              Cancelar
            </Button>
            <Button color="red" onClick={confirmArchive}>
              {pendingArchive?.status === "DRAFT" ? "Descartar" : "Archivar"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
