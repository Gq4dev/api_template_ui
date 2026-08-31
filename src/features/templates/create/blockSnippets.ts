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

/**
 * The brand palette, as the bundled templates actually use it.
 *
 * A free colour picker would be worse than no picker: it invites an author to
 * pick a purple that is almost #1E1248, and nothing in the pipeline would ever
 * flag it. These are the values already in the platform's own templates.
 */
export const BRAND_COLORS = [
  { value: "#1E1248", label: "Violeta (títulos)" },
  { value: "#565856", label: "Gris (texto)" },
  { value: "#E50051", label: "Rosa (acciones)" },
  { value: "#8a8a8a", label: "Gris claro (secundario)" },
  { value: "#ffffff", label: "Blanco (sobre fondo)" },
] as const;

export const ALIGNMENTS = [
  { value: "left", label: "Izquierda" },
  { value: "center", label: "Centro" },
  { value: "right", label: "Derecha" },
] as const;

/** `<strong>`, not `<b>`: it carries emphasis, and mail clients render both. */
export const BOLD_WRAP = { open: "<strong>", close: "</strong>" } as const;

export function colorWrap(hex: string) {
  return { open: `<span style="color:${hex};">`, close: "</span>" };
}

/**
 * Alignment is a BLOCK property, so it wraps in a div rather than a span.
 * `text-align` on an inline element does nothing, and an author who applied
 * "centrar" and saw no change would reasonably conclude the tool is broken.
 */
export function alignWrap(alignment: string) {
  return { open: `<div style="text-align:${alignment};">`, close: "</div>" };
}

/** An <img> with the attributes mail clients need. */
export function imageSnippet(path: string, alt = ""): string {
  return (
    `<img src="{{ resources_base_url }}/${path}" alt="${alt}"\n` +
    `     style="display:block;border:0;max-width:100%;margin:0 auto;" />`
  );
}

/**
 * Wraps the selection in `open`/`close`, or drops the pair around `placeholder`
 * when nothing is selected.
 *
 * Returns a range rather than a caret: with a selection the author is done and
 * wants the cursor after it, but with none, the placeholder is the thing they
 * are about to overwrite, so selecting it means the next keystroke replaces it.
 */
export function wrapSelection(
  text: string,
  open: string,
  close: string,
  selectionStart: number,
  selectionEnd: number,
  placeholder = "texto",
): { text: string; selectionStart: number; selectionEnd: number } {
  const start = clamp(selectionStart, 0, text.length);
  const end = clamp(Math.max(selectionEnd, start), 0, text.length);

  const selected = text.slice(start, end);
  const inner = selected.length > 0 ? selected : placeholder;
  const wrapped = `${open}${inner}${close}`;

  const next = `${text.slice(0, start)}${wrapped}${text.slice(end)}`;
  const innerStart = start + open.length;

  return selected.length > 0
    ? { text: next, selectionStart: start + wrapped.length, selectionEnd: start + wrapped.length }
    : { text: next, selectionStart: innerStart, selectionEnd: innerStart + inner.length };
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
