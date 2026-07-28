import { Badge, Group, Paper, Stack, Text } from "@mantine/core";

interface RenderedEmailProps {
  subject: string | null;
  html: string;
  height?: number;
}

// The rendered mail, shown the way a recipient would see it. Shared by the
// create form's live preview and the list's per-version preview so both are
// sandboxed identically — a second copy of this would eventually get one of
// the sandbox flags wrong.
export function RenderedEmail({ subject, html, height = 480 }: RenderedEmailProps) {
  return (
    <Stack gap="xs">
      <Group gap="xs" align="center">
        <Badge variant="light">Subject</Badge>
        <Text size="sm">{subject ?? "(no subject)"}</Text>
      </Group>
      <Paper withBorder radius="sm" p={0} style={{ overflow: "hidden" }}>
        {/*
          srcDoc with a fully restrictive sandbox. This HTML was typed by
          someone else and renders on our own origin, so it gets NO script
          execution, NO same-origin access, NO form submission and NO top-level
          navigation. Mail clients run no scripts either, so nothing legitimate
          is lost — and a pasted <script> is inert here instead of in a session.
        */}
        <iframe
          title="Rendered email preview"
          srcDoc={html}
          sandbox=""
          style={{ width: "100%", height, border: 0, background: "#fff" }}
        />
      </Paper>
    </Stack>
  );
}
