import { Outlet, Link, matchPath, useLocation } from "react-router-dom";
import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconLayoutList,
  IconMail,
  IconMoon,
  IconPlus,
  IconSun,
  IconTable,
} from "@tabler/icons-react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof IconMail;
  /** Extra route patterns that should light this item up. */
  alsoActiveOn?: string[];
}

// Primary work happens in Templates and Crear. The legacy table stays reachable
// as a secondary item until the browse view covers everything it does.
const PRIMARY_NAV: NavItem[] = [
  {
    to: "/",
    label: "Templates",
    icon: IconLayoutList,
    alsoActiveOn: ["/templates/:templateKey/versions/:version/edit"],
  },
  { to: "/create", label: "Crear", icon: IconPlus },
];

const SECONDARY_NAV: NavItem[] = [
  { to: "/list", label: "Listado", icon: IconTable },
];

function isActive(item: NavItem, pathname: string): boolean {
  const patterns = [item.to, ...(item.alsoActiveOn ?? [])];
  return patterns.some((pattern) => matchPath({ path: pattern, end: true }, pathname) !== null);
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  // Computed, not raw: the stored value can be "auto", and the icon has to show
  // what is actually on screen.
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const next = computed === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";

  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={label}
        onClick={() => setColorScheme(next)}
      >
        {computed === "dark" ? <IconSun size={18} stroke={1.6} /> : <IconMoon size={18} stroke={1.6} />}
      </ActionIcon>
    </Tooltip>
  );
}

function Brand() {
  return (
    <Group gap="sm" wrap="nowrap">
      <ThemeIcon size="md" radius="md" variant="filled">
        <IconMail size={16} stroke={1.8} />
      </ThemeIcon>
      <Box>
        <Text fw={600} size="sm" lh={1.2}>
          Templates
        </Text>
        <Text size="xs" c="dimmed" lh={1.2}>
          Notificaciones
        </Text>
      </Box>
    </Group>
  );
}

/**
 * The application shell: fixed left navbar on desktop, a burger-driven drawer
 * on mobile. Pages render inside the main area through <Outlet/> and bring only
 * their own content — no page owns navigation or an outer container any more.
 */
export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const { pathname } = useLocation();

  function renderItem(item: NavItem) {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        component={Link}
        to={item.to}
        label={item.label}
        leftSection={<Icon size={18} stroke={1.6} />}
        active={isActive(item, pathname)}
        onClick={close}
      />
    );
  }

  return (
    <AppShell
      header={{ height: { base: 56, sm: 0 } }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding={{ base: "md", sm: "xl" }}
    >
      {/* Mobile only: on desktop the navbar carries the brand and the toggle. */}
      <AppShell.Header hiddenFrom="sm" px="md">
        <Group h="100%" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} size="sm" aria-label="Abrir navegación" />
            <Brand />
          </Group>
          <ColorSchemeToggle />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <AppShell.Section visibleFrom="sm" mb="lg">
          <Brand />
        </AppShell.Section>

        <AppShell.Section grow>
          <Stack gap={4}>{PRIMARY_NAV.map(renderItem)}</Stack>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase" mt="lg" mb={6} px="sm">
            Otros
          </Text>
          <Stack gap={4}>{SECONDARY_NAV.map(renderItem)}</Stack>
        </AppShell.Section>

        <AppShell.Section visibleFrom="sm">
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Apariencia
            </Text>
            <ColorSchemeToggle />
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1400} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
