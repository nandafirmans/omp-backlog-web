import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutterLineClass, lineNumbers } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import type { Language } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import { diffRows, sourceRows } from './transcript-presentation';
import type { DiffRow } from './transcript-presentation';

type Token = { text: string; className?: string };
export const transcriptHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], class: 'transcript-syntax-keyword' },
  { tag: [tags.string, tags.regexp, tags.attributeValue], class: 'transcript-syntax-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'transcript-syntax-number' },
  { tag: [tags.comment, tags.meta], class: 'transcript-syntax-comment' },
  { tag: [tags.typeName, tags.className, tags.tagName, tags.propertyName, tags.attributeName], class: 'transcript-syntax-name' },
  { tag: [tags.heading, tags.strong], class: 'transcript-syntax-heading' },
  { tag: [tags.link, tags.url], class: 'transcript-syntax-link' },
  { tag: tags.monospace, class: 'transcript-syntax-string' },
]);

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface-inset, var(--surface-elevated))', border: '1px solid var(--line)', fontSize: '13px' },
  '&.cm-focused': { outline: '2px solid var(--accent)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', scrollbarWidth: 'thin', scrollbarColor: 'var(--line) transparent' },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--line)' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '4ch', padding: '0 10px 0 12px' },
  '.cm-content ::selection, .cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-transcript-add': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
  '.cm-transcript-remove': { backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' },
  '.cm-transcript-meta': { color: 'var(--muted)' },
  '.cm-gutterElement.cm-transcript-add': { color: 'var(--accent)' },
  '.cm-gutterElement.cm-transcript-remove': { color: 'var(--danger)' },
});

class RowMarker extends GutterMarker {
  constructor(readonly elementClass: string) { super(); }
}
const rowClass = { add: 'cm-transcript-add', remove: 'cm-transcript-remove', meta: 'cm-transcript-meta' } as const;
const failedLoads = new Set<LanguageDescription>();

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
    highlightCode(source, language.parser.parse(source), transcriptHighlighter,
      (text, className) => lines[lines.length - 1].push({ text, className: className || undefined }),
      () => { lines.push([]); });
    indices.forEach((index, position) => {
      if (version === 'new' || rows[index].kind === 'remove') result[index] = lines[position] ?? [{ text: rows[index].text }];
    });
  }
  return result;
}

function describe(hint: string) {
  return hint ? LanguageDescription.matchLanguageName(languages, hint, false)
    ?? LanguageDescription.matchFilename(languages, hint.replace(/:\d.*$/, '')) : null;
}

function sections(rows: DiffRow[], text: string, languageHint: string) {
  const groups: { rows: DiffRow[]; description: LanguageDescription | null }[] = [];
  let hint = languageHint.split(', ')[0];
  if (!hint && /^[{[]/.test(text.trim())) {
    try { JSON.parse(text); hint = 'json'; } catch { /* Partial/ordinary output stays plain text. */ }
  }
  for (const row of rows) {
    if (row.kind === 'meta') {
      const filename = /^(?:\+\+\+ |--- )(?:[ab]\/)?(.+?)(?:\t.*)?$/.exec(row.text)?.[1];
      if (filename && filename !== '/dev/null') hint = filename;
      groups.push({ rows: [row], description: null });
    } else {
      const description = describe(hint);
      const last = groups.at(-1);
      if (last && last.rows[0].kind !== 'meta' && last.description === description) last.rows.push(row);
      else groups.push({ rows: [row], description });
    }
  }
  return groups;
}

/** Read-only CodeMirror view of recorded tool content. Never editable. */
export default memo(function TranscriptCode({ text, diff = false, preview = false, languageHint = '' }: { text: string; diff?: boolean; preview?: boolean; languageHint?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const groups = useMemo(() => {
    const allRows = diff ? diffRows(text) : sourceRows(text);
    return sections(preview ? allRows.slice(0, 8) : allRows, text, languageHint);
  }, [text, diff, preview, languageHint]);
  const pending = useMemo(() => [...new Set(groups.flatMap(group => group.description && !group.description.support && !failedLoads.has(group.description) ? [group.description] : []))], [groups]);

  useEffect(() => {
    if (!pending.length) return;
    let current = true;
    // Plain source stays readable if a lazy grammar chunk cannot be fetched.
    void Promise.all(pending.map(description => description.load().catch(() => { failedLoads.add(description); })))
      .then(() => { if (current) setLoadVersion(version => version + 1); });
    return () => { current = false; };
  }, [pending]);

  const descriptions = groups.flatMap(group => group.description ? [group.description] : []);
  const failed = descriptions.some(description => failedLoads.has(description));
  const state = failed ? 'unavailable' : pending.length ? 'loading' : descriptions.length ? 'ready' : 'plain';

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const rows = groups.flatMap(group => group.rows);
    const tokens = groups.flatMap(group => tokenLines(group.rows, group.description?.support?.language ?? null));
    const doc = rows.map(row => row.text).join('\n');
    const labels = rows.map(row => `${row.sign.trim()}${row.lineNumber ?? ''}`);

    const marks = new RangeSetBuilder<Decoration>();
    const gutterMarks = new RangeSetBuilder<GutterMarker>();
    let position = 0;
    rows.forEach((row, index) => {
      if (row.kind !== 'context') {
        marks.add(position, position, Decoration.line({ class: rowClass[row.kind] }));
        gutterMarks.add(position, position, new RowMarker(rowClass[row.kind]));
      }
      for (const token of tokens[index]) {
        if (token.className && token.text) marks.add(position, position + token.text.length, Decoration.mark({ class: token.className }));
        position += token.text.length;
      }
      position += 1;
    });

    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.contentAttributes.of(preview ? { 'aria-hidden': 'true' } : { tabindex: '0', 'aria-label': 'Recorded tool content' }),
      lineNumbers({ formatNumber: line => labels[line - 1] ?? '' }),
      gutterLineClass.of(gutterMarks.finish()),
      EditorView.decorations.of(marks.finish()),
      preview ? [] : EditorView.lineWrapping,
      theme,
    ] }) });
    return () => view.destroy();
  }, [groups, preview, loadVersion]);

  return <div ref={host} className={`run-transcript-code${diff ? ' run-transcript-diff' : ''}${preview ? ' run-transcript-code-preview' : ''}`}
    data-highlight-state={state} title={failed ? 'Syntax highlighting unavailable; showing plain source.' : undefined} />;
});
