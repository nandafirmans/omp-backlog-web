import { useEffect, useId, useRef, useState } from 'react';
import { Switch } from 'antd';
import { Annotation, Compartment, EditorState, Prec, Transaction } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { acceptCompletion, autocompletion, closeCompletion, completionStatus, moveCompletionSelection, startCompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { getCM, vim } from '@replit/codemirror-vim';
import { mentionAt } from './mentions';
import './MarkdownEditor.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  repoId: string;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
  disabled?: boolean;
  label?: string;
}
interface CompletionResponse {
  items: { label: string; value: string; description?: string }[];
  truncated: boolean;
}
const preferenceKey = 'omp-backlog.vim';
const externalChange = Annotation.define<boolean>();


/** Keep unaffected selections mapped rather than replacing the entire controlled document. */
function replacementChange(current: string, next: string) {
  let from = 0;
  while (from < current.length && from < next.length && current[from] === next[from]) from++;
  let to = current.length;
  let end = next.length;
  while (to > from && end > from && current[to - 1] === next[end - 1]) { to--; end--; }
  return { from, to, insert: next.slice(from, end) };
}

function storedVimPreference() {
  try { return localStorage.getItem(preferenceKey) === 'true'; }
  catch { return false; }
}

const editorTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface-inset, var(--surface))' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft, var(--surface-elevated))' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--accent-soft, #29483b)' },
  '.cm-tooltip': { color: 'var(--text)', backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--line)', borderRadius: '2px', fontFamily: 'inherit' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--surface)', backgroundColor: 'var(--accent)' },
  '.cm-completionDetail': { marginLeft: '12px', opacity: '0.8' },
  '.cm-panels': { color: 'var(--text)', backgroundColor: 'var(--surface-elevated)' },
});

