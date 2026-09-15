import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Group,
  Pagination,
  Paper,
  Select,
  TextInput,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { PageHeader } from "../../../app/PageHeader";
import { useTemplatesList } from "../../../queries/useTemplatesList";
import { useArchiveTemplate } from "../../../queries/useArchiveTemplate";
import { usePublishTemplate } from "../../../queries/usePublishTemplate";
import { toUiError } from "../../../lib/errors";
import type { TemplateSummary } from "../../../api/types";
import {
  EMPTY_LIST_FILTER_STATE,
  buildListParams,
  rowId,
  type ListFilterState,
} from "./listFilters.logic";
import { TemplatesTable } from "./TemplatesTable";

// The four status values are enum values off the wire and are never translated;
// only the "no filter" entry is copy, so only that one is in Spanish.
const STATUS_OPTIONS = [
  { value: "", label: "Todos los estados" },
  { value: "DRAFT", label: "DRAFT" },
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "ARCHIVED", label: "ARCHIVED" },
];

// Container — owns filter + pagination state, drives the list and archive
// queries, and maps errors. Renders the presentational TemplatesTable.
export function ListPage() {
  // Read once on mount. The create page sends the author back here with
  // ?templateKey=… after saving a draft, so they land on the rows they just
  // authored instead of hunting for them in the full catalogue.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<ListFilterState>(() => ({
    ...EMPTY_LIST_FILTER_STATE,
    templateKey: searchParams.get("templateKey") ?? "",
  }));

  const params = useMemo(() => buildListParams(filters), [filters]);
  const listQuery = useTemplatesList(params);
  const archiveMutation = useArchiveTemplate();
  const publishMutation = usePublishTemplate();

  // Changing any filter resets to the first page; page changes keep filters.
  function updateFilter<K extends keyof ListFilterState>(
    field: K,
    value: ListFilterState[K],
  ) {
    setFilters((prev) => ({ ...prev, [field]: value, page: 0 }));
  }

  function handlePageChange(oneBasedPage: number) {
    // Mantine Pagination is 1-based; the API and our state are 0-based.
    setFilters((prev) => ({ ...prev, page: oneBasedPage - 1 }));
  }

  function handleArchive(row: TemplateSummary) {
    archiveMutation.mutate({
      templateKey: row.templateKey,
      version: row.version,
    });
  }

  // No effectiveFrom passed: publishing from the list means "live now". Scheduling
  // a future date is a different intent and deserves its own deliberate flow, not
  // a date picker hiding inside a confirm dialog.
  function handlePublish(row: TemplateSummary) {
    publishMutation.mutate({
      templateKey: row.templateKey,
      version: row.version,
    });
  }

  const listError = listQuery.error ? toUiError(listQuery.error) : null;
  const archiveError = archiveMutation.error
    ? toUiError(archiveMutation.error)
    : null;
  const publishError = publishMutation.error
    ? toUiError(publishMutation.error)
    : null;

  const archivingId =
    archiveMutation.isPending && archiveMutation.variables
      ? rowId(archiveMutation.variables)
      : null;

  const publishingId =
    publishMutation.isPending && publishMutation.variables
      ? rowId(publishMutation.variables)
      : null;

  const rows = listQuery.data?.content ?? [];
  const totalPages = listQuery.data?.totalPages ?? 0;

  return (
    <>
      <PageHeader
        title="Listado"
        description="Todas las versiones guardadas, con filtros por estado, key, Action y Collector."
        actions={
          <Button
            component={Link}
            to="/create"
            leftSection={<IconPlus size={16} stroke={1.8} />}
          >
            Nueva plantilla
          </Button>
        }
      />

      <Paper withBorder p="md">
      <Group align="flex-end" gap="md" wrap="wrap">
        <Select
          label="Status"
          data={STATUS_OPTIONS}
          value={filters.status}
          onChange={(value) => updateFilter("status", value ?? "")}
          allowDeselect={false}
          w={180}
        />
        <TextInput
          label="Template key"
          description="Coincide con cualquier parte de la key"
          placeholder="payment"
          value={filters.templateKey}
          onChange={(event) =>
            updateFilter("templateKey", event.currentTarget.value)
          }
        />
        <TextInput
          label="Action"
          description="Coincide con cualquier parte de la Action"
          placeholder="payment"
          value={filters.action}
          onChange={(event) => updateFilter("action", event.currentTarget.value)}
        />
        {/* Blank means "every row", generic and variant alike — not "only the
            generic ones". There is no filter for generics alone, and the column
            below is how you tell them apart. */}
        <TextInput
          label="Collector"
          description="Coincide con cualquier parte del Collector"
          placeholder="bbva"
          value={filters.collector}
          onChange={(event) =>
            updateFilter("collector", event.currentTarget.value)
          }
        />
      </Group>
      </Paper>

      {listError ? (
        <Alert color="red" title="No se pudieron cargar las plantillas" mt="md">
          {listError.message}
        </Alert>
      ) : null}

      {archiveError ? (
        <Alert color="red" title="No se pudo archivar la versión" mt="md">
          {archiveError.message}
        </Alert>
      ) : null}

      {publishError ? (
        <Alert color="red" title="No se pudo publicar la versión" mt="md">
          {publishError.message}
        </Alert>
      ) : null}

      {publishMutation.isSuccess && publishMutation.data ? (
        <Alert color="green" title="Versión publicada" mt="md">
          <strong>{publishMutation.data.templateKey}</strong> v
          {publishMutation.data.version} ahora está en{" "}
          {publishMutation.data.status}. El servicio de notificaciones la usará de
          aquí en adelante.
        </Alert>
      ) : null}

      <TemplatesTable
        rows={rows}
        isLoading={listQuery.isLoading}
        archivingId={archivingId}
        publishingId={publishingId}
        onArchive={handleArchive}
        onPublish={handlePublish}
      />

      {totalPages > 1 ? (
        <Group justify="center" mt="lg">
          <Pagination
            total={totalPages}
            value={filters.page + 1}
            onChange={handlePageChange}
          />
        </Group>
      ) : null}
    </>
  );
}
