import { memo, useEffect, useMemo, useState } from 'react';
import { LanguageDescription } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import { diffRows } from './transcript-presentation';
import type { DiffRow } from './transcript-presentation';

type Token = { text: string; className?: string };
const highlighter = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: 'transcript-syntax-keyword' },
  { tag: [tags.string, tags.regexp, tags.attributeValue], class: 'transcript-syntax-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'transcript-syntax-number' },
  { tag: [tags.comment, tags.meta], class: 'transcript-syntax-comment' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.propertyName, tags.attributeName], class: 'transcript-syntax-name' },
  { tag: [tags.heading, tags.strong], class: 'transcript-syntax-heading' },
  { tag: [tags.link, tags.url], class: 'transcript-syntax-link' },
  { tag: tags.monospace, class: 'transcript-syntax-string' },
]);

function tokenLines(rows: DiffRow[], language: Language | null): Token[][] {
  const result = rows.map(row => [{ text: row.text }]);
  if (!language) return result;
  // Parse old/new fragments separately: removed text cannot open a string or
  // comment that incorrectly colors the added version (or vice versa).
  for (const version of ['old', 'new'] as const) {
    const indices = rows.flatMap((row, index) => row.kind === 'meta' || row.kind === (version === 'old' ? 'add' : 'remove') ? [] : [index]);
    if (!indices.length) continue;
    const source = indices.map(index => rows[index].text).join('\n');
    const lines: Token[][] = [[]];
    highlightCode(source, language.parser.parse(source), highlighter,
      (text, className) => lines[lines.length - 1].push({ text, className: className || undefined }),
      () => { lines.push([]); });
    indices.forEach((index, position) => {
      if (version === 'new' || rows[index].kind === 'remove') result[index] = lines[position] ?? [{ text: rows[index].text }];
    });
  }
  return result;
}

function CodeRows({ rows, languageHint }: { rows: DiffRow[]; languageHint: string }) {
  const description = LanguageDescription.matchLanguageName(languages, languageHint, false)
    ?? LanguageDescription.matchFilename(languages, languageHint.replace(/:\d.*$/, ''));
  const [loaded, setLoaded] = useState<{ description: LanguageDescription; language: Language | null } | null>(null);
  useEffect(() => {
    if (!description) return;
    let current = true;
    void description.load().then(support => {
      if (current) setLoaded({ description, language: support.language });
    }, () => {
      // The source remains readable if a lazy grammar chunk cannot be fetched.
      if (current) setLoaded({ description, language: null });
    });
    return () => { current = false; };
  }, [description]);
  const language = loaded?.description === description ? loaded?.language ?? null : null;
  const tokens = useMemo(() => tokenLines(rows, language), [rows, language]);
  const failed = !!description && loaded?.description === description && !loaded.language;
  return <span className="run-transcript-code-rows" data-highlight-state={failed ? 'unavailable' : language ? 'ready' : description ? 'loading' : 'plain'} title={failed ? 'Syntax highlighting unavailable; showing plain source.' : undefined}>
    {rows.map((row, index) => <span key={index} className={`run-transcript-code-line diff-${row.kind}`}>
      <span className="run-transcript-line-number"><span className="run-transcript-diff-sign">{row.sign}</span>{row.lineNumber ?? ''}</span>
      <span className="run-transcript-source">{tokens[index].map((token, part) => <span key={part} className={token.className}>{token.text}</span>)}</span>
    </span>)}
  </span>;
}

export default memo(function TranscriptCode({ text, diff = false, preview = false, languageHint = '' }: { text: string; diff?: boolean; preview?: boolean; languageHint?: string }) {
  const sections = useMemo(() => {
    const allRows: DiffRow[] = diff ? diffRows(text) : text.split('\n').map((line, index) => ({ text: line, lineNumber: index + 1, kind: 'context', sign: '' }));
    const rows = preview ? allRows.slice(0, 8) : allRows;
    const groups: { rows: DiffRow[]; languageHint: string }[] = [];
    let hint = languageHint.split(', ')[0];
    if (!hint && /^[{[]/.test(text.trim())) {
      try { JSON.parse(text); hint = 'json'; } catch { /* Partial/ordinary output stays plain text. */ }
    }
    for (const row of rows) {
      if (row.kind === 'meta') {
        const filename = /^(?:\+\+\+ |--- )(?:[ab]\/)?(.+?)(?:\t.*)?$/.exec(row.text)?.[1];
        if (filename && filename !== '/dev/null') hint = filename;
        groups.push({ rows: [row], languageHint: '' });
      } else {
        const last = groups.at(-1);
        if (last && last.rows[0].kind !== 'meta' && last.languageHint === hint) last.rows.push(row);
        else groups.push({ rows: [row], languageHint: hint });
      }
    }
    return groups;
  }, [text, diff, preview, languageHint]);
  return <pre className={`run-transcript-code${diff ? ' run-transcript-diff' : ''}`} tabIndex={preview ? -1 : 0} aria-label={preview ? 'Tool preview' : 'Recorded tool content'}><code>{sections.map((section, index) => <CodeRows key={index} rows={section.rows} languageHint={section.languageHint} />)}</code></pre>;
});
