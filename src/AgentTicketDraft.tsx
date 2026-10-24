import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Modal, Select, Tag } from 'antd';
import type { DraftContext, DraftPreparation, DraftSnapshot } from '../server/drafting-contracts';
import type { UploadAttachments } from './attachments';
import MarkdownEditor from './MarkdownEditor';
import type { RequestApi } from './Workspace';
import { proposedTicketMarkdown } from './ticketProposal';
import './AgentTicketDraft.css';

interface Props {
  repoId: string;
  api: RequestApi;
  files: { name: string; file: File }[];
  onUpload: UploadAttachments;
  onUseDraft: (markdown: string) => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}


const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export default function AgentTicketDraft({ repoId, api, files, onUpload, onUseDraft, onDirtyChange, onBusyChange, disabled = false }: Props) {
  const [snapshot, setSnapshot] = useState<DraftSnapshot>();
  const [prompt, setPrompt] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<{ input: string; value: DraftPreparation }>();
  const [operation, setOperation] = useState('');
  const [error, setError] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const session = useRef('');
  const alive = useRef(true);
  const locked = useRef(false);
  const submittedPrompt = useRef<{ text: string; messagesBefore: number } | null>(null);
  const root = `/api/repos/${encodeURIComponent(repoId)}/drafts`;
  const draftId = snapshot?.id;
  const draftStatus = snapshot?.status;
  const busy = !!operation || snapshot?.status === 'busy';
  const unavailable = disabled || busy;
  // File identity is stable in the parent until staging changes. The names are the final sanitized names.
  const input = JSON.stringify([prompt, excluded, files.map(file => [file.name, file.file.size]), snapshot?.model, snapshot?.thinking]);
  const preparation = prepared?.input === input ? prepared.value : undefined;
  const contexts = preparation?.contexts ?? Array.from(new Map<string, Pick<DraftContext, 'key' | 'label' | 'detail'>>([
    ...files.map(file => [`upload:${file.name}`, { key: `upload:${file.name}`, label: file.name, detail: 'Check context to validate these bytes for the effective model.' }] as const),
    ...(prepared?.value.contexts ?? []).map(context => [context.key, context] as const),
  ]).values()).map(context => ({ ...context, status: excluded.includes(context.key) ? 'excluded' : 'pending' }));
  const connected = !!snapshot && snapshot.status !== 'stopped';
  const dirty = !!prompt || !!snapshot?.messages.length || snapshot?.status === 'busy';

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (session.current) void api(`${root}/${encodeURIComponent(session.current)}`, { method: 'DELETE' }).catch(() => undefined);
    };
  }, [api, root]);

  useEffect(() => {
    if (!draftId || draftStatus !== 'busy') return;
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        const next = await api<DraftSnapshot>(`${root}/${encodeURIComponent(draftId)}`);
        if (cancelled) return;
        setSnapshot(next);
        if (next.status !== 'busy') {
          if (next.status === 'idle' && !next.error && submittedPrompt.current && next.messages.length > submittedPrompt.current.messagesBefore) {
            const sent = submittedPrompt.current.text;
            setPrompt(current => current === sent ? '' : current);
          }
          submittedPrompt.current = null;
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        setError(`Status check failed: ${cause instanceof Error ? cause.message : String(cause)}. Available text is preserved; checking again without replaying the turn.`);
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 700);
    };
    timer = window.setTimeout(() => void poll(), 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, root, draftId, draftStatus]);

  function contextBody() {
    const data = new FormData();
    data.set('prompt', prompt);
    data.set('excluded', JSON.stringify(excluded));
    for (const file of files) data.append('files', file.file, file.name);
    return data;
  }

  async function run(name: string, work: () => Promise<void>) {
    if (locked.current || disabled) return;
    locked.current = true;
    setOperation(name); setError('');
    try { await work(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { locked.current = false; if (alive.current) setOperation(''); }
  }

  async function prepare(id = snapshot!.id, key = input): Promise<DraftPreparation> {
    setPrepared(current => current ? { ...current, input: '' } : undefined);
    const value = await api<DraftPreparation>(`${root}/${encodeURIComponent(id)}/context`, { method: 'POST', body: contextBody() });
    if (alive.current) setPrepared({ input: key, value });
    return value;
  }

  function connect() {
    void run('Connecting to OMP…', async () => {
      if (snapshot?.messages.length && !await modal.confirm({ title: 'Start a new conversation?', content: 'This replaces the stopped conversation and its partial output. Copy any useful text first. Your prompt, editor and staged files remain.', okText: 'Replace conversation', cancelText: 'Keep conversation' })) return;
      if (session.current) {
        await api(`${root}/${encodeURIComponent(session.current)}`, { method: 'DELETE' });
        session.current = '';
      }
      const next = await api<DraftSnapshot>(root, json({}));
      if (!alive.current) { await api(`${root}/${encodeURIComponent(next.id)}`, { method: 'DELETE' }); return; }
      session.current = next.id;
      setSnapshot(next); setPrepared(undefined);
    });
  }

  function selectModel(body: { provider: string; modelId: string } | { thinking: string }) {
    if (!snapshot || busy) return;
    void run('Updating effective model and context…', async () => {
      const next = await api<DraftSnapshot>(`${root}/${encodeURIComponent(snapshot.id)}/model`, json(body));
      setSnapshot(next); setPrepared(undefined);
      const key = JSON.stringify([prompt, excluded, files.map(file => [file.name, file.file.size]), next.model, next.thinking]);
      await prepare(next.id, key);
    });
  }

  function send() {
    if (!snapshot || busy || !prompt.trim()) return;
    void run('Preparing selected context…', async () => {
      // A previous preview is never authority to send: revalidate the current bytes and model every turn.
      const checked = await prepare();
      if (!checked.ready) throw new Error('Selected context is not ready. Replace unreadable references or explicitly mark them reference-only, then check context again.');
      setOperation('Starting drafting turn…');
      submittedPrompt.current = { text: prompt, messagesBefore: snapshot.messages.length };
      try {
        const next = await api<DraftSnapshot>(`${root}/${encodeURIComponent(snapshot.id)}/turn`, { method: 'POST', body: contextBody() });
        setSnapshot(next);
        if (next.status === 'idle' && !next.error && next.messages.length > snapshot.messages.length) { setPrompt(''); submittedPrompt.current = null; }
      } catch (cause) {
        // An accepted turn can outlive a lost response. Poll status, never resubmit it automatically.
        setSnapshot(current => current ? { ...current, status: 'busy' } : current);
        throw cause;
      }
    });
  }

  function cancel() {
    if (!snapshot || operation) return;
    void run('Cancelling owned draft turn…', async () => {
      submittedPrompt.current = null;
      setSnapshot(await api<DraftSnapshot>(`${root}/${encodeURIComponent(snapshot.id)}/cancel`, json({})));
    });
  }

  function disconnect() {
    if (!snapshot || operation || !connected) return;
    void run('Disconnecting from OMP…', async () => {
      const stopped = await api<DraftSnapshot>(`${root}/${encodeURIComponent(snapshot.id)}`, { method: 'DELETE' });
      session.current = ''; submittedPrompt.current = null;
      setSnapshot(stopped); setPrepared(undefined);
    });
  }

  function clearConversation() {
    if (!snapshot || busy) return;
    void run('Closing conversation…', async () => {
      if (!await modal.confirm({ title: 'Clear this conversation?', content: 'The messages and partial agent output will be discarded. Your prompt, ticket editor and staged attachments stay in this tab. A new session requires Connect again.', okText: 'Clear conversation', cancelText: 'Keep conversation', okButtonProps: { danger: true } })) return;
      if (session.current) await api(`${root}/${encodeURIComponent(session.current)}`, { method: 'DELETE' });
      session.current = ''; submittedPrompt.current = null;
      setSnapshot(undefined); setPrepared(undefined);
    });
  }

  async function stageFiles(selected: File[]) {
    if (unavailable) throw new Error('Wait for drafting work to finish before adding files.');
    return onUpload(selected);
  }

  return <section className="agent-ticket-draft" aria-label="Agent-assisted ticket drafting">
    {modalContext}
    <header className="agent-draft-heading"><div><span className="eyebrow">OMP / TICKET DRAFTING</span><h3>Discuss first. Create only when reviewed.</h3></div><Tag>{operation || (snapshot ? snapshot.status : 'Not connected')}</Tag></header>
    <p className="muted">This separate conversation cannot implement or create a ticket. No provider turn runs until Send. Conversation and uploads live in this tab only; reloading loses them. Capability-restricted drafting is not an OS sandbox.</p>
    {!connected && <Button htmlType="button" disabled={unavailable} onClick={connect}>Connect to OMP for drafting</Button>}
    {snapshot && <>
      <div className="agent-model-controls">
        <label>Drafting model<Select aria-label="Drafting model" showSearch optionFilterProp="label" disabled={unavailable || !connected || !snapshot.models.length} placeholder={snapshot.models.length ? 'Choose a drafting model' : 'No models discovered'} value={snapshot.model ? JSON.stringify([snapshot.model.provider, snapshot.model.id]) : undefined} options={snapshot.models.map(model => ({ value: JSON.stringify([model.provider, model.id]), label: `${model.name} · ${model.provider}${model.images ? ' · images' : ''}` }))} onChange={value => { const [provider, modelId] = JSON.parse(value) as [string, string]; selectModel({ provider, modelId }); }} /></label>
        <label>Thinking<Select aria-label="Drafting thinking level" disabled={unavailable || !connected || !snapshot.thinkingLevels.length} value={snapshot.thinking || undefined} options={snapshot.thinkingLevels.map(level => ({ value: level, label: level }))} onChange={thinking => selectModel({ thinking })} /></label>
      </div>
      <p className="agent-effective-model">Effective: {snapshot.model ? `${snapshot.model.provider} / ${snapshot.model.id}` : 'No model selected'} · thinking: {snapshot.thinking || 'unavailable'}. Drafting only; execution settings are unchanged.</p>
      <div className="agent-conversation" role="log" aria-label="Drafting conversation" aria-live="polite" aria-relevant="additions text">
        {snapshot.messages.length ? snapshot.messages.map((item, index) => <article key={index} className={`agent-message agent-message-${item.role}`}><header><strong>{item.role === 'user' ? 'You' : 'OMP agent'}</strong>{item.model && <small>{item.model}{item.thinking ? ` · ${item.thinking}` : ''}</small>}</header><pre tabIndex={0}>{item.text || (snapshot.status === 'busy' ? 'Waiting for agent output…' : '(No text returned)')}</pre>{item.role === 'assistant' && item.text.trim() && <Button htmlType="button" disabled={unavailable} onClick={() => void run('Transferring proposed Markdown…', async () => { await onUseDraft(proposedTicketMarkdown(item.text)); })}>Use draft{snapshot.status === 'failed' || snapshot.status === 'stopped' ? ' / partial output' : ''}</Button>}</article>) : <p className="muted">Describe the change below. Follow-up answers and refinements stay in this conversation.</p>}
      </div>
      <div className="toolbar">{connected && <Button htmlType="button" disabled={disabled || !!operation} onClick={disconnect}>Disconnect from OMP</Button>}<Button htmlType="button" disabled={unavailable} onClick={clearConversation}>Clear conversation…</Button>{!busy && connected && <Button htmlType="button" disabled={disabled} onClick={() => void run('Refreshing session status…', async () => { setSnapshot(await api<DraftSnapshot>(`${root}/${encodeURIComponent(snapshot.id)}`)); })}>Refresh status</Button>}</div>
    </>}
    {(error || snapshot?.error) && <div className="error-banner" role="alert">{error && <p>{error}</p>}{snapshot?.error && snapshot.error !== error && <p>{snapshot.error}</p>}<p>Your prompt, staged files and available output are preserved. No turn is replayed automatically.</p></div>}
    <div className="agent-composer">
      <MarkdownEditor label="Message to drafting agent" value={prompt} onChange={setPrompt} repoId={repoId} api={api} disabled={unavailable} onUpload={stageFiles} />
      <label className="agent-upload">Add ticket references<input type="file" multiple disabled={unavailable} accept=".png,.jpg,.jpeg,.gif,.webp,.json,.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx,.odt" onChange={event => { const selected = Array.from(event.target.files ?? []); event.target.value = ''; if (!selected.length) return; void run('Staging reference files…', async () => { const references = await onUpload(selected); setPrompt(current => `${current}${current ? '\n' : ''}${references.map(reference => reference.markdown).join('\n')}\n`); }); }} /><small>Paste also works. Keep purpose labels and relative attachment references in the final ticket. Replace unreadable documents with readable text or supported images.</small></label>
      <section className="agent-context" aria-label="Prepared model context" aria-busy={operation === 'Preparing selected context…'}>
        <div className="agent-context-heading"><h4>Context for the next turn</h4><Button htmlType="button" disabled={unavailable || !connected} onClick={() => void run('Preparing selected context…', async () => { await prepare(); })}>Check context</Button></div>
        <p className="muted">Preparation reports bytes supplied, not proof of understanding. Pending, unreadable or partial included context blocks Send. Reference-only attachments remain staged for the final ticket.</p>
        {contexts.length ? <ul>{contexts.map(context => <li key={context.key}><div><strong>{context.label}</strong><Tag>{operation === 'Preparing selected context…' && !excluded.includes(context.key) ? 'pending' : context.status}</Tag><p>{context.detail}</p></div><Checkbox disabled={unavailable} checked={excluded.includes(context.key)} onChange={event => setExcluded(current => event.target.checked ? [...current, context.key] : current.filter(key => key !== context.key))}>Reference only (exclude bytes)</Checkbox></li>)}</ul> : <p className="muted">{preparation ? 'No file or skill references selected.' : 'Not checked. File and /skill: mentions are resolved securely by the host when you check or send.'}</p>}
        {!preparation && <p className="warning-text" role="status">Current prompt, files or model need context preparation.</p>}
        {preparation && !preparation.ready && <p className="warning-text" role="status">Send blocked: replace or explicitly exclude each unresolved reference. Check context again after changes.</p>}
      </section>
      <div className="toolbar agent-send-actions"><Button htmlType="button" type="primary" disabled={unavailable || !connected || !snapshot?.model || !prompt.trim() || preparation?.ready === false} onClick={send}>Send to drafting agent</Button><Button htmlType="button" disabled={disabled || snapshot?.status !== 'busy' || !!operation} onClick={cancel}>Cancel turn</Button><small>{busy ? 'Drafting work in progress. Partial output remains available.' : 'Send always prepares and validates the current selected context first.'}</small></div>
    </div>
  </section>;
}
