import { Badge, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import type { CatalogueResult } from "../../../preview/protocol";

interface AvailableVariablesProps {
  catalogue: CatalogueResult | null;
  isLoading: boolean;
  /** True once action + actionType are both filled in. */
  ready: boolean;
}

// Renders one sample value compactly enough for a tooltip.
function describe(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (typeof value === "object") return Object.keys(value as object).join(", ");
  return String(value);
}

// Presentational. The list comes from the action's PRODUCTION template, not from
// the draft, so it names variables the author has not typed yet — which are
// precisely the ones worth showing. Reading them out of the draft text could
// only ever repeat back what the author already knows.
export function AvailableVariables({
  catalogue,
  isLoading,
  ready,
}: AvailableVariablesProps) {
  const unknownAction = catalogue != null && !catalogue.known;

  return (
    <div>
      <Group gap="xs" mb={4} align="center">
        <Text size="sm" fw={500}>
          Available variables
        </Text>
        {isLoading ? <Loader size="xs" /> : null}
        {catalogue?.template ? (
          <Text size="xs" c="dimmed" ff="monospace">
            {catalogue.template}
          </Text>
        ) : null}
      </Group>

      {!ready ? (
        <Text size="sm" c="dimmed">
          Fill in action and action type to see what this notification provides.
        </Text>
      ) : unknownAction ? (
        <Text size="sm" c="dimmed">
          The sender has no template for this action, so there is nothing to list.
          Check the action and action type — a typo here is the usual cause. You
          can still author and preview the body; the sample data will just come
          from what you reference yourself.
        </Text>
      ) : catalogue && catalogue.variables.length > 0 ? (
        <Stack gap={6}>
          <Group gap="xs">
            {catalogue.variables.map((name) => (
              <Tooltip
                key={name}
                label={describe(catalogue.context[name])}
                withArrow
                multiline
                w={260}
              >
                <Badge variant="light" style={{ cursor: "help" }}>
                  {name}
                </Badge>
              </Tooltip>
            ))}
          </Group>
          <Text size="xs" c="dimmed">
            Hover a variable to see the sample value the preview will use. Use
            them as <code>{"{{ name }}"}</code>; blocks such as{" "}
            <code>{"{% for %}"}</code> are available too.
          </Text>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          This action's template references no variables.
        </Text>
      )}
    </div>
  );
}
