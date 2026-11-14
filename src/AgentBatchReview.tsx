import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Checkbox, Input, Modal } from 'antd';
import type { AgentWorkspace, TaskProposal } from '../server/agent-workspace-contracts';
import type { RequestApi } from './Workspace';
import { dependencyIssues, moveProposal } from './batchReview';

type Review = { id: string; version: number; proposalSetId: string; proposals: TaskProposal[]; selectedKeys: string[]; updatedAt: number };
export type BatchOperation = { confirmation: string; workspaceId: string; reviewId: string; reviewVersion: number; proposalSetId: string | null; sourcePlanRevisionId: string | null; state: 'prepared' | 'publishing' | 'complete' | 'blocked'; phase?: 'staging' | 'publishing' | 'reconciling'; mode: string; expires: number; error?: string; compacted?: boolean; tickets: { key: string; id: string; markdown: string; dependencies: string[]; revision?: string }[]; publicationId?: string };
type ArtifactFinding = { status: 'match' | 'missing' | 'mismatch' | 'unproven'; identity: Identity | null; expectedIdentity: Identity | null; files: { status: 'match' | 'missing' | 'mismatch' | 'unexpected'; details: string[] } };
const inspectionAllowsRecovery = (operation: BatchOperation | undefined, inspection: OperationInspection | undefined) =>
  !!operation && !!inspection && operation.confirmation === inspection.confirmation && operation.state === inspection.state && inspection.safeToResume && (operation.state === 'publishing' || operation.state === 'blocked');
type OperationInspection = { confirmation: string; state: BatchOperation['state']; safeToResume: boolean; reasons: string[]; tickets: { id: string; key: string; status: 'not_started' | 'staged' | 'published' | 'ambiguous'; reason?: string; expectedRevision: string; stage: ArtifactFinding; published: ArtifactFinding }[] };
type Identity = { dev: number; ino: number; birthtimeMs: number };
const findingLabel: Record<ArtifactFinding['status'], string> = { match: 'Matching', missing: 'Missing', mismatch: 'Mismatched', unproven: 'Unproven' };
const fileFindingLabel: Record<ArtifactFinding['files']['status'], string> = { match: 'Matching', missing: 'Missing', mismatch: 'Mismatched', unexpected: 'Unexpected' };
const recoveryLabel: Record<OperationInspection['tickets'][number]['status'], string> = { not_started: 'Not started', staged: 'Staged', published: 'Published', ambiguous: 'Ambiguous' };
type BatchWorkspace = AgentWorkspace & { batchReview?: Review | null };
type Props = { workspace: AgentWorkspace; initialOperations: BatchOperation[]; path: string; api: RequestApi; disabled: boolean; workspaceDirty: boolean; onWorkspace: (value: AgentWorkspace) => void; onDirty: (value: boolean) => void; onBusy: (value: boolean) => void; saveRef: { current: (() => Promise<AgentWorkspace | undefined>) | null } };
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const lines = (value: string) => value ? value.split('\n') : [];

