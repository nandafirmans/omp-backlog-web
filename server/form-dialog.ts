// OMP 19.1+ sends `ask` questions as `extension_ui_request` { method: 'form', html }.
// The dashboard never renders agent HTML: the form is reduced to plain fields here,
// and answers are checked against those fields before OMP validates them again.

export interface FormOption { value: string; label: string }
export type FormField =
  | { kind: 'choice'; name: string; label: string; multiple: boolean; options: FormOption[]; initial: string[] }
  | { kind: 'text'; name: string; label: string; multiline: boolean; initial: string };
export interface DialogForm { intro: string[]; fields: FormField[] }

const TEXT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);
const IGNORED_TYPES = new Set(['hidden', 'submit', 'button', 'reset']);
const MAX_FIELDS = 50;
const MAX_TEXT = 64_000;

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[lower] ?? entity;
  });
}
const clean = (text: string) => decode(text).replace(/\s+/g, ' ').trim();

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    result.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return result;
}

/** Reduce an OMP form to plain fields. Returns null when it holds anything the dashboard cannot show faithfully. */
export function parseDialogForm(html: string): DialogForm | null {
  if (typeof html !== 'string' || html.length > 512_000) return null;
  const intro: string[] = [];
  const fields: FormField[] = [];
  const choices = new Map<string, Extract<FormField, { kind: 'choice' }>>();
  let legend = '';
  let text = '';
  // Open label/option/textarea/select capture their text; inputs inside a label take the label's text.
  let label: { text: string; pending: { kind: 'choice' | 'text'; name: string; value: string; checked: boolean; multiple: boolean }[] } | null = null;
  let capture: 'legend' | 'option' | 'textarea' | null = null;
  let select: { name: string; label: string; multiple: boolean; options: FormOption[]; initial: string[] } | null = null;
  let option: { value: string | undefined; selected: boolean; text: string } | null = null;
  let textarea: { name: string; text: string } | null = null;

  const flush = () => { const value = clean(text); if (value) intro.push(value); text = ''; };
  const choiceField = (name: string, groupLabel: string, multiple: boolean) => {
    let field = choices.get(name);
    if (!field) {
      field = { kind: 'choice', name, label: groupLabel, multiple, options: [], initial: [] };
      choices.set(name, field);
      fields.push(field);
    }
    return field;
  };

  for (const match of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g)) {
    if (match[0].startsWith('<!--')) continue;
    const content = match[4];
    if (content !== undefined) {
      if (option) option.text += content;
      else if (textarea) textarea.text += content;
      else if (capture === 'legend') legend += content;
      else if (label) label.text += content;
      else if (!select) text += content;
      continue;
    }
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    const attrs = attributes(match[3]);
    if (['script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'video', 'audio', 'canvas'].includes(tag)) return null;
    if (tag === 'legend') {
      if (closing) { capture = null; legend = clean(legend); } else { flush(); capture = 'legend'; legend = ''; }
    } else if (tag === 'fieldset') {
      if (!closing) flush();
      legend = '';
    } else if (tag === 'label') {
      if (closing && label) {
        const labelText = clean(label.text);
        for (const input of label.pending) {
          if (input.kind === 'choice') {
            const field = choiceField(input.name, legend, input.multiple);
            field.options.push({ value: input.value, label: labelText || input.value });
            if (input.checked) field.initial.push(input.value);
          } else fields.push({ kind: 'text', name: input.name, label: labelText || legend || input.name, multiline: false, initial: input.value });
        }
        label = null;
      } else if (!closing) { flush(); label = { text: '', pending: [] }; }
    } else if (tag === 'input' && !closing) {
      const type = (attrs.get('type') ?? '').toLowerCase();
      const name = attrs.get('name') ?? '';
      if (IGNORED_TYPES.has(type)) continue;
      if (!name || attrs.has('disabled')) return null;
      if (type === 'radio' || type === 'checkbox') {
        const value = attrs.get('value') ?? 'on';
        const input = { kind: 'choice' as const, name, value, checked: attrs.has('checked'), multiple: type === 'checkbox' };
        if (label) label.pending.push(input);
        else {
          const field = choiceField(name, legend, input.multiple);
          field.options.push({ value, label: value });
          if (input.checked) field.initial.push(value);
        }
      } else if (TEXT_TYPES.has(type)) {
        const input = { kind: 'text' as const, name, value: attrs.get('value') ?? '', checked: false, multiple: false };
        if (label) label.pending.push(input);
        else fields.push({ kind: 'text', name, label: legend || attrs.get('placeholder') || name, multiline: false, initial: input.value });
      } else return null;
    } else if (tag === 'select') {
      if (closing && select) {
        if (option) {
          const value = option.value ?? clean(option.text);
          select.options.push({ value, label: clean(option.text) || value });
          if (option.selected) select.initial.push(value);
          option = null;
        }
        if (!select.options.length) return null;
        fields.push({ kind: 'choice', name: select.name, label: select.label, multiple: select.multiple, options: select.options, initial: select.initial.length || select.multiple ? select.initial : [select.options[0].value] });
        select = null;
      } else if (!closing) {
        const name = attrs.get('name') ?? '';
        if (!name || attrs.has('disabled')) return null;
        const labelText = label ? clean(label.text) : '';
        if (label) label.text = '';
        select = { name, label: labelText || legend || name, multiple: attrs.has('multiple'), options: [], initial: [] };
      }
    } else if (tag === 'option' && select) {
      if (option) {
        const value = option.value ?? clean(option.text);
        select.options.push({ value, label: clean(option.text) || value });
        if (option.selected) select.initial.push(value);
        option = null;
      }
      if (!closing) option = { value: attrs.get('value'), selected: attrs.has('selected'), text: '' };
    } else if (tag === 'textarea') {
      if (closing && textarea) {
        const labelText = label ? clean(label.text) : '';
        if (label) label.text = '';
        fields.push({ kind: 'text', name: textarea.name, label: labelText || legend || textarea.name, multiline: true, initial: decode(textarea.text) });
        textarea = null;
      } else if (!closing) {
        const name = attrs.get('name') ?? '';
        if (!name || attrs.has('disabled')) return null;
        textarea = { name, text: '' };
      }
    } else if (['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'form'].includes(tag)) {
      if (!label && !select && !option && !textarea) flush();
    }
  }
  flush();
  if (!fields.length || fields.length > MAX_FIELDS || fields.some(field => field.kind === 'choice' && !field.options.length)) return null;
  return { intro, fields };
}

/** Check an operator answer against the parsed fields; OMP validates the same data again. */
export function formAnswer(form: DialogForm, data: unknown): Record<string, string | string[]> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Answer shape does not match this dialog');
  const result: Record<string, string | string[]> = {};
  const values = data as Record<string, unknown>;
  for (const key of Object.keys(values)) if (!form.fields.some(field => field.name === key)) throw new Error(`Unknown form field ${key}`);
  for (const field of form.fields) {
    if (!Object.hasOwn(values, field.name)) continue;
    const value = values[field.name];
    if (field.kind === 'text') {
      if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error(`${field.label}: enter text`);
      result[field.name] = value;
    } else if (field.multiple) {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !field.options.some(option => option.value === item))) throw new Error(`${field.label}: choose offered options`);
      result[field.name] = [...new Set(value as string[])];
    } else {
      if (typeof value !== 'string' || !field.options.some(option => option.value === value)) throw new Error(`${field.label || field.name}: choose an offered option`);
      result[field.name] = value;
    }
  }
  return result;
}
