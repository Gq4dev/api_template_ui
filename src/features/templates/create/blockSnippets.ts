// The snippets the "Insert" buttons drop into the HTML body, and the pure
// text-splicing that puts them where the caret is.
//
// Kept away from React because the interesting failures here are all textual:
// an insert that swallows the character before it, one that lands glued to the
// previous tag, or a caret left somewhere the author did not ask for. Those are
// cheap to test directly and miserable to chase through a DOM.
//
// Every snippet carries its styling INLINE. Mail clients discard the CSS in the
// head, so a rule that is not on the element does not exist — an "insert title"
// button that produced a bare <h1> would be handing the author the exact bug
// this whole change is fixing.

export interface BlockSnippet {
  /** Stable id, used as the button's key and in tests. */
  id: string;
  /** Button label. */
  label: string;
  /** One line on what it inserts, for the tooltip. */
  hint: string;
  text: string;
}

const TEXT_STYLE = "font-family:Arial;font-size:13px;color:#565856;";

export const BLOCK_SNIPPETS: BlockSnippet[] = [
  {
    id: "title",
    label: "Título",
    hint: "Un encabezado centrado, en el violeta de la marca.",
    text: `<p style="font-family:Arial;font-size:18px;font-weight:bold;color:#1E1248;text-align:center;margin:0 0 12px;">
  Título del mail
</p>`,
  },
  {
    id: "paragraph",
    label: "Párrafo",
    hint: "Un bloque de texto corrido.",
    text: `<p style="${TEXT_STYLE}line-height:1.5;margin:0 0 10px;">
  Escribí el texto acá.
</p>`,
  },
  {
    id: "button",
    label: "Botón",
    hint: "Un enlace con aspecto de botón. En mail se hace con un <a> estilado, no con <button>.",
    text: `<a href="{{ link }}" target="_blank"
   style="display:inline-block;font-family:Arial;font-size:12px;background-color:#E50051;
          color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:3px;">
  VER COMPROBANTE
</a>`,
  },
  {
    id: "table",
    label: "Tabla",
    hint: "Dos columnas sobre fondo gris, para un detalle concepto/valor.",
    text: `<table align="center" cellpadding="0" cellspacing="0"
       style="margin:12px auto;background-color:#f4f4f2;border-radius:7px;padding:15px;">
  <tbody>
    <tr>
      <td style="${TEXT_STYLE}padding:6px 10px;text-align:left;">Concepto</td>
      <td style="font-family:Arial;font-size:15px;color:#1E1248;padding:6px 10px;text-align:right;">
        <strong>Valor</strong>
      </td>
    </tr>
  </tbody>
</table>`,
  },
  // The two snippets below are logic rather than layout. They are here because
  // they are what separates a real template from a static one, and because they
  // are the syntax nobody remembers.
  {
    id: "loop",
    label: "Repetir por pago",
    hint: "Un {% for %} sobre payments — hace que el mismo mail sirva para uno o varios pagos.",
    text: `{% for p in payments %}
  <p style="${TEXT_STYLE}margin:0 0 6px;">
    {{ p.currency_id }} {{ p.final_amount | format_amount }} — {{ p.paid_date | format_date }}
  </p>
{% endfor %}`,
  },
  {
    id: "condition",
    label: "Condicional",
    hint: "Un {% if %} para mostrar algo solo cuando el dato viene.",
    text: `{% if link %}
  <p style="${TEXT_STYLE}margin:0 0 6px;">Enlace: {{ link }}</p>
{% endif %}`,
  },
];

/** `{{ name }}`, the one thing an author should never hand-type. */
export function variableSnippet(name: string): string {
  return `{{ ${name} }}`;
}

export interface InsertResult {
  text: string;
  /** Where the caret belongs afterwards: at the end of what was inserted. */
  caret: number;
}

/**
 * Splices `snippet` into `text` at the caret, replacing any selection.
 *
 * Blank lines are added around it only where one is not already there, so
 * clicking twice does not open a growing gap and inserting at the very start or
 * end does not leave a stray newline. Indentation of the insertion point is
 * deliberately NOT copied: these snippets are multi-line, and re-indenting only
 * the first line of one produces a ragged block that looks like a mistake.
 */
export function insertSnippet(
  text: string,
  snippet: string,
  selectionStart: number,
  selectionEnd: number = selectionStart,
): InsertResult {
  const start = clamp(selectionStart, 0, text.length);
  const end = clamp(Math.max(selectionEnd, start), 0, text.length);

  const before = text.slice(0, start);
  const after = text.slice(end);

  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";

  const inserted = `${lead}${snippet}${trail}`;

  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + lead.length + snippet.length,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return max;
  return Math.min(Math.max(value, min), max);
}
