import { useState } from 'react';
import { Button, Checkbox, Input, Modal } from 'antd';
import type { Repo, WorkspaceReview } from '../server/contracts';
import type { RequestApi } from './Workspace';

interface Props { repo: Repo; api: RequestApi; disabled: boolean; onCommitted: () => Promise<void> }
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export default function WorkspaceCommit({ repo, api, disabled, onCommitted }: Props) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<WorkspaceReview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [modal, context] = Modal.useModal();

  async function load() {
    setBusy(true); setError(''); setReceipt(''); setReview(undefined); setSelected([]); setConfirming(false);
    try { setReview(await api<WorkspaceReview>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-review`, json({ handoffId: repo.handoff?.id }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  async function close() {
    if (busy) return;
    if ((selected.length || message.trim()) && !receipt && !await modal.confirm({ title: 'Discard commit draft?', content: 'No Git files have been changed. Close without committing?', okText: 'Discard draft', cancelText: 'Keep reviewing' })) return;
    setOpen(false); setReview(undefined); setSelected([]); setMessage(''); setError(''); setConfirming(false);
  }
  async function commit() {
    if (!review || busy || !confirming) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ commit: string }>(`/api/repos/${encodeURIComponent(repo.id)}/workspace-commit`, json({ handoffId: repo.handoff?.id, reviewId: review.id, files: selected, message, confirm: true }));
      setReceipt(result.commit); setReview(undefined); setSelected([]); setMessage(''); setConfirming(false);
      await onCommitted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setReview(undefined); setSelected([]); setConfirming(false); }
    finally { setBusy(false); }
  }
  return <>
    {context}
    <Button disabled={disabled || busy} onClick={() => { setOpen(true); void load(); }}>Review &amp; commit</Button>
    <Modal className="workspace-commit-modal" title="Review workspace changes" open={open} onCancel={() => void close()} footer={null} width={960} maskClosable={false} closable={!busy} keyboard={!busy}>
      <p>Operator action only. Select files deliberately. Commit records the reviewed working-tree versions, including deletions and executable modes; any staged versions of selected files are replaced. Unselected staged changes are preserved.</p>
      <p>No push, reset, stash, hooks, signing or clean filters. Sensitive filenames, suspected credentials, binary/large files, links, conflicts and custom conversions require terminal review. Filename/content screening is not a secret scanner guarantee. Keep external editors and Git operations idle while committing.</p>
      <p className="warning-text">Committing does not mark tickets Done or release the queue. Separate Recheck workspace is still required.</p>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {receipt && <p role="status">Created commit <code>{receipt}</code>. Workspace remains gated. Close this dialog, then use Recheck workspace when ready.</p>}
      {busy && <p role="status">Working…</p>}
      {!confirming && <>
        <Button disabled={busy || disabled} onClick={() => void load()}>Reload changes</Button>
        {review && <div className="workspace-change-list">
          <p>Base: <code>{review.head ?? 'Initial commit (no HEAD)'}</code>. Review expires after ten minutes.</p>
          {!review.files.length && <p>No changed files. Close and use Recheck workspace.</p>}
          {review.files.map(file => <section className="panel" key={file.path}>
            <Checkbox disabled={!!file.blocked || busy || disabled} checked={selected.includes(file.path)} onChange={event => setSelected(paths => event.target.checked ? [...paths, file.path] : paths.filter(path => path !== file.path))}><code>{JSON.stringify(file.path)}</code> · {file.status}</Checkbox>
            {file.mode && <p className="muted">File mode: {file.mode}</p>}
            {file.blocked ? <p className="warning-text">{file.blocked}</p> : <><details open><summary>Diff: HEAD → working tree</summary><pre tabIndex={0}>{file.diff}</pre></details><details><summary>Before (HEAD)</summary><pre tabIndex={0}>{file.before || '(empty or absent)'}</pre></details><details><summary>After (working tree)</summary><pre tabIndex={0}>{file.after || '(empty or deleted)'}</pre></details></>}
          </section>)}
          <label htmlFor="workspace-commit-message">Commit message</label>
          <Input.TextArea id="workspace-commit-message" value={message} maxLength={2000} rows={3} disabled={busy || disabled} onChange={event => setMessage(event.target.value)} />
          <Button type="primary" disabled={busy || disabled || !selected.length || !message.trim()} onClick={() => setConfirming(true)}>Review commit</Button>
        </div>}
      </>}
      {confirming && <section className="panel" aria-label="Confirm workspace commit">
        <h3>Commit these files?</h3><ul>{selected.map(path => <li key={path}><code>{JSON.stringify(path)}</code></li>)}</ul><pre>{message.trim()}</pre>
        <p>This creates a local Git commit only. It does not release the workspace gate or start tickets.</p>
        <div className="toolbar"><Button disabled={busy} onClick={() => setConfirming(false)}>Back to review</Button><Button type="primary" disabled={busy || disabled} onClick={() => void commit()}>Confirm commit</Button></div>
      </section>}
    </Modal>
  </>;
}
