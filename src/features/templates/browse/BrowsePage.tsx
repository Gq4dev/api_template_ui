import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { AppHeader } from "../../../app/AppHeader";
import { useTemplatesList } from "../../../queries/useTemplatesList";
import { useRowPreview } from "../../../queries/useRowPreview";
import { useArchiveTemplate } from "../../../queries/useArchiveTemplate";
import { usePublishTemplate } from "../../../queries/usePublishTemplate";
import { toUiError } from "../../../lib/errors";
import type { PreviewVariant } from "../../../preview/protocol";
import { RenderedEmail } from "../RenderedEmail";
import {
  defaultVersion,
  effectiveStatus,
  findVersion,
  groupByTemplateKey,
  groupsWithMixedActions,
  templateKeyOptions,
  versionOptions,
} from "./browse.logic";

// One page big enough to hold the whole catalogue. The two selects need every
// key at once — a paginated dropdown would hide half the templates behind a
// control that gives no hint there is more.
const ALL = { page: 0, size: 500 } as const;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green",
  SCHEDULED: "blue",
  DRAFT: "gray",
  ARCHIVED: "dark",
};

/**
 * Browse: pick a template, pick a version, see what it sends.
 *
 * Replaces the filter-and-scan table as the way in. The table asked the reader
 * to find a row among dozens before they could look at anything; here the two
 * choices that identify a template ARE the interface, and the rendered mail sits
 * underneath them where the answer belongs.
 */
