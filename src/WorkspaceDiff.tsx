import { useEffect, useRef, useState } from 'react';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import type { LanguageSupport } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { transcriptHighlighter } from './TranscriptCode';

interface Props { path: string; before: string; after: string; layout: 'split' | 'unified' }

const removed = 'color-mix(in srgb, var(--danger) 12%, transparent)';
const added = 'color-mix(in srgb, var(--accent) 12%, transparent)';
// Same specificity as @codemirror/merge's base theme but higher precedence: tokens replace its fixed palette and gradients.
const diffTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface-inset)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--line)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--accent-soft)' },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: removed },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: added },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': { background: 'color-mix(in srgb, var(--danger) 30%, transparent)', textDecoration: 'none' },
  '&.cm-merge-b .cm-changedText': { background: 'color-mix(in srgb, var(--accent) 30%, transparent)', textDecoration: 'none' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--danger)' },
  '&.cm-merge-b .cm-changedLineGutter, .cm-changedLineGutter': { background: 'var(--accent)' },
  '.cm-collapsedLines': { color: 'var(--muted)', background: 'var(--surface)', borderBlock: '1px solid var(--line)', fontFamily: 'var(--font-mono)', fontSize: '13px' },
});

function extensions(language: LanguageSupport | null): Extension[] {
  return [EditorState.readOnly.of(true), lineNumbers(), diffTheme, syntaxHighlighting(transcriptHighlighter), language ?? []];
}

/** Read-only HEAD vs working-tree view. Never edits the workspace. */
export default function WorkspaceDiff({ path, before, after, layout }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [language, setLanguage] = useState<{ path: string; support: LanguageSupport | null }>();
  const description = LanguageDescription.matchFilename(languages, path);

  useEffect(() => {
    if (!description) return;
    let current = true;
    void description.load().then(support => { if (current) setLanguage({ path, support }); },
      // Plain text stays readable if a lazy grammar chunk cannot be fetched.
      () => { if (current) setLanguage({ path, support: null }); });
    return () => { current = false; };
  }, [description, path]);
  const support = language?.path === path ? language.support : null;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const collapseUnchanged = { margin: 3, minSize: 6 };
    // A wholly added or deleted file is one big change; per-word marks would only add noise.
    const highlightChanges = !!before && !!after;
    if (layout === 'split') {
      const view = new MergeView({ parent, collapseUnchanged, highlightChanges, a: { doc: before, extensions: extensions(support) }, b: { doc: after, extensions: extensions(support) } });
      view.a.contentDOM.setAttribute('aria-label', `${path} before (HEAD)`);
      view.b.contentDOM.setAttribute('aria-label', `${path} after (working tree)`);
      return () => view.destroy();
    }
    const view = new EditorView({ parent, state: EditorState.create({ doc: after, extensions: [...extensions(support), unifiedMergeView({ original: before, mergeControls: false, collapseUnchanged, highlightChanges })] }) });
    view.contentDOM.setAttribute('aria-label', `${path} changes, HEAD to working tree`);
    return () => view.destroy();
  }, [path, before, after, layout, support]);

  return <div ref={host} className={`workspace-diff workspace-diff-${layout}`} />;
}
