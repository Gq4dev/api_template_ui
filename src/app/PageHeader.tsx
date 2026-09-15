import type { ReactNode } from "react";
import { Box, Group, Text, Title } from "@mantine/core";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary action(s), rendered on the right. */
  actions?: ReactNode;
}

// The one page header every screen uses, so title, description and the primary
// action always sit in the same place.
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" gap="md" mb="lg" wrap="wrap">
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Title order={2} fz={26} lh={1.25}>
          {title}
        </Title>
        {description ? (
          <Text c="dimmed" size="sm" mt={4}>
            {description}
          </Text>
        ) : null}
      </Box>
      {actions ? <Group gap="sm">{actions}</Group> : null}
    </Group>
  );
}
