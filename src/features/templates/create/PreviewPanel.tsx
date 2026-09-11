import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { PreviewVariant, RenderResult } from "../../../preview/protocol";
import { RenderedEmail } from "../RenderedEmail";

interface PreviewPanelProps {
  variant: PreviewVariant;
  result: RenderResult | null;
  /** The engine itself failed — Pyodide did not boot, an asset is missing. */
  engineErrorMessage: string | null;
  isRendering: boolean;
  canRender: boolean;
  onVariantChange: (variant: PreviewVariant) => void;
  onRender: () => void;
  /** Re-render on its own shortly after typing stops. */
  live?: boolean;
  onLiveChange?: (live: boolean) => void;
}

const FAILURE_TITLES: Record<string, string> = {
  SYNTAX: "Esta plantilla no se puede parsear",
  TEMPLATE_NOT_FOUND: "Falta una plantilla referenciada",
  RENDER: "Se parseó, pero falló al renderizar",
  ENGINE: "El motor de vista previa no está disponible",
};

// Presentational — owns no state and makes no calls.
export function PreviewPanel({
  variant,
  result,
  engineErrorMessage,
  isRendering,
  canRender,
  onVariantChange,
  onRender,
  live,
  onLiveChange,
}: PreviewPanelProps) {
  const failure = result && !result.ok ? result : null;
  const success = result && result.ok ? result : null;

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="sm" fw={500}>
            Vista previa
          </Text>
          <Text size="xs" c="dimmed">
            Se renderiza en tu navegador con el mismo render core Jinja2 que usa
            el emisor, y con datos de ejemplo derivados de la plantilla de esta
            Action. Un campo que vaya a llegar vacío se muestra vacío: esto es lo
            que recibe el destinatario, no una garantía de que el dato vaya a
            estar.
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={variant}
            onChange={(value) => onVariantChange(value as PreviewVariant)}
            data={[
              { label: "Individual", value: "single" },
              { label: "Múltiple", value: "multi" },
            ]}
          />
          {onLiveChange ? (
            <Switch
              size="xs"
              checked={live ?? false}
              onChange={(event) => onLiveChange(event.currentTarget.checked)}
              label="En vivo"
            />
          ) : null}
          {/*
            Kept even with live on: the debounce means a render is always a
            moment away, and when an author wants to look NOW, waiting on a
            timer they cannot see reads as the app having stopped working.
          */}
          <Button
            size="xs"
            variant="default"
            onClick={onRender}
            loading={isRendering}
            disabled={!canRender || isRendering}
          >
            Ver vista previa
          </Button>
        </Group>
      </Group>

      {!canRender ? (
        <Text size="sm" c="dimmed">
          Completa Action, Action type y el HTML body para renderizar una vista
          previa.
        </Text>
      ) : null}

      {engineErrorMessage ? (
        <Alert color="red" title={FAILURE_TITLES.ENGINE}>
          <Stack gap={4}>
            <Text size="sm">{engineErrorMessage}</Text>
            <Text size="xs" c="dimmed">
              Tu plantilla no tiene nada malo: el navegador no pudo arrancar el
              renderizador. Prueba recargando; si sigue pasando, puede faltar el
              runtime preparado (npm run setup:pyodide).
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {failure ? (
        <Alert
          color="red"
          title={FAILURE_TITLES[failure.kind] ?? "No se pudo renderizar"}
        >
          <Stack gap={4}>
            <Text size="sm" ff="monospace">
              {failure.line != null ? `línea ${failure.line}: ` : ""}
              {failure.message}
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {/* A stale render core is the one way this preview can silently disagree
          with what gets sent, so it is an error, not a note. */}
      {success && success.unknownFilters.length > 0 ? (
        <Alert
          color="red"
          title="Esta plantilla usa filtros que el renderizador no tiene"
        >
          <Text size="sm" ff="monospace">
            {success.unknownFilters.join(", ")}
          </Text>
          <Text size="xs" mt={4}>
            La vista previa de abajo los renderizó tal cual, pero el envío
            fallaría. O el nombre del filtro tiene un error de tipeo, o el render
            core incluido está desactualizado (npm run sync:render-core).
          </Text>
        </Alert>
      ) : null}

      {success?.actionProblem ? (
        <Alert color="yellow" title="Action no reconocida">
          <Text size="sm">{success.actionProblem.message}</Text>
          <Text size="xs" mt={4}>
            El cuerpo de abajo igual se renderizó, pero los datos de ejemplo
            salen solo de lo que referencia este borrador: no hay una plantilla
            de producción para esta Action con la que comparar.
          </Text>
        </Alert>
      ) : null}

      {success?.subjectProblem ? (
        <Alert color="yellow" title="El subject no se renderiza">
          <Text size="sm" ff="monospace">
            {success.subjectProblem.line != null
              ? `línea ${success.subjectProblem.line}: `
              : ""}
            {success.subjectProblem.message}
          </Text>
        </Alert>
      ) : null}

      {success ? (
        <RenderedEmail subject={success.subject} html={success.html} />
      ) : null}
    </Stack>
  );
}
