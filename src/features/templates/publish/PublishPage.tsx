import { Container, Text, Title } from "@mantine/core";
import { useParams } from "react-router-dom";

// Placeholder — the real publish flow lands in PR 4.
export function PublishPage() {
  const { templateKey, version } = useParams<{
    templateKey: string;
    version: string;
  }>();

  return (
    <Container size="sm" py="xl">
      <Title order={2}>Publish template</Title>
      <Text c="dimmed" mt="sm">
        {templateKey} v{version} — coming soon (PR 4).
      </Text>
    </Container>
  );
}
