import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Breadcrumb, Button, Drawer, Input, InputNumber, Modal, Segmented, Select, Tag } from 'antd';
import { ArrowsInIcon, ArrowsOutIcon, FolderIcon, LightningIcon, PauseIcon, PlusIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import type { Dialog, Mode, Repo, Run, Settings, Snapshot, Ticket } from '../server/contracts';
import type { AssistedConfirmation } from '../server/drafting-contracts';
import { attachmentReference } from './attachments';
import type { AttachmentReference, StagedAttachment } from './attachments';
import MarkdownEditor from './MarkdownEditor';
import AgentTicketDraft from './AgentTicketDraft';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import TicketBoard from './TicketBoard';
import { requestReviewFeedback } from './reviewFeedback';

const RichMarkdownEditor = lazy(() => import('./RichMarkdownEditor'));

export type RequestApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type Execute = (name: string, work: () => Promise<void>) => Promise<boolean>;
interface Props { snapshot: Snapshot; api: RequestApi; refresh: () => Promise<void>; onError: (message: string) => void }
const encode = encodeURIComponent;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const activeStatuses = ['running', 'stopping', 'paused'];
const modes: Record<Mode, string> = { paused: 'Paused', approved: 'Approved tickets only', automatic: 'Automatic' };
const modeIcons = { paused: PauseIcon, approved: ShieldCheckIcon, automatic: LightningIcon };
const modeOptions = (Object.entries(modes) as [Mode, string][]).map(([value, text]) => {
  const Icon = modeIcons[value];
  return { value, label: <span className="execution-mode-label"><Icon size={16} aria-hidden="true" />{text}</span> };
});
const queueStatuses: Ticket['status'][] = ['draft', 'ready', 'running', 'stopping', 'paused', 'blocked', 'needs_review', 'failed', 'interrupted', 'done'];

function Status({ value }: { value: string }) { return <Tag className={`badge status-${value}`}>{value.replaceAll('_', ' ')}</Tag>; }

export default function Workspace({ snapshot, api, refresh, onError }: Props) {
  const { repoId, ticketId, runId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const home = pathname === '/';
  const settingsView = pathname === '/settings';
  const picking = pathname === '/projects/new';
  const creating = !!repoId && pathname.endsWith('/tickets/new');
  const assisting = !!repoId && pathname.endsWith('/tickets/new/agent');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const [expanded, setExpanded] = useState(false);
  const returnFocus = useRef<HTMLAnchorElement | null>(null);
  const newTicketLink = useRef<HTMLAnchorElement | null>(null);
  const repo = snapshot.repos.find(value => value.id === repoId);
  const tickets = snapshot.tickets.filter(value => value.repoId === repo?.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ticket = tickets.find(value => value.id === ticketId);
  const selectedRun = snapshot.runs.find(value => value.id === runId);
  const activeRun = snapshot.runs.find(value => activeStatuses.includes(value.status));
  const busy = !!pending;
  const queueSummaries = new Map<string, { total: number; counts: Partial<Record<Ticket['status'], number>> }>();
  for (const item of snapshot.tickets) {
    if (item.removed) continue;
    let summary = queueSummaries.get(item.repoId);
    if (!summary) { summary = { total: 0, counts: {} }; queueSummaries.set(item.repoId, summary); }
    summary.total++;
    summary.counts[item.status] = (summary.counts[item.status] ?? 0) + 1;
  }

  const execute: Execute = async (name, work) => {
    setPending(name); setNotice(''); onError('');
    try { await work(); await refresh(); setNotice(name); return true; }
    catch (cause) { onError(message(cause)); return false; }
    finally { setPending(''); }
  };

  function setRunId(id: string) { void navigate(`/runs/${encode(id)}`); }

  async function changeMode(mode: Mode) {
    if (!repo || mode === repo.mode) return;
    if (mode === 'automatic' && !await modal.confirm({ title: 'Enable automatic execution?', content: 'New valid tickets and eligible requirement or attachment revisions may run without individual approval. OMP can execute commands with your filesystem permissions. Nothing is sandboxed; completed tickets still require revision review.', okText: 'Enable automatic execution', cancelText: 'Keep current permission' })) return;
    await execute('Repository permission saved.', async () => { await api(`/api/repos/${encode(repo.id)}`, json('PATCH', { mode })); });
  }

  const scheduler = <div className={`execution-strip${snapshot.settings.paused ? ' scheduler-paused' : ''}`} aria-label="Scheduler">
    <div><strong>Scheduler: {snapshot.settings.paused ? 'all new starts paused' : 'following repository permissions'}</strong><small>One active ticket globally. Pausing new starts lets the current run continue.</small></div>
    <Button disabled={busy} onClick={() => void execute(snapshot.settings.paused ? 'New starts enabled.' : 'All new starts paused. Current run continues.', async () => { await api('/api/settings', json('PATCH', { paused: !snapshot.settings.paused })); })}>{snapshot.settings.paused ? 'Allow new starts' : 'Pause all new starts'}</Button>
  </div>;

  return <>
    {modalContext}
    {activeRun && <section className="active-run" aria-label="Current run"><div><Status value={activeRun.status} /><strong>{snapshot.repos.find(value => value.id === activeRun.repoId)?.name} / {activeRun.ticketId}</strong>{activeRun.dialog && <Tag className="attention">Answer needed</Tag>}</div><div className="toolbar"><Button onClick={() => setRunId(activeRun.id)}>Open current run</Button>{activeRun.status === 'running' && <Button disabled={busy} onClick={() => void execute('Pause requested. Wait for the run to stop.', async () => { await api(`/api/runs/${encode(activeRun.id)}/control`, json('POST', { action: 'pause' })); })}>Pause current run</Button>}{activeRun.status === 'paused' && <Button disabled={busy} onClick={() => void execute('Run resume requested.', async () => { await api(`/api/runs/${encode(activeRun.id)}/control`, json('POST', { action: 'resume' })); })}>Resume current run</Button>}</div></section>}
    {activeRun?.dialog && runId !== activeRun.id && <DialogForm key={activeRun.dialog.id} dialog={activeRun.dialog} runId={activeRun.id} repoId={activeRun.repoId} api={api} execute={execute} busy={busy} />}
    <p className="operation-status" role="status" aria-live="polite">{pending ? 'Working...' : notice}</p>
    {home || picking ? <section className="home-view" aria-labelledby="home-heading">
      <div className="section-heading"><div><h1 id="home-heading">Home</h1><p className="muted">Choose a project to manage tickets and review runs.</p></div><Link className="home-action" to="/projects/new">Add project +</Link></div>
      {home && scheduler}
      {snapshot.repos.length ? <ul className="project-grid" aria-label="Projects">
        {snapshot.repos.map(project => {
          const summary = queueSummaries.get(project.id);
          return <li key={project.id}>
          <Link className="project-folder" to={`/projects/${encode(project.id)}`}>
            <FolderIcon className="project-folder-icon" size={30} weight="duotone" aria-hidden="true" />
            <strong>{project.name}</strong>
            <span className="path" title={project.path}>{project.path}</span>
            <span className="project-folder-meta"><span>{modes[project.mode]}</span><span>Tickets: {summary?.total ?? 0}</span></span>
            {project.handoff && <span className="warning-text">Operator reconciliation required · new starts blocked</span>}
            <span className="project-queue" aria-label="Ticket status counts">{summary ? queueStatuses.map(status => summary.counts[status] ? <span key={status}><Status value={status} /> <span>{summary.counts[status]}</span></span> : null) : <span>No tickets</span>}</span>
          </Link>
          </li>;
        })}
      </ul> : <div className="panel empty-state"><FolderIcon className="project-folder-icon" size={40} weight="duotone" aria-hidden="true" /><h2>No projects yet</h2><p>Add a local folder to get started. New projects start paused.</p></div>}
    </section> : settingsView ? <SettingsPanel key="settings" settings={snapshot.settings} api={api} execute={execute} busy={busy} /> : repo ? <>
      {assisting ? <TicketEditor key={`agent-${repo.id}`} assisted repo={repo} api={api} execute={execute} busy={busy} onCreated={id => { void navigate(`/projects/${encode(repo.id)}/tickets/${encode(id)}`); }} onRun={setRunId} runs={[]} /> : <>
      <header className="project-header">
        <div className="project-title"><Breadcrumb className="page-breadcrumb" aria-label="Page location" items={[{ title: <Link to="/">Home</Link> }, { title: <span aria-current="page">{repo.name}</span> }]} /><h1 title={repo.path}>{repo.name}</h1></div>
        <div className="project-controls">
          <div className="execution-control" title="Execution permission"><Select aria-label="Execution permission" popupMatchSelectWidth={280} disabled={busy} value={repo.mode} onChange={value => void changeMode(value)} options={modeOptions} /></div>
          <Link className="new-ticket-link" ref={newTicketLink} onClick={event => { returnFocus.current = event.currentTarget; }} to={`/projects/${encode(repo.id)}/tickets/new`}><PlusIcon size={16} aria-hidden="true" />New ticket</Link>
          <Link className="agent-ticket-link" to={`/projects/${encode(repo.id)}/tickets/new/agent`}>Create with agent</Link>
        </div>
      </header>
      <p className="execution-context">{repo.mode === 'paused' ? 'New starts paused. A current run continues.' : repo.mode === 'approved' ? 'Only approved revisions may start. Dependencies and the global slot still apply.' : 'Automatic execution enabled. Eligible revisions may run without individual approval.'}{snapshot.settings.paused && ' Global scheduler also paused.'}</p>
      {!repo.git && <p className="warning-text">Non-Git workspace. Git changed-file tracking is unavailable.</p>}
      {repo.handoff && <section className="panel" aria-label="Workspace handoff"><h2>Operator reconciliation required</h2><p>{repo.handoff.reason}</p>{repo.handoff.runId && <Link to={`/runs/${encode(repo.handoff.runId)}`}>Review originating run</Link>}<ol><li>Review evidence and partial work. Preserve unrelated edits.</li><li>Reconcile Git changes in your terminal under your own approval policy. This app never commits, stashes, resets, or deletes them.</li><li>When Git is clean outside <code>.omp-backlog/</code>, recheck below. Eligible queued tickets may then start under existing permissions.</li></ol>{repo.handoff.files.length > 0 && <pre tabIndex={0}>{repo.handoff.files.map(file => JSON.stringify(file)).join('\n')}</pre>}<Button disabled={busy || snapshot.runs.some(run => run.repoId === repo.id && activeStatuses.includes(run.status))} onClick={async () => {
        if (!await modal.confirm({ title: 'Recheck reconciled workspace?', content: 'This only inspects Git status. A clean result releases this project gate; eligible tickets may start under existing permissions. Dirty or unavailable Git remains blocked. No files will be changed.', okText: 'Recheck workspace', cancelText: 'Keep blocked' })) return;
        await execute('Workspace reconciled. Existing execution permissions still apply.', async () => { await api(`/api/repos/${encode(repo.id)}/reconcile-workspace`, json('POST', { handoffId: repo.handoff!.id })); });
      }}>Recheck workspace</Button></section>}
      <TicketBoard key={repo.id} repo={repo} tickets={tickets} snapshot={snapshot} selectedId={ticket?.id} busy={busy} api={api} execute={execute} onOpen={element => { returnFocus.current = element; }} />
      <Drawer className="ticket-drawer" title={creating ? 'New ticket' : ticket?.id ?? 'Ticket unavailable'} open={creating || !!ticketId} onClose={() => { void navigate(`/projects/${encode(repo.id)}`); }} size={expanded ? '100vw' : 'min(800px, 100vw)'} destroyOnHidden afterOpenChange={open => { if (!open) { setExpanded(false); (returnFocus.current?.isConnected ? returnFocus.current : newTicketLink.current)?.focus({ preventScroll: true }); } }} extra={<Button type="text" aria-label={expanded ? 'Restore ticket panel' : 'Expand ticket panel'} icon={expanded ? <ArrowsInIcon size={18} /> : <ArrowsOutIcon size={18} />} onClick={() => setExpanded(value => !value)} />}>
        {creating ? <TicketEditor key={`new-${repo.id}`} repo={repo} api={api} execute={execute} busy={busy} onCreated={id => { void navigate(`/projects/${encode(repo.id)}/tickets/${encode(id)}`); }} onRun={setRunId} runs={[]} /> : ticket ? <TicketEditor key={`${repo.id}-${ticket.id}`} repo={repo} ticket={ticket} tickets={tickets} api={api} execute={execute} busy={busy} runs={snapshot.runs.filter(value => value.repoId === repo.id && value.ticketId === ticket.id).sort((a, b) => b.started - a.started)} onCreated={() => undefined} onRun={setRunId} /> : ticketId ? <div className="empty-state"><h2>Ticket not found</h2><p>This ticket is not available in this project.</p><Link to={`/projects/${encode(repo.id)}`}>Return to board</Link></div> : null}
      </Drawer>
      </>}
    </> : !selectedRun && <section className="panel empty-state"><h1>Page not found</h1><p>This project, run, or page is unavailable.</p><Link to="/">Return Home</Link></section>}
    {selectedRun && <RunPanel run={selectedRun} ticket={snapshot.tickets.find(value => value.repoId === selectedRun.repoId && value.id === selectedRun.ticketId)} repo={snapshot.repos.find(value => value.id === selectedRun.repoId)} api={api} execute={execute} busy={busy} onClose={() => { void navigate(`/projects/${encode(selectedRun.repoId)}/tickets/${encode(selectedRun.ticketId)}`); }} />}
    {picking && <FolderPicker api={api} execute={execute} busy={busy} onClose={() => { void navigate('/'); }} onRegistered={id => { void navigate(`/projects/${encode(id)}`); }} />}
  </>;
}

interface EditorProps { repo: Repo; ticket?: Ticket; tickets?: Ticket[]; api: RequestApi; execute: Execute; busy: boolean; runs: Run[]; onCreated: (id: string) => void; onRun: (id: string) => void; assisted?: boolean }
const template = '---\nid: T001\ntitle: \ndepends_on: []\n---\n\n[What to change and where.]\n\n[Constraints or reference, if needed.]\n\nDone when:\n- [Observable result.]\n- [How to verify it.]\n';
function TicketEditor({ repo, ticket, tickets = [], api, execute, busy, runs, onCreated, onRun, assisted = false }: EditorProps) {
  const [draft, setDraft] = useState(ticket?.markdown ?? template);
  const latestDraft = useRef(draft);
  useEffect(() => { latestDraft.current = draft; }, [draft]);
  const [base, setBase] = useState({ markdown: ticket?.markdown ?? template, revision: ticket?.revision ?? '' });
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(!ticket);
  const [conflict, setConflict] = useState('');
  const [attachment, setAttachment] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [stagedCount, setStagedCount] = useState(0);
  const [draftFiles, setDraftFiles] = useState<{ name: string; file: File }[]>([]);
  const [agentVisible, setAgentVisible] = useState(assisted);
  const [assistedUsed, setAssistedUsed] = useState(assisted);
  const [agentDirty, setAgentDirty] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmationMode, setConfirmationMode] = useState<Mode>();
  const assistedAttempt = useRef<{ markdown: string; files: { name: string; file: File }[]; confirmation: string } | null>(null);
  const publicationLock = useRef(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const staged = useRef<StagedAttachment[]>([]);
  const serverTicket = useRef(ticket);
  const [knownRevisions, setKnownRevisions] = useState(() => new Set(ticket ? [ticket.revision] : []));
  const [hasServerTicket, setHasServerTicket] = useState(Boolean(ticket));
  const uploadTask = useRef<Promise<void> | null>(null);
  const createAttempt = useRef<{ markdown: string; previousIds: Set<string> } | null>(null);
  const alive = useRef(true);
  const [modal, modalContext] = Modal.useModal();
  const stale = !!ticket && !uploading && !knownRevisions.has(ticket.revision);
  const dirty = draft !== base.markdown;
  const actionsBusy = busy || uploading || stagedCount > 0;
  const savedNavigation = useRef(false);
  const editorBusy = busy || agentBusy || publishing;
  const unsaved = dirty || agentDirty || agentBusy || publishing || stagedCount > 0 || (!ticket && hasServerTicket);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && !savedNavigation.current && currentLocation.pathname !== nextLocation.pathname);
  const working = !!ticket && activeStatuses.includes(ticket.status);
  const path = ticket ? `/api/repos/${encode(ticket.repoId)}/tickets/${encode(ticket.id)}` : '';
  const attachmentBase = path ? `${path}/attachments/` : '';

  useEffect(() => {
    alive.current = true;
    const files = staged.current;
    return () => {
      alive.current = false;
      for (const file of files) if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
    };
  }, []);

  function acceptRevision(saved: Ticket) {
    serverTicket.current = saved;
    if (alive.current) {
      setKnownRevisions(previous => previous.has(saved.revision) ? previous : new Set(previous).add(saved.revision));
      setHasServerTicket(true);
      setBase({ markdown: saved.markdown, revision: saved.revision });
    }
  }

  async function recoverUpload(file: StagedAttachment, before: Ticket): Promise<Ticket | undefined> {
    const state = await api<Snapshot>('/api/state');
    const current = state.tickets.find(value => value.repoId === repo.id && value.id === before.id);
    const alreadyKnown = before.attachments.some(value => value.name === file.name);
    if (!current || current.markdown !== before.markdown || current.attachments.length !== before.attachments.length + (alreadyKnown ? 0 : 1)) return;
    if (!before.attachments.every(old => current.attachments.some(value => value.name === old.name && value.hash === old.hash))) return;
    const uploaded = current.attachments.find(value => value.name === file.name);
    if (!uploaded || uploaded.size !== file.file.size) return;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    return uploaded.hash === hash ? current : undefined;
  }

  function flushUploads(): Promise<void> {
    if (uploadTask.current) return uploadTask.current;
    if (!serverTicket.current || !staged.current.some(file => !file.uploaded)) return Promise.resolve();
    setUploading(true); setUploadError('');
    const task = (async () => {
      for (const file of staged.current) {
        if (file.uploaded || !alive.current) continue;
        const before = serverTicket.current!;
        if (before.attachments.some(value => value.name === file.name)) {
          const recovered = await recoverUpload(file, before);
          if (!recovered) throw new Error(`Attachment ${file.name} does not match the pasted file. Preserve your draft and reconcile the attachment.`);
          file.uploaded = true; acceptRevision(recovered);
          if (alive.current) setStagedCount(staged.current.filter(value => !value.uploaded).length);
          continue;
        }
        const data = new FormData();
        data.set('file', file.file, file.name);
        data.set('revision', before.revision);
        let saved: Ticket;
        try {
          saved = await api<Ticket>(`/api/repos/${encode(repo.id)}/tickets/${encode(before.id)}/attachments`, { method: 'POST', body: data });
        } catch (cause) {
          // A disconnected response may still have committed. Confirm its exact bytes before retrying.
          const recovered = await recoverUpload(file, before).catch(() => undefined);
          if (!recovered) throw cause;
          saved = recovered;
        }
        if (saved.markdown !== before.markdown || saved.attachments.length !== before.attachments.length + 1 || !before.attachments.every(old => saved.attachments.some(value => value.name === old.name && value.hash === old.hash)) || !saved.attachments.some(value => value.name === file.name)) throw new Error('Requirements changed during upload. Your draft and staged files are preserved; reconcile before retrying.');
        file.uploaded = true;
        acceptRevision(saved);
        if (alive.current) setStagedCount(staged.current.filter(value => !value.uploaded).length);
      }
    })().catch(cause => {
      if (alive.current) setUploadError(`${message(cause)} Your Markdown and pasted files are preserved. Reconcile any external changes, then retry uploads.`);
      throw cause;
    }).finally(() => {
      uploadTask.current = null;
      if (alive.current) setUploading(false);
    });
    uploadTask.current = task;
    return task;
  }

  async function uploadFiles(files: File[]): Promise<AttachmentReference[]> {
    if (editorBusy || ticket?.removed) throw new Error('Attachments are unavailable while the ticket or drafting agent is busy or missing.');
    if (stale) throw new Error('A newer revision is available. Your draft is preserved; reconcile it before pasting attachments.');
    // Validate the entire paste before staging anything; rejected files never become Markdown references.
    const references = files.map(file => ({ ...attachmentReference(file), file, uploaded: false } as StagedAttachment));
    const total = (serverTicket.current?.attachments.reduce((sum, file) => sum + file.size, 0) ?? 0)
      + staged.current.filter(file => !file.uploaded).reduce((sum, file) => sum + file.file.size, 0)
      + files.reduce((sum, file) => sum + file.size, 0);
    if (total > 50 * 1024 * 1024) throw new Error('Ticket attachments exceed the 50 MiB limit.');
    const count = (serverTicket.current?.attachments.length ?? 0) + staged.current.filter(file => !file.uploaded).length + references.length;
    if (count > 100) throw new Error('At most 100 attachments are permitted per ticket.');
    for (const reference of references) {
      if (/\.(png|jpe?g|gif|webp)$/i.test(reference.name)) reference.objectUrl = URL.createObjectURL(reference.file);
      staged.current.push(reference);
    }
    setAttachmentUrls(Object.fromEntries(staged.current.filter(file => file.objectUrl).map(file => [file.url, file.objectUrl!])));
    setStagedCount(staged.current.filter(file => !file.uploaded).length);
    setDraftFiles(staged.current.map(({ name, file }) => ({ name, file })));
    setUploadError('');
    if (ticket) void flushUploads().catch(() => undefined);
    return references;
  }

  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft || editorBusy || uploading) return;
    const submitted = draft;
    if (!ticket && assistedUsed) {
      if (publicationLock.current) return;
      publicationLock.current = true;
      setPublishing(true); setConflict('');
      try {
        const files = staged.current.map(({ name, file }) => ({ name, file }));
        let attempt = assistedAttempt.current;
        if (!attempt || attempt.markdown !== submitted || attempt.files.length !== files.length || !attempt.files.every((file, index) => file.name === files[index].name && file.file === files[index].file)) {
          assistedAttempt.current = null;
          const data = new FormData();
          data.set('markdown', submitted);
          for (const file of files) data.append('files', file.file, file.name);
          const confirmation = await api<AssistedConfirmation>(`/api/repos/${encode(repo.id)}/assisted-prepare`, { method: 'POST', body: data });
          setConfirmationMode(confirmation.mode);
          if (!await modal.confirm({
            title: confirmation.mode === 'automatic' ? 'Create ticket with Automatic execution enabled?' : 'Create reviewed ticket?',
            content: confirmation.mode === 'automatic'
              ? 'Current project mode: Automatic. The complete reviewed Markdown and all staged attachment bytes have been validated. Creating this ticket may immediately start implementation under standing permission. OMP can execute commands with your filesystem permissions; this is not sandboxed. Cancel keeps your draft, conversation and files without creating a ticket.'
              : `Current project mode: ${modes[confirmation.mode]}. ${confirmation.mode === 'paused' ? 'New starts remain paused.' : 'Exact-revision approval is still required before implementation.'} Create the reviewed Markdown and all staged attachment bytes? Cancel preserves everything in this tab.`,
            okText: confirmation.mode === 'automatic' ? 'Create ticket · allow Automatic execution' : 'Create reviewed ticket',
            cancelText: 'Keep reviewing',
          })) return;
          attempt = { markdown: submitted, files, confirmation: confirmation.confirmation };
          assistedAttempt.current = attempt;
        }
        const confirmed = attempt;
        await execute('Ticket created with all reviewed attachments. Repository permission still applies.', async () => {
          try {
            const data = new FormData();
            data.set('markdown', confirmed.markdown);
            data.set('confirmation', confirmed.confirmation);
            for (const file of confirmed.files) data.append('files', file.file, file.name);
            // Keep the same confirmation after a lost response: the server owns exact-once publication.
            const saved = await api<Ticket>(`/api/repos/${encode(repo.id)}/assisted-create`, { method: 'POST', body: data });
            for (const file of staged.current) file.uploaded = true;
            setStagedCount(0); setUploadError('');
            acceptRevision(saved);
            setDraft(saved.markdown); setConflict('');
            savedNavigation.current = true;
            onCreated(saved.id);
          } catch (cause) {
            if (typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number' && cause.status >= 400 && cause.status < 500) assistedAttempt.current = null;
            setConflict(`${message(cause)} Your reviewed Markdown, conversation and staged files are preserved. Retry keeps the same publication confirmation after an uncertain response; a stale payload or mode requires a fresh review. No manual-create fallback is used.`);
            throw cause;
          }
        });
      } catch (cause) {
        setConflict(`${message(cause)} Your draft, conversation and staged files are preserved; no ticket was intentionally submitted without confirmation.`);
      } finally { publicationLock.current = false; setPublishing(false); }
      return;
    }
    await execute(ticket ? 'Ticket saved. Revision permissions refreshed.' : 'Ticket created. Repository permission still applies.', async () => {
      try {
        if (!ticket && !serverTicket.current) {
          if (!createAttempt.current) {
            const state = await api<Snapshot>('/api/state');
            createAttempt.current = { markdown: submitted, previousIds: new Set(state.tickets.filter(value => value.repoId === repo.id).map(value => value.id)) };
          } else {
            const state = await api<Snapshot>('/api/state');
            const attempt = createAttempt.current;
            const created = state.tickets.find(value => value.repoId === repo.id && !attempt.previousIds.has(value.id) && value.markdown === attempt.markdown);
            if (created) acceptRevision(created);
          }
          if (!serverTicket.current) {
            const saved = await api<Ticket>(`/api/repos/${encode(repo.id)}/tickets`, json('POST', { markdown: createAttempt.current.markdown }));
            acceptRevision(saved);
          }
        }
        await flushUploads();
        const current = serverTicket.current!;
        const saved = ticket || current.markdown !== submitted
          ? await api<Ticket>(`/api/repos/${encode(repo.id)}/tickets/${encode(current.id)}`, json('PUT', { markdown: submitted, revision: current.revision }))
          : current;
        acceptRevision(saved);
        setDraft(value => value === submitted ? saved.markdown : value); setConflict('');
        if (!ticket && latestDraft.current === submitted) { savedNavigation.current = true; onCreated(saved.id); }
      } catch (cause) {
        if (!serverTicket.current && typeof cause === 'object' && cause !== null && 'status' in cause && typeof cause.status === 'number' && cause.status >= 400 && cause.status < 500) createAttempt.current = null;
        if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 409) setConflict('This save conflicted with a newer revision. Your draft is preserved below. Copy it before loading the current file, then reconcile the changes.');
        throw cause;
      }
    });
  }

  async function loadCurrentVersion() {
    const identity = ticket ?? serverTicket.current;
    if (!identity) return;
    if (dirty && !await modal.confirm({ title: 'Replace unsaved draft?', content: 'Replace your unsaved editor contents with the current file? Copy or download your draft first.', okText: 'Load current version', cancelText: 'Keep draft', okButtonProps: { danger: true } })) return;
    await execute('Current revision loaded. Staged attachments preserved.', async () => {
      const state = await api<Snapshot>('/api/state');
      const current = state.tickets.find(value => value.repoId === repo.id && value.id === identity.id);
      if (!current || current.removed) throw new Error('Ticket file is missing. Restore it before reconciling this draft.');
      setDraft(current.markdown);
      acceptRevision(current);
      setConflict('');
    });
  }

  async function action(value: 'approve' | 'retry' | 'done' | 'changes' | 'reorder', order?: number) {
    if (!ticket || uploading || stagedCount > 0) return;
    if (value === 'retry' && ticket.status === 'interrupted' && !await modal.confirm({ title: 'Retry interrupted run?', content: 'Have you reviewed this interrupted run and its partial filesystem changes? Retrying starts a fresh session and may repeat actions.', okText: 'Retry reviewed run', cancelText: 'Cancel' })) return;
    if (value === 'done' && !await modal.confirm({ title: 'Mark this revision Done?', content: 'Confirm every acceptance criterion has revision-bound evidence and any visual or subjective requirements have been reviewed.', okText: 'Mark revision Done', cancelText: 'Keep in review' })) return;
    const feedback = value === 'changes' ? await requestReviewFeedback(modal, <p>{ticket.id}: describe the missing behavior or evidence.</p>) : undefined;
    if (feedback === null) return;
    await execute(value === 'done' ? 'Reviewed revision marked Done.' : `Ticket ${value} recorded.`, async () => { await api(`/api/tickets/${encode(ticket.repoId)}/${encode(ticket.id)}/action`, json('POST', { action: value, revision: ticket.revision, ...(order !== undefined ? { order } : {}), ...(feedback ? { feedback } : {}) })); });
  }


  return <div className={assisted ? 'panel editor-panel agent-creation-page' : 'panel editor-panel'}>
    {modalContext}
    <Modal title="Leave unsaved changes?" open={blocker.state === 'blocked'} okText="Discard changes" cancelText="Keep editing" onOk={() => blocker.state === 'blocked' && blocker.proceed()} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>Your unsaved ticket changes, agent conversation and staged files will be discarded. An owned drafting session will be stopped.</p></Modal>
    {assisted ? <header className="agent-page-heading"><Breadcrumb className="page-breadcrumb" aria-label="Page location" items={[{ title: <Link to="/">Home</Link> }, { title: <Link to={`/projects/${encode(repo.id)}`}>{repo.name}</Link> }, { title: <span aria-current="page">Create with agent</span> }]} /><h1>Draft ticket with OMP</h1><p className="muted">Discuss the change, then review the ticket before creating it. Drafts and files live in this tab; reloading loses them.</p><Segmented aria-label="Drafting view" disabled={editorBusy || uploading || hasServerTicket} options={['Discuss', 'Review ticket']} value={agentVisible ? 'Discuss' : 'Review ticket'} onChange={value => setAgentVisible(value === 'Discuss')} /></header> : <div className="section-heading"><div>{ticket && <p className="ticket-reference">{ticket.id} · {ticket.revision.slice(0, 10)}</p>}<h2>{ticket ? ticket.title : 'Describe the change'}</h2></div>{ticket && <Status value={ticket.status} />}</div>}
    {ticket?.removed && <p className="error-banner" role="alert">Ticket file is missing. Restore its file in the repository before taking action.</p>}
    {ticket?.error && <p className="error-banner" role="alert">{ticket.error}</p>}
    {stale && <div className="notice"><div><h3>Requirements changed{working ? ' during execution' : ' outside this editor'}.</h3><p>Your editor has not been overwritten. The current run keeps its immutable revision; changed requirements require new approval.</p></div></div>}
    {(stale || conflict) && <div className="conflict-box" role="alert"><p>{conflict || 'A newer ticket or attachment revision is available. Preserve your draft and reconcile before saving.'}</p><div className="toolbar"><Button onClick={() => { void navigator.clipboard.writeText(draft).catch(() => setConflict('Clipboard unavailable. Select and copy the Markdown from the editor before loading the current version.')); }}>Copy my draft</Button><Button download={`${ticket?.id ?? 'ticket'}-draft.md`} href={`data:text/markdown;charset=utf-8,${encode(draft)}`}>Download draft</Button><Button disabled={busy || uploading} onClick={() => void loadCurrentVersion()}>Load current version</Button></div></div>}
    {ticket && <div className="ticket-facts"><p><span>Dependencies</span>{ticket.dependencies.length ? ticket.dependencies.join(', ') : 'None'}</p><p><span>Approval</span>{ticket.approvedRevision === ticket.revision ? 'Current revision approved' : 'Current revision not approved'}</p><p><span>Acceptance criteria</span>{ticket.criteria.length}</p></div>}
    {ticket && <>
      <section className="detail-section" aria-label="Ticket actions"><h3>Permission & review</h3><div className="toolbar"><Button disabled={actionsBusy || ticket.removed || !!ticket.error || dirty || stale || working || ticket.status === 'done' || ticket.approvedRevision === ticket.revision} onClick={() => void action('approve')}>Approve this revision</Button>{['blocked', 'failed', 'interrupted'].includes(ticket.status) && <Button disabled={actionsBusy || dirty || stale || ticket.removed || !!ticket.error} onClick={() => void action('retry')}>Review & retry</Button>}{ticket.status === 'needs_review' && <><Button type="primary" className="primary" disabled={actionsBusy || dirty || stale} onClick={() => void action('done')}>Accept evidence · Done</Button><Button disabled={actionsBusy || dirty || stale} onClick={() => void action('changes')}>Request changes</Button></>}{tickets.length > 1 && <><Button disabled={actionsBusy || tickets[0]?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i - 1]?.order ?? ticket.order) - 0.5); }}>Move up</Button><Button disabled={actionsBusy || tickets.at(-1)?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i + 1]?.order ?? ticket.order) + 0.5); }}>Move down</Button></>}</div><p className="muted">Approval is revision-bound, not a command to bypass dependencies or pauses. Dependencies wait for Done, not Needs review.</p>{ticket.status === 'interrupted' && <p className="warning-text">Recovery required: inspect the previous transcript and partial changes before explicitly retrying. No mutating action is replayed automatically.</p>}{working && <p className="warning-text">To stop active work, open its run and pause it. Repository pause only prevents future starts.</p>}</section>
    </>}
    {ticket && <div className="requirements-heading"><h3>Requirements</h3><Button disabled={actionsBusy || (editing && unsaved)} onClick={() => setEditing(value => !value)}>{editing ? 'Reading view' : 'Edit Markdown'}</Button></div>}
    {!editing && <article className="ticket-reading" aria-label="Ticket requirements"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith('attachments/') ? `${attachmentBase}${url.slice('attachments/'.length)}` : defaultUrlTransform(url)} components={{ a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a> }}>{draft.replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')}</Markdown></article>}
    {assisted && <>
      <div className="agent-discuss-view" hidden={!agentVisible}><AgentTicketDraft repoId={repo.id} api={api} files={draftFiles} onUpload={uploadFiles} onDirtyChange={setAgentDirty} onBusyChange={setAgentBusy} disabled={busy || publishing || uploading} onUseDraft={async markdown => {
        if (latestDraft.current !== base.markdown && !await modal.confirm({ title: 'Replace unsaved editor text with the agent draft?', content: 'Your Markdown editor contains unsaved changes. Copy or download them first if you want to keep both versions. The conversation and staged attachment files will remain available.', okText: 'Replace editor text', cancelText: 'Keep my editor text', okButtonProps: { danger: true } })) return;
        setDraft(markdown); setConflict(''); setAssistedUsed(true); setAgentVisible(false);
      }} /></div>
    </>}
    {editing && (!assisted || !agentVisible) && <form onSubmit={event => void save(event)}>
      {!ticket && !assisted && <details className="import-options"><summary>Import existing Markdown</summary><label className="import-draft">Markdown file<input type="file" disabled={editorBusy} accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { setDraft(text); setConflict(''); }).catch(cause => setConflict(message(cause))); event.target.value = ''; }} /><small>Explicit import only. Existing BACKLOG.md is never rewritten. Use a unique frontmatter id/title, describe what to change, and add Done when: bullets with observable results and how to verify them.</small></label></details>}
      <div className="editor-tabs"><Segmented aria-label="Ticket view" options={['Markdown', 'Preview']} value={preview ? 'Preview' : 'Markdown'} onChange={value => setPreview(value === 'Preview')} /><span className="muted">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
      {preview ? <div className="ticket-preview"><Suspense fallback={<p role="status" aria-live="polite">Loading editable Preview… Your Markdown is preserved.</p>}><RichMarkdownEditor value={draft} onChange={setDraft} disabled={editorBusy} onUpload={uploadFiles} attachmentBase={attachmentBase} attachmentUrls={attachmentUrls} /></Suspense></div> : <MarkdownEditor label="Ticket Markdown" value={draft} onChange={setDraft} repoId={repo.id} api={api} disabled={editorBusy} onUpload={uploadFiles} />}
      <div className="attachment-paste-status" aria-live="polite">
        <p className="muted" role="status">{uploading ? `Uploading pasted attachments… ${stagedCount} remaining. Keep editing; your Markdown is not saved automatically.` : stagedCount ? `${stagedCount} pasted attachment${stagedCount === 1 ? '' : 's'} ${hasServerTicket ? 'waiting to upload' : 'staged in this tab until Create ticket'}.` : 'Paste images or supported files directly into Markdown or Preview to attach them.'}</p>
        {uploadError && <div className="error-banner" role="alert"><p>{uploadError}</p>{hasServerTicket && <Button disabled={busy || uploading || stale} onClick={() => void flushUploads().catch(() => undefined)}>Retry uploads</Button>}</div>}
      </div>
      <p className="muted">Every uploaded file needs a Markdown link or image with a descriptive purpose label or title before execution. Explain what screenshots demonstrate, including viewport and acceptable differences. Purpose quality remains part of human review.</p>
      {!ticket && assistedUsed && <aside className="assisted-publication-note"><p>Agent-assisted creation validates and publishes the reviewed Markdown and all staged files together. {confirmationMode ? `Last reviewed project mode: ${modes[confirmationMode]}. ` : ''}Current mode is rechecked before publication. Automatic mode may start implementation immediately after explicit creation. Cancelling confirmation creates nothing.</p></aside>}
      <div className="toolbar editor-actions"><Button type="primary" htmlType="submit" className="primary" disabled={editorBusy || uploading || !!ticket?.removed || !draft}>{publishing ? 'Reviewing / creating ticket…' : ticket ? 'Save revision' : hasServerTicket ? 'Finish creating ticket' : 'Create ticket'}</Button><small>Explicit save only. Edits never silently replace an active run's instructions.</small></div>
    </form>}
    {ticket && <>
      <section className="detail-section" aria-labelledby="attachment-heading"><h3 id="attachment-heading">Attachments</h3><p className="muted">Paste files into either editor to attach them. References are not executable instructions. Describe each file's purpose in the Markdown. Use synthetic examples, never credentials.</p>{ticket.attachments.length ? <ul className="attachment-list">{ticket.attachments.map(file => <li key={file.name}><Button type="link" href={`${path}/attachments/${encode(file.name)}`} target="_blank" rel="noreferrer">{file.name}</Button><small>{(file.size / 1024).toFixed(1)} KB</small><Button onClick={() => setAttachment(attachment === file.name ? '' : file.name)}>{attachment === file.name ? 'Close preview' : 'Preview'}</Button></li>)}</ul> : <p className="muted">No attachments.</p>}{attachment && ticket.attachments.some(file => file.name === attachment) && <AttachmentPreview key={`${attachment}-${ticket.revision}`} name={attachment} url={`${path}/attachments/${encode(attachment)}`} api={api} />}</section>
      <section className="detail-section" aria-labelledby="history-heading"><h3 id="history-heading">Run history</h3>{runs.length ? <ul className="run-list">{runs.map(run => <li key={run.id}><Button className="run-history-entry" onClick={() => onRun(run.id)}><span><Status value={run.status} /> <time dateTime={new Date(run.started).toISOString()}>{new Date(run.started).toLocaleString()}</time></span><small>Revision {run.revision.slice(0, 10)}{run.revision !== ticket.revision ? ' · Older requirements' : ' · Current requirements'}</small>{run.dialog && <Tag className="attention">Answer needed</Tag>}</Button></li>)}</ul> : <p className="muted">No runs. A fresh session starts only when this revision is eligible and permitted.</p>}</section>
    </>}
  </div>;
}

