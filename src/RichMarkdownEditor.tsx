import { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, ClipboardEvent } from 'react';
import {
  MDXEditor, BlockTypeSelect, BoldItalicUnderlineToggles, CodeToggle,
  StrikeThroughSupSubToggles, ListsToggle, CreateLink, InsertImage, InsertTable,
  InsertThematicBreak, InsertCodeBlock, UndoRedo, Separator, ConditionalContents,
  ChangeCodeMirrorLanguage, CodeMirrorEditor, headingsPlugin, listsPlugin,
  quotePlugin, linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin,
  thematicBreakPlugin, codeBlockPlugin, codeMirrorPlugin, markdownShortcutPlugin,
  toolbarPlugin, realmPlugin, addImportVisitor$, UnrecognizedMarkdownConstructError,
} from '@mdxeditor/editor';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import './RichMarkdownEditor.css';

export interface RichMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  attachmentBase: string;
  attachmentUrls?: Record<string, string>;
  onUpload: (files: File[]) => Promise<Array<{ name: string; url: string; markdown: string }>>;
}

// Keep the exact YAML bytes (including BOM, CRLF, and either YAML end marker)
// outside Lexical's Markdown normalization. An unclosed header is never imported.
function splitDocument(value: string) {
  const opening = /^(?:\uFEFF)?---[\t ]*(?:\r\n|\n)/.exec(value);
  if (!opening) return { prefix: '', body: value, invalid: false };
  const closing = /^(?:---|\.\.\.)[\t ]*(?:\r\n|\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const match = closing.exec(value);
  if (!match) return { prefix: '', body: value, invalid: true };
  const end = match.index + match[0].length;
  return { prefix: value.slice(0, end), body: value.slice(end), invalid: false };
}

// imagePlugin also installs an HTML-image visitor that uses innerHTML. Reject
// raw HTML before that visitor, preserving its original source instead.
const safeMarkdownPlugin = realmPlugin({
  init(realm) {
    realm.pub(addImportVisitor$, {
      testNode: 'html',
      priority: 100,
      visitNode() {
        throw new UnrecognizedMarkdownConstructError('Raw HTML is available only in the Markdown tab.');
      },
    });
  },
});

function FormattingToolbar() {
  return (
    <ConditionalContents options={[
      { when: editor => editor?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
      { fallback: () => <>
        <UndoRedo /><Separator /><BlockTypeSelect />
        <BoldItalicUnderlineToggles options={['Bold', 'Italic']} /><CodeToggle />
        <StrikeThroughSupSubToggles options={['Strikethrough']} /><Separator />
        <ListsToggle options={['bullet', 'number', 'check']} /><Separator />
        <CreateLink /><InsertImage /><InsertTable /><InsertCodeBlock /><InsertThematicBreak />
      </> },
    ]} />
  );
}

class EditorBoundary extends Component<{ children: ReactNode; source: string }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div className="rich-markdown-recovery">
      <p role="alert">Preview could not open this document. Your Markdown is unchanged. Use the Markdown tab to continue editing.</p>
      <textarea aria-label="Preserved Markdown source" value={this.props.source} readOnly spellCheck={false} />
    </div>;
    return this.props.children;
  }
}