export default function MarkdownEditor({ value, onChange, repoId, api, disabled = false, label = 'Ticket Markdown' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const latest = useRef({ value, onChange, api, disabled });
  const compartments = useRef({ vim: new Compartment(), editable: new Compartment(), label: new Compartment() });
  const cancelCompletion = useRef<(() => void) | null>(null);
  const [vimEnabled, setVimEnabled] = useState(storedVimPreference);
  const [mode, setMode] = useState('NORMAL');
  const [completionNotice, setCompletionNotice] = useState('');
  const [completionError, setCompletionError] = useState(false);
  const id = useId();
  const labelId = `${id}-label`;
  const contentId = `${id}-content`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;

  useEffect(() => { latest.current = { value, onChange, api, disabled }; }, [value, onChange, api, disabled]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let request: AbortController | null = null;
    let generation = 0;
    const cancel = () => { generation++; request?.abort(); request = null; };
    cancelCompletion.current = cancel;
    const notice = (text: string, error = false) => {
      if (!disposed) { setCompletionNotice(text); setCompletionError(error); }
    };
    const canComplete = (view: EditorView) => !view.state.readOnly && (!getCM(view)?.state.vim || !!getCM(view)?.state.vim?.insertMode);
    const source = async (context: CompletionContext): Promise<CompletionResult | null> => {
      const line = context.state.doc.lineAt(context.pos);
      const token = mentionAt(line.text, context.pos - line.from);
      if (!token || !context.state.selection.main.empty || !context.view || !canComplete(context.view)) { notice(''); return null; }
      cancel();
      const current = generation;
      const controller = new AbortController();
      request = controller;
      context.addEventListener('abort', () => controller.abort(), { onDocChange: true });
      notice(`Loading ${token.kind === 'skill' ? 'skills' : 'repository files'}…`);
      controller.signal.addEventListener('abort', () => { if (current === generation) notice(''); }, { once: true });
      try {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 180);
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
        if (controller.signal.aborted || context.aborted || disposed) return null;
        const query = new URLSearchParams({ kind: token.kind, q: token.query });
        const result = await latest.current.api<CompletionResponse>(`/api/repos/${encodeURIComponent(repoId)}/completions?${query}`, { signal: controller.signal });
        if (controller.signal.aborted || context.aborted || disposed || current !== generation) return null;
        notice(result.items.length ? `${result.items.length} ${token.kind === 'skill' ? 'skills' : 'files'}${result.truncated ? ' · More results available; keep typing to narrow.' : ' · ↑↓ select · Enter / Tab insert · Esc dismiss'}` : `No ${token.kind === 'skill' ? 'skills' : 'repository files'} match this mention.`);
        return {
          from: line.from + token.from,
          to: line.from + token.to,
          filter: false,
          options: result.items.map(item => ({ label: item.label, detail: item.description, apply: item.value, type: token.kind === 'skill' ? 'function' : 'text' })),
        };
      } catch (cause) {
        if (!controller.signal.aborted && !context.aborted && !disposed && current === generation) {
          notice(`Completion failed: ${cause instanceof Error ? cause.message : String(cause)}. Press Ctrl-Space to retry; your text is unchanged.`, true);
        }
        return null;
      } finally {
        if (request === controller) request = null;
      }
    };
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          compartments.current.vim.of([]),
          compartments.current.editable.of([EditorState.readOnly.of(latest.current.disabled), EditorView.editable.of(!latest.current.disabled)]),
          compartments.current.label.of([]),
          lineNumbers(), highlightSpecialChars(), history(), drawSelection(), highlightActiveLine(),
          markdown(), syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping, editorTheme,
          autocompletion({ override: [source], defaultKeymap: false, activateOnTypingDelay: 0, interactionDelay: 0, icons: false }),
          // DOM-handler precedence is required: Vim handles keys before ordinary CM keymaps.
          Prec.highest(EditorView.domEventHandlers({
            keydown(event, currentView) {
              if (event.isComposing || !canComplete(currentView)) return false;
              if (event.key === 'Escape') {
                const closed = closeCompletion(currentView);
                cancel(); notice('');
                // Let Vim receive the same Escape so INSERT actually returns to NORMAL.
                return getCM(currentView)?.state.vim ? false : closed;
              }
              if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'Space') return startCompletion(currentView);
              if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || completionStatus(currentView.state) !== 'active') return false;
              if (event.key === 'ArrowDown') return moveCompletionSelection(true)(currentView);
              if (event.key === 'ArrowUp') return moveCompletionSelection(false)(currentView);
              if (event.key === 'PageDown') return moveCompletionSelection(true, 'page')(currentView);
              if (event.key === 'PageUp') return moveCompletionSelection(false, 'page')(currentView);
              if (event.key === 'Enter' || event.key === 'Tab') return acceptCompletion(currentView);
              return false;
            },
            blur() { cancel(); notice(''); return false; },
          })),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              notice('');
              if (update.transactions.some(transaction => !transaction.annotation(externalChange))) latest.current.onChange(update.state.doc.toString());
            } else if (update.selectionSet && completionStatus(update.state) === null) notice('');
          }),
        ],
      }),
    });
    editor.current = view;
    return () => { disposed = true; cancel(); cancelCompletion.current = null; editor.current = null; view.destroy(); };
  }, [repoId]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === value) return;
    cancelCompletion.current?.();
    closeCompletion(view);
    view.dispatch({ changes: replacementChange(view.state.doc.toString(), value), annotations: [externalChange.of(true), Transaction.addToHistory.of(false)] });
  }, [value, repoId]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    cancelCompletion.current?.();
    closeCompletion(view);
    view.dispatch({ effects: compartments.current.vim.reconfigure(vimEnabled ? vim() : []) });
    try { localStorage.setItem(preferenceKey, String(vimEnabled)); } catch { /* Editing remains available when browser storage is restricted. */ }
    const cm = vimEnabled ? getCM(view) : null;
    const updateMode = () => {
      const state = cm?.state.vim;
      setMode(state?.insertMode ? 'INSERT' : state?.visualMode ? `VISUAL${state.visualLine ? ' LINE' : state.visualBlock ? ' BLOCK' : ''}` : 'NORMAL');
      if (state && !state.insertMode) { cancelCompletion.current?.(); closeCompletion(view); setCompletionNotice(''); }
    };
    updateMode();
    cm?.on('vim-mode-change', updateMode);
    return () => { cm?.off('vim-mode-change', updateMode); };
  }, [vimEnabled, repoId]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    if (disabled) { cancelCompletion.current?.(); closeCompletion(view); }
    view.dispatch({ effects: compartments.current.editable.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]) });
  }, [disabled, repoId]);

  useEffect(() => {
    editor.current?.dispatch({ effects: compartments.current.label.reconfigure(EditorView.contentAttributes.of({ id: contentId, role: 'textbox', 'aria-labelledby': labelId, 'aria-label': label, 'aria-multiline': 'true', 'aria-readonly': String(disabled), 'aria-describedby': `${hintId} ${statusId}`, tabindex: '0' })) });
  }, [label, disabled, repoId, contentId, labelId, hintId, statusId]);

  return <div className={`markdown-editor${disabled ? ' markdown-editor-readonly' : ''}`}>
    <div className="markdown-editor-toolbar">
      <span id={labelId}>{label}</span>
      <div className="markdown-editor-keymap">
        <span className="markdown-editor-mode" aria-live="polite">{disabled ? 'READ ONLY' : vimEnabled ? mode : 'PLAIN'}</span>
        <Switch size="small" checked={vimEnabled} onChange={setVimEnabled} aria-label="Enable Vim keymap" aria-controls={contentId} checkedChildren="VIM" unCheckedChildren="VIM" />
      </div>
    </div>
    <div ref={host} className="markdown-editor-host" />
    <div className="markdown-editor-footer">
      <span id={hintId}>Markdown · /skill:name · @file or @"path with spaces" · Ctrl-Space to complete{vimEnabled ? ' · i insert / Esc normal' : ''}</span>
      <span id={statusId} role="status" aria-live="polite" className={completionError ? 'markdown-editor-error' : ''}>{disabled ? '' : completionNotice}</span>
    </div>
  </div>;
}