function AttachmentPreview({ name, url }: { name: string; url: string; api: RequestApi }) {
  const [text, setText] = useState<string>();
  const [error, setError] = useState('');
  const image = /\.(png|jpe?g|gif|webp)$/i.test(name);
  const readable = /\.(json|txt|md|csv)$/i.test(name);
  useEffect(() => {
    if (!readable) return;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal, credentials: 'same-origin' }).then(async response => { if (!response.ok) throw new Error(`Attachment request failed (${response.status}). Sign in again if your session expired.`); const value = await response.text(); setText(value); }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); });
    return () => controller.abort();
  }, [url, readable]);
  return <div className="attachment-preview"><h4>{name}</h4>{image ? <img src={url} alt={`Attachment reference: ${name}`} onError={() => setError('Image could not be loaded. Your session may have expired.')} /> : readable ? <pre tabIndex={0}>{text ?? 'Loading text...'}</pre> : <p>This document is not rendered inline. <Button type="link" href={url} target="_blank" rel="noreferrer">Download and inspect {name}</Button>.</p>}{error && <p role="alert" className="warning-text">{error}</p>}</div>;
}

interface FolderListing { path: string; parent: string | null; directories: string[] }
function FolderPicker({ api, execute, busy, onClose, onRegistered }: { api: RequestApi; execute: Execute; busy: boolean; onClose: () => void; onRegistered: (id: string) => void }) {
  const [listing, setListing] = useState<FolderListing>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const browse = useCallback(async (path = '') => {
    const next = ++sequence.current;
    setLoading(true); setError('');
    try { const value = await api<FolderListing>(`/api/folders${path ? `?path=${encode(path)}` : ''}`); if (next === sequence.current) setListing(value); }
    catch (cause) { if (next === sequence.current) setError(message(cause)); }
    finally { if (next === sequence.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    let active = true;
    async function loadRoots() {
      try { const value = await api<FolderListing>('/api/folders'); if (active) setListing(value); }
      catch (cause) { if (active) setError(message(cause)); }
      finally { if (active) setLoading(false); }
    }
    void loadRoots();
    return () => { active = false; };
  }, [api]);
  async function register() {
    if (!listing?.path) return;
    setError('');
    await execute('Repository registered paused.', async () => {
      try { const repo = await api<Repo>('/api/repos', json('POST', { path: listing.path })); onRegistered(repo.id); }
      catch (cause) { setError(message(cause)); throw cause; }
    });
  }
  return <Modal open className="folder-dialog" title="Choose a repository" width={720} onCancel={onClose} mask={{ closable: false }} footer={<div className="dialog-actions"><Button onClick={onClose}>Cancel</Button><Button type="primary" className="primary" disabled={busy || loading || !listing?.path} onClick={() => void register()}>Register this directory</Button></div>}><p className="muted">Only permitted roots are browsable. The backend resolves the real execution directory and detects its Git root. New repositories are paused.</p>{error && <p role="alert" className="error-banner">{error}</p>}<p className="path folder-path">{listing?.path || 'Permitted roots'}</p><div className="toolbar"><Button disabled={loading} onClick={() => void browse()}>Permitted roots</Button>{listing?.parent && <Button disabled={loading} onClick={() => void browse(listing.parent ?? '')}>Parent folder ↑</Button>}</div>{loading ? <p role="status">Reading directories...</p> : <ul className="folder-list">{listing?.directories.map(path => <li key={path}><Button onClick={() => void browse(path)}>{path.split('/').filter(Boolean).at(-1) || path}<span aria-hidden="true">→</span></Button></li>)}{listing?.directories.length === 0 && <li className="muted">No child directories.</li>}</ul>}</Modal>;
}

function SettingsPanel({ settings, api, execute, busy }: { settings: Settings; api: RequestApi; execute: Execute; busy: boolean }) {
  const [draft, setDraft] = useState(settings);
  const [roots, setRoots] = useState(settings.roots.join('\n'));
  async function save(event: FormEvent) { event.preventDefault(); await execute('Settings saved. Existing runs are not restarted.', async () => { await api('/api/settings', json('PATCH', { executable: draft.executable, model: draft.model, roots: roots.split('\n').map(value => value.trim()).filter(Boolean), timeLimitMinutes: draft.timeLimitMinutes, tokenBudget: draft.tokenBudget })); }); }
  return <section className="settings-view"><h1>Execution settings</h1><p className="lead">These settings govern new runs. Saving does not restart interrupted work or change your global OMP configuration.</p><form className="panel settings-form" onSubmit={event => void save(event)}><label>OMP executable<Input value={draft.executable} onChange={event => setDraft({ ...draft, executable: event.target.value })} required /><small>Executable name on PATH or an absolute executable path on this backend.</small></label><label>Model<Input value={draft.model} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder="Use OMP configured default" /><small>Leave blank to use OMP's configured model. Credentials remain outside this website.</small></label><div className="form-columns"><label>Time limit (minutes)<InputNumber type="number" min={1} step={1} required value={Number.isNaN(draft.timeLimitMinutes) ? null : draft.timeLimitMinutes} onChange={value => setDraft({ ...draft, timeLimitMinutes: value ?? NaN })} /></label><label>Token budget<InputNumber type="number" min={1} step={1} required value={Number.isNaN(draft.tokenBudget) ? null : draft.tokenBudget} onChange={value => setDraft({ ...draft, tokenBudget: value ?? NaN })} /></label></div><label>Permitted folder roots<Input.TextArea rows={5} value={roots} onChange={event => setRoots(event.target.value)} required spellCheck={false} /><small>One absolute directory per line. Folder browsing cannot escape these roots, including through symlinks. Roots are organizational access controls, not an execution sandbox.</small></label><div className="notice"><div><h3>Limits stop work; they do not cause automatic restarts.</h3><p>Pauses do not roll back side effects. Use Pause all new starts above to prevent new sessions, and Pause current run separately to interrupt execution. Human evidence review remains required before Done.</p></div></div><div className="toolbar"><Button type="primary" htmlType="submit" className="primary" disabled={busy}>Save settings</Button><Button disabled={busy} onClick={() => { setDraft(settings); setRoots(settings.roots.join('\n')); }}>Load saved settings</Button></div></form></section>;
}

function RunPanel({ run, ticket, repo, api, execute, busy, onClose }: { run: Run; ticket?: Ticket; repo?: Repo; api: RequestApi; execute: Execute; busy: boolean; onClose: () => void }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => { section.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); section.current?.focus({ preventScroll: true }); }, [run.id]);
  const old = !!ticket && run.revision !== ticket.revision;
  return <section ref={section} className="panel run-panel" tabIndex={-1} aria-labelledby="run-heading"><div className="section-heading"><div><p className="run-reference">{repo?.name ?? run.repoId} / {run.ticketId}</p><h2 id="run-heading">Run evidence & transcript</h2></div><Button onClick={onClose}>Close run</Button></div><div className="toolbar"><Status value={run.status} /><span className="muted">{new Date(run.started).toLocaleString()}</span>{run.status === 'running' && <Button disabled={busy} onClick={() => void execute('Pause requested. Stopping is not yet stopped.', async () => { await api(`/api/runs/${encode(run.id)}/control`, json('POST', { action: 'pause' })); })}>Pause run</Button>}{run.status === 'paused' && <Button type="primary" className="primary" disabled={busy} onClick={() => void execute('Explicit run resume requested.', async () => { await api(`/api/runs/${encode(run.id)}/control`, json('POST', { action: 'resume' })); })}>Resume run</Button>}</div>{run.status === 'stopping' && <p className="notice" role="status">Stopping... Waiting for the agent and its child work to actually stop. Completed actions are not rolled back.</p>}{old && <p className="warning-text">Requirements changed during or after this run. This evidence belongs to an older revision and cannot complete the current ticket.</p>}{run.error && <p role="alert" className="error-banner">{run.error}</p>}{run.blocker && <section className="blocker-box"><h3>Blocked · prerequisite needed</h3><p>{run.blocker}</p></section>}{run.dialog && <DialogForm key={run.dialog.id} dialog={run.dialog} runId={run.id} repoId={run.repoId} api={api} execute={execute} busy={busy} />}
    <dl className="run-metadata"><div><dt>Run</dt><dd>{run.id}</dd></div><div><dt>Revision</dt><dd>{run.revision}</dd></div><div><dt>OMP session</dt><dd>{run.sessionId || 'Not recorded yet'}</dd></div><div><dt>Finished</dt><dd>{run.finished ? new Date(run.finished).toLocaleString() : 'Not settled'}</dd></div></dl>
    {run.progress && <section className="detail-section" aria-label="Observed progress"><h3>Observed progress</h3><p>{run.progress.phase}</p><p>Latest tool/action: {run.progress.latestAction}</p><p>Run time limit: {new Date(run.progress.deadline).toLocaleString()} · Token budget: {run.progress.tokenBudget}</p>{run.progress.tokens ? <><p>Last reported session usage: {run.progress.tokens.total} tokens · sampled {new Date(run.progress.tokens.sampled).toLocaleString()}</p><small>{run.progress.tokens.basis}</small></> : <p>Session token usage not reported yet.</p>}<p className="muted">Activity is not percentage completion or proof of correctness. Criterion outcomes below remain agent-reported.</p></section>}
    <section className="detail-section"><h3>Acceptance evidence</h3><p className="muted">An agent's success claim is not independent verification. Review evidence against every criterion before accepting this revision.</p>{ticket && !old && ticket.criteria.length > 0 && <ol className="criteria-list">{ticket.criteria.map((criterion, i) => <li key={`${i}-${criterion}`}>{criterion}</li>)}</ol>}{run.evidence.length ? <ol className="evidence-list">{run.evidence.map((item, i) => <li key={i}><pre tabIndex={0}>{item}</pre></li>)}</ol> : <p className="muted">No verification evidence recorded.</p>}</section>
    <section className="detail-section"><h3>Verification receipts</h3><p className="muted">Outcomes, commands and recipe identities below are agent-reported. Host records receipt time and artifact bytes/hash, not whether a check really ran or its conclusion is correct.</p>{run.verification?.length ? <ol className="evidence-list">{run.verification.map(receipt => <li key={receipt.id}><strong>{receipt.outcome} · {receipt.criterion}</strong><p>{receipt.feature} → {receipt.entryPoint}</p><pre tabIndex={0}>{receipt.method}{'\n'}{receipt.details}</pre><p>Recipe (reported): {receipt.recipe}</p><small>Run {receipt.runId} · revision {receipt.revision} · recorded {new Date(receipt.recorded).toLocaleString()}</small>{receipt.artifact && <p><a href={`/api/runs/${encode(run.id)}/proof/${encode(receipt.artifact.id)}`} download>{receipt.artifact.name}</a> · {receipt.artifact.size} bytes · SHA-256 <code>{receipt.artifact.sha256}</code></p>}</li>)}</ol> : <p className="muted">No structured receipts. Legacy text evidence is unverified.</p>}</section>
    {run.reviewFeedback && <section className="detail-section"><h3>Human change request</h3><p>Linked to this run and revision; supplied to the next authorized attempt.</p><pre tabIndex={0}>{run.reviewFeedback.message}</pre></section>}
    <section className="detail-section"><h3>Changed files</h3><pre className="transcript" tabIndex={0}>{run.changedFiles || (repo?.git ? 'No changed-file summary recorded.' : 'Git change tracking unavailable for this workspace.')}</pre></section><section className="detail-section"><h3>Live transcript</h3><p className="muted">Persisted output, including errors and partial work. Browser closure does not stop this process.</p><pre className="transcript" tabIndex={0}>{run.transcript || 'Waiting for recorded output…'}</pre></section>
  </section>;
}

