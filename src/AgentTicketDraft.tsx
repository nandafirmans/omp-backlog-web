import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Input, Modal, Segmented, Select, Tag } from 'antd';
import type { AgentWorkspace, AgentWorkspaceSnapshot, AgentWorkspaceSummary } from '../server/agent-workspace-contracts';
import type { DraftContext, DraftPreparation, DraftSnapshot } from '../server/drafting-contracts';
import type { UploadAttachments } from './attachments';
import MarkdownEditor from './MarkdownEditor';
import type { RequestApi } from './Workspace';
import { proposedTicketMarkdown } from './ticketProposal';
import { currentPlan, workspaceEditorsChanged } from './agentWorkspaceState';
import './AgentTicketDraft.css';

interface Props {
  repoId: string;
  api: RequestApi;
  files: { name: string; file: File }[];
  onUpload: UploadAttachments;
  ticketMarkdown: string;
  initialTicketMarkdown: string;
  onLoadTicket: (markdown: string, discardFiles: boolean) => void;
  onTicketSaved: (markdown: string) => void;
  onBeforeWorkspaceChange: () => Promise<boolean>;
  onUseDraft: (markdown: string) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onReadyChange: (ready: boolean) => void;
  saveBeforePublicationRef: { current: (() => Promise<void>) | null };
  disabled?: boolean;
  children: ReactNode;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export default function AgentTicketDraft({ repoId, api, files, onUpload, ticketMarkdown, initialTicketMarkdown, onLoadTicket, onTicketSaved, onBeforeWorkspaceChange, onUseDraft, onDirtyChange, onBusyChange, onReadyChange, saveBeforePublicationRef, disabled = false, children }: Props) {
  const [workspaces, setWorkspaces] = useState<AgentWorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<AgentWorkspace>();
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [plan, setPlan] = useState('');
  const [revisionId, setRevisionId] = useState<string>();
  const [view, setView] = useState('Discussion');
  const [showArchived, setShowArchived] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<{ input: string; value: DraftPreparation }>();
  const [operation, setOperation] = useState('Loading workspaces…');
  const [error, setError] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const alive = useRef(true);
  const locked = useRef(false);
  const session = useRef('');
  const contextInspector = useRef<HTMLDetailsElement>(null);
  const root = `/api/repos/${encodeURIComponent(repoId)}/agent-workspaces`;
  const selectionKey = `omp-agent-workspace:${repoId}`;
  const path = workspace ? `${root}/${encodeURIComponent(workspace.id)}` : '';
  const busy = !!operation || snapshot?.status === 'busy';
  const unavailable = disabled || busy || !workspace || workspace.archived;
  const connected = !!snapshot && snapshot.status !== 'stopped';
  const dirty = !!workspace && workspaceEditorsChanged(workspace, { title, prompt, plan, ticketMarkdown }, initialTicketMarkdown);
  const input = JSON.stringify([prompt, excluded, files.map(file => [file.name, file.file.size]), snapshot?.model, snapshot?.thinking, workspace?.currentPlanRevisionId]);
  const preparation = prepared?.input === input ? prepared.value : undefined;
  const contexts = preparation?.contexts ?? Array.from(new Map<string, Pick<DraftContext, 'key' | 'label' | 'detail'>>([
    ...files.map(file => [`upload:${file.name}`, { key: `upload:${file.name}`, label: file.name, detail: 'Check context to validate these bytes for the effective model.' }] as const),
    ...(prepared?.value.contexts ?? []).map(context => [context.key, context] as const),
  ]).values()).map(context => ({ ...context, status: excluded.includes(context.key) ? 'excluded' : 'pending' }));
  const messages = snapshot?.messages ?? workspace?.messages ?? [];
  const selectedRevision = workspace?.planRevisions.find(revision => revision.id === revisionId);
  const latestPlan = currentPlan(workspace);
  const inspectingHistory = !!selectedRevision && selectedRevision.id !== workspace?.currentPlanRevisionId;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => { onReadyChange(!!workspace && !workspace.archived); }, [workspace, onReadyChange]);
  useEffect(() => {
    if ((error || snapshot?.error || preparation?.ready === false) && contextInspector.current) contextInspector.current.open = true;
  }, [error, snapshot?.error, preparation?.ready]);