export default function AgentBatchReview({ workspace, initialOperations, path, api, disabled, workspaceDirty, onWorkspace, onDirty, onBusy, saveRef }: Props) {
  const initial = workspace as BatchWorkspace;
  const latest = initial.proposalSets.at(-1);
  const savedForLatest = initial.batchReview?.proposalSetId === latest?.id;
  const initialProposals = savedForLatest ? initial.batchReview!.proposals : latest?.payload.proposals ?? [];
  const initialSelected = savedForLatest ? initial.batchReview!.selectedKeys : initialProposals.map(item => item.key);
  const initialSetId = latest?.id ?? initial.batchReview?.proposalSetId ?? '';
  const [review, setReview] = useState(initial.batchReview ?? null);
  const [setId, setSetId] = useState(initialSetId);
  const [proposals, setProposals] = useState<TaskProposal[]>(() => structuredClone(initialProposals));
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [baseline, setBaseline] = useState(() => JSON.stringify([initialSetId, initialProposals, initialSelected]));
  const [quickPreviewOpen, setQuickPreviewOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [operations, setOperations] = useState<BatchOperation[]>(initialOperations);
  const [operationId, setOperationId] = useState(initialOperations.at(-1)?.confirmation ?? '');
  const [inspections, setInspections] = useState<Record<string, OperationInspection>>({});
  const [statusRequired, setStatusRequired] = useState<string[]>([]);
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
  const inspection = operation ? inspections[operation.confirmation] : undefined;
  const mustCheckStatus = statusRequired.length > 0;
  const safeToRecover = inspectionAllowsRecovery(operation, inspection) && !mustCheckStatus;
  const alreadyPublished = !dirty && operation?.state === 'complete' && operation.proposalSetId === setId && review?.id === operation.reviewId && review.version === operation.reviewVersion;
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
  async function quickReview() {
    if (!setId || !chosen.length || issues.length || (stale && !acknowledged) || mustCheckStatus || workspaceDirty) return;
    await run(async () => {
      // One deliberate review action saves the selection and asks the server for an
      // immutable exact preview. Publication remains a distinct confirmation.
      let version = workspace.version;
      let current = review;
      if (!current || current.proposalSetId !== setId || dirty) {
        const saved = await save();
        if (!saved) return;
        version = saved.version;
        current = saved.batchReview ?? null;
      }
      if (!current) throw new Error('The reviewed tickets could not be saved.');
      if (!dirty && operation?.state === 'prepared' && !operation.compacted &&
        operation.reviewId === current.id && operation.reviewVersion === current.version && Date.now() < operation.expires) {
        // Reopen the same exact reserved preview after Cancel; do not mint a second.
        setQuickPreviewOpen(true);
        return;
      }
      const preview = await api<BatchOperation>(`${path}/batch-preview`, json({
        version, reviewId: current.id, reviewVersion: current.version, acknowledgeStalePlan: acknowledged,
      }));
      updateOperation(preview);
      setQuickPreviewOpen(true);
    });
  }
  async function quickPublish() {
    if (!operation || operation.state !== 'prepared' || operation.compacted || mustCheckStatus || workspaceDirty || dirty) return;
    await run(async () => {
      try {
        const published = await api<BatchOperation>(`${path}/batch-publish`, json({ confirmation: operation.confirmation }));
        updateOperation(published);
        setQuickPreviewOpen(false);
      } catch (cause) {
        setStatusRequired(current => current.includes(operation.confirmation) ? current : [...current, operation.confirmation]);
        setQuickPreviewOpen(false);
        throw cause;
      }
    });
  }
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
  async function checkStatus(confirmation: string) {
    const value = await api<BatchOperation>(`${path}/batch-operations/${encodeURIComponent(confirmation)}`);
    updateOperation(value);
    setStatusRequired(current => current.filter(id => id !== confirmation));
    setInspections(current => { const next = { ...current }; delete next[confirmation]; return next; });
  }
  async function inspectOperation(confirmation: string) {
    const value = await api<OperationInspection>(`${path}/batch-operations/${encodeURIComponent(confirmation)}/inspect`);
    if (value.confirmation !== confirmation) throw new Error('Inspection response does not match this publication.');
    setInspections(current => ({ ...current, [confirmation]: value }));
  }
  async function recoverOperation(confirmation: string) {
    if (!await modal.confirm({ title: 'Resume this publication?', content: 'The latest inspection says it is safe to resume. This continues only the exact journaled operation and its reviewed ticket contents.', okText: 'Resume publication', cancelText: 'Cancel', okButtonProps: { danger: true } })) return;
    await run(async () => {
      try {
        const value = await api<BatchOperation>(`${path}/batch-operations/${encodeURIComponent(confirmation)}/recover`, json({ confirm: true }));
        updateOperation(value);
        setInspections(current => { const next = { ...current }; delete next[confirmation]; return next; });
      } catch (cause) {
        setStatusRequired(current => current.includes(confirmation) ? current : [...current, confirmation]);
        throw cause;
      }
    });
  }
  return <section className="agent-batch-review" aria-label="Batch task review">{modalContext}
    {workspace.proposalSets.at(-1)?.id !== setId && workspace.proposalSets.length > 0 && <div className="agent-new-proposal"><Button type="primary" disabled={disabled || busy} onClick={() => void chooseSet(workspace.proposalSets.at(-1)!.id)}>Review newly generated tickets</Button></div>}
    {!!setId && <div className="agent-quick-tickets">
      <h3>{chosen.length} of {proposals.length} tickets selected</h3>
      <p className="muted">Review the titles. Open a ticket only if you want to change its details.</p>
      <div className="agent-quick-ticket-list">
        {proposals.map((item, index) => <div className="agent-quick-ticket" key={item.key}>
          <Checkbox checked={selected.includes(item.key)} disabled={disabled || busy} onChange={value => {
            setSelected(current => value.target.checked ? [...current, item.key] : current.filter(key => key !== item.key));
            setModeConfirmed(false);
          }}>{item.title || 'Untitled ticket'}</Checkbox>
          <span className="agent-quick-dependencies">{item.dependsOn.length ? `After ${item.dependsOn.join(', ')}` : 'Independent'}</span>
          <details className="agent-quick-ticket-edit">
            <summary>Edit details</summary>
            <label>Title<Input aria-label={`Task title ${index + 1}`} value={item.title} disabled={disabled || busy} onChange={event => edit(index, 'title', event.target.value)} /></label>
            {(['description', 'acceptanceCriteria', 'verification', 'dependsOn', 'sourceReferences'] as const).map(field => <label key={field}>{({
              description: 'Description', acceptanceCriteria: 'Acceptance criteria · one per line', verification: 'Verification · one per line',
              dependsOn: 'Dependencies · task keys or existing ticket IDs, one per line', sourceReferences: 'Source references · one per line',
            })[field]}<Input.TextArea aria-label={`${field} ${index + 1}`} value={typeof item[field] === 'string' ? item[field] : item[field].join('\n')} disabled={disabled || busy} autoSize={{ minRows: 2, maxRows: 8 }} onChange={event => edit(index, field, field === 'description' ? event.target.value : lines(event.target.value))} /></label>)}
            <div className="toolbar"><Button size="small" disabled={disabled || busy || index === 0} onClick={() => setProposals(current => moveProposal(current, index, -1))}>Move up</Button><Button size="small" disabled={disabled || busy || index === proposals.length - 1} onClick={() => setProposals(current => moveProposal(current, index, 1))}>Move down</Button></div>
          </details>
        </div>)}
      </div>
      {issues.length > 0 && <div className="error-banner" role="alert"><strong>Fix ticket dependencies</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {stale && <div className="warning-text"><p>These tickets came from an older plan revision.</p><Checkbox checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledgedSource(event.target.checked ? staleIdentity : '')}>I've reviewed the differences</Checkbox></div>}
      {workspaceDirty && <p className="warning-text">Save your unsaved chat or plan edits before creating tickets.</p>}
      <div className="agent-quick-ticket-actions">
        {alreadyPublished ? <p className="muted" role="status">This reviewed ticket set has already been created. Generate a new version to create more tickets.</p>
          : <Button type="primary" disabled={disabled || busy || mustCheckStatus || workspaceDirty || !chosen.length || !!issues.length || (stale && !acknowledged)} onClick={() => void quickReview()}>
            Review {chosen.length} {chosen.length === 1 ? 'ticket' : 'tickets'} &amp; create…
          </Button>}
        {workspace.proposalSets.length > 1 && <details className="agent-older-sets"><summary>Previous versions</summary>
          {workspace.proposalSets.map((set, index) => <Button key={set.id} size="small" disabled={disabled || busy} onClick={() => void chooseSet(set.id)}>Version {index + 1}</Button>)}
        </details>}
      </div>
    </div>}
    {operation?.state === 'complete' && <div className="agent-publication-done" role="status">
      <strong>{operation.tickets.length} Draft tickets created.</strong>
      <div className="agent-created-ticket-links">{operation.tickets.map(ticket =>
        <Link key={ticket.id} to={`/projects/${encodeURIComponent(workspace.repoId)}/tickets/${encodeURIComponent(ticket.id)}`}>{ticket.id}</Link>,
      )}</div>
    </div>}
    {(operation?.state === 'blocked' || operation?.state === 'publishing' || mustCheckStatus) && <p className="error-banner" role="alert">
      Publication needs attention. Open recovery tools below before creating another batch.
    </p>}
    <Modal title={`Create ${operation?.tickets.length ?? 0} Draft tickets?`} open={quickPreviewOpen && !!operation}
      onCancel={() => { if (!busy) setQuickPreviewOpen(false); }}
      onOk={() => void quickPublish()} okText="Create Draft tickets" okButtonProps={{ disabled: busy || mustCheckStatus || workspaceDirty || dirty || operation?.state !== 'prepared' || !!operation?.compacted }}
      confirmLoading={busy} closable={!busy} maskClosable={!busy} keyboard={!busy} width={800} destroyOnHidden>
      {operation && <div className="agent-quick-preview">
        <p>The exact ticket files below will be created in <strong>{operation.mode}</strong> execution mode. {operation.mode === 'automatic' ? 'Eligible tickets may begin implementation immediately.' : 'They remain unapproved until separately authorized.'}</p>
        <p className="muted">Review each ticket's complete Markdown by opening its details. This preview expires {new Date(operation.expires).toLocaleTimeString()}.</p>
        {operation.tickets.map(ticket => <details key={ticket.key}>
          <summary>{ticket.id} · {ticket.markdown.match(/^title:\s*(.+)$/m)?.[1] ?? ticket.key} · Dependencies: {ticket.dependencies.join(', ') || 'None'}</summary>
          <pre tabIndex={0}>{ticket.markdown}</pre>
        </details>)}
      </div>}
    </Modal>
    <details className="agent-advanced-review" open={advancedOpen || operation?.state === 'blocked' || operation?.state === 'publishing' || mustCheckStatus} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
      <summary>Advanced ticket editing, history &amp; recovery</summary>
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
      <div className="toolbar"><Button disabled={disabled || busy || proposals.length >= 12} onClick={() => { const key = `task-manual-${crypto.randomUUID().slice(0, 8)}`; setProposals(current => [...current, { key, title: '', description: '', acceptanceCriteria: [], verification: [], dependsOn: [], sourceReferences: [] }]); setSelected(current => [...current, key]); }}>Add task</Button><Button disabled={disabled || busy || mustCheckStatus || !dirty} onClick={() => void run(async () => { await save(); })}>Save task review</Button><Button disabled={disabled || busy || workspaceDirty} onClick={() => void loadSavedReview()}>Load saved task review</Button></div>
      {issues.length > 0 && <div className="error-banner" role="alert"><strong>Dependency feedback</strong><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      {stale && <div className="warning-text"><p>The proposal set was generated from a different plan revision. Review it against the current plan before proceeding.</p><Checkbox checked={acknowledged} disabled={disabled || busy} onChange={event => setAcknowledgedSource(event.target.checked ? staleIdentity : '')}>I reviewed this stale plan source against the current plan</Checkbox></div>}
      {workspaceDirty && <p className="warning-text">Save workspace edits, including the current plan, before previewing or publishing.</p>}
      <Button type="primary" disabled={disabled || busy || mustCheckStatus || dirty || workspaceDirty || !review || !chosen.length || !!issues.length || (stale && !acknowledged)} onClick={() => void run(async () => { const preview = await api<BatchOperation>(`${path}/batch-preview`, json({ version: workspace.version, reviewId: review!.id, reviewVersion: review!.version, acknowledgeStalePlan: acknowledged })); updateOperation(preview); setModeConfirmed(false); })}>Preview exact publication</Button>
    </>}
    {operations.length > 1 && <div className="toolbar" aria-label="Publication history">{operations.map((item, index) => <Button key={item.confirmation} disabled={disabled || busy} onClick={() => { setOperationId(item.confirmation); setModeConfirmed(false); }}>Publication {index + 1} · {item.compacted && item.state === 'prepared' ? 'expired' : item.state}</Button>)}</div>}
    {operation && <section className="agent-proposal-set" aria-label="Batch publication preview"><h3>Publication {operation.compacted && operation.state === 'prepared' ? 'expired · compacted' : operation.state}{!operation.compacted && operation.phase ? ` · ${operation.phase}` : ''}</h3>
      {operation.compacted ? operation.state === 'complete' ? <p className="muted">Publication audit retained: assigned ticket IDs, dependencies and content revisions remain recorded. The full preview has been compacted; open the published tickets to inspect their current contents.</p> : <p className="warning-text" role="status">This preview expired before publication and was permanently compacted. It cannot be published or resumed. Create a new preview from the saved task review.</p> : <p>Execution mode: <strong>{operation.mode}</strong>. Automatic mode may start eligible tickets after publication; approval and scheduler gates remain in effect. Preview expires {new Date(operation.expires).toLocaleString()}.</p>}
      {operation.state === 'complete' && <><p>Source workspace: <code>{operation.workspaceId}</code> · Review: <code>{operation.reviewId}</code> (version {operation.reviewVersion}) · Proposal set: <code>{operation.proposalSetId ?? 'Unavailable'}</code></p><p>Source plan revision: <code>{operation.sourcePlanRevisionId ?? 'No plan'}</code></p>{operation.sourcePlanRevisionId && workspace.planRevisions.find(plan => plan.id === operation.sourcePlanRevisionId) && <details><summary>Inspect source plan</summary><pre tabIndex={0}>{workspace.planRevisions.find(plan => plan.id === operation.sourcePlanRevisionId)!.markdown}</pre></details>}</>}
      {operation.tickets.map(ticket => <details key={ticket.key} open><summary>{ticket.key} → {ticket.id}</summary>{operation.state === 'complete' && <p><Link to={`/projects/${encodeURIComponent(workspace.repoId)}/tickets/${encodeURIComponent(ticket.id)}`}>Open {ticket.id}</Link></p>}<p>Published dependencies: {ticket.dependencies.join(', ') || 'None'}</p>{ticket.revision && <p>Original published revision: <code>{ticket.revision}</code></p>}{!operation.compacted && <pre tabIndex={0}>{ticket.markdown}</pre>}</details>)}
      {operation.state === 'complete' && <p role="status">Publication {operation.publicationId ?? operation.confirmation} completed. Tickets: {operation.tickets.map(ticket => ticket.id).join(', ')}.</p>}
      {operation.state === 'blocked' && <p className="error-banner" role="alert">Publication is blocked and requires operator inspection.{operation.error ? ` ${operation.error}` : ''}</p>}
      {mustCheckStatus && !operation.compacted && <p className="warning-text" role="alert">The last publication response was uncertain. Check this operation’s status before attempting another mutation.</p>}
      <div className="toolbar"><Button disabled={disabled || busy} onClick={() => void run(async () => { await checkStatus(operation.confirmation); })}>Check publication status</Button>
      {!operation.compacted && operation.state === 'prepared' && <><Checkbox checked={modeConfirmed} disabled={disabled || busy || mustCheckStatus} onChange={event => setModeConfirmed(event.target.checked)}>I confirm publication in {operation.mode} mode with the exact preview above</Checkbox><Button type="primary" disabled={disabled || busy || mustCheckStatus || dirty || workspaceDirty || !modeConfirmed} onClick={() => void run(async () => { try { updateOperation(await api<BatchOperation>(`${path}/batch-publish`, json({ confirmation: operation.confirmation }))); } catch (cause) { setStatusRequired(current => current.includes(operation.confirmation) ? current : [...current, operation.confirmation]); throw cause; } })}>Publish exact preview</Button></>}</div>
      {!operation.compacted && (operation.state === 'publishing' || operation.state === 'blocked') && <div className="agent-batch-inspection"><h4>Operator inspection &amp; recovery</h4><p className="muted">Inspect the durable journal before resuming an interrupted publication. No repository paths are exposed here; artifact identities are shown as returned by the host.</p>
        {!inspection && <Button disabled={disabled || busy} onClick={() => void run(async () => { await inspectOperation(operation.confirmation); })}>Inspect publication</Button>}
        {inspection && <><p role="status">Inspection for {inspection.confirmation} · observed state: {inspection.state} · {inspection.safeToResume ? 'Safe to resume' : 'Not safe to resume'}</p>
          {!!inspection.reasons.length && <div className={inspection.safeToResume ? 'warning-text' : 'error-banner'}><strong>Inspection reasons</strong><ul>{inspection.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
          <div className="agent-batch-inspection-tickets">{inspection.tickets.map(ticket => <details key={ticket.key}><summary>{ticket.key} → {ticket.id} · {recoveryLabel[ticket.status]}</summary>
            <p>Expected revision: <code>{ticket.expectedRevision}</code></p>{ticket.reason && <p>{ticket.reason}</p>}
            {(['stage', 'published'] as const).map(name => { const finding = ticket[name]; return <section key={name}><h5>{name === 'stage' ? 'Staged directory' : 'Published directory'} · {findingLabel[finding.status]}</h5>
              <p>Observed identity: <code>{finding.identity ? `device ${finding.identity.dev} · inode ${finding.identity.ino} · created ${new Date(finding.identity.birthtimeMs).toLocaleString()}` : 'Not available'}</code></p><p>Expected identity: <code>{finding.expectedIdentity ? `device ${finding.expectedIdentity.dev} · inode ${finding.expectedIdentity.ino} · created ${new Date(finding.expectedIdentity.birthtimeMs).toLocaleString()}` : 'Not available'}</code></p>
              <p>Files: <strong>{fileFindingLabel[finding.files.status]}</strong></p>{!!finding.files.details.length && <ul>{finding.files.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
            </section>; })}
          </details>)}</div>
          {safeToRecover ? <Button type="primary" disabled={disabled || busy} onClick={() => void recoverOperation(operation.confirmation)}>Resume same publication</Button> : <p className="muted">Recovery is unavailable until the latest inspection for this exact operation state reports that resuming is safe.</p>}
        </>}
      </div>}
      {!operation.compacted && <p className="muted">A lost response is uncertain. Check status; interrupted publications require inspection and explicit recovery of the same confirmation. Nothing is replayed automatically.</p>}
    </section>}
    </details>
    {error && <div className="error-banner" role="alert">{error} Your review remains available. Check publication status before taking further action after an uncertain response.</div>}
  </section>;
}
