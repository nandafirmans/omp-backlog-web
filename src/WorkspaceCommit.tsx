import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Grid, Input, Modal, Segmented, Tooltip, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { ArrowClockwiseIcon, ArrowLeftIcon, CheckCircleIcon, ColumnsIcon, FileCodeIcon, FileCssIcon, FileHtmlIcon, FileIcon, FileImageIcon, FileJsIcon, FileJsxIcon, FileLockIcon, FileMdIcon, FilePyIcon, FileRsIcon, FileSqlIcon, FileSvgIcon, FileTsIcon, FileTsxIcon, FileTxtIcon, FolderSimpleIcon, GitCommitIcon, ListBulletsIcon, RobotIcon, RowsIcon, TrashIcon, TreeStructureIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useBlocker, useLinkClickHandler, useNavigate } from 'react-router';
import type { Repo, WorkspaceReview } from '../server/contracts';
import type { RequestApi } from './Workspace';
import WorkspaceDiff from './WorkspaceDiff';
import { fileTree } from './fileTree';
import type { FileTreeNode } from './fileTree';

interface Props { repo: Repo; api: RequestApi; disabled: boolean; onCommitted: () => Promise<void> }
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const fileIcons: Record<string, Icon> = {
  ts: FileTsIcon, mts: FileTsIcon, cts: FileTsIcon, tsx: FileTsxIcon, js: FileJsIcon, mjs: FileJsIcon, cjs: FileJsIcon, jsx: FileJsxIcon,
  css: FileCssIcon, scss: FileCssIcon, html: FileHtmlIcon, md: FileMdIcon, mdx: FileMdIcon, py: FilePyIcon, rs: FileRsIcon, sql: FileSqlIcon,
  svg: FileSvgIcon, png: FileImageIcon, jpg: FileImageIcon, jpeg: FileImageIcon, gif: FileImageIcon, webp: FileImageIcon, txt: FileTxtIcon,
  json: FileCodeIcon, yaml: FileCodeIcon, yml: FileCodeIcon, toml: FileCodeIcon, lock: FileLockIcon,
};
function fileIcon(name: string): Icon {
  if (/^(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/.test(name)) return FileLockIcon;
  return fileIcons[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? FileIcon;
}
/** Git porcelain v1 XY code (renames disabled server-side) as a short label. */
function statusLabel(code: string): { text: string; tone: string } {
  if (code === '??') return { text: 'New', tone: 'added' };
  if (code.includes('U') || code === 'AA' || code === 'DD') return { text: 'Conflict', tone: 'deleted' };
  if (code.includes('D')) return { text: 'Deleted', tone: 'deleted' };
  if (code.includes('A')) return { text: 'Added', tone: 'added' };
  return { text: 'Modified', tone: 'modified' };
}
type ReviewFile = WorkspaceReview['files'][number];

function FileLabel({ file, showFolder }: { file: ReviewFile; showFolder: boolean }) {
  const slash = file.path.lastIndexOf('/');
  const name = file.path.slice(slash + 1);
  const status = statusLabel(file.status);
  return <>
    {createElement(fileIcon(name), { className: 'workspace-review-file-icon', size: 18, 'aria-hidden': true })}
    <span className="workspace-review-path"><span className="workspace-review-name">{name}</span>{showFolder && slash > 0 && <span className="workspace-review-dir">{file.path.slice(0, slash)}</span>}</span>
    <span className={`workspace-review-status status-${status.tone}`} title={`Git status ${file.status}`}>{file.blocked && <WarningCircleIcon size={16} aria-label="Terminal review required" />}{status.text}</span>
  </>;
}

/** Operator Review & commit page: select reviewed working-tree files and create one confirmed local commit. */
export default function WorkspaceCommit({ repo, api, disabled, onCommitted }: Props) {
  const boardPath = `/projects/${encodeURIComponent(repo.id)}`;
  const backToBoard = useLinkClickHandler<HTMLElement>(boardPath);
  const navigate = useNavigate();
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState('');
  const screens = Grid.useBreakpoint();
  const [review, setReview] = useState<WorkspaceReview>();
  const [activePath, setActivePath] = useState('');
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const [fileView, setFileView] = useState<'list' | 'tree'>('tree');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ kind: 'commit'; commit: string; subject: string; files: number } | { kind: 'discard'; backup: string; files: number }>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const draft = !receipt && (selected.length > 0 || !!message.trim());
  const blocker = useBlocker(({ currentLocation, nextLocation }) => draft && currentLocation.pathname !== nextLocation.pathname);
  const handoffId = repo.handoff?.id;
  const initial = useRef<Promise<WorkspaceReview>>(undefined);

  const request = useCallback(() => api<WorkspaceReview>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-review`, json({ handoffId })), [api, repo.id, handoffId]);
  const show = useCallback((value: WorkspaceReview) => {
    setReview(value);
    setActivePath(path => value.files.some(file => file.path === path) ? path : value.files[0]?.path ?? '');
  }, []);

  async function reload() {
    setBusy(true); setError(''); setReceipt(undefined); setReview(undefined); setSelected([]); setConfirming(false);
    try { show(await request()); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!handoffId || disabled) return;
    let current = true;
    // The server allows one workspace operation per repo: share an in-flight load across effect re-runs.
    if (!initial.current) {
      const promise = request().finally(() => { if (initial.current === promise) initial.current = undefined; });
      initial.current = promise;
    }
    initial.current.then(value => { if (current) show(value); }, cause => { if (current) setError(errorText(cause)); });
    return () => { current = false; };
  }, [handoffId, disabled, request, show]);

  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);

  /** One click: draft a message from the selected diffs, then commit those files with it. */
  async function generateAndCommit() {
    if (!review || generating || busy || !selected.length) return;
    if (message.trim() && !await modal.confirm({ title: 'Replace commit message?', content: 'The generated message replaces what you wrote and is committed right away.', okText: 'Generate & commit', cancelText: 'Keep mine' })) return;
    setGenerating(true); setGenerateError('');
    let generated: string;
    try {
      const result = await api<{ message: string }>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-commit-message`, json({ handoffId, reviewId: review.id, files: selected }));
      generated = result.message;
      setMessage(generated);
    } catch (cause) { setGenerateError(errorText(cause)); return; }
    finally { setGenerating(false); }
    await commit(generated);
  }

  async function commit(commitMessage: string) {
    if (!review || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ commit: string }>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-commit`, json({ handoffId, reviewId: review.id, files: selected, message: commitMessage, confirm: true }));
      setReceipt({ kind: 'commit', commit: result.commit, subject: commitMessage.trim().split('\n')[0], files: selected.length }); setReview(undefined); setSelected([]); setMessage(''); setConfirming(false);
      await onCommitted();
    } catch (cause) { setError(errorText(cause)); setReview(undefined); setSelected([]); setConfirming(false); return; }
    finally { setBusy(false); }
    // Recheck right away: if Git is now clean the gate releases and we return to the board; otherwise the receipt shows why.
    await recheck();
  }

  /** Explicitly confirmed: back up, then drop the selected files' uncommitted changes. */
  async function discard() {
    if (!review || busy || !selected.length) return;
    const count = `${selected.length} ${selected.length === 1 ? 'file' : 'files'}`;
    const confirmed = await modal.confirm({
      title: `Discard changes in ${count}?`,
      content: <>
        <p>These files lose their uncommitted changes:</p>
        <ul className="workspace-discard-list">{selected.map(path => <li key={path}><code>{path}</code></li>)}</ul>
        <p>Tracked files go back to the last commit and new files are deleted. A backup copy is saved in the app's private data folder first. Other files are not touched.</p>
      </>,
      okText: `Discard ${count}`, okButtonProps: { danger: true }, cancelText: 'Keep changes', focusable: { autoFocusButton: 'cancel' },
    });
    if (!confirmed) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ files: number; backup: string }>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-discard`, json({ handoffId, reviewId: review.id, files: selected, confirm: true }));
      setReceipt({ kind: 'discard', backup: result.backup, files: result.files }); setReview(undefined); setSelected([]); setMessage(''); setConfirming(false);
      await onCommitted();
    } catch (cause) { setError(errorText(cause)); setReview(undefined); setSelected([]); setConfirming(false); return; }
    finally { setBusy(false); }
    await recheck();
  }

  async function recheck() {
    if (rechecking || !handoffId) return;
    setRechecking(true); setRecheckError('');
    try {
      await api(`/api/repos/${encodeURIComponent(repo.id)}/reconcile-workspace`, json({ handoffId }));
      await onCommitted();
      void navigate(boardPath);
    } catch (cause) { setRecheckError(errorText(cause)); }
    finally { setRechecking(false); }
  }

  // A review that already finds Git clean needs no operator decision: recheck once automatically.
  const clean = !!review && !review.files.length;
  const autoRechecked = useRef(false);
  useEffect(() => {
    if (!clean || autoRechecked.current) return;
    autoRechecked.current = true;
    void recheck();
  });

  const recheckActions = <>
    {recheckError && <p className="warning-text" role="alert">{recheckError} Commit or reconcile the remaining changes, then recheck.</p>}
    <div className="toolbar">
      <Button type="primary" icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} loading={rechecking} disabled={disabled || !handoffId} onClick={() => void recheck()}>Recheck workspace</Button>
      {recheckError && <Button icon={<GitCommitIcon size={16} aria-hidden="true" />} disabled={rechecking || disabled} onClick={() => void reload()}>Review remaining changes</Button>}
    </div>
  </>;

  const active = review?.files.find(file => file.path === activePath);
  const activeStatus = active && statusLabel(active.status);
  // Side by side only helps when both versions exist; a wholly new or deleted file reads better as one column.
  const twoSided = !!active?.before && !!active?.after;
  const split = layout === 'split' && screens.md !== false && twoSided;
  const locked = busy || disabled || confirming || generating;
  const loading = !review && !error && !receipt && !!handoffId && !disabled;
  const eligible = review?.files.filter(file => !file.blocked).map(file => file.path) ?? [];
  const allSelected = eligible.length > 0 && eligible.every(path => selected.includes(path));
  const files = review?.files;
  const treeData = useMemo(() => {
    const byPath = new Map(files?.map(file => [file.path, file]));
    const toData = (nodes: FileTreeNode[]): TreeDataNode[] => nodes.map(node => node.children
      ? { key: node.key, title: node.name, selectable: false, children: toData(node.children) }
      : { key: node.key, title: node.name, isLeaf: true, disableCheckbox: !!byPath.get(node.path)?.blocked });
    return { byPath, nodes: toData(fileTree(files?.map(file => file.path) ?? [])) };
  }, [files]);
  return <section className="workspace-review" aria-labelledby="workspace-review-title">
    {modalContext}
    <Modal title="Discard commit draft?" open={blocker.state === 'blocked'} okText="Discard draft" cancelText="Keep reviewing" onOk={() => blocker.state === 'blocked' && blocker.proceed()} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>No Git files have been changed. Leave without committing?</p></Modal>
    <header className="workspace-review-header">
      <div>
        <h1 id="workspace-review-title">Review &amp; commit</h1>
        <p className="execution-context">{review ? <>HEAD <code title={review.head ?? undefined}>{review.head?.slice(0, 12) ?? 'none (initial commit)'}</code> vs working tree · review expires after ten minutes</> : 'HEAD compared with the working tree'}</p>
      </div>
      <div className="toolbar">
        <Button icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} disabled={busy || loading || disabled || confirming || !handoffId} onClick={() => void reload()}>Reload changes</Button>
        <Button href={boardPath} icon={<ArrowLeftIcon size={16} aria-hidden="true" />} onClick={backToBoard}>Back to board</Button>
      </div>
    </header>

    {!receipt && <details className="workspace-review-rules">
      <summary><WarningCircleIcon size={16} aria-hidden="true" /><span className="warning-text">Committing does not mark tickets Done. The workspace is rechecked automatically after committing; the queue resumes only if Git is clean.</span><span className="workspace-review-rules-toggle">Commit rules</span></summary>
      <p>Operator action only. Select files deliberately. Commit records the reviewed working-tree versions, including deletions and executable modes; any staged versions of selected files are replaced. Unselected staged changes are preserved. Discard selected drops the selected files' uncommitted changes after a confirmation, saving a private backup first.</p>
      <p>No push, reset, stash, hooks, signing or clean filters. Sensitive filenames, suspected credentials, binary/large files, links, conflicts and custom conversions require terminal review. Filename/content screening is not a secret scanner guarantee. Keep external editors and Git operations idle while committing.</p>
    </details>}

    {error && <div className="error-banner" role="alert">{error}</div>}
    {receipt && <section className="panel workspace-review-done" role="status" aria-labelledby="workspace-review-done-title">
      <CheckCircleIcon size={28} weight="fill" aria-hidden="true" />
      <div>
        {receipt.kind === 'commit' ? <>
          <h2 id="workspace-review-done-title">Commit created</h2>
          <p className="workspace-review-done-commit"><code title={receipt.commit}>{receipt.commit.slice(0, 12)}</code> {receipt.subject}</p>
          <p className="muted">{receipt.files} {receipt.files === 1 ? 'file' : 'files'} committed locally. Nothing was pushed.</p>
        </> : <>
          <h2 id="workspace-review-done-title">Changes discarded</h2>
          <p>{receipt.files} {receipt.files === 1 ? 'file' : 'files'} returned to the last commit. Backup: <code>{receipt.backup}</code></p>
          <p className="muted">Copy files back from the backup folder if you need them.</p>
        </>}
        {rechecking || busy
          ? <p className="muted">Rechecking workspace…</p>
          : <><p>Automatic recheck did not release the gate. New starts stay blocked until a recheck finds Git clean; eligible tickets then start under existing permissions.</p>{recheckActions}</>}
      </div>
    </section>}
    {(busy || loading) && <p className="muted" role="status">{loading ? 'Loading changes…' : 'Working…'}</p>}
    {!handoffId && !receipt && <div className="panel empty-state"><h2>No workspace review pending</h2><p>This project has no blocked workspace handoff to commit.</p></div>}
    {handoffId && disabled && !receipt && <p className="warning-text" role="status">A run in this project is active. Review &amp; commit is unavailable until it stops.</p>}
    {review && !review.files.length && <div className="panel empty-state"><h2>No changed files</h2>{!recheckError ? <p className="muted">Git looks clean. Rechecking workspace…</p> : <><p>Git looks clean, but the automatic recheck did not release the gate.</p>{recheckActions}</>}</div>}

    {review && review.files.length > 0 && <div className="workspace-review-layout">
      <aside className="workspace-review-rail">
        <section className="workspace-review-commit" aria-label="Commit">
          {confirming ? <>
            <h2>Commit {selected.length} {selected.length === 1 ? 'file' : 'files'}?</h2>
            <pre>{message.trim()}</pre>
            <p className="muted">Creates a local Git commit only. The workspace gate stays and no tickets start.</p>
            <div className="toolbar">
              <Button icon={<ArrowLeftIcon size={16} aria-hidden="true" />} disabled={busy} onClick={() => setConfirming(false)}>Back</Button>
              <Button type="primary" icon={<CheckCircleIcon size={16} aria-hidden="true" />} disabled={busy || disabled} onClick={() => void commit(message)}>Confirm commit</Button>
            </div>
          </> : <>
            <div className="workspace-review-commit-label">
              <label htmlFor="workspace-commit-message">Commit message</label>
              <Tooltip title={selected.length ? 'Draft a message from the selected diffs with your default model, then commit the selected files immediately' : 'Select files first'}>
                <Button type="text" icon={<RobotIcon size={16} aria-hidden="true" />} loading={generating} disabled={busy || disabled || !selected.length} onClick={() => void generateAndCommit()}>Generate &amp; commit</Button>
              </Tooltip>
            </div>
            <Input.TextArea id="workspace-commit-message" value={message} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} disabled={busy || disabled || generating} onChange={event => setMessage(event.target.value)} />
            {generating && <p className="muted" role="status">Generating from {selected.length} {selected.length === 1 ? 'diff' : 'diffs'}, then committing. This can take up to two minutes.</p>}
            {generateError && <p className="workspace-review-generate-error" role="alert">{generateError}</p>}
            <Button type="primary" block icon={<GitCommitIcon size={16} aria-hidden="true" />} disabled={busy || disabled || generating || !selected.length || !message.trim()} onClick={() => setConfirming(true)}>Review commit</Button>
            <p className="muted">{!selected.length ? 'Select files to include.' : !message.trim() ? 'Write a commit message.' : 'You confirm the exact file list next.'}</p>
            <Button danger block icon={<TrashIcon size={16} aria-hidden="true" />} disabled={busy || disabled || generating || !selected.length} onClick={() => void discard()}>Discard selected…</Button>
          </>}
        </section>

        <nav className="workspace-review-files" aria-label="Changed files">
          <div className="workspace-review-files-head">
            <Checkbox aria-label="Include all eligible files" disabled={locked || !eligible.length} checked={allSelected} indeterminate={!allSelected && selected.length > 0} onChange={event => setSelected(event.target.checked ? eligible : [])} />
            <h2>Changed files</h2>
            <span className="muted">{selected.length}/{review.files.length}</span>
            <Segmented aria-label="File list layout" value={fileView} onChange={setFileView} options={[
              { value: 'list', label: <Tooltip title="List"><span className="view-label" aria-label="List"><ListBulletsIcon size={16} aria-hidden="true" /></span></Tooltip> },
              { value: 'tree', label: <Tooltip title="Tree"><span className="view-label" aria-label="Tree"><TreeStructureIcon size={16} aria-hidden="true" /></span></Tooltip> },
            ]} />
          </div>
          {fileView === 'tree'
            ? <Tree key={review.id} className="workspace-review-tree" checkable blockNode disabled={locked} defaultExpandAll expandAction="click" treeData={treeData.nodes}
              checkedKeys={selected} selectedKeys={activePath ? [activePath] : []}
              onSelect={keys => { if (typeof keys[0] === 'string') setActivePath(keys[0]); }}
              onCheck={checked => setSelected((Array.isArray(checked) ? checked : checked.checked).filter((key): key is string => typeof key === 'string' && treeData.byPath.has(key)))}
              titleRender={node => {
                const file = treeData.byPath.get(String(node.key));
                return file
                  ? <span className="workspace-review-file" title={file.path}><FileLabel file={file} showFolder={false} /></span>
                  : <span className="workspace-review-folder"><FolderSimpleIcon size={18} aria-hidden="true" />{String(node.title)}</span>;
              }} />
            : <ul>
              {review.files.map(file => <li key={file.path} className={file.path === activePath ? 'active' : undefined}>
                <Checkbox aria-label={`Include ${file.path} in commit`} disabled={!!file.blocked || locked} checked={selected.includes(file.path)} onChange={event => setSelected(paths => event.target.checked ? [...paths, file.path] : paths.filter(path => path !== file.path))} />
                <button type="button" className="workspace-review-file" title={file.path} aria-current={file.path === activePath ? 'true' : undefined} onClick={() => setActivePath(file.path)}><FileLabel file={file} showFolder /></button>
              </li>)}
            </ul>}
        </nav>
      </aside>

      {active && activeStatus && <section className="workspace-review-diff" aria-label={`Changes in ${active.path}`}>
        <div className="workspace-review-diff-bar">
          <div className="workspace-review-diff-title">
            <code>{active.path}</code>
            <span className={`workspace-review-status status-${activeStatus.tone}`}>{activeStatus.text}</span>
            {active.mode && <span className="muted">mode {active.mode}</span>}
          </div>
          {screens.md !== false && twoSided && !active.blocked && <Segmented aria-label="Diff layout" value={layout} onChange={setLayout} options={[
            { value: 'split', label: <Tooltip title="Side by side"><span className="view-label" aria-label="Side by side"><ColumnsIcon size={16} aria-hidden="true" /></span></Tooltip> },
            { value: 'unified', label: <Tooltip title="Unified"><span className="view-label" aria-label="Unified"><RowsIcon size={16} aria-hidden="true" /></span></Tooltip> },
          ]} />}
        </div>
        {active.blocked
          ? <p className="warning-text workspace-review-blocked">{active.blocked}</p>
          : <>
            {split && <div className="workspace-review-sides" aria-hidden="true"><span>Before (HEAD)</span><span>After (working tree)</span></div>}
            <WorkspaceDiff path={active.path} before={active.before ?? ''} after={active.after ?? ''} layout={split ? 'split' : 'unified'} />
          </>}
      </section>}
    </div>}
  </section>;
}
