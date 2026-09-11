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
  if (Array.isArray(value)) return `lista de ${value.length}`;
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
          Variables disponibles
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
          Completa Action y Action type para ver qué provee esta notificación.
        </Text>
      ) : unknownAction ? (
        <Text size="sm" c="dimmed">
          El emisor no tiene ninguna plantilla para esta Action, así que no hay
          nada que listar. Revisa Action y Action type: un error de tipeo aquí es
          la causa habitual. Igual puedes escribir el cuerpo y previsualizarlo;
          los datos de ejemplo saldrán solo de lo que referencies tú.
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
            Pasa el cursor sobre una variable para ver el valor de ejemplo que
            usará la vista previa. Se usan como <code>{"{{ nombre }}"}</code>;
            también tienes bloques como <code>{"{% for %}"}</code>.
          </Text>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          La plantilla de esta Action no referencia ninguna variable.
        </Text>
      )}
    </div>
  );
}
