import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input, Modal } from 'antd';
import type { AgentWorkspace, TaskProposal } from '../server/agent-workspace-contracts';
import type { RequestApi } from './Workspace';
import { dependencyIssues, moveProposal } from './batchReview';

type Review = { id: string; version: number; proposalSetId: string; proposals: TaskProposal[]; selectedKeys: string[]; updatedAt: number };
export type BatchOperation = { confirmation: string; reviewId: string; state: 'prepared' | 'publishing' | 'complete' | 'blocked'; phase?: 'staging' | 'publishing' | 'reconciling'; mode: string; expires: number; error?: string; tickets: { key: string; id: string; markdown: string; dependencies: string[] }[]; publicationId?: string };
type BatchWorkspace = AgentWorkspace & { batchReview?: Review | null };
type Props = { workspace: AgentWorkspace; initialOperations: BatchOperation[]; path: string; api: RequestApi; disabled: boolean; workspaceDirty: boolean; onWorkspace: (value: AgentWorkspace) => void; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; saveRef: { current: (() => Promise<AgentWorkspace | undefined>) | null } };
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const lines = (value: string) => value ? value.split('\n') : [];

export default function AgentBatchReview({ workspace, initialOperations, path, api, disabled, workspaceDirty, onWorkspace, onDirty, onBusy, saveRef }: Props) {
  const initial = workspace as BatchWorkspace;
  const [review, setReview] = useState(initial.batchReview ?? null);
  const [setId, setSetId] = useState(initial.batchReview?.proposalSetId ?? '');
  const [proposals, setProposals] = useState<TaskProposal[]>(initial.batchReview?.proposals ?? []);
  const [selected, setSelected] = useState<string[]>(initial.batchReview?.selectedKeys ?? []);
  const [baseline, setBaseline] = useState(() => JSON.stringify([initial.batchReview?.proposalSetId ?? '', initial.batchReview?.proposals ?? [], initial.batchReview?.selectedKeys ?? []]));
  const [operations, setOperations] = useState<BatchOperation[]>(initialOperations);
  const [operationId, setOperationId] = useState(initialOperations.at(-1)?.confirmation ?? '');
  const [acknowledgedSource, setAcknowledgedSource] = useState('');
  const [modeConfirmed, setModeConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const lock = useRef(false);
  const chosen = proposals.filter(item => selected.includes(item.key));
  const dirty = JSON.stringify([setId, proposals, selected]) !== baseline;
  const issues = dependencyIssues(chosen);
  const source = workspace.proposalSets.find(item => item.id === setId);
  const stale = !!source && source.sourcePlanRevisionId !== workspace.currentPlanRevisionId;
  const staleIdentity = JSON.stringify([setId, workspace.currentPlanRevisionId]);
  const acknowledged = acknowledgedSource === staleIdentity;
  const operation = operations.find(item => item.confirmation === operationId);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (!setId) return;
    const result = await api<{ workspace: AgentWorkspace; review: Review }>(`${path}/batch-review`, json({ version: workspace.version, proposalSetId: setId, reviewVersion: review?.version ?? null, proposals, selectedKeys: proposals.filter(item => selected.includes(item.key)).map(item => item.key) }, 'PUT'));
    setReview(result.review); setBaseline(JSON.stringify([setId, proposals, selected])); onWorkspace(result.workspace);
    return result.workspace;
  }
  useEffect(() => { saveRef.current = save; return () => { saveRef.current = null; }; });
  function edit(index: number, field: keyof TaskProposal, value: string | string[]) {
    setProposals(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
    setModeConfirmed(false);
  }
  async function chooseSet(id: string) {
    if (id === setId) return;
    if (dirty && !await modal.confirm({ title: 'Replace unsaved task review?', content: 'Save your task review first to preserve its edits. Switching sets replaces the current editor.', okText: 'Replace editor', cancelText: 'Keep editing', okButtonProps: { danger: true } })) return;
    if (review && review.proposalSetId !== id && !await modal.confirm({ title: 'Replace saved task review?', content: 'Saving a review for another set replaces the current saved review. Switch only if you no longer need its edits.', okText: 'Switch sets', cancelText: 'Keep review', okButtonProps: { danger: true } })) return;
    const next = workspace.proposalSets.find(item => item.id === id);
    if (!next) return;
    const saved = review?.proposalSetId === id ? review : null;
    setSetId(id); setProposals(structuredClone(saved?.proposals ?? next.payload.proposals)); setSelected(saved?.selectedKeys ?? next.payload.proposals.map(item => item.key)); setAcknowledgedSource(''); setModeConfirmed(false);
  }
  async function loadSavedReview() {
    if (dirty && !await modal.confirm({ title: 'Discard unsaved task review?', content: 'Loading the current saved review replaces these local task edits.', okText: 'Load saved review', cancelText: 'Keep editing', okButtonProps: { danger: true } })) return;
    await run(async () => {
      const value = await api<{ workspace: AgentWorkspace; batchOperations?: BatchOperation[] }>(path);
      const saved = value.workspace.batchReview ?? null;
      const nextId = saved?.proposalSetId ?? '';
      const nextProposals = saved?.proposals ?? [];
      const nextSelected = saved?.selectedKeys ?? [];
      setReview(saved); setSetId(nextId); setProposals(nextProposals); setSelected(nextSelected);
      setBaseline(JSON.stringify([nextId, nextProposals, nextSelected])); setOperations(value.batchOperations ?? []);
      setOperationId(value.batchOperations?.at(-1)?.confirmation ?? ''); setAcknowledgedSource(''); setModeConfirmed(false);
      onWorkspace(value.workspace);
    });
  }
  function updateOperation(value: BatchOperation) { setOperations(current => [...current.filter(item => item.confirmation !== value.confirmation), value]); setOperationId(value.confirmation); }
  return <section className="agent-batch-review" aria-label="Batch task review">{modalContext}
    <h3>Review and publish tasks</h3><p className="muted">Choose a proposal set, edit and select tasks, then save the review. Publishing creates unapproved Draft tickets; it does not approve them. Batch publication does not include attachments.</p>
    <div className="toolbar">{workspace.proposalSets.map((set, index) => <Button key={set.id} disabled={disabled || busy} onClick={() => void chooseSet(set.id)}>{set.id === setId ? 'Editing' : 'Review'} set {index + 1}</Button>)}</div>
    {setId && <><p role="status">{dirty ? 'Unsaved task review changes' : 'Task review saved'} · {chosen.length} selected</p>
      {proposals.map((item, index) => <details className="agent-task-proposal" key={item.key}><summary>{selected.includes(item.key) ? 'Selected' : 'Not selected'} · {item.key} · {item.title || 'Untitled'}</summary>
        <Checkbox checked={selected.includes(item.key)} disabled={disabled || busy} onChange={event => { setSelected(current => event.target.checked ? [...current, item.key] : current.filter(key => key !== item.key)); setModeConfirmed(false); }}>Include in publication</Checkbox>
        <div className="toolbar"><Button disabled={disabled || busy || index === 0} onClick={() => setProposals(current => moveProposal(current, index, -1))}>Move up</Button><Button disabled={disabled || busy || index === proposals.length - 1} onClick={() => setProposals(current => moveProposal(current, index, 1))}>Move down</Button></div>
        <p>Task key: <code>{item.key}</code></p>
        <label>Title<Input aria-label={`Task title ${index + 1}`} value={item.title} disabled={disabled || busy} onChange={event => edit(index, 'title', event.target.value)} /></label>
        {(['description', 'acceptanceCriteria', 'verification', 'dependsOn', 'sourceReferences'] as const).map(field => <label key={field}>{({ description: 'Description', acceptanceCriteria: 'Acceptance criteria · one per line', verification: 'Verification · one per line', dependsOn: 'Dependencies · task keys or existing ticket IDs, one per line', sourceReferences: 'Source references · one per line' })[field]}<Input.TextArea aria-label={`${field} ${index + 1}`} value={typeof item[field] === 'string' ? item[field] : item[field].join('\n')} disabled={disabled || busy} autoSize={{ minRows: 2, maxRows: 8 }} onChange={event => edit(index, field, field === 'description' ? event.target.value : lines(event.target.value))} /></label>)}
      </details>)}
      <div className="toolbar"><Button disabled={disabled || busy || proposals.length >= 12} onClick={() => { const key = `task-manual-${crypto.randomUUID().slice(0, 8)}`; setProposals(current => [...current, { key, title: '', description: '', acceptanceCriteria: [], verification: [], dependsOn: [], sourceReferences: [] }]); setSelected(current => [...current, key]); }}>Add task</Button><Button disabled={disabled || busy || !dirty} onClick={() => void run(async () => { await save(); })}>Save task review</Button><Button disabled={disabled || busy || workspaceDirty} onClick={() => void loadSavedReview()}>Load saved task review</Button></div>
      {issues.length > 0 && <div className="error-banner" role="alert"><strong>Dependency feedback</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {stale && <div className="warning-text"><p>The proposal set was generated from a different plan revision. Review it against the current plan before proceeding.</p><Checkbox checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledgedSource(event.target.checked ? staleIdentity : '')}>I reviewed this stale plan source against the current plan</Checkbox></div>}
      {workspaceDirty && <p className="warning-text">Save workspace edits, including the current plan, before previewing or publishing.</p>}
      <Button type="primary" disabled={disabled || busy || dirty || workspaceDirty || !review || !chosen.length || !!issues.length || (stale && !acknowledged)} onClick={() => void run(async () => { const preview = await api<BatchOperation>(`${path}/batch-preview`, json({ version: workspace.version, reviewId: review!.id, reviewVersion: review!.version, acknowledgeStalePlan: acknowledged })); updateOperation(preview); setModeConfirmed(false); })}>Preview exact publication</Button>
    </>}
    {operations.length > 1 && <div className="toolbar" aria-label="Publication history">{operations.map((item, index) => <Button key={item.confirmation} disabled={disabled || busy} onClick={() => { setOperationId(item.confirmation); setModeConfirmed(false); }}>Publication {index + 1} · {item.state}</Button>)}</div>}
    {operation && <section className="agent-proposal-set" aria-label="Batch publication preview"><h3>Publication {operation.state}{operation.state === 'publishing' && operation.phase ? ` · ${operation.phase}` : ''}</h3><p>Execution mode: <strong>{operation.mode}</strong>. Automatic mode may start eligible tickets after publication; approval and scheduler gates remain in effect. Preview expires {new Date(operation.expires).toLocaleString()}.</p>
      {operation.tickets.map(ticket => <details key={ticket.key} open><summary>{ticket.key} → {ticket.id}</summary><p>Dependencies: {ticket.dependencies.join(', ') || 'None'}</p><pre tabIndex={0}>{ticket.markdown}</pre></details>)}
      {operation.state === 'complete' && <p role="status">Publication {operation.publicationId ?? operation.confirmation} completed. Tickets: {operation.tickets.map(ticket => ticket.id).join(', ')}.</p>}
      {operation.state === 'blocked' && <p className="error-banner" role="alert">Publication is blocked and requires operator inspection.{operation.error ? ` ${operation.error}` : ''}</p>}
      <div className="toolbar"><Button disabled={disabled || busy} onClick={() => void run(async () => updateOperation(await api<BatchOperation>(`${path}/batch-operations/${encodeURIComponent(operation.confirmation)}`)))}>Check publication status</Button>
      {operation.state !== 'complete' && <><Checkbox checked={modeConfirmed} disabled={disabled || busy} onChange={event => setModeConfirmed(event.target.checked)}>I confirm publication in {operation.mode} mode with the exact preview above</Checkbox><Button type="primary" disabled={disabled || busy || dirty || workspaceDirty || !modeConfirmed || operation.state === 'blocked'} onClick={() => void run(async () => { try { await api(`${path}/batch-publish`, json({ confirmation: operation.confirmation })); } finally { updateOperation(await api<BatchOperation>(`${path}/batch-operations/${encodeURIComponent(operation.confirmation)}`)); } })}>{operation.state === 'publishing' ? 'Retry same confirmation' : 'Publish exact preview'}</Button></>}</div><p className="muted">A lost response is uncertain. Check status; only an explicit retry of this same confirmation is permitted. Nothing is replayed automatically. Blocked publication requires operator inspection.</p>
    </section>}
    {error && <div className="error-banner" role="alert">{error} Your review remains available. Check publication status before retrying an uncertain operation.</div>}
  </section>;
}
