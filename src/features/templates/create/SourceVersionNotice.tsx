import { Link } from "react-router-dom";
import { Alert, Button, Loader, Group, Stack, Text } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import type { TemplateStatus } from "../../../api/types";
import type { SourceAddress } from "./createForm.logic";

interface SourceVersionNoticeProps {
  source: SourceAddress;
  isLoading: boolean;
  /** Set when the source could not be fetched; the form stays usable blank. */
  errorMessage: string | null;
  /**
   * Set when the source loaded but is not published (DRAFT or ARCHIVED), so
   * nothing was copied from it.
   */
  unusableStatus: TemplateStatus | null;
  /**
   * Whether the identity on the form is still the source's. null while the
   * source has not been loaded, because there is nothing to compare against.
   */
  identityMatches: boolean | null;
}

// Presentational — tells the author what this form was copied from and what
// saving it will produce. The container decides every value.
export function SourceVersionNotice({
  source,
  isLoading,
  errorMessage,
  unusableStatus,
  identityMatches,
}: SourceVersionNoticeProps) {
  const title = `Basado en ${source.templateKey} v${source.version}`;

  if (unusableStatus) {
    const isDraft = unusableStatus === "DRAFT";
    return (
      <Alert
        color="yellow"
        title={`${source.templateKey} v${source.version} no es una versión publicada`}
      >
        <Stack gap="xs">
          <Text size="sm">
            {isDraft
              ? "Es un borrador: se edita en el lugar, sin crear una versión nueva. No se copió su contenido."
              : "Está archivada: una versión retirada no es un punto de partida. No se copió su contenido."}{" "}
            El formulario conserva solo la identidad del enlace.
          </Text>
          {isDraft ? (
            <Group>
              <Button
                size="xs"
                variant="default"
                component={Link}
                to={`/templates/${encodeURIComponent(source.templateKey)}/versions/${source.version}/edit`}
              >
                Editar borrador
              </Button>
            </Group>
          ) : null}
        </Stack>
      </Alert>
    );
  }

  if (errorMessage) {
    return (
      <Alert color="red" title="No se pudo cargar la versión de origen">
        <Stack gap={4}>
          <Text size="sm">{errorMessage}</Text>
          <Text size="xs" c="dimmed">
            Puedes seguir y escribir la plantilla desde cero: la identidad del
            enlace ya está cargada en el formulario.
          </Text>
        </Stack>
      </Alert>
    );
  }

  return (
    <Alert color="accent" title={title} icon={<IconCopy size={18} stroke={1.6} />}>
      <Stack gap={4}>
        {isLoading ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm">Cargando el contenido de la versión de origen…</Text>
          </Group>
        ) : (
          <Text size="sm">
            Se copiaron el HTML, el asunto y la identidad. Si mantienes Action,
            Action type y Collector, se guarda como una nueva versión de esta
            plantilla; si cambias alguno, se crea una plantilla o variante nueva.
          </Text>
        )}
        {identityMatches === null ? null : (
          <Text size="xs" c="dimmed">
            {identityMatches
              ? `Con la identidad actual: nueva versión de ${source.templateKey}.`
              : `Con la identidad actual: plantilla nueva, no una versión de ${source.templateKey}.`}
          </Text>
        )}
      </Stack>
    </Alert>
  );
}
