// The app's single visual source of truth: one accent, neutral grays, subtle
// radius, thin borders and light shadows. Components pick these up through
// defaultProps so pages never hard-code a look — which is also what keeps dark
// mode correct, since every color here resolves through Mantine's CSS variables.
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  NavLink,
  Paper,
  Select,
  Table,
  TextInput,
  Textarea,
  Tooltip,
  createTheme,
  type MantineColorsTuple,
} from "@mantine/core";

// A refined indigo leaning slightly toward violet. Index 6 is the filled shade
// in light mode; dark mode uses 8 via `primaryShade`.
const accent: MantineColorsTuple = [
  "#eef0ff",
  "#dcdefc",
  "#b6b9f3",
  "#8d92eb",
  "#6b70e4",
  "#555ae0",
  "#4a4edf",
  "#3b3fc6",
  "#3337b2",
  "#282c9e",
];

const FONT_STACK =
  "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: "accent",
  primaryShade: { light: 6, dark: 7 },
  colors: { accent },
  fontFamily: FONT_STACK,
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace",
  headings: {
    fontFamily: FONT_STACK,
    fontWeight: "600",
  },
  defaultRadius: "md",
  cursorType: "pointer",
  shadows: {
    xs: "0 1px 2px rgba(15, 23, 42, 0.04)",
    sm: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
    md: "0 4px 12px rgba(15, 23, 42, 0.08)",
  },
  components: {
    Button: Button.extend({ defaultProps: { radius: "md" } }),
    Card: Card.extend({ defaultProps: { withBorder: true, shadow: "xs" } }),
    Paper: Paper.extend({ defaultProps: { radius: "md" } }),
    Badge: Badge.extend({ defaultProps: { variant: "light", radius: "sm" } }),
    Alert: Alert.extend({ defaultProps: { variant: "light", radius: "md" } }),
    TextInput: TextInput.extend({ defaultProps: { radius: "md" } }),
    Textarea: Textarea.extend({ defaultProps: { radius: "md" } }),
    Select: Select.extend({ defaultProps: { radius: "md" } }),
    Modal: Modal.extend({ defaultProps: { radius: "md", overlayProps: { blur: 2 } } }),
    Tooltip: Tooltip.extend({ defaultProps: { radius: "sm" } }),
    NavLink: NavLink.extend({ defaultProps: { variant: "light" } }),
    Table: Table.extend({ defaultProps: { verticalSpacing: "sm" } }),
  },
});