  function remember(value: AgentWorkspace) {
    setWorkspaces(current => [value, ...current.filter(item => item.id !== value.id)]);
  }

  function load(value: AgentWorkspaceSnapshot, discardFiles = true) {
    localStorage.setItem(selectionKey, value.workspace.id);
    setWorkspace(value.workspace); remember(value.workspace);
    setSnapshot(value.draft); session.current = value.draft && value.draft.status !== 'stopped' ? value.workspace.id : '';
    setPrompt(value.workspace.prompt); setTitle(value.workspace.title);
    setPlan(currentPlan(value.workspace)?.markdown ?? '');
    setRevisionId(value.workspace.currentPlanRevisionId ?? undefined);
    setExcluded([]); setPrepared(undefined);
    onLoadTicket(value.workspace.ticketMarkdown || initialTicketMarkdown, discardFiles);
  }

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void api<AgentWorkspaceSummary[]>(root).then(async values => {
      if (cancelled) return;
      setWorkspaces(values);
      const selected = localStorage.getItem(selectionKey);
      const first = values.find(value => value.id === selected) ?? values.find(value => !value.archived);
      if (first) {
        const value = await api<AgentWorkspaceSnapshot>(`${root}/${encodeURIComponent(first.id)}`);
        if (!cancelled) load(value);
      }
    }).catch(cause => { if (!cancelled) setError(failure(cause)); }).finally(() => { if (!cancelled) setOperation(''); });
    return () => {
      cancelled = true; alive.current = false;
      if (session.current) void api(`${root}/${encodeURIComponent(session.current)}/session`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    };
    // Editor callbacks are deliberately not loading triggers: typing never reloads saved editors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, root, selectionKey]);

  useEffect(() => {
    if (!path || snapshot?.status !== 'busy') return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const value = await api<AgentWorkspaceSnapshot>(path);
        if (cancelled) return;
        setSnapshot(value.draft);
        setWorkspace(current => current ? { ...current, messages: value.workspace.messages, model: value.workspace.model, thinking: value.workspace.thinking } : current);
        if (value.draft?.status !== 'busy') { remember(value.workspace); return; }
      } catch (cause) {
        if (cancelled) return;
        setError(`Status check failed: ${failure(cause)}. Available editors remain untouched; checking again without replaying the turn.`);
      }
      timer = window.setTimeout(() => void poll(), 700);
    };
    timer = window.setTimeout(() => void poll(), 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, path, snapshot?.status]);

  async function run(name: string, work: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true; setOperation(name); setError('');
    try { await work(); }
    catch (cause) { if (alive.current) setError(failure(cause)); }
    finally { locked.current = false; if (alive.current) setOperation(''); }
  }

  async function saveEditors() {
    if (!workspace) throw new Error('Open a workspace first.');
    const value = await api<AgentWorkspaceSnapshot>(path, json({ version: workspace.version, title, prompt, ticketMarkdown, ...(plan !== (latestPlan?.markdown ?? '') ? { planMarkdown: plan } : {}) }, 'PATCH'));
    if (!alive.current) return value;
    setWorkspace(value.workspace); remember(value.workspace); setSnapshot(value.draft);
    setRevisionId(value.workspace.currentPlanRevisionId ?? undefined);
    setTitle(value.workspace.title);
    onTicketSaved(ticketMarkdown);
    return value;
  }

  useEffect(() => {
    saveBeforePublicationRef.current = async () => { await saveEditors(); };
    return () => { saveBeforePublicationRef.current = null; };
  });

  async function protectSwitch() {
    if (dirty) {
      if (!await modal.confirm({ title: 'Save editors before switching workspace?', content: 'Save the message, title, plan revision and single-ticket review before opening another workspace. A conflicting save keeps you here with all edits available.', okText: 'Save and continue', cancelText: 'Keep editing' })) return false;
      await saveEditors();
    }
    return onBeforeWorkspaceChange();
  }