function DialogForm({ dialog, runId, repoId, api, execute, busy }: { dialog: Dialog; runId: string; repoId: string; api: RequestApi; execute: Execute; busy: boolean }) {
  const [value, setValue] = useState(typeof dialog.prefill === 'string' ? dialog.prefill : '');
  const method = dialog.method.replace(/^.*\./, '');
  const options = (dialog.options ?? []).filter((option): option is string => typeof option === 'string');
  async function answer(response: Record<string, unknown>) { await execute('Answer sent to this dialog.', async () => { await api(`/api/runs/${encode(runId)}/answer`, json('POST', { id: dialog.id, ...response })); }); }
  return <section className="agent-dialog" aria-labelledby={`dialog-${dialog.id}`}><h3 id={`dialog-${dialog.id}`}>{dialog.title || 'Agent response required'}</h3>{dialog.message && <pre className="dialog-message">{dialog.message}</pre>}{method === 'confirm' ? <div className="toolbar"><Button type="primary" className="primary" disabled={busy} onClick={() => void answer({ confirmed: true })}>Confirm / allow</Button><Button disabled={busy} onClick={() => void answer({ confirmed: false })}>Decline</Button></div> : ['select', 'input', 'editor'].includes(method) ? <form onSubmit={event => { event.preventDefault(); if (value) void answer({ value }); }}>{method === 'editor' ? <MarkdownEditor label="Your answer" value={value} onChange={setValue} repoId={repoId} api={api} disabled={busy} /> : <label>{method === 'select' ? 'Choose a response' : 'Your answer'}{method === 'select' ? <Select aria-label="Choose a response" placeholder="Select an option" value={value || undefined} onChange={setValue} disabled={busy} options={options.map(option => ({ value: option, label: option }))} /> : <Input.TextArea required value={value} onChange={event => setValue(event.target.value)} rows={3} disabled={busy} />}</label>}<Button type="primary" htmlType="submit" className="primary" disabled={busy || !value}>Send answer</Button></form> : <p className="warning-text">Unsupported interactive request ({dialog.method}). It cannot be silently approved. Cancel this request and review the run.</p>}<Button className="quiet" disabled={busy} onClick={() => void answer({ cancelled: true })}>Cancel request · do not approve</Button><p className="muted">Responses are bound to this dialog. Approval is never assumed if you disconnect.</p></section>;
}
