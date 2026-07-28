import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Pagination,
  Select,
  TextInput,
  Title,
} from "@mantine/core";
import { AppHeader } from "../../../app/AppHeader";
import { useTemplatesList } from "../../../queries/useTemplatesList";
import { useArchiveTemplate } from "../../../queries/useArchiveTemplate";
import { toUiError } from "../../../lib/errors";
import type { TemplateSummary } from "../../../api/types";
import {
  EMPTY_LIST_FILTER_STATE,
  buildListParams,
  rowId,
  type ListFilterState,
} from "./listFilters.logic";
import { TemplatesTable } from "./TemplatesTable";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "SCHEDULED", label: "SCHEDULED" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "ARCHIVED", label: "ARCHIVED" },
];

// Container — owns filter + pagination state, drives the list and archive
// queries, and maps errors. Renders the presentational TemplatesTable.
export function ListPage() {
  const [filters, setFilters] = useState<ListFilterState>(
    EMPTY_LIST_FILTER_STATE,
  );

  const params = useMemo(() => buildListParams(filters), [filters]);
  const listQuery = useTemplatesList(params);
  const archiveMutation = useArchiveTemplate();

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

  const listError = listQuery.error ? toUiError(listQuery.error) : null;
  const archiveError = archiveMutation.error
    ? toUiError(archiveMutation.error)
    : null;

  const archivingId =
    archiveMutation.isPending && archiveMutation.variables
      ? rowId(archiveMutation.variables)
      : null;

  const rows = listQuery.data?.content ?? [];
  const totalPages = listQuery.data?.totalPages ?? 0;

  return (
    <Container size="xl" py="xl">
      <AppHeader />
      <Group justify="space-between" align="center">
        <Title order={2}>Templates</Title>
        <Button component={Link} to="/create">
          Create template
        </Button>
      </Group>

      <Group mt="md" align="flex-end" gap="md">
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
          description="Matches any part of the key"
          placeholder="payment"
          value={filters.templateKey}
          onChange={(event) =>
            updateFilter("templateKey", event.currentTarget.value)
          }
        />
        <TextInput
          label="Action"
          description="Matches any part of the action"
          placeholder="payment"
          value={filters.action}
          onChange={(event) => updateFilter("action", event.currentTarget.value)}
        />
      </Group>

      {listError ? (
        <Alert color="red" title="Could not load templates" mt="md">
          {listError.message}
        </Alert>
      ) : null}

      {archiveError ? (
        <Alert color="red" title="Could not archive version" mt="md">
          {archiveError.message}
        </Alert>
      ) : null}

      <TemplatesTable
        rows={rows}
        isLoading={listQuery.isLoading}
        archivingId={archivingId}
        onArchive={handleArchive}
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
    </Container>
  );
}