  async function stopSession() {
    if (!session.current) return;
    const id = session.current;
    const stopped = await api<DraftSnapshot>(`${root}/${encodeURIComponent(id)}/session`, { method: 'DELETE' });
    session.current = '';
    setWorkspace(current => current ? { ...current, messages: stopped.messages, model: stopped.model, thinking: stopped.thinking } : current);
    setSnapshot(null);
  }

  function openWorkspace(id?: string) {
    void run(id ? 'Opening workspace…' : 'Creating workspace…', async () => {
      if (!await protectSwitch()) return;
      await stopSession();
      const value = id ? await api<AgentWorkspaceSnapshot>(`${root}/${encodeURIComponent(id)}`) : await api<AgentWorkspaceSnapshot>(root, json({}));
      if (alive.current) load(value);
    });
  }

  function contextBody() {
    const data = new FormData();
    data.set('prompt', prompt); data.set('excluded', JSON.stringify(excluded));
    for (const file of files) data.append('files', file.file, file.name);
    return data;
  }

  async function prepare(key = input) {
    const value = await api<DraftPreparation>(`${path}/session/context`, { method: 'POST', body: contextBody() });
    if (alive.current) setPrepared({ input: key, value });
    return value;
  }

  function connect() {
    void run('Connecting to OMP…', async () => {
      if (dirty) await saveEditors();
      const value = await api<AgentWorkspaceSnapshot>(`${path}/connect`, json({}));
      if (!alive.current) { await api(`${path}/session`, { method: 'DELETE' }); return; }
      session.current = value.workspace.id;
      setSnapshot(value.draft);
      setWorkspace(current => current ? { ...current, messages: value.workspace.messages, model: value.workspace.model, thinking: value.workspace.thinking } : current);
      remember(value.workspace); setPrepared(undefined);
    });
  }

  function selectModel(body: { provider: string; modelId: string } | { thinking: string }) {
    void run('Updating saved drafting model…', async () => {
      const next = await api<DraftSnapshot>(`${path}/session/model`, json(body));
      setSnapshot(next); setPrepared(undefined);
      setWorkspace(current => current ? { ...current, model: next.model, thinking: next.thinking } : current);
      const key = JSON.stringify([prompt, excluded, files.map(file => [file.name, file.file.size]), next.model, next.thinking, workspace?.currentPlanRevisionId]);
      await prepare(key);
    });
  }

