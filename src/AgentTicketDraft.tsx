import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Drawer, Grid, Input, Modal, Spin, Tag } from 'antd';
import { ArrowDownIcon } from '@phosphor-icons/react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router';
import type { AgentWorkspace, AgentWorkspaceSnapshot, AgentWorkspaceSummary, ResponseGenerationModels, ResponseOperation } from '../server/agent-workspace-contracts';
import type { DraftContext, DraftPreparation, DraftSnapshot } from '../server/drafting-contracts';
import type { UploadAttachments } from './attachments';
import MarkdownEditor from './MarkdownEditor';
import type { RequestApi } from './Workspace';
import { acceptedComposerText, mergeWorkspaceRuntime } from './agentWorkspaceState';
import { clearPendingTurn, pendingAgentTurn, pendingTurnBody, readPendingTurn, storePendingTurn, type PendingAgentTurn } from './pendingAgentTurn';
import ModelPicker from './ModelPicker';
import './AgentTicketDraft.css';

interface Props {
  repoId: string;
  api: RequestApi;
  files: { name: string; file: File }[];
  onUpload: UploadAttachments;
  onClearFiles: () => void;
  onBeforeWorkspaceChange: () => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });
const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const emptyMessages: DraftSnapshot['messages'] = [];

export default function AgentTicketDraft({ repoId, api, files, onUpload, onClearFiles, onBeforeWorkspaceChange, onDirtyChange, onBusyChange, disabled = false }: Props) {
  const [workspaces, setWorkspaces] = useState<AgentWorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<AgentWorkspace>();
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [prompt, setPrompt] = useState('');
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [title, setTitle] = useState('');
  const savedTitle = useRef('');
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const [excluded, setExcluded] = useState<string[]>([]);
  const intent = 'discussion';
  const [researchPaths, setResearchPaths] = useState('');
  const [pending, setPending] = useState<PendingAgentTurn>();
  const [pendingReady, setPendingReady] = useState(false);
  const [pendingUnknown, setPendingUnknown] = useState(false);
  const openedWorkspace = useRef('');
  const [prepared, setPrepared] = useState<{ input: string; value: DraftPreparation }>();
  const [operation, setOperation] = useState('Loading workspaces…');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const [batchOperations, setBatchOperations] = useState<NonNullable<AgentWorkspaceSnapshot['batchOperations']>>([]);
  const [responseOperations, setResponseOperations] = useState<NonNullable<AgentWorkspaceSnapshot['responseOperations']>>([]);
  const [ticketResponse, setTicketResponse] = useState<number>();
  const [generationModels, setGenerationModels] = useState<ResponseGenerationModels>();
  const [generationModel, setGenerationModel] = useState('');
  const [generationThinking, setGenerationThinking] = useState('');
  const [eligibleResponseIndices, setEligibleResponseIndices] = useState<number[]>([]);
  const [inspections, setInspections] = useState<Record<string, { confirmation: string; state: string; safeToResume: boolean; reasons: string[] }>>({});
  const [following, setFollowing] = useState(true);
  const conversation = useRef<HTMLDivElement>(null);
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
  const dirty = !!workspace && (title !== workspace.title || prompt !== workspace.prompt);
  const replyDirty = Object.values(replies).some(text => text.length > 0);
  const clarification = responseOperations.find(item => item.responseIndex === ticketResponse && item.state === 'clarification');
  const clarifying = !!clarification;
  const composerText = clarification ? replies[clarification.responseIndex] ?? '' : prompt;
  const input = JSON.stringify([composerText, intent, excluded, files.map(file => [file.name, file.file.size, file.file.lastModified]), snapshot?.model, snapshot?.thinking, workspace?.version]);
  const preparation = prepared?.input === input ? prepared.value : undefined;
  const contexts = preparation?.contexts ?? Array.from(new Map<string, Pick<DraftContext, 'key' | 'label' | 'detail'>>([
    ...files.map(file => [`upload:${file.name}`, { key: `upload:${file.name}`, label: file.name, detail: 'Check context to validate these bytes for the effective model.' }] as const),
    ...(prepared?.value.contexts ?? []).map(context => [context.key, context] as const),
  ]).values()).map(context => ({ ...context, status: excluded.includes(context.key) ? 'excluded' : 'pending' }));
  const messages = snapshot?.messages ?? workspace?.messages ?? emptyMessages;

  useEffect(() => { onDirtyChange(dirty || replyDirty); }, [dirty, replyDirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    const previous = savedTitle.current;
    const next = workspace?.title ?? '';
    savedTitle.current = next;
    setTitle(current => current === previous ? next : current);
  }, [workspace?.title]);
  useEffect(() => {
    if ((error || snapshot?.error || preparation?.ready === false) && contextInspector.current) {
      contextInspector.current.open = true;
      contextInspector.current.closest('details.agent-composer-context')?.setAttribute('open', '');
    }
  }, [error, snapshot?.error, preparation?.ready]);

  function remember(value: AgentWorkspace) {
    setWorkspaces(current => [value, ...current.filter(item => item.id !== value.id)]);
  }

  function adoptAcceptedDraft(turn: PendingAgentTurn, accepted: boolean, saved?: AgentWorkspace) {
    const submitted = turn.entries.find(entry => entry.name === 'prompt')?.value;
    const kind = turn.entries.find(entry => entry.name === 'intent')?.value;
    if (!accepted || kind === 'task_extraction' || typeof submitted !== 'string' || !submitted.trim()) return;
    if (turn.replyResponseIndex !== undefined) {
      const index = turn.replyResponseIndex;
      setReplies(current => ({ ...current, [index]: acceptedComposerText(current[index] ?? '', turn.composerText ?? submitted, true) }));
      setTicketResponse(undefined); setFollowing(true);
    } else {
      setPrompt(current => acceptedComposerText(current, turn.composerText ?? submitted, true));
    }
    if (saved) setWorkspace(current => current?.id === saved.id
      ? mergeWorkspaceRuntime(saved.prompt === '' && acceptedComposerText(current.prompt, submitted, true) === '' ? { ...current, prompt: '' } : current, saved)
      : current);
  }

  function load(value: AgentWorkspaceSnapshot, discardFiles = true) {
    setTicketResponse(undefined);
    setReplies({});
    setGenerationModels(undefined); setGenerationModel(''); setGenerationThinking('');
    localStorage.setItem(selectionKey, value.workspace.id);
    openedWorkspace.current = value.workspace.id;
    setPending(undefined); setPendingReady(false); setPendingUnknown(false);
    void readPendingTurn(value.workspace.id).then(turn => {
      if (!alive.current || openedWorkspace.current !== value.workspace.id) return;
      setPending(turn); setPendingReady(true);
      if (turn?.replyResponseIndex !== undefined && turn.composerText !== undefined) {
        setReplies({ [turn.replyResponseIndex]: turn.composerText });
      }
    }).catch(cause => { if (alive.current) setError(failure(cause)); });
    setBatchOperations(value.batchOperations ?? []);
    setResponseOperations(value.responseOperations ?? []);
    setEligibleResponseIndices(value.eligibleResponseIndices ?? []);
    setWorkspace(value.workspace); remember(value.workspace);
    setSnapshot(value.draft); session.current = value.draft && value.draft.status !== 'stopped' ? value.workspace.id : '';
    setPrompt(value.workspace.prompt); setTitle(value.workspace.title);
    setExcluded([]); setPrepared(undefined);
    if (discardFiles) onClearFiles();
  }

  useEffect(() => {
    alive.current = true;
    locked.current = true;
    let cancelled = false;
    void api<AgentWorkspaceSummary[]>(root).then(async values => {
      if (cancelled) return;
      setWorkspaces(values);
      const query = new URLSearchParams(window.location.search);
      const linkedWorkspace = query.get('workspace');
      const selected = linkedWorkspace ?? localStorage.getItem(selectionKey);
      const first = values.find(value => value.id === selected) ?? (!linkedWorkspace ? values.find(value => !value.archived) : undefined);
      if (linkedWorkspace && !first) setError('The linked workspace is unavailable.');
      if (first) {
        const value = await api<AgentWorkspaceSnapshot>(`${root}/${encodeURIComponent(first.id)}`);
        if (!cancelled) {
          load(value);
          if (query.get('plan') && !value.workspace.planRevisions.some(revision => revision.id === query.get('plan'))) setError('The linked historical plan is unavailable.');
        }
      } else if (!linkedWorkspace) {
        const value = await api<AgentWorkspaceSnapshot>(root, json({}));
        if (!cancelled) load(value);
      }
    }).catch(cause => { if (!cancelled) setError(failure(cause)); }).finally(() => { if (!cancelled) { locked.current = false; setOperation(''); } });
    return () => {
      cancelled = true; alive.current = false;
      locked.current = false;
      if (session.current) void api(`${root}/${encodeURIComponent(session.current)}/session`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
    };
    // Editor callbacks are deliberately not loading triggers: typing never reloads saved editors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, root, selectionKey, loadAttempt]);

  useEffect(() => {
    if (following && conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [messages, following]);

  useEffect(() => {
    if (!path || !responseOperations.some(item => item.state === 'generating' || item.state === 'publishing')) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api<AgentWorkspaceSnapshot>(path).then(value => {
        if (!cancelled) setResponseOperations(value.responseOperations ?? []);
      }).catch(cause => { if (!cancelled) setError(`Could not check ticket creation: ${failure(cause)}. Use Check ticket creation to refresh the saved status; generation has not been retried.`); });
    }, 1000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, path, responseOperations]);
  useEffect(() => {
    if (!path || (snapshot?.status !== 'busy' && !pending)) return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const receipt = pending ? await api<{ accepted: boolean; resolved?: boolean }>(`${path}/turns/${encodeURIComponent(pending.key)}`) : undefined;
        if (!cancelled && pending) adoptAcceptedDraft(pending, receipt?.accepted === true);
        const value = await api<AgentWorkspaceSnapshot>(path);
        if (cancelled) return;
        setSnapshot(value.draft);
        setEligibleResponseIndices(value.eligibleResponseIndices ?? []);
        setResponseOperations(value.responseOperations ?? []);
        setWorkspace(current => current ? mergeWorkspaceRuntime(current, value.workspace) : current);
        if (pending) {
          adoptAcceptedDraft(pending, receipt?.accepted === true, value.workspace);
          if (receipt?.accepted || receipt?.resolved) {
            await clearPendingTurn(pending);
            if (cancelled) return;
            setPending(undefined); setPendingUnknown(false);
          } else {
            setPendingUnknown(true);
            if (value.draft?.status !== 'busy') return;
          }
        }
        if (value.draft?.status !== 'busy') { remember(value.workspace); return; }
      } catch (cause) {
        if (cancelled) return;
        setError(`Status check failed: ${failure(cause)}. Available editors remain untouched; checking again without replaying the turn.`);
      }
      timer = window.setTimeout(() => void poll(), 700);
    };
    timer = window.setTimeout(() => void poll(), 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, path, snapshot?.status, pending]);

  async function run(name: string, work: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true; setOperation(name); setError('');
    try { await work(); }
    catch (cause) { if (alive.current) setError(failure(cause)); }
    finally { locked.current = false; if (alive.current) setOperation(''); }
  }

  async function saveEditors() {
    if (!workspace) throw new Error('Open a workspace first.');
    const value = await api<AgentWorkspaceSnapshot>(path, json({ version: workspace.version, ...(title !== workspace.title ? { title } : {}), prompt }, 'PATCH'));
    if (!alive.current) return value;
    setWorkspace(value.workspace); remember(value.workspace); setSnapshot(value.draft);
    setEligibleResponseIndices(value.eligibleResponseIndices ?? []);
    setResponseOperations(value.responseOperations ?? []);
    return value;
  }


  async function protectSwitch() {
    if (replyDirty && !await modal.confirm({ title: 'Discard unsent ticket replies?', content: 'Ticket replies are separate from the saved chat draft. Switching conversations discards these unsent replies.', okText: 'Discard replies and continue', cancelText: 'Keep editing', okButtonProps: { danger: true } })) return false;
    if (dirty) {
      if (!await modal.confirm({ title: 'Save conversation before switching?', content: 'Save your title and unsent message before opening another conversation. A conflicting save preserves your edits.', okText: 'Save and continue', cancelText: 'Keep editing' })) return false;
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
      if (alive.current) { load(value); setHistoryOpen(false); }
    });
  }

  function contextBody(submittedPrompt = composerText) {
    const data = new FormData();
    data.set('prompt', submittedPrompt); data.set('excluded', JSON.stringify(excluded));
    data.set('intent', intent);
    if (workspace) data.set('contextVersion', String(workspace.version));
    for (const file of files) data.append('files', file.file, file.name);
    return data;
  }

  async function prepare(key = input, version = workspace?.version) {
    const body = contextBody();
    if (version !== undefined) body.set('contextVersion', String(version));
    const value = await api<DraftPreparation>(`${path}/session/context`, { method: 'POST', body });
    if (alive.current) setPrepared({ input: key, value });
    return value;
  }

  async function connect() {
    const value = await api<AgentWorkspaceSnapshot>(`${path}/connect`, json({}));
    if (!alive.current) { await api(`${path}/session`, { method: 'DELETE' }); throw new Error('Chat closed while connecting.'); }
    session.current = value.workspace.id;
    setSnapshot(value.draft);
    setEligibleResponseIndices(value.eligibleResponseIndices ?? []);
    setResponseOperations(value.responseOperations ?? []);
    setWorkspace(current => current ? mergeWorkspaceRuntime(current, value.workspace) : current);
    remember(value.workspace); setPrepared(undefined);
    return value;
  }

  function selectModel(body: { provider: string; modelId: string } | { thinking: string }) {
    void run('Updating saved drafting model…', async () => {
      const next = await api<DraftSnapshot>(`${path}/session/model`, json(body));
      setSnapshot(next); setPrepared(undefined);
      setWorkspace(current => current ? { ...current, model: next.model, thinking: next.thinking } : current);
      const current = await api<AgentWorkspaceSnapshot>(path);
      setWorkspace(previous => previous ? mergeWorkspaceRuntime(previous, current.workspace) : previous);
      const key = JSON.stringify([composerText, intent, excluded, files.map(file => [file.name, file.file.size, file.file.lastModified]), next.model, next.thinking, current.workspace.version]);
      await prepare(key, current.workspace.version);
    });
  }

  async function reconcilePending(turn: PendingAgentTurn) {
    const receipt = await api<{ accepted: boolean; resolved?: boolean }>(`${path}/turns/${encodeURIComponent(turn.key)}`);
    if (alive.current) adoptAcceptedDraft(turn, receipt.accepted);
    const value = await api<AgentWorkspaceSnapshot>(path);
    if (!alive.current) return true;
    setSnapshot(value.draft);
    setEligibleResponseIndices(value.eligibleResponseIndices ?? []);
    setResponseOperations(value.responseOperations ?? []);
    setWorkspace(current => current ? mergeWorkspaceRuntime(current, value.workspace) : current);
    remember(value.workspace);
    adoptAcceptedDraft(turn, receipt.accepted, value.workspace);
    if (receipt.accepted || receipt.resolved) {
      await clearPendingTurn(turn); setPending(undefined); setPendingUnknown(false);
      return true;
    }
    setPendingUnknown(true);
    return false;
  }

  async function submitTurn(turn: PendingAgentTurn) {
    try {
      const next = await api<DraftSnapshot>(`${path}/session/turn`, { method: 'POST', headers: { 'Idempotency-Key': turn.key }, body: pendingTurnBody(turn) });
      if (alive.current) {
        setSnapshot(next);
        adoptAcceptedDraft(turn, next.acceptedTurnKey === turn.key);
      }
      await reconcilePending(turn);
    } catch (cause) {
      // A failed HTTP request says nothing about provider acceptance.
      if (alive.current) setError(`Send outcome uncertain: ${failure(cause)}. Check the saved request before retrying.`);
      await reconcilePending(turn).catch(() => undefined);
    }
  }

  function send(clarification?: ResponseOperation) {
    const text = clarification ? replies[clarification.responseIndex] ?? '' : prompt;
    if (unavailable || pending || !pendingReady || !text.trim()) return;
    const submittedPrompt = clarification
      ? `Clarification for ticket creation from assistant response ${clarification.responseIndex + 1}:\n\nSource response:\n${messages[clarification.responseIndex].text}\n\nQuestions:\n${(clarification.questions ?? []).map(question => `- ${question}`).join('\n')}\n\nMy answers:\n${text}`
      : text;
    void run('Preparing message…', async () => {
      if (!connected) await connect();
      const saved = await saveEditors();
      const body = contextBody(submittedPrompt);
      body.set('contextVersion', String(saved.workspace.version));
      const checked = await api<DraftPreparation>(`${path}/session/context`, { method: 'POST', body });
      const key = JSON.stringify([text, intent, excluded, files.map(file => [file.name, file.file.size, file.file.lastModified]), saved.draft?.model, saved.draft?.thinking, saved.workspace.version]);
      if (alive.current) setPrepared({ input: key, value: checked });
      if (!checked.ready) throw new Error('Selected context is not ready. Replace unreadable references or explicitly mark them reference-only, then check again.');
      const turn = pendingAgentTurn(workspace!.id, body);
      turn.composerText = text;
      if (clarification) turn.replyResponseIndex = clarification.responseIndex;
      await storePendingTurn(turn);
      setPending(turn); setPendingUnknown(false);
      setOperation('Starting discussion turn…');
      await submitTurn(turn);
    });
  }

  function research() {
    void run('Retrieving repository evidence…', async () => {
      const saved = dirty ? await saveEditors() : { workspace: workspace! };
      const value = await api<AgentWorkspaceSnapshot>(`${path}/research`, json({ version: saved.workspace.version, paths: researchPaths.split('\n').map(item => item.trim()).filter(Boolean) }));
      setWorkspace(value.workspace); remember(value.workspace); setSnapshot(value.draft); setPrepared(undefined);
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


  function openTicketResponse(index: number) {
    setTicketResponse(index);
    setGenerationModels(undefined); setGenerationModel(''); setGenerationThinking('');
  }

  function discoverGenerationModels(index: number, model = '') {
    setGenerationModel(model); setGenerationThinking('');
    setGenerationModels(current => current ? { ...current, model: '', thinkingLevels: [] } : undefined);
    void run('Loading generation models…', async () => {
      setGenerationModels(await api<ResponseGenerationModels>(`${path}/responses/${index}/models`, json({ model })));
    });
  }

  function createTickets(index: number, retry = false, selection?: ResponseOperation['generation']) {
    openTicketResponse(index);
    void run(retry ? 'Retrying ticket generation…' : 'Creating tickets…', async () => {
      try {
        const value = await api<AgentWorkspaceSnapshot>(`${path}/responses/${index}/tickets${retry ? '/retry' : ''}`, json(selection ? { model: `${selection.model.provider}/${selection.model.id}`, thinking: selection.thinking } : {}));
        setResponseOperations(value.responseOperations ?? []);
      } catch (cause) {
        const saved = await api<AgentWorkspaceSnapshot>(path);
        setResponseOperations(saved.responseOperations ?? []);
        if (!saved.responseOperations?.some(item => item.responseIndex === index && (item.state === 'generating' || item.state === 'publishing' || item.state === 'complete'))) throw cause;
      }
    });
  }

  const composer = workspace && <div className="agent-composer" onFocus={() => { if (!connected && !unavailable && !pending) void run('Loading chat capabilities…', async () => { await connect(); }); }}>
          <MarkdownEditor label={clarifying ? 'Reply' : 'Message'} value={composerText} onChange={text => clarification ? setReplies(current => ({ ...current, [clarification.responseIndex]: text })) : setPrompt(text)} repoId={repoId} api={api} commands={snapshot?.commands ?? []} disabled={disabled || workspace.archived} onUpload={onUpload} onSubmit={() => send(clarification)}>
          {!!files.length && <p className="agent-composer-hint">Attached · {files.map(file => file.file.name).join(', ')} · Staged until sent</p>}
          <div className="agent-composer-controls">
            <details className="agent-composer-advanced" onToggle={event => { if (event.currentTarget.open && !connected && !unavailable) void run('Loading model settings…', async () => { await connect(); }); }}><summary>{snapshot?.model ? `${snapshot.model.id} · ${snapshot.thinking || "default"}` : "Model settings"}</summary>
              {snapshot ? <ModelPicker modelAriaLabel="Drafting model" thinkingAriaLabel="Drafting thinking level"
                disabled={unavailable || !connected} modelDisabled={!snapshot.models.length} thinkingDisabled={!snapshot.thinkingLevels.length}
                modelPlaceholder="Choose a drafting model" model={snapshot.model ? `${snapshot.model.provider}/${snapshot.model.id}` : undefined} thinking={snapshot.thinking || undefined}
                modelOptions={snapshot.models.map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} · ${model.provider}${model.images ? ' · images' : ''}` }))}
                thinkingOptions={snapshot.thinkingLevels.map(level => ({ value: level, label: level }))}
                onModelChange={value => { const model = snapshot.models.find(model => `${model.provider}/${model.id}` === value); if (model) selectModel({ provider: model.provider, modelId: model.id }); }}
                onThinkingChange={thinking => selectModel({ thinking })} /> : workspace.model && <p className="muted">Saved: {workspace.model.provider} / {workspace.model.id} · {workspace.thinking}</p>}
              {clarifying && <p className="muted">Model changes apply to chat and this reply, not the original generation.</p>}
              {connected && <Button disabled={disabled || !!operation} onClick={() => void run("Disconnecting from OMP…", async () => { await stopSession(); const value = await api<AgentWorkspaceSnapshot>(path); setSnapshot(value.draft); setWorkspace(current => current ? { ...current, messages: value.workspace.messages } : current); setPrepared(undefined); })}>Disconnect</Button>}
            </details>
          <details className="agent-composer-context"><summary>Context &amp; research{preparation?.ready === false ? ' · Needs attention' : ''}</summary>
          <details className="agent-research-tools"><summary>Repository research</summary>
            <p>Retrieve exact repository files read-only when you need source evidence.</p>
            <label>Paths<Input.TextArea aria-label="Research paths" value={researchPaths} onChange={event => setResearchPaths(event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} disabled={unavailable || !!pending} /></label>
            <Button disabled={unavailable || !!pending || !researchPaths.trim()} onClick={research}>Retrieve files</Button>
            {!!workspace.researchReferences.length && <ul className="agent-research-references">{workspace.researchReferences.map(reference => <li key={reference.id}><details><summary>{reference.title} · {reference.status}</summary><p>{reference.summary}</p><code>{reference.location}</code></details></li>)}</ul>}
          </details>
        <details ref={contextInspector} className="agent-context" aria-label="Prepared model context">
          <summary>Model context · {preparation ? preparation.ready ? 'Ready' : 'Blocked' : 'Checks on send'}</summary>
          <div className="agent-context-body">
            <div className="agent-context-heading"><p className="muted">Preparation reports supplied bytes, not proof of understanding. Reference-only files remain staged for the ticket but are not sent to the model.</p><Button disabled={unavailable || !connected} onClick={() => void run('Preparing selected context…', async () => { await prepare(); })}>Check context</Button></div>
            {contexts.length ? <ul>{contexts.map(context => <li key={context.key}>
              <div><strong>{context.label}</strong><Tag>{context.status}</Tag><p>{context.detail}</p></div>
              {/^(?:file|skill|upload):/.test(context.key) && <Checkbox disabled={unavailable} checked={excluded.includes(context.key)} onChange={event => setExcluded(current => event.target.checked ? [...current, context.key] : current.filter(key => key !== context.key))}>Reference only (exclude bytes)</Checkbox>}
            </li>)}</ul> : <p className="muted">File and /skill: mentions are resolved securely by the host when checking or sending.</p>}
          </div>
        </details>
          </details>
            <Button type="primary" disabled={unavailable || !!pending || !pendingReady || !prompt.trim() || preparation?.ready === false} onClick={() => send(clarification)}>{clarifying ? 'Send reply' : 'Send'}</Button>
          </div>
        {busy && <p className="agent-turn-status" role="status">{operation || 'Discussion turn in progress. Partial output remains available.'}</p>}
          </MarkdownEditor>
        </div>;
  const history = <div className="agent-history">
    <Button disabled={busy || disabled} onClick={() => openWorkspace()}>New chat</Button>
    <nav className="agent-history-list" aria-label="Saved conversations">
      {workspaces.filter(item => showArchived || !item.archived || item.id === workspace?.id).map(item =>
        <Button key={item.id} type="text" className="agent-history-item" aria-current={item.id === workspace?.id ? 'true' : undefined} disabled={busy || disabled} onClick={() => openWorkspace(item.id)}>
          {item.title}{item.archived ? ' · Archived' : ''}
        </Button>)}
      {!workspaces.length && <p className="muted">{operation ? 'Loading conversations…' : 'No saved conversations.'}</p>}
    </nav>
    <Button onClick={() => { setHistoryOpen(false); setSettingsOpen(true); }}>Chat settings</Button>
  </div>;

  return <section className="agent-workspace" aria-label="Persistent agent workspace">
    {modalContext}
    {screens.md === false
      ? <Drawer title="Conversations" placement="left" open={historyOpen} onClose={() => setHistoryOpen(false)} size={280}>{history}</Drawer>
      : <aside className="agent-history-sidebar" aria-label="Conversations"><h2>Conversations</h2>{history}</aside>}
    <div className="agent-chat-main">
    {screens.md === false && <div className="agent-workspace-toolbar"><Button onClick={() => setHistoryOpen(true)} aria-expanded={historyOpen}>Conversations</Button></div>}
      <Modal title="Chat settings" open={settingsOpen} onCancel={() => setSettingsOpen(false)} footer={null}>
        <div className="agent-workspace-options">
        <p className="muted">Discuss your project. Create tickets from an assistant response when ready; saved tickets stay held until you explicitly approve them for execution.</p>
        {workspace && <><label>Title<Input aria-label="Workspace title" value={title} disabled={unavailable} onChange={event => setTitle(event.target.value)} /></label><Button disabled={unavailable || !dirty} onClick={() => void run("Saving workspace editors…", async () => { await saveEditors(); })}>Save changes</Button></>}
        <Checkbox checked={showArchived} onChange={event => setShowArchived(event.target.checked)}>Show archived</Checkbox>
        <Button disabled={busy || disabled} onClick={() => void run("Refreshing workspace list…", async () => { setWorkspaces(await api<AgentWorkspaceSummary[]>(root)); })}>Refresh chats</Button>
        {workspace && <Button disabled={busy || disabled} onClick={archive}>{workspace.archived ? "Restore chat" : "Archive chat…"}</Button>}
        <details className="agent-safety-help"><summary>Process &amp; context limits</summary><p>Sending connects automatically. Leaving stops the owned child; saved discussion remains. No turn is replayed automatically. The process is capability-restricted, not an OS sandbox.</p><p>Only bounded recent text and plan context are supplied to new turns. Staged files live only in this tab until sent; reload requires reattaching their bytes.</p></details>
        </div>
      </Modal>
    {workspace && (!pendingReady || pending) && <aside className="agent-pending-turn" aria-label="Pending Send recovery">
      <h3>Pending Send recovery</h3>
      <p>{pending ? `Request ${pending.key} is preserved with its exact message, context selection and upload bytes. A lost response is not a failed model turn.` : 'Checking browser storage before another Send is allowed.'}</p>
      {pending && <><details><summary>Submitted request</summary><pre>{String(pending.entries.find(entry => entry.name === 'prompt')?.value ?? '')}</pre><p>Started {new Date(pending.createdAt).toLocaleString()}. Composer edits do not change this saved request.</p></details><div className="toolbar">
        <Button disabled={disabled || !!operation} onClick={() => void run('Checking persisted turn…', async () => { await reconcilePending(pending); })}>Check pending Send</Button>
        <Button disabled={unavailable || !pendingUnknown} onClick={() => void run('Reconciling exact saved request…', async () => { if (!await reconcilePending(pending)) { if (!connected) await connect(); await submitTurn(pending); } })}>Retry exact saved request</Button>
        <Button disabled={disabled || !!operation || !pendingUnknown} onClick={() => void run('Resolving unaccepted request…', async () => {
          const result = await api<{ accepted: boolean; resolved?: boolean }>(`${path}/turns/${encodeURIComponent(pending.key)}/abandon`, json({}));
          if (result.accepted) { await reconcilePending(pending); return; }
          if (!result.resolved) throw new Error('Host could not resolve this request. It remains pending.');
          await clearPendingTurn(pending); setPending(undefined); setPendingUnknown(false);
        })}>Discard unaccepted request</Button>
      </div><p className="muted">Retry first checks host state and reuses the original key and bytes. Discard records a host rejection before clearing browser storage, so a delayed request cannot start inference.</p></>}
      {!pendingReady && <Button disabled={disabled || !!operation} onClick={() => void run('Checking pending storage…', async () => { const turn = await readPendingTurn(workspace.id); setPending(turn); setPendingReady(true); })}>Check pending storage</Button>}
    </aside>}
    {(error || snapshot?.error) && <div className="error-banner" role="alert">{error && <p>{error}</p>}{snapshot?.error && snapshot.error !== error && <p>{snapshot.error}</p>}<p>Available edits, files and conversation are preserved. No failed turn is replayed automatically.</p>{workspace && <Button disabled={busy || disabled} onClick={() => void run('Loading saved workspace…', async () => { if ((dirty || replyDirty) && !await modal.confirm({ title: 'Replace local editor changes?', content: 'Load the saved workspace without merging your local edits or unsent ticket replies. Copy them first if needed. Tab-local attachments remain.', okText: 'Load saved editors', cancelText: 'Keep edits', okButtonProps: { danger: true } })) { setError(error); return; } load(await api<AgentWorkspaceSnapshot>(path), false); })}>Load saved editors…</Button>}</div>}
    {!workspace ? <div className="agent-conversation-empty">{operation ? <><h2>Opening chat</h2><p>Your saved conversation will appear here.</p></> : <><h2>Chat could not be loaded</h2><p>Retry loading the selected conversation.</p><Button disabled={disabled} onClick={() => { if (locked.current) return; locked.current = true; setError(''); setOperation('Loading workspaces…'); setLoadAttempt(current => current + 1); }}>Retry loading chat</Button></>}</div> : <div className="agent-workspace-columns agent-workspace-columns-discussion">
      <section className="agent-ticket-draft" aria-label="Persistent discussion">
        {!!snapshot?.activity?.length && <details className="agent-safety-help"><summary>Activity · {snapshot.activity.length}</summary>{snapshot.activity.map((activity, index) => <p key={index}>{activity.type} · {activity.status} · {activity.detail}</p>)}</details>}
        <div className="agent-conversation-viewport">
        <div ref={conversation} className="agent-conversation" role="log" aria-label="Saved drafting conversation" aria-live="polite" aria-relevant="additions text" onScroll={event => { const node = event.currentTarget; setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 80); }}>
          {messages.length ? messages.map((item, index) => {
            const result = responseOperations.find(operation => operation.responseIndex === index);
            const inspection = result?.publicationId ? inspections[result.publicationId] : undefined;
            const eligible = eligibleResponseIndices.includes(index);
            return <article key={index} className={`agent-message agent-message-${item.role}`}><header><strong>{item.role === 'user' ? 'You' : 'OMP agent'}</strong>{item.status && <Tag>{item.status}</Tag>}{item.model && <small>{item.model}{item.thinking ? ` · ${item.thinking}` : ''}</small>}</header><div className="agent-message-content" tabIndex={0}><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith('attachments/') ? `${path}/attachments/${index}/${url.slice('attachments/'.length)}` : defaultUrlTransform(url)} components={{ img: ({ src, alt }) => <a href={typeof src === 'string' ? src : undefined}>Image: {alt || 'attachment'}</a> }}>{item.text || (snapshot?.status === 'busy' ? 'Waiting for agent output…' : '(No text returned)')}</Markdown></div>
              {(eligible || result) && <div className="agent-response-actions">
                {!result && <Button disabled={unavailable} onClick={() => createTickets(index)}>Create tickets</Button>}
                {result && <Button disabled={disabled || !!operation} onClick={() => openTicketResponse(index)}>Tickets · {result.state === 'generating' ? 'Generating…' : result.state === 'publishing' ? 'Saving…' : result.state === 'complete' ? 'Saved' : 'Needs attention'}</Button>}
                <Modal className="agent-generation-modal" title="Ticket creation" destroyOnHidden open={ticketResponse === index} onCancel={() => setTicketResponse(undefined)} footer={<Button onClick={() => setTicketResponse(undefined)}>Back to chat</Button>} width={1040} style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }}>
                  <div className="agent-generation">
                  <p className="muted">From this assistant response. Closing this window does not cancel generation.</p>
                  <details className="agent-generation-source"><summary>Source response</summary><div className="agent-message-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>Image: {alt || 'attachment'}</span> }}>{item.text}</Markdown></div></details>
                  <div role="status" aria-live="polite" className="agent-generation-status">
                    {(!result && !!operation || result?.state === 'generating' || result?.state === 'publishing') && <Spin size="small" />}
                    <strong>{!result ? operation ? 'Starting ticket generation…' : 'Ticket status not confirmed' : result.state === 'generating' ? 'Generating tickets…' : result.state === 'publishing' ? 'Saving tickets…' : result.state === 'complete' ? 'Tickets saved' : result.state === 'clarification' ? 'Your input is needed' : result.state === 'blocked' ? 'Saving is blocked' : 'Generation interrupted'}</strong>
                  </div>
                  {result?.generation && <p className="muted">Generation model: {result.generation.model.provider}/{result.generation.model.id} · {result.generation.thinking}</p>}
                  {(error || result?.error) && <div className="error-banner" role="alert">{result?.error && <p>{result.error}</p>}{error && error !== result?.error && <p>{error}</p>}<p>Your conversation and unsent message are preserved. Nothing is retried automatically.</p></div>}
                  {!result && !operation && <Button disabled={disabled} onClick={() => void run('Checking ticket creation…', async () => { const value = await api<AgentWorkspaceSnapshot>(path); setResponseOperations(value.responseOperations ?? []); })}>Check ticket creation</Button>}
                {result && <>
                  {result.questions?.map((question, i) => <p key={i}>{question}</p>)}
                  {result.state !== 'complete' && <Button disabled={disabled || !!operation} onClick={() => void run('Checking ticket creation…', async () => { const value = await api<AgentWorkspaceSnapshot>(path); setResponseOperations(value.responseOperations ?? []); })}>Check ticket creation</Button>}
                  {result.state === 'clarification' && <><p className="muted">Reply continues chat without creating tickets. Create tickets from the new completed response.</p>{composer}{pending && <div className="notice"><p>A saved Send needs reconciliation before another reply.</p><Button onClick={() => setTicketResponse(undefined)}>Review pending Send in chat</Button></div>}</>}
                  {result.state === 'interrupted' && !result.publicationId && !result.tickets.length && <>
                    <details className="agent-generation-options" onToggle={event => { if (event.currentTarget.open && !generationModels && !busy) discoverGenerationModels(index); }}>
                      <summary>Change generation model</summary>
                      <p className="muted">Only ticket generation changes. The saved response, retained context and chat model stay unchanged. Retrying makes a new model request.</p>
                      {generationModels?.saved.model && <p className="muted">Previous selection: {generationModels.saved.model.provider}/{generationModels.saved.model.id} · {generationModels.saved.thinking}</p>}
                      {generationModels?.requiresImages && <p>The saved context includes images. Choose an image-capable model.</p>}
                      {operation === 'Loading generation models…' && <p role="status">Loading available models and supported thinking levels…</p>}
                      {generationModels && <ModelPicker modelLabel="Generation model" modelAriaLabel="Generation model" thinkingAriaLabel="Generation thinking level"
                        model={generationModel || undefined} thinking={generationThinking || undefined} disabled={unavailable}
                        modelPlaceholder="Choose an available model" thinkingPlaceholder="Choose thinking"
                        modelOptions={generationModels.models.map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} · ${model.provider}${model.images ? ' · images' : ''}`, disabled: generationModels.requiresImages && !model.images }))}
                        thinkingOptions={generationModels.thinkingLevels.map(level => ({ value: level, label: level }))}
                        thinkingDisabled={generationModels.model !== generationModel || !generationModels.thinkingLevels.length}
                        onModelChange={model => discoverGenerationModels(index, model)} onThinkingChange={setGenerationThinking} />}
                      {generationModels && !generationModels.models.length && <p>No models are available. Configure provider access in local OMP, then reload models.</p>}
                      <div className="toolbar">
                        <Button disabled={unavailable} onClick={() => discoverGenerationModels(index, generationModel)}>Reload models</Button>
                        <Button type="primary" disabled={unavailable || !generationModel || !generationModels || generationModels.model !== generationModel || !generationModels.thinkingLevels.includes(generationThinking) || !generationModels.models.some(model => `${model.provider}/${model.id}` === generationModel && (!generationModels.requiresImages || model.images))} onClick={() => {
                          const model = generationModels?.models.find(model => `${model.provider}/${model.id}` === generationModel);
                          if (model) createTickets(index, true, { model: { provider: model.provider, id: model.id }, thinking: generationThinking });
                        }}>Retry with selected model</Button>
                      </div>
                    </details>
                    <Button disabled={unavailable} onClick={() => createTickets(index, true)}>Retry same model</Button>
                  </>}
                  {result.state === 'complete' && <><p className="muted">Saved and held from execution, including Automatic mode. Approve each ticket revision to release its hold.</p><div className="agent-ticket-links">{result.tickets.map(ticket => <Link key={ticket.id} to={`/projects/${encodeURIComponent(repoId)}/tickets/${encodeURIComponent(ticket.id)}`}>{ticket.id}{ticket.title ? ` · ${ticket.title}` : ''}</Link>)}</div><Link to={`/projects/${encodeURIComponent(repoId)}`}>View tickets</Link></>}
                  {(result.state === 'blocked' || result.state === 'interrupted') && result.publicationId && <div className="toolbar"><Button disabled={disabled || !!operation} onClick={() => void run('Inspecting publication…', async () => { const id = result.publicationId!; const value = await api<{ confirmation: string; state: string; safeToResume: boolean; reasons: string[] }>(`${path}/batch-operations/${encodeURIComponent(id)}/inspect`); setInspections(current => ({ ...current, [id]: value })); })}>Inspect recovery</Button>{inspection && <><span>{inspection.safeToResume ? 'Safe to resume' : 'Not safe to resume'} {inspection.reasons.join(' ')}</span>{inspection.safeToResume && <Button disabled={disabled || !!operation} onClick={() => void run('Resuming publication…', async () => { await api(`${path}/batch-operations/${encodeURIComponent(result.publicationId!)}/recover`, json({ confirm: true })); const value = await api<AgentWorkspaceSnapshot>(path); setResponseOperations(value.responseOperations ?? []); })}>Resume same publication</Button>}</>}</div>}
                </>}
                  </div>
                </Modal>
              </div>}
              {!eligible && !result && item.role === 'assistant' && item.status === 'complete' && !!item.text.trim() && <p className="muted">Ticket creation is unavailable for this saved response. Choose an available model or send a follow-up to produce a new completed response.</p>}
            </article>;
          }) : <div className="agent-conversation-empty"><h2>What would you like to change?</h2><p>Discuss an idea, explore the repository or work through a plan.</p><p>Create tickets from a completed response when you are ready. Saved tickets stay held until you approve each revision.</p></div>}
        </div>
        <div className="agent-floating-status">
          <Tag role="status" aria-live="polite" title={operation || snapshot?.status || 'Ready to chat'}>{operation ? 'Working' : snapshot?.status === 'busy' ? 'Responding' : snapshot?.status === 'failed' ? 'Failed' : snapshot?.status === 'stopped' ? 'Disconnected' : 'Ready'}</Tag>
          {snapshot?.status === "busy" && <Button disabled={disabled || !!operation} onClick={() => void run("Cancelling discussion turn…", async () => { setSnapshot(await api<DraftSnapshot>(`${path}/session/cancel`, json({}))); })}>Stop</Button>}
        </div>
        {!following && <div className="agent-floating-controls"><Button aria-label="Jump to latest" title="Jump to latest" icon={<ArrowDownIcon size={16} aria-hidden="true" />} onClick={() => { setFollowing(true); if (conversation.current) conversation.current.scrollTop = conversation.current.scrollHeight; }}>Latest</Button></div>}
        </div>
        {!clarifying && composer}
      </section>
      {(workspace.planRevisions.length > 0 || workspace.proposalSets.length > 0 || workspace.ticketMarkdown) && <details className="agent-safety-help"><summary>Saved historical records</summary>
        <p className="muted">Read-only records. Create new tickets from a completed chat response.</p>
        {workspace.planRevisions.map((revision, index) => <details key={revision.id}><summary>Plan revision {index + 1} · {new Date(revision.createdAt).toLocaleString()}</summary><Markdown remarkPlugins={[remarkGfm]} skipHtml>{revision.markdown}</Markdown></details>)}
        {workspace.proposalSets.map(set => <details key={set.id}><summary>{set.payload.proposals.length} saved proposals · {new Date(set.createdAt).toLocaleString()}</summary>{set.payload.proposals.map(proposal => <details key={proposal.key}><summary>{proposal.title}</summary><pre>{proposal.description}</pre></details>)}</details>)}
        {workspace.ticketMarkdown && <details><summary>Saved ticket text</summary><pre>{workspace.ticketMarkdown}</pre></details>}
      </details>}
      {batchOperations.some(item => ['publishing', 'blocked'].includes(item.state) && !responseOperations.some(result => result.publicationId === item.publicationId)) && <details className="agent-safety-help"><summary>Interrupted saved publications</summary>
        <p>Only previously accepted publications can resume. New tickets use the response action.</p>
        {batchOperations.filter(item => ['publishing', 'blocked'].includes(item.state) && !responseOperations.some(result => result.publicationId === item.publicationId)).map(item => {
          const inspection = inspections[item.publicationId];
          return <section key={item.publicationId}><p>{item.tickets.map(ticket => ticket.id).join(', ')} · {item.state}{item.error ? ` · ${item.error}` : ''}</p>
            <Button disabled={busy || disabled} onClick={() => void run('Inspecting saved publication…', async () => { const value = await api<{ confirmation: string; state: string; safeToResume: boolean; reasons: string[] }>(`${path}/batch-operations/${encodeURIComponent(item.publicationId)}/inspect`); setInspections(current => ({ ...current, [item.publicationId]: value })); })}>Inspect recovery</Button>
            {inspection && <><p>{inspection.reasons.join(' ') || (inspection.safeToResume ? 'Safe to resume the saved publication.' : 'Manual reconciliation required.')}</p>{inspection.safeToResume && <Button disabled={busy || disabled} onClick={() => void run('Resuming saved publication…', async () => { await api(`${path}/batch-operations/${encodeURIComponent(item.publicationId)}/recover`, json({ confirm: true })); const value = await api<AgentWorkspaceSnapshot>(path); setBatchOperations(value.batchOperations ?? []); })}>Resume same publication</Button>}</>}
          </section>;
        })}
      </details>}
    </div>}
    </div>
  </section>;
}
