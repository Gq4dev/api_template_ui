import { Button, ColorSwatch, Group, Menu, Text, Tooltip } from "@mantine/core";
import {
  ALIGNMENTS,
  BOLD_WRAP,
  BRAND_COLORS,
  alignWrap,
  colorWrap,
  imageSnippet,
} from "./blockSnippets";
import { EMAIL_ASSETS } from "./emailAssets";

interface FormatToolbarProps {
  disabled?: boolean;
  /** Wraps the current selection (or a placeholder) in open/close. */
  onWrap: (open: string, close: string, placeholder?: string) => void;
  /** Splices a standalone snippet in at the caret. */
  onInsert: (snippet: string) => void;
}

/**
 * Formatting for the HTML body: bold, colour, alignment, and images.
 *
 * Everything here writes INLINE style attributes, because that is the only kind
 * of styling that survives a mail client. There is no stylesheet to put a class
 * in, so a toolbar that emitted `<b class="titulo">` would be producing markup
 * that renders as nothing.
 */
export function FormatToolbar({ disabled, onWrap, onInsert }: FormatToolbarProps) {
  return (
    <Group gap="xs" align="center" wrap="wrap">
      <Text size="xs" c="dimmed">
        Formato:
      </Text>

      <Tooltip label="Negrita sobre lo seleccionado" withArrow>
        <Button
          size="compact-xs"
          variant="default"
          disabled={disabled}
          onClick={() => onWrap(BOLD_WRAP.open, BOLD_WRAP.close)}
          fw={700}
        >
          N
        </Button>
      </Tooltip>

      <Menu shadow="md" width={220} position="bottom-start">
        <Menu.Target>
          <Button size="compact-xs" variant="default" disabled={disabled}>
            Color ▾
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Paleta de la marca</Menu.Label>
          {BRAND_COLORS.map((color) => (
            <Menu.Item
              key={color.value}
              leftSection={<ColorSwatch color={color.value} size={14} withShadow />}
              onClick={() => {
                const wrap = colorWrap(color.value);
                onWrap(wrap.open, wrap.close);
              }}
            >
              <Text size="xs">{color.label}</Text>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>

      <Menu shadow="md" width={180} position="bottom-start">
        <Menu.Target>
          <Button size="compact-xs" variant="default" disabled={disabled}>
            Alinear ▾
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {ALIGNMENTS.map((alignment) => (
            <Menu.Item
              key={alignment.value}
              onClick={() => {
                const wrap = alignWrap(alignment.value);
                onWrap(wrap.open, wrap.close, "contenido");
              }}
            >
              <Text size="xs">{alignment.label}</Text>
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>

      <Menu shadow="md" width={320} position="bottom-start">
        <Menu.Target>
          <Button size="compact-xs" variant="default" disabled={disabled}>
            Imagen ▾
          </Button>
        </Menu.Target>
        <Menu.Dropdown mah={420} style={{ overflowY: "auto" }}>
          {EMAIL_ASSETS.map((group) => [
            <Menu.Label key={`${group.label}-label`}>{group.label}</Menu.Label>,
            ...group.paths.map((path) => (
              <Menu.Item
                key={path}
                onClick={() => onInsert(imageSnippet(path))}
                style={{ fontFamily: "monospace", fontSize: 11 }}
              >
                {path.split("/").pop()}
              </Menu.Item>
            )),
          ])}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
