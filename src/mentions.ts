interface Mention { kind: 'skill' | 'file'; query: string; from: number; to: number }

/** Positions are relative to one line; replace the whole mention, including its prefix. */
export function mentionAt(line: string, cursor: number): Mention | null {
  const match = /(?:^|[\s([{>])((?:\/skill:([A-Za-z0-9._/-]*))|@(?:"((?:[^"\\]|\\.)*)|([^\s@"<>()[\]{},;]*)))$/.exec(line.slice(0, cursor));
  if (!match) return null;
  const kind = match[2] !== undefined ? 'skill' : 'file';
  const quoted = match[3] !== undefined;
  const query = match[2] ?? (quoted ? match[3].replace(/\\(["\\])/g, '$1') : match[4]);
  const suffix = line.slice(cursor).match(kind === 'skill' ? /^[A-Za-z0-9._/-]*/ : quoted ? /^(?:[^"\\]|\\.)*"?/ : /^[^\s@"<>()[\]{},;]*/)?.[0] ?? '';
  return { kind, query, from: cursor - match[1].length, to: cursor + suffix.length };
}