export default function RichMarkdownEditor(props: RichMarkdownEditorProps) {
  const { value, disabled = false, attachmentBase, attachmentUrls } = props;
  const document = useMemo(() => splitDocument(value), [value]);
  const editor = useRef<MDXEditorMethods>(null);
  const latest = useRef(props);
  const current = useRef(value);
  const parseFailure = useRef<string | null>(null);
  const externalRevision = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const userEdit = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [recoveredAttachments, setRecoveredAttachments] = useState('');
  const helpId = useId();
  useEffect(() => { latest.current = props; }, [props]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (current.current === value) return;
    current.current = value;
    externalRevision.current++;
    userEdit.current = false;
    parseFailure.current = null;
    setParseError(null);
    if (!document.invalid) editor.current?.setMarkdown(document.body);
  }, [value, document]);

  // The preview callback changes when local blobs become available. ImageNode's
  // stored src remains the portable attachments/... URL throughout.
  const plugins = useMemo(() => [
    safeMarkdownPlugin(),
    headingsPlugin(), listsPlugin(), quotePlugin(),
    linkPlugin({ validateUrl: url => !/^\s*(?:javascript|vbscript|data):/i.test(url) }),
    linkDialogPlugin(),
    imagePlugin({
      disableImageResize: true,
      imagePreviewHandler: async source => {
        const local = attachmentUrls?.[source];
        if (local) return local;
        const relative = source.replace(/^\.\//, '');
        if (attachmentBase && relative.startsWith('attachments/')) {
          return attachmentBase + relative.slice('attachments/'.length);
        }
        if (/^\s*(?:javascript|vbscript|data):/i.test(source)) return '';
        return source;
      },
    }),
    tablePlugin(), thematicBreakPlugin(),
    codeBlockPlugin({ codeBlockEditorDescriptors: [{ priority: -1, match: () => true, Editor: CodeMirrorEditor }] }),
    codeMirrorPlugin({ codeBlockLanguages: {
      '': 'Plain text', js: 'JavaScript', ts: 'TypeScript', tsx: 'TSX', jsx: 'JSX',
      json: 'JSON', bash: 'Shell', css: 'CSS', html: 'HTML', yaml: 'YAML',
      python: 'Python', go: 'Go', sql: 'SQL', mermaid: 'Mermaid',
    } }),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: FormattingToolbar, toolbarClassName: 'rich-markdown-toolbar' }),
  ], [attachmentBase, attachmentUrls]);

  async function uploadFiles(files: File[], pastedText = '') {
    if (!files.length || latest.current.disabled || pending.current || parseFailure.current || document.invalid) return;
    pending.current = true;
    setUploading(true);
    setUploadError('');
    setRecoveredAttachments('');
    const revision = externalRevision.current;
    const source = latest.current.value;
    try {
      const attachments = await latest.current.onUpload(files);
      if (!mounted.current) return;
      const markdown = [pastedText, ...attachments.map(attachment => attachment.markdown)].filter(Boolean).join('\n\n');
      if (revision !== externalRevision.current || source !== latest.current.value || latest.current.disabled || parseFailure.current) {
        setUploadError('The document changed while files were being attached. The references below are preserved; insert them from the Markdown tab.');
        setRecoveredAttachments(markdown);
        return;
      }
      // Restore Lexical focus after the clipboard/file picker without discarding
      // its saved selection. A document with no selection inserts at the end.
      userEdit.current = true;
      editor.current?.focus(() => editor.current?.insertMarkdown(markdown), { preventScroll: true, defaultSelection: 'rootEnd' });
    } catch (error) {
      if (mounted.current) setUploadError(error instanceof Error ? error.message : 'Attachments could not be added. Your document is unchanged.');
    } finally {
      pending.current = false;
      if (mounted.current) setUploading(false);
    }
  }

  function pasteFiles(event: ClipboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[contenteditable="true"]')) return;
    userEdit.current = true;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadFiles(files, event.clipboardData.getData('text/plain'));
  }

  function changeBody(body: string, initialNormalize: boolean) {
    // MDXEditor 4.3 publishes its first dirty update before clearing the initial
    // normalization flag, so the first real edit can carry that flag too.
    if ((initialNormalize && !userEdit.current) || parseFailure.current || latest.current.disabled) return;
    const original = splitDocument(latest.current.value);
    if (original.invalid) return;
    // Lexical normalizes body Markdown only after an actual edit. Merely opening
    // Preview never rewrites the source. Retain original surrounding whitespace.
    const leading = /^\s*/.exec(original.body)?.[0] ?? '';
    const trailing = original.body.trim() ? /\s*$/.exec(original.body)?.[0] ?? '' : '';
    const newline = original.body.includes('\r\n') || original.prefix.includes('\r\n') ? '\r\n' : '\n';
    const normalized = body.trim().replace(/\r?\n/g, newline);
    const prefix = original.prefix && !/[\r\n]$/.test(original.prefix) && normalized ? original.prefix + newline : original.prefix;
    const next = prefix + leading + normalized + trailing;
    current.current = next;
    latest.current.onChange(next);
  }

  const error = document.invalid ? 'The leading YAML metadata has no closing --- or ... marker.' : parseError;
  return <section className="rich-markdown-editor" aria-label="Editable ticket preview" aria-busy={uploading} onPasteCapture={pasteFiles}
    onBeforeInputCapture={() => { userEdit.current = true; }}
    onKeyDownCapture={event => {
      if (event.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Tab'].includes(event.key)) userEdit.current = true;
    }}
    onClickCapture={event => {
      if (event.target instanceof Element && event.target.closest('.rich-markdown-theme button, [role="checkbox"]')) userEdit.current = true;
    }}
  >
    <div className="rich-markdown-help" id={helpId}>
      <span>Editable preview · changes are saved only with Save. Paste images or files at the cursor.</span>
      <button type="button" disabled={disabled || uploading || Boolean(error)} onMouseDown={event => event.preventDefault()} onClick={() => editor.current?.focus(() => fileInput.current?.click(), { defaultSelection: 'rootEnd', preventScroll: true })}>Attach files</button>
      <input ref={fileInput} type="file" multiple hidden aria-label="Attach files to Markdown" onChange={event => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        void uploadFiles(files);
      }} />
    </div>
    {disabled && <p className="rich-markdown-status" role="status">Preview is read-only while this ticket is being saved.</p>}
    {uploading && <p className="rich-markdown-status" role="status" aria-live="polite">Adding attachments…</p>}
    {uploadError && <p className="rich-markdown-error" role="alert">{uploadError}</p>}
    {recoveredAttachments && <textarea className="rich-markdown-references" aria-label="Preserved attachment references" readOnly value={recoveredAttachments} />}
    {document.prefix && <details className="rich-markdown-metadata">
      <summary>Ticket metadata · read-only in Preview</summary>
      <pre><code>{document.prefix}</code></pre>
    </details>}
    {error && <div className="rich-markdown-recovery">
      <p role="alert">Preview cannot safely edit this syntax: {error} Your original text is preserved. Use the Markdown tab to edit it.</p>
      <textarea aria-label="Preserved Markdown source" value={value} readOnly spellCheck={false} />
    </div>}
    <div hidden={Boolean(error)} aria-describedby={helpId}>
      <EditorBoundary key={document.invalid ? 'invalid-header' : 'editor'} source={value}>
        {!document.invalid && <MDXEditor
          ref={editor}
          className="rich-markdown-theme"
          contentEditableClassName="rich-markdown-body"
          markdown={document.body}
          trim={false}
          readOnly={disabled || Boolean(error)}
          suppressHtmlProcessing
          plugins={plugins}
          placeholder="Write the implementation plan…"
          onChange={changeBody}
          onError={({ error: message, source }) => {
            parseFailure.current = message;
            setParseError(message);
            if (source !== splitDocument(latest.current.value).body) setRecoveredAttachments(source);
          }}
        />}
      </EditorBoundary>
    </div>
  </section>;
}