  function send() {
    if (!snapshot || unavailable || !prompt.trim()) return;
    void run('Saving editors and preparing context…', async () => {
      await saveEditors();
      const checked = await prepare();
      if (!checked.ready) throw new Error('Selected context is not ready. Replace unreadable references or explicitly mark them reference-only, then check again.');
      setOperation('Starting discussion turn…');
      try {
        setSnapshot(await api<DraftSnapshot>(`${path}/session/turn`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: contextBody() }));
      } catch (cause) {
        setSnapshot(current => current ? { ...current, status: 'busy' } : current);
        throw cause;
      }
    });
  }

  function archive() {
    void run(workspace?.archived ? 'Restoring workspace…' : 'Archiving workspace…', async () => {
      if (!workspace) return;
      const version = dirty ? (await saveEditors()).workspace.version : workspace.version;
      if (!await modal.confirm({ title: workspace.archived ? 'Restore this workspace?' : 'Archive this workspace?', content: 'Saved conversation, plan revisions and ticket Markdown are retained. Archiving stops the connected process; nothing is deleted.', okText: workspace.archived ? 'Restore workspace' : 'Stop and archive', cancelText: 'Cancel' })) return;
      await stopSession();
      const value = await api<AgentWorkspaceSnapshot>(path, json({ version, archived: !workspace.archived }, 'PATCH'));
      setWorkspace(value.workspace); remember(value.workspace); setSnapshot(value.draft);
    });
  }

  async function applyPlanProposal(text: string) {
    if (!await modal.confirm({ title: 'Use this message as a proposed plan?', content: 'The full assistant message will replace the plan editor, including any conversational prose. Review and edit it before explicitly saving a revision. This does not approve a plan or create tickets.', okText: 'Use as proposed plan', cancelText: 'Keep current plan', ...(plan !== (latestPlan?.markdown ?? '') ? { okButtonProps: { danger: true } } : {}) })) return;
    setPlan(text); setRevisionId(workspace?.currentPlanRevisionId ?? undefined); setView('Plan');
  }

  return <section className="agent-workspace" aria-label="Persistent agent workspace">
    {modalContext}
    <div className="agent-workspace-toolbar">
      <label className="agent-workspace-picker">Workspace<Select aria-label="Open saved workspace" placeholder="Choose a workspace" value={workspace?.id} disabled={busy || disabled} options={workspaces.filter(item => showArchived || !item.archived || item.id === workspace?.id).map(item => ({ value: item.id, label: `${item.title}${item.archived ? ' · Archived' : ''}` }))} onChange={openWorkspace} /></label>
      <Button disabled={busy || disabled} onClick={() => openWorkspace()}>New workspace</Button>
      <Checkbox checked={showArchived} onChange={event => setShowArchived(event.target.checked)}>Show archived</Checkbox>
      <Button disabled={busy || disabled} onClick={() => void run('Refreshing workspace list…', async () => { setWorkspaces(await api<AgentWorkspaceSummary[]>(root)); })}>Refresh list</Button>
      {workspace && <Button disabled={busy || disabled} onClick={archive}>{workspace.archived ? 'Restore workspace' : 'Archive…'}</Button>}
    </div>
    {workspace && <div className="agent-workspace-title">
      <label>Workspace title<Input aria-label="Workspace title" value={title} disabled={unavailable} onChange={event => setTitle(event.target.value)} /></label>
      <Button disabled={unavailable || !dirty} onClick={() => void run('Saving workspace editors…', async () => { await saveEditors(); })}>Save workspace edits</Button>
      <span className="muted" role="status">{dirty ? 'Unsaved editor changes' : 'Editors saved'}{workspace.archived ? ' · Archived (read-only)' : ''}</span>
    </div>}
    {(error || snapshot?.error) && <div className="error-banner" role="alert">{error && <p>{error}</p>}{snapshot?.error && snapshot.error !== error && <p>{snapshot.error}</p>}<p>Available edits, files and conversation are preserved. No failed turn is replayed automatically.</p>{workspace && <Button disabled={busy || disabled} onClick={() => void run('Loading saved workspace…', async () => { if (dirty && !await modal.confirm({ title: 'Replace local editor changes?', content: 'Load the saved workspace without merging your local edits. Copy them first if needed. Tab-local attachments remain.', okText: 'Load saved editors', cancelText: 'Keep edits', okButtonProps: { danger: true } })) { setError(error); return; } load(await api<AgentWorkspaceSnapshot>(path), false); })}>Load saved editors…</Button>}</div>}
    {!workspace ? <div className="agent-conversation-empty"><h2>Keep the discussion with the work</h2><p>Create a workspace to save a conversation, optional plan revisions and one reviewed ticket. Creating a workspace does not connect OMP or send a message.</p></div> : <div className="agent-workspace-columns">
      <section className="agent-ticket-draft" aria-label="Persistent discussion">
        <header className="agent-draft-heading"><div className="agent-connection-status"><h2>Conversation</h2><Tag aria-live="polite">{operation || (snapshot ? snapshot.status : 'Not connected')}</Tag></div><div className="toolbar agent-session-actions">
          {connected ? <Button disabled={disabled || !!operation} onClick={() => void run('Disconnecting from OMP…', async () => { await stopSession(); const value = await api<AgentWorkspaceSnapshot>(path); setSnapshot(value.draft); setWorkspace(current => current ? { ...current, messages: value.workspace.messages } : current); setPrepared(undefined); })}>Disconnect</Button> : <Button disabled={unavailable} onClick={connect}>Connect to OMP</Button>}
          <Button disabled={disabled || !!operation || snapshot?.status !== 'busy'} onClick={() => void run('Cancelling discussion turn…', async () => { setSnapshot(await api<DraftSnapshot>(`${path}/session/cancel`, json({}))); })}>Cancel turn</Button>
        </div></header>
        <details className="agent-safety-help"><summary>Saved discussion · process &amp; context limits</summary><p>Connect never sends inference or replaces messages. Disconnect and leaving this page stop the owned child; saved discussion remains. No turn is replayed automatically. The process is capability-restricted, not an OS sandbox.</p><p>Only bounded recent text and plan context are supplied to new turns; inspect Model context for truncation. Old images are not replayed. Staged files live only in this tab: reload requires reattaching their bytes. Model settings are saved for drafting only, not ticket execution.</p></details>
        <div className="agent-conversation" role="log" aria-label="Saved drafting conversation" aria-live="polite" aria-relevant="additions text">
          {messages.length ? messages.map((item, index) => <article key={index} className={`agent-message agent-message-${item.role}`}><header><strong>{item.role === 'user' ? 'You' : 'OMP agent'}</strong>{item.status && <Tag>{item.status}</Tag>}{item.model && <small>{item.model}{item.thinking ? ` · ${item.thinking}` : ''}</small>}</header><pre tabIndex={0}>{item.text || (snapshot?.status === 'busy' ? 'Waiting for agent output…' : '(No text returned)')}</pre>{item.role === 'assistant' && item.text.trim() && <div className="toolbar"><Button size="small" disabled={unavailable} onClick={() => void run('Reviewing ticket proposal…', async () => { await onUseDraft(proposedTicketMarkdown(item.text)); setView('Tasks'); })}>Review as single ticket…</Button><Button size="small" disabled={unavailable} onClick={() => void applyPlanProposal(item.text)}>Use as proposed plan…</Button></div>}</article>) : <div className="agent-conversation-empty"><h3>What would you like to change?</h3><p>Discuss an idea, ask for a proposed plan, or request one ticket directly. A plan is optional.</p><small>Connect when ready. You can write and save your message first.</small></div>}
        </div>
        <div className="agent-composer"><MarkdownEditor label="Message to drafting agent" value={prompt} onChange={setPrompt} repoId={repoId} api={api} disabled={unavailable} onUpload={onUpload} /><div className="agent-composer-controls">
          {snapshot ? <div className="agent-model-controls"><label>Model<Select aria-label="Drafting model" showSearch optionFilterProp="label" disabled={unavailable || !connected || !snapshot.models.length} placeholder="Choose a drafting model" value={snapshot.model ? JSON.stringify([snapshot.model.provider, snapshot.model.id]) : undefined} options={snapshot.models.map(model => ({ value: JSON.stringify([model.provider, model.id]), label: `${model.name} · ${model.provider}${model.images ? ' · images' : ''}` }))} onChange={value => { const [provider, modelId] = JSON.parse(value) as [string, string]; selectModel({ provider, modelId }); }} /></label><label>Thinking<Select aria-label="Drafting thinking level" disabled={unavailable || !connected || !snapshot.thinkingLevels.length} value={snapshot.thinking || undefined} options={snapshot.thinkingLevels.map(level => ({ value: level, label: level }))} onChange={thinking => selectModel({ thinking })} /></label></div> : workspace.model && <p className="muted">Saved: {workspace.model.provider} / {workspace.model.id} · {workspace.thinking}</p>}
          <Button type="primary" disabled={unavailable || !connected || !snapshot?.model || !prompt.trim() || preparation?.ready === false} onClick={send}>Send message</Button>
        </div><p className="muted">Send saves current editors first. Your saved message stays in the composer; edit it for the next turn. Nothing sends automatically.</p>
        {busy && <p className="agent-turn-status" role="status">{operation || 'Discussion turn in progress. Partial output remains available.'}</p>}
        <details ref={contextInspector} className="agent-context" aria-label="Prepared model context">
          <summary>Model context · {preparation ? preparation.ready ? 'Ready' : 'Blocked' : 'Checks on send'}</summary>
          <div className="agent-context-body">
            <div className="agent-context-heading"><p className="muted">Preparation reports supplied bytes, not proof of understanding. Reference-only files remain staged for the ticket but are not sent to the model.</p><Button size="small" disabled={unavailable || !connected} onClick={() => void run('Preparing selected context…', async () => { await prepare(); })}>Check context</Button></div>
            {contexts.length ? <ul>{contexts.map(context => <li key={context.key}>
              <div><strong>{context.label}</strong><Tag>{context.status}</Tag><p>{context.detail}</p></div>
              {/^(?:file|skill|upload):/.test(context.key) && <Checkbox disabled={unavailable} checked={excluded.includes(context.key)} onChange={event => setExcluded(current => event.target.checked ? [...current, context.key] : current.filter(key => key !== context.key))}>Reference only (exclude bytes)</Checkbox>}
            </li>)}</ul> : <p className="muted">File and /skill: mentions are resolved securely by the host when checking or sending.</p>}
          </div>
        </details>
        </div>
      </section>
      <section className="agent-workspace-review" aria-label="Workspace review"><div className="agent-review-toolbar"><Segmented aria-label="Workspace review view" value={view} options={['Discussion', 'Plan', 'Tasks']} onChange={setView} /></div>
        <div hidden={view !== 'Discussion'} className="agent-discussion-summary"><h2>Discussion notes</h2><p>The saved conversation stays alongside this review area. Ask the agent for ordinary Markdown, then explicitly transfer a message to the plan or single-ticket editor.</p><p>A plan is optional. Saving or approving one does not run implementation or create tickets.</p><p className="muted">This slice supports one reviewed ticket only. Multiple-task extraction, batch publication and external research are not available.</p></div>
        <div hidden={view !== 'Plan'} className="agent-plan-panel"><h2>Plan revisions</h2><p className="muted">Proposed Markdown, reviewed by you. Each save creates an immutable revision only when the plan changes.</p><label>Read revision<Select aria-label="Plan revision history" value={revisionId} placeholder="No saved revisions" options={workspace.planRevisions.map((revision, index) => ({ value: revision.id, label: `Revision ${index + 1} · ${new Date(revision.createdAt).toLocaleString()}${revision.approvedAt ? ' · Approved' : ''}${revision.id === workspace.currentPlanRevisionId ? ' · Current' : ''}` }))} onChange={setRevisionId} /></label>{inspectingHistory && <p className="warning-text">Reading an older immutable revision. Your current plan edits remain preserved; select the current revision to return to editing.</p>}<MarkdownEditor label={inspectingHistory ? 'Historical plan Markdown (read-only)' : 'Proposed plan Markdown'} value={inspectingHistory ? selectedRevision.markdown : plan} onChange={setPlan} repoId={repoId} api={api} disabled={unavailable || inspectingHistory} onUpload={onUpload} /><div className="toolbar"><Button disabled={unavailable || inspectingHistory || plan === (latestPlan?.markdown ?? '')} onClick={() => void run('Saving plan revision…', async () => { await saveEditors(); })}>Save plan revision</Button><Button disabled={unavailable || inspectingHistory || !latestPlan || !!latestPlan.approvedAt || plan !== latestPlan.markdown} onClick={() => void run('Approving exact plan revision…', async () => { if (!latestPlan || !await modal.confirm({ title: 'Approve this exact plan revision?', content: `Approve revision ${latestPlan.revisionHash.slice(0, 12)} as reviewed planning text? This does not authorize implementation or publish a ticket. Editing the plan creates a new, unapproved revision.`, okText: 'Approve this revision', cancelText: 'Keep reviewing' })) return; const value = await api<AgentWorkspaceSnapshot>(path, json({ version: workspace.version, approvePlanRevisionId: latestPlan.id }, 'PATCH')); setWorkspace(value.workspace); remember(value.workspace); })}>Approve exact revision…</Button></div>{latestPlan && <p className="muted">Current revision {latestPlan.revisionHash.slice(0, 12)} · {latestPlan.approvedAt ? 'Approved' : 'Not approved'}{plan !== latestPlan.markdown ? ' · Unsaved changes are not approved' : ''}</p>}</div>
        <div hidden={view !== 'Tasks'} className="agent-single-ticket"><h2>Tasks · single ticket only</h2><p className="muted">Review and publish one ticket with its staged attachments. No multiple-task extraction or batch publication is available.</p>{children}</div>
      </section>
    </div>}
  </section>;
}
