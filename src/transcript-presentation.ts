import type { TranscriptEntry } from '../server/contracts';

type Presentation = { target: string; content: string; format: 'diff' | 'text'; source: 'output' | 'input' | 'none' };
type RecordValue = Record<string, unknown>;

export type DiffRow = { text: string; kind: 'add' | 'remove' | 'context' | 'meta'; lineNumber?: number; sign: '+' | '-' | ' ' | '' };

export function diffRows(text: string): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  return text.split(/\r?\n/).map((line): DiffRow => {
    const numbered = /^([ +-])\s*(\d+)\|(.*)$/.exec(line);
    if (numbered) {
      const sign = numbered[1] as '+' | '-' | ' ';
      return { text: numbered[3], kind: sign === '+' ? 'add' : sign === '-' ? 'remove' : 'context', lineNumber: Number(numbered[2]), sign };
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      return { text: line, kind: 'meta', sign: '' };
    }
    if (line.startsWith('-') && oldRemaining > 0) {
      oldRemaining--;
      return { text: line.slice(1), kind: 'remove', lineNumber: oldLine++, sign: '-' };
    }
    if (line.startsWith('+') && newRemaining > 0) {
      newRemaining--;
      return { text: line.slice(1), kind: 'add', lineNumber: newLine++, sign: '+' };
    }
    if (line.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
      oldRemaining--;
      newRemaining--;
      oldLine++;
      return { text: line.slice(1), kind: 'context', lineNumber: newLine++, sign: ' ' };
    }
    // Unnumbered changes still have a sign, but no invented source position.
    if (/^[+-]/.test(line) && !/^(?:---|\+\+\+)/.test(line)) {
      return { text: line.slice(1), kind: line[0] === '+' ? 'add' : 'remove', sign: line[0] as '+' | '-' };
    }
    if (line.startsWith(' ')) return { text: line.slice(1), kind: 'context', sign: ' ' };
    return { text: line, kind: 'meta', sign: '' };
  });
}

// Keep line breaks and tabs, but never terminal cursor commands or OSC links.
/* eslint-disable no-control-regex -- Removing terminal control bytes intentionally. */
function plain(text: string): string {
  return text.replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\|\x9c)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}
/* eslint-enable no-control-regex */

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
}

