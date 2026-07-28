import { Badge, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import type { ContractResponse } from "../../../api/types";

interface AvailableVariablesProps {
  contract: ContractResponse | null;
  isLoading: boolean;
  /** True once action + actionType are both filled in. */
  ready: boolean;
  /** The action was rejected by the renderer — no template or fixture maps to it. */
  unknownAction: boolean;
}

// Renders one sample value compactly enough for a tooltip.
function describe(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `list of ${value.length}`;
  if (typeof value === "object") return Object.keys(value as object).join(", ");
  return String(value);
}

// Presentational. The list comes from the renderer's own context, so it names
// variables the author has not typed yet — which are precisely the ones worth
// showing. Reading them out of the draft text could only ever repeat back what
// the author already knows.
export function AvailableVariables({
  contract,
  isLoading,
  ready,
  unknownAction,
}: AvailableVariablesProps) {
  return (
    <div>
      <Group gap="xs" mb={4} align="center">
        <Text size="sm" fw={500}>
          Available variables
        </Text>
        {isLoading ? <Loader size="xs" /> : null}
        {contract ? (
          <Text size="xs" c="dimmed" ff="monospace">
            {contract.template}
          </Text>
        ) : null}
      </Group>

      {!ready ? (
        <Text size="sm" c="dimmed">
          Fill in action and action type to see what this notification provides.
        </Text>
      ) : unknownAction ? (
        <Text size="sm" c="dimmed">
          The renderer has no template for this action, so it provides no
          variables. Check the action and action type — a typo here is the usual
          cause, and creating the template will be refused for the same reason.
        </Text>
      ) : contract && contract.variables.length > 0 ? (
        <Stack gap={6}>
          <Group gap="xs">
            {contract.variables.map((name) => (
              <Tooltip
                key={name}
                label={describe(contract.context[name])}
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
          No variables reported for this action.
        </Text>
      )}
    </div>
  );
}
