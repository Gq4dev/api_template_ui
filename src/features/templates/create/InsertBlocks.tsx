import { Button, Group, Menu, Text, Tooltip } from "@mantine/core";
import { BLOCK_SNIPPETS, variableSnippet } from "./blockSnippets";

interface InsertBlocksProps {
  /** Variables this action provides, for the Variable menu. Empty until the catalogue loads. */
  variables: string[];
  disabled?: boolean;
  /** Called with the text to splice in at the caret. */
  onInsert: (snippet: string) => void;
}

/**
 * Buttons that drop a correctly-styled block into the HTML body at the caret.
 *
 * Deliberately an INSERTER, not a builder. The textarea stays the source of
 * truth, so the author keeps every escape hatch — hand-editing, {% for %},
 * anything the buttons do not cover — and nothing has to round-trip Jinja back
 * into UI state, which is where editors like this usually die.
 *
 * The variable menu matters more than it looks: a hand-typed {{ costumer_name }}
 * renders empty and says nothing, because the engine treats undefined as blank
 * by design. Picking from the action's own catalogue removes that class of bug
 * rather than asking people to proofread.
 */
export function InsertBlocks({ variables, disabled, onInsert }: InsertBlocksProps) {
  return (
    <Group gap="xs" align="center" wrap="wrap">
      <Text size="xs" c="dimmed">
        Insertar:
      </Text>

      {BLOCK_SNIPPETS.map((snippet) => (
        <Tooltip key={snippet.id} label={snippet.hint} withArrow multiline w={260}>
          <Button
            size="compact-xs"
            variant="default"
            disabled={disabled}
            onClick={() => onInsert(snippet.text)}
          >
            {snippet.label}
          </Button>
        </Tooltip>
      ))}

      <Menu shadow="md" width={240} position="bottom-start">
        <Menu.Target>
          <Button
            size="compact-xs"
            variant="default"
            disabled={disabled || variables.length === 0}
          >
            Variable ▾
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Variables de esta acción</Menu.Label>
          {variables.map((name) => (
            <Menu.Item
              key={name}
              onClick={() => onInsert(variableSnippet(name))}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            >
              {name}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
