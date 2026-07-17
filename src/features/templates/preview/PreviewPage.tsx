import { Container, Text, Title } from "@mantine/core";
import { useParams } from "react-router-dom";

// Placeholder — the real preview flow (bindings editor + live render) lands in PR 3.
export function PreviewPage() {
  const { templateKey, version } = useParams<{
    templateKey: string;
    version: string;
  }>();

  return (
    <Container size="sm" py="xl">
      <Title order={2}>Preview template</Title>
      <Text c="dimmed" mt="sm">
        {templateKey} v{version} — coming soon (PR 3).
      </Text>
    </Container>
  );
}
