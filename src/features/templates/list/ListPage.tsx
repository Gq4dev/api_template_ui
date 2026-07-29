import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
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

      {publishError ? (
        <Alert color="red" title="Could not publish version" mt="md">
          {publishError.message}
        </Alert>
      ) : null}

      {publishMutation.isSuccess && publishMutation.data ? (
        <Alert color="green" title="Version published" mt="md">
          <strong>{publishMutation.data.templateKey}</strong> v
          {publishMutation.data.version} is now {publishMutation.data.status}. The
          notification service will use it from here on.
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
    </Container>
  );
}