export function BrowsePage() {
  const listQuery = useTemplatesList(ALL);
  const preview = useRowPreview();
  const archiveMutation = useArchiveTemplate();
  const publishMutation = usePublishTemplate();

  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [variant, setVariant] = useState<PreviewVariant>("single");

  const rows = useMemo(() => listQuery.data?.content ?? [], [listQuery.data]);
  const groups = useMemo(() => groupByTemplateKey(rows), [rows]);
  const mixed = useMemo(() => groupsWithMixedActions(rows), [rows]);

  const group = useMemo(
    () => groups.find((candidate) => candidate.templateKey === templateKey) ?? null,
    [groups, templateKey],
  );
  const selected = findVersion(group, version);
  // Same rule the server will use once it computes status; see effectiveStatus.
  const selectedStatus = selected ? effectiveStatus(selected) : null;

  // Choosing a key implies a version — asking for both before showing anything
  // would make the common case ("what are we sending today") two clicks instead
  // of one. The reader can still override it.
  useEffect(() => {
    if (!group) return;
    setVersion(defaultVersion(group)?.version ?? null);
  }, [group]);

  // Never carry one template's render under another's name. Resetting on every
  // change of selection is cheaper to reason about than proving each path clears
  // it, and a stale preview here is a lie about what a customer receives.
  useEffect(() => {
    preview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey, version, variant]);

  const listError = listQuery.error ? toUiError(listQuery.error) : null;
  const previewError = preview.error ? toUiError(preview.error) : null;
  const archiveError = archiveMutation.error ? toUiError(archiveMutation.error) : null;
  const publishError = publishMutation.error ? toUiError(publishMutation.error) : null;

  const result = preview.data;
  const failure = result && !result.ok ? result : null;
  const rendered = result && result.ok ? result : null;

  return (
    <Container size="lg" py="xl">
      <AppHeader />
      <Group justify="space-between" align="center">
        <Title order={2}>Templates</Title>
        <Button component={Link} to="/create">
          Create template
        </Button>
      </Group>

      <Paper withBorder p="md" radius="md" mt="md">
        <Group align="flex-end" gap="md" wrap="wrap">
          <Select
            label="Template"
            placeholder={listQuery.isLoading ? "Loading…" : "Pick a template"}
            description={`${groups.length} available`}
            data={templateKeyOptions(groups)}
            value={templateKey}
            onChange={setTemplateKey}
            searchable
            nothingFoundMessage="No template matches"
            disabled={listQuery.isLoading}
            w={380}
          />
          <Select
            label="Version"
            placeholder={group ? "Pick a version" : "Pick a template first"}
            data={versionOptions(group)}
            value={version == null ? null : String(version)}
            onChange={(value) => setVersion(value == null ? null : Number(value))}
            disabled={!group}
            allowDeselect={false}
            w={220}
          />
          <SegmentedControl
            value={variant}
            onChange={(value) => setVariant(value as PreviewVariant)}
            data={[
              { label: "Single", value: "single" },
              { label: "Multi", value: "multi" },
            ]}
          />
          <Button
            onClick={() => selected && preview.mutate({ row: selected, variant })}
            loading={preview.isPending}
            disabled={!selected || preview.isPending}
          >
            Render preview
          </Button>
        </Group>

        {selected ? (
          <Group gap="xs" mt="md" align="center">
            <Badge color={STATUS_COLOR[selectedStatus ?? ""] ?? "gray"} variant="light">
              {selectedStatus}
            </Badge>
            <Text size="sm" c="dimmed">
              {selected.action}/{selected.actionType} · v{selected.version} · by{" "}
              {selected.createdBy}
            </Text>
            <Group gap="xs" ml="auto">
              {selectedStatus === "DRAFT" ? (
                <>
                  <Button
                    size="xs"
                    variant="light"
                    component={Link}
                    to={`/templates/${selected.templateKey}/versions/${selected.version}/edit`}
                  >
                    Edit draft
                  </Button>
                  <Button
                    size="xs"
                    onClick={() =>
                      publishMutation.mutate({
                        templateKey: selected.templateKey,
                        version: selected.version,
                      })
                    }
                    loading={publishMutation.isPending}
                  >
                    Publish
                  </Button>
                </>
              ) : null}
              {selectedStatus !== "ARCHIVED" ? (
                <Button
                  size="xs"
                  color="red"
                  variant="light"
                  onClick={() =>
                    archiveMutation.mutate({
                      templateKey: selected.templateKey,
                      version: selected.version,
                    })
                  }
                  loading={archiveMutation.isPending}
                >
                  Archive
                </Button>
              ) : null}
            </Group>
          </Group>
        ) : null}
      </Paper>

      {mixed.length ? (
        <Alert color="yellow" title="Template keys with more than one action" mt="md">
          {mixed.join(", ")} — the key is meant to identify one action, so this is
          worth looking at.
        </Alert>
      ) : null}

      {listError ? (
        <Alert color="red" title="Could not load templates" mt="md">
          {listError.message}
        </Alert>
      ) : null}

      {publishError ? (
        <Alert color="red" title="Could not publish version" mt="md">
          {publishError.message}
        </Alert>
      ) : null}

      {archiveError ? (
        <Alert color="red" title="Could not archive version" mt="md">
          {archiveError.message}
        </Alert>
      ) : null}

      {publishMutation.isSuccess && publishMutation.data ? (
        <Alert color="green" title="Version published" mt="md">
          <strong>{publishMutation.data.templateKey}</strong> v
          {publishMutation.data.version} is now {publishMutation.data.status}.
        </Alert>
      ) : null}

      <Stack mt="lg" gap="md">
        {preview.isPending ? (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Rendering — the engine boots on first use.
            </Text>
          </Group>
        ) : null}

        {/*
          Split deliberately. A fetch that never returned content is not a
          template that failed to render, and saying so sends the reader to the
          server instead of into perfectly good Jinja.
        */}
        {previewError ? (
          <Alert color="red" title="Could not fetch this version">
            {previewError.message}
          </Alert>
        ) : null}

        {failure ? (
          <Alert color="red" title={`Could not render — ${failure.kind}`}>
            <Stack gap={4}>
              <Text size="sm" ff="monospace">
                {failure.line != null ? `line ${failure.line}: ` : ""}
                {failure.message}
              </Text>
              <Text size="xs" c="dimmed">
                This is a stored version, so it was saved in this state. If it is
                published, it is failing to send.
              </Text>
            </Stack>
          </Alert>
        ) : null}

        {rendered ? (
          <>
            {rendered.actionProblem ? (
              <Alert color="yellow" title="No bundled template for this action">
                {rendered.actionProblem.message} The draft still rendered, but the
                layout it extends could not be resolved from the action.
              </Alert>
            ) : null}
            {rendered.unknownFilters.length ? (
              <Alert color="yellow" title="Unknown filters">
                {rendered.unknownFilters.join(", ")} — the vendored render core is
                behind the sender. Run: npm run sync:render-core
              </Alert>
            ) : null}
            <RenderedEmail
              subject={rendered.subject}
              html={rendered.html}
              height={620}
            />
          </>
        ) : null}

        {!preview.isPending && !result && !previewError && selected ? (
          <Text size="sm" c="dimmed">
            Render preview to see what this version sends.
          </Text>
        ) : null}
      </Stack>
    </Container>
  );
}
