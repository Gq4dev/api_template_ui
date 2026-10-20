import { Alert, Badge, Group, Stack, Text } from "@mantine/core";
import type { ResolveByActionResult } from "../../../queries/useResolveByAction";
import { toUiError } from "../../../lib/errors";
import { collectorLabel, normalizeCollector } from "../../../lib/collector";
import { RenderedEmail } from "../RenderedEmail";
import { resolutionOutcome } from "./browse.logic";
import { STATUS_COLOR, collectorBadgeColor } from "./browseStyle";

interface ResolutionAnswerProps {
  /** What the send path answered for one spelling, or null when it failed. */
  result: ResolveByActionResult | null;
  /** Why it failed, when it did. */
  error: Error | null;
}

/**
 * Presentational — ONE answer of the send-path panel.
 *
 * Extracted so a pair written more than one way can show one answer per stored
 * spelling without copying the banners. Every rule below was already the panel's
 * rule for its single answer; nothing in here knows or cares how many siblings
 * it has.
 */
export function ResolutionAnswer({ result, error }: ResolutionAnswerProps) {
  const resolveError = error ? toUiError(error) : null;

  // Computed once, read by every banner below. See the block comment above the
  // banners for why this is a four-way question and not a boolean.
  const outcome = result
    ? resolutionOutcome(result.content, result.requestedCollector)
    : null;

  /*
    Three states, not two, and the third is the one worth naming: the API
    answered and the LOCAL engine did not run. `render` is null exactly then,
    and `engineErrorMessage` says why — see useResolveByAction. Everything else
    on this panel is built from `content`, so it keeps rendering: the reader
    still learns which version the send path picks and whether it fell back,
    and only the mail itself is missing.
  */
  const resolvedRender = result?.render?.ok ? result.render : null;
  const resolvedFailure =
    result?.render && !result.render.ok ? result.render : null;
  const resolvedEngineError = result?.engineErrorMessage ?? null;

  return (
    <>
      {/* The server's own 400 on a malformed collector. It is shown as a
          validation error and NEVER as a template: the API refuses to guess
          what was meant, and showing the generic here would answer a
          question nobody asked. */}
      {resolveError ? (
        <Alert
          color="red"
          title={
            resolveError.kind === "VALIDATION_ERROR"
              ? "Esa consulta no es válida"
              : "No se pudo resolver"
          }
        >
          <Stack gap={4}>
            <Text size="sm">{resolveError.message}</Text>
            {(resolveError.fieldDetails ?? []).map((detail) => (
              <Text key={detail} size="sm" ff="monospace">
                {detail}
              </Text>
            ))}
            {resolveError.kind === "TEMPLATE_NOT_FOUND" ? (
              <Text size="xs" c="dimmed">
                No hay nada vigente para esta Action, ni siquiera una
                plantilla genérica. Que falte una variante de collector nunca
                llegaría hasta aquí por sí solo.
              </Text>
            ) : null}
          </Stack>
        </Alert>
      ) : null}

      {/*
        ABSENT IS NOT FALSE — which is why these banners switch on a
        four-way outcome instead of reading one boolean.

        These used to be two mutually exclusive ternaries on
        `content.fallbackToGeneric`, so a response that simply lacked the
        field was read as "false", and "false" was rendered as "no, it did
        not fall back — this collector has its own version". That is the
        single most dangerous sentence this panel can print, and it was
        printed over live traffic: the collector dimension is not deployed
        yet, the running API ignores the `collector` parameter outright, and
        it answers with a body carrying neither `collector` nor
        `fallbackToGeneric`. The badge row below, which derives from
        `content.collector`, correctly read GENERIC while the banner
        immediately above it claimed the opposite.

        "I did not answer your question" is its own outcome, and it gets its
        own banner that claims nothing.
      */}

      {/*
        The single most important element in this feature.

        An operator who asked for Santander and is shown the generic without
        being told will go and fix the wrong document — and the fix will
        land on every client instead of the one they meant. So this names
        both halves explicitly: the collector they asked for, and the
        template they are in fact looking at. A version that is DRAFT,
        archived, or scheduled for next month is not servable and falls back
        exactly like one that was never authored, which is why the reason is
        spelled out rather than left to be inferred from a missing row.
      */}
      {result && outcome === "FELL_BACK" ? (
        <Alert
          color="yellow"
          title={`No hay plantilla vigente para “${normalizeCollector(result.requestedCollector)}” — se muestra la genérica`}
        >
          <Stack gap={4}>
            <Text size="sm">
              Pediste{" "}
              <strong>{normalizeCollector(result.requestedCollector)}</strong>
              , que ahora mismo no tiene ninguna versión publicada y vigente.
              Lo que aparece abajo es la plantilla GENÉRICA{" "}
              <strong>{result.content.templateKey}</strong>: la que recibe
              todo cliente que no tenga una versión propia, y la que hoy se le
              está enviando a ese cliente.
            </Text>
            <Text size="xs" c="dimmed">
              Una variante puede existir y aun así no enviarse: un borrador,
              una versión archivada o una programada para más adelante caen
              todas en la genérica igual. Si editas lo que aparece abajo,
              cambias el mail de todos, no solo el de{" "}
              {normalizeCollector(result.requestedCollector)}.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {result && outcome === "COLLECTOR_SERVED" ? (
        <Alert
          color="teal"
          title={`${normalizeCollector(result.requestedCollector)} tiene su propia versión`}
        >
          <Text size="sm">
            A este collector se le está enviando{" "}
            <strong>{result.content.templateKey}</strong>, no la genérica.
            Si la editas, solo lo afectas a él.
          </Text>
        </Alert>
      ) : null}

      {/*
        The honest "I don't know". It must not be mistaken for either of the
        two banners above, which is why it is neither yellow nor teal and
        why every sentence in it is about the API rather than about the
        template: the one thing this build cannot tell the reader is whether
        this collector has a variant, and pretending otherwise in either
        direction is the bug.
      */}
      {result && outcome === "UNREPORTED" ? (
        <Alert
          color="orange"
          title={`Esta versión de la API no puede responder por “${normalizeCollector(result.requestedCollector)}”`}
        >
          <Stack gap={4}>
            <Text size="sm">
              El servidor no informó la dimensión collector en absoluto.
              Ignoró el collector que pediste —{" "}
              <strong>{normalizeCollector(result.requestedCollector)}</strong>{" "}
              — y respondió como si no se hubiera pedido ninguno, así que lo
              que aparece abajo es la plantilla GENÉRICA{" "}
              <strong>{result.content.templateKey}</strong>. Desde aquí no
              se puede saber si este collector tiene una versión propia:
              tómalo como desconocido, no como un no.
            </Text>
            <Text size="xs" c="dimmed">
              Es lo esperable hasta que se despliegue el soporte de collector
              en el backend. La resolución de abajo es el comportamiento
              previo a collector: la misma respuesta que daba este endpoint
              antes de que existiera la dimensión.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {/*
        Badges only — no Edit draft, no Publish, no Archive, and this is not
        an omission to be tidied up later.

        On a fallback the version on screen is the GENERIC one. Offering to
        edit it right where the reader asked about santander is precisely the
        mistake the yellow banner above exists to prevent: they came to fix
        one client's mail and the button under their cursor would change
        everybody's. Acting on a version is the catalogue's job, where what is
        named on screen is what the buttons touch — so the reader goes back up
        and names the template they actually mean.
      */}
      {result ? (
        <Group gap="xs" align="center">
          <Badge color={STATUS_COLOR[result.content.status] ?? "gray"} variant="light">
            {result.content.status}
          </Badge>
          <Badge
            color={collectorBadgeColor(result.content.collector)}
            variant={result.content.collector ? "filled" : "light"}
          >
            {collectorLabel(result.content.collector)}
          </Badge>
          <Text size="sm" c="dimmed">
            {result.content.templateKey} · v{result.content.version} ·{" "}
            {result.content.action}/{result.content.actionType}
          </Text>
        </Group>
      ) : null}

      {resolvedFailure ? (
        <Alert color="red" title={`No se pudo renderizar — ${resolvedFailure.kind}`}>
          <Stack gap={4}>
            <Text size="sm" ff="monospace">
              {resolvedFailure.line != null ? `línea ${resolvedFailure.line}: ` : ""}
              {resolvedFailure.message}
            </Text>
            <Text size="xs" c="dimmed">
              Esta es la versión a la que resuelve el envío. Si no puede
              renderizarse aquí, está fallando al enviarse.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {/*
        THE ENGINE, NOT THE TEMPLATE, AND NOT THE SERVER.

        Scoped to the rendered-mail area on purpose: the resolution above it
        is a complete, correct answer that the API already gave, and the
        badges and banners are still saying what the send path would do. The
        only thing missing is the picture of the mail, so that is the only
        thing this reports.

        Red, but worded away from the template. A version that cannot render
        because of its own Jinja arrives as `resolvedFailure` above, with a
        line number; this one means Pyodide never booted or the worker died,
        and sending the reader to look for the fault in perfectly good HTML
        would cost them an afternoon.
      */}
      {resolvedEngineError ? (
        <Alert color="red" title="No se pudo arrancar el motor de vista previa">
          <Stack gap={4}>
            <Text size="sm">
              La resolución de arriba es correcta: el servidor respondió y
              esa es la versión que se envía. Lo que falló es el motor que
              renderiza el mail en este navegador, así que no se puede
              mostrar cómo se ve.
            </Text>
            <Text size="xs" c="dimmed" ff="monospace">
              {resolvedEngineError}
            </Text>
            <Text size="xs" c="dimmed">
              No es un problema de la plantilla. Recarga la página para
              volver a arrancar el motor.
            </Text>
          </Stack>
        </Alert>
      ) : null}

      {resolvedRender ? (
        <RenderedEmail
          subject={resolvedRender.subject}
          html={resolvedRender.html}
          height={520}
        />
      ) : null}
    </>
  );
}
