import { useEffect, useState } from 'react';
import { Button, Modal } from 'antd';
import { Link } from 'react-router';
import type { Repo, Run, Snapshot, Ticket } from '../server/contracts';
import type { RequestApi } from './Workspace';
import MarkdownEditor from './MarkdownEditor';

interface Props {
  repo: Repo; ticket: Ticket; run: Run; api: RequestApi; disabled: boolean;
  execute: (notice: string, work: () => Promise<void>) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}

export default function BlockedRecovery({ repo, ticket, run, api, disabled, execute, onDirtyChange }: Props) {
  const suggested = run.blockerDetails?.suggestedPrompt ?? `Review blocked run ${run.id} and its partial evidence.\n${run.blocker ?? 'Prerequisite not recorded; investigate before repair.'}\nRecheck the prerequisite first. Apply only permitted in-scope fixes; do not install dependencies or bypass workspace gates. Verify the original criteria with fresh checks; report remaining blockers honestly.`;
  const [base, setBase] = useState({ note: run.recoveryNote, revision: ticket.revision, suggested });
  const [instructions, setInstructions] = useState(run.recoveryNote?.instructions ?? suggested);
  const [error, setError] = useState('');
  const [modal, context] = Modal.useModal();
  const dirty = instructions !== (base.note?.instructions ?? base.suggested);
  const stale = (run.recoveryNote?.id ?? null) !== (base.note?.id ?? null) || base.revision !== ticket.revision;
  const editable = ['blocked', 'draft'].includes(ticket.status) && run.status === 'blocked' && run.pid === null;
  const invalid = !instructions.trim() || instructions.length > 8000;
  const busy = disabled || !editable;

  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);

  async function save() {
    const submitted = instructions;
    setError('');
    await execute('Recovery note saved. No approval or execution granted.', async () => {
      try {
        const saved = await api<Run>(`/api/runs/${encodeURIComponent(run.id)}/recovery`, { method: 'POST', body: JSON.stringify({ revision: ticket.revision, noteId: base.note?.id ?? null, instructions: submitted }) });
        setBase({ note: saved.recoveryNote, revision: ticket.revision, suggested });
        setInstructions(current => current === submitted ? saved.recoveryNote!.instructions : current);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery note save was not confirmed.'); throw cause; }
    });
  }

  async function retry() {
    const note = base.note;
    if (!note || dirty || stale || note.revision !== ticket.revision) return;
    if (!await modal.confirm({
      title: 'Review fix & retry?', autoFocusButton: 'cancel', okText: 'Approve revision & retry', cancelText: 'Keep blocked',
      content: <><p>Approve revision {ticket.revision.slice(0, 10)} with these exact recovery instructions for a fresh attempt. Previous side effects remain; inspect partial work first. This does not grant installation, destructive-action or expanded-scope permission.</p><pre className="recovery-text" tabIndex={0}>{note.instructions}</pre><p>{repo.handoff ? 'Workspace reconciliation still blocks execution. This action does not release the gate.' : 'Project/global pauses, dependencies, workspace checks and the global slot still apply.'}</p></>,
    })) return;
    setError('');
    await execute('Recovery reviewed; Ready requested. Existing execution gates still apply.', async () => {
      try {
        await api(`/api/tickets/${encodeURIComponent(ticket.repoId)}/${encodeURIComponent(ticket.id)}/action`, { method: 'POST', body: JSON.stringify({ action: 'recover', revision: ticket.revision, executionVersion: ticket.executionVersion ?? null, runId: run.id, noteId: note.id }) });
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Recovery retry was not confirmed.'); throw cause; }
    });
  }

  return <section className="detail-section blocked-recovery" aria-label="Blocked ticket recovery">
    {context}
    <h3>Blocker recovery</h3>
    <p className="muted">Source: <Link to={`/runs/${encodeURIComponent(run.id)}`}>blocked run · {run.revision.slice(0, 10)}</Link>{run.revision !== ticket.revision && ' · Older requirements; reconcile against current criteria.'}</p>
    <h4>Why blocked</h4><p className="recovery-text">{run.blockerDetails?.prerequisite ?? run.blocker ?? 'Not recorded.'}</p>
    <h4>Recommended fix · agent suggestion</h4><p className="recovery-text">{run.blockerDetails?.unblock ?? 'Review the legacy blocker above.'}</p>
    <details><summary>Attempts, checks &amp; partial work</summary>
      <h4>What was tried · agent report</h4><p className="recovery-text">{run.blockerDetails?.attempted ?? 'Not reported. Inspect the source run before repeating any action.'}</p>
      <h4>Permission needed · agent report</h4><p className="recovery-text">{run.blockerDetails?.permission ?? 'Not reported; no additional permission granted.'}</p>
      <h4>What will be checked</h4><p className="recovery-text">{run.blockerDetails?.verification ?? 'Recheck the prerequisite and original acceptance criteria using permitted checks.'}</p>
      <h4>Partial evidence · not inherited passes</h4>{run.evidence.length ? <ul className="evidence-list">{run.evidence.map((item, index) => <li key={index} className="recovery-text">{item}</li>)}</ul> : <p>No partial criterion evidence reported.</p>}
      <h4>Recorded workspace changes</h4><pre className="recovery-text" tabIndex={0}>{run.changedFiles || 'No recorded paths. This does not prove a clean workspace.'}</pre>
    </details>
    {repo.handoff && <p className="warning-text">Recovery can be saved; execution remains blocked by workspace reconciliation. Close this panel to review the project’s New starts blocked notice.</p>}
    <p className="muted">Save instructions separately from requirements. Saving neither approves nor starts work. No secrets; suggestions cannot override repository policy. Maximum 8,000 characters.</p>
    <MarkdownEditor label="Recovery instructions" value={instructions} onChange={setInstructions} repoId={repo.id} api={api} disabled={busy} />
    {invalid && <p className="error-banner" role="alert">Provide 1–8,000 characters of recovery instructions.</p>}
    {stale && <p className="warning-text" role="alert">Requirements or saved recovery note changed. Your text is preserved; copy it before loading the current note and review current requirements.</p>}
    {error && <p className="error-banner" role="alert">{error} Your text is preserved. Load the current note to reconcile before retrying; an uncertain response may already have saved.</p>}
    <div className="toolbar">
      <Button disabled={busy || stale || !!error || invalid || !!base.note && !dirty && base.note.revision === ticket.revision} onClick={() => void save()}>Save recovery note</Button>
      <Button type="primary" disabled={busy || stale || !!error || dirty || invalid || !base.note || base.note.revision !== ticket.revision} onClick={() => void retry()}>Review fix &amp; retry</Button>
      {(stale || error) && <Button disabled={disabled} onClick={async () => {
        if (dirty && !await modal.confirm({ title: 'Replace unsaved recovery instructions?', content: 'Copy your instructions first if you need both versions.', okText: 'Load saved note', cancelText: 'Keep my text' })) return;
        await execute('Current recovery note loaded. Review the current requirements before retrying.', async () => {
          const state = await api<Snapshot>('/api/state');
          const currentRun = state.runs.find(value => value.id === run.id);
          const currentTicket = state.tickets.find(value => value.repoId === ticket.repoId && value.id === ticket.id);
          if (!currentRun || !currentTicket || currentTicket.runId !== currentRun.id) throw new Error('Source run changed; reopen the current ticket.');
          setBase({ note: currentRun.recoveryNote, revision: currentTicket.revision, suggested }); setInstructions(currentRun.recoveryNote?.instructions ?? suggested); setError('');
        });
      }}>Load saved note</Button>}
    </div>
    <p className="muted" role="status">{dirty ? 'Unsaved recovery instructions' : base.note ? 'Recovery note saved separately from requirements' : 'Suggested instructions · save before reviewing retry'}</p>
  </section>;
}