// Recover complete recorded JSON string tokens only; never close an unfinished
// string or guess missing payload. The full sanitized record stays separately available.
function partialEnvelope(value: string): string {
  if (!/"(?:content|displayContent)"\s*:\s*[[{]/.test(value)) return '';
  const parts: string[] = [];
  for (const match of value.matchAll(/"text"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    try { parts.push(JSON.parse(match[1]) as string); } catch { /* Not a complete JSON token. */ }
  }
  return [...new Set(parts)].join('\n');
}

function text(value: unknown, depth = 0): string {
  if (depth > 12) return '';
  if (typeof value === 'string') {
    const decoded = parsed(value);
    if (decoded && typeof decoded === 'object') return text(decoded, depth + 1) || plain(JSON.stringify(decoded, null, 2));
    if (typeof decoded === 'string') {
      const recovered = decoded === value ? partialEnvelope(value) : '';
      return recovered ? `${text(recovered, depth + 1)}\n[Partial preview: recovered complete text blocks from truncated recorded output.]` : plain(decoded);
    }
    return plain(value);
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => text(item, depth + 1)).filter(part => part.trim()).join('\n');
  const item = record(value);
  if (!item) return '';
  // Image references are not fetched or interpreted as HTML.
  if (item.type === 'image' || item.type === 'image_url') return typeof item.text === 'string' ? plain(item.text) : '';
  if (item.type === 'text' || Object.keys(item).length === 1 && typeof item.text === 'string') return text(item.text, depth + 1);
  const envelopeKeys = ['content', 'stdout', 'stderr', 'output', 'result', 'message', 'error'];
  // Application JSON (including url/text and nested scalar fields) is data:
  // pretty-print it intact rather than mistaking its fields for tool metadata.
  if (!envelopeKeys.some(key => key in item)) {
    const display = record(record(item.details)?.displayContent);
    return display ? text(display, depth + 1) : plain(JSON.stringify(item, null, 2));
  }
  const parts = envelopeKeys.flatMap(key => item[key] === undefined ? [] : [text(item[key], depth + 1)])
    .filter(part => part.trim());
  if (parts.length) return [...new Set(parts)].join('\n');
  return typeof item.text === 'string' ? text(item.text, depth + 1) : '';
}

function diff(value: unknown, depth = 0): string {
  if (depth > 12) return '';
  const decoded = parsed(value);
  if (decoded !== value) return diff(decoded, depth + 1);
  if (typeof value === 'string') {
    const recovered: string[] = [];
    for (const match of value.matchAll(/"(diff|text)"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
      try {
        const token = JSON.parse(match[2]) as string;
        const candidate = match[1] === 'diff' ? plain(token) : diff(token, depth + 1);
        if (candidate.trim()) recovered.push(candidate);
      } catch { /* Never repair incomplete or invalid JSON string tokens. */ }
    }
    return [...new Set(recovered)].join('\n');
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => diff(item, depth + 1)).filter(Boolean).join('\n');
  const item = record(value);
  if (!item) return '';
  const details = record(item.details);
  for (const candidate of [details?.diff, item.diff]) {
    if (typeof candidate === 'string' && candidate.trim()) return plain(candidate);
  }
  return Object.values(item).slice(0, 100).map(child => diff(child, depth + 1)).filter(Boolean).join('\n');
}

function targets(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  const decoded = parsed(value);
  if (decoded !== value) return targets(decoded, depth + 1);
  if (typeof value === 'string') {
    return [...value.matchAll(/^(?:\[([^\r\n#]+)#[\da-fA-F]{4}\]|\*\*\* (?:Update|Add|Delete) File: (.+))\r?$/gm)]
      .map(match => match[1] || match[2]);
  }
  if (Array.isArray(value)) return value.slice(0, 100).flatMap(item => targets(item, depth + 1));
  const item = record(value);
  if (!item) return [];
  const direct = ['command', 'path', 'file_path', 'filePath', 'filename', 'paths'].flatMap(key => {
    const field = item[key];
    return typeof field === 'string' ? [field] : Array.isArray(field) ? field.filter((part): part is string => typeof part === 'string') : [];
  });
  return [...direct, ...['patch', 'input', 'tool_uses', 'parameters', 'arguments', 'args'].flatMap(key => targets(item[key], depth + 1))];
}

function proposed(value: unknown): string {
  if (typeof value === 'string') return plain(value);
  const item = record(value);
  if (!item) return '';
  for (const key of ['patch', 'content', 'input']) {
    if (typeof item[key] === 'string' && item[key].trim()) return plain(item[key]);
  }
  return '';
}

export function toolPresentation(entry: TranscriptEntry): Presentation {
  const input = parsed(entry.input);
  const output = parsed(entry.output);
  const target = [...new Set(targets(input).map(part => plain(part).replace(/\s+/g, ' ').trim()).filter(Boolean))].join(', ');
  const recordedDiff = entry.diff?.trim() ? plain(entry.diff) : diff(output);
  const inputContent = entry.state !== 'error' && /(?:^|[._])write$/.test(entry.toolName ?? '') ? proposed(input) : '';
  const outputContent = text(output);
  const fallback = output && typeof output === 'object' ? plain(JSON.stringify(output, null, 2)) : entry.output?.trim() ? plain(entry.output) : '';
  let content = recordedDiff || inputContent || (outputContent.trim() ? outputContent : '') || fallback;
  // A selected diff/input must not hide retention notices from its recorded envelope.
  const notices = [entry.diff?.trim() ? entry.diff : entry.output, inputContent ? entry.input : ''].join('\n').match(/\[Truncated[^\]\r\n]*\]/g) ?? [];
  for (const notice of notices) if (!content.includes(notice)) content += `${content ? '\n' : ''}${notice}`;
  const source = recordedDiff ? 'output' : inputContent ? 'input' : content ? 'output' : 'none';
  return { target: target.length > 240 ? `${target.slice(0, 239)}…` : target, content,
    format: recordedDiff ? 'diff' : 'text', source };
}
