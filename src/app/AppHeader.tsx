import { Anchor, Group } from "@mantine/core";
import { Link } from "react-router-dom";

// Minimal top nav shared by every page. Kept dependency-light — just two links.
export function AppHeader() {
  return (
    <Group gap="lg" mb="lg">
      <Anchor component={Link} to="/" fw={600}>
        Templates
      </Anchor>
      <Anchor component={Link} to="/create">
        Create
      </Anchor>
    </Group>
  );
}
