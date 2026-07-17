import { Container, Text, Title } from "@mantine/core";

// Placeholder — the real create form lands in PR 2. This page exists so the route
// and providers can be exercised end-to-end in this scaffold PR.
export function CreatePage() {
  return (
    <Container size="sm" py="xl">
      <Title order={2}>Create template</Title>
      <Text c="dimmed" mt="sm">
        Coming soon (PR 2).
      </Text>
    </Container>
  );
}
