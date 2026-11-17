import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Checkbox, Input, InputNumber, message as toastApi, Modal, Segmented, Select, Tabs, Tag, Tooltip } from 'antd';
import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ArrowDownIcon, ArrowSquareOutIcon, ArrowUpIcon, BrainIcon, CaretRightIcon, ChatCircleDotsIcon, CheckCircleIcon, ClockCounterClockwiseIcon, CodeIcon, CoinsIcon, CopyIcon, CpuIcon, DownloadSimpleIcon, EyeIcon, FileTextIcon, FloppyDiskIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, FolderSimpleIcon, GaugeIcon, GearSixIcon, GitBranchIcon, HouseLineIcon, InfoIcon, LightningIcon, ListChecksIcon, PaperclipIcon, PauseIcon, PencilSimpleIcon, PlayIcon, PlusIcon, RobotIcon, SealCheckIcon, ShieldCheckIcon, SlidersIcon, StackIcon, TerminalWindowIcon, TicketIcon, TimerIcon, TreeStructureIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { Link, useBlocker, useLinkClickHandler, useLocation, useNavigate, useParams } from 'react-router';
import type { Dialog, Mode, Repo, Run, Settings, Snapshot, Ticket } from '../server/contracts';
import { attachmentReference } from './attachments';
import type { AttachmentReference, StagedAttachment } from './attachments';
import MarkdownEditor from './MarkdownEditor';
import AgentTicketDraft from './AgentTicketDraft';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import TicketBoard from './TicketBoard';
import { requestReviewFeedback } from './reviewFeedback';
import WorkspaceCommit from './WorkspaceCommit';
import RunTranscript from './RunTranscript';
import BlockedRecovery from './BlockedRecovery';
import TicketExecution from './TicketExecution';
import ModelPicker from './ModelPicker';
import RunUsage from './RunUsage';
import CompletionPolicy from './CompletionPolicy';
import LifecycleProgress from './LifecycleProgress';
import { lifecycleLabels, lifecycleOwnsCompletion } from './lifecyclePresentation';

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
  const newTicketPath = `/projects/${encode(repoId ?? '')}/tickets/new`;
  const openNewTicket = useLinkClickHandler<HTMLElement>(newTicketPath);
  const openAgentTicket = useLinkClickHandler<HTMLElement>(`${newTicketPath}/agent`);
  const openProjectPicker = useLinkClickHandler<HTMLElement>('/projects/new');
  const home = pathname === '/';
  const settingsView = pathname === '/settings';
  const picking = pathname === '/projects/new';
  const creating = !!repoId && pathname.endsWith('/tickets/new');
  const assisting = !!repoId && pathname.endsWith('/tickets/new/agent');
  const [pending, setPending] = useState('');
  const [toast, toastContext] = toastApi.useMessage({ duration: 4, maxCount: 3 });
  const [modal, modalContext] = Modal.useModal();
  const [completionOpen, setCompletionOpen] = useState(false);
  const returnFocus = useRef<HTMLAnchorElement | null>(null);
  const newTicketLink = useRef<HTMLAnchorElement | null>(null);
  const repo = snapshot.repos.find(value => value.id === repoId);
  const tickets = snapshot.tickets.filter(value => value.repoId === repo?.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ticket = tickets.find(value => value.id === ticketId);
  const selectedRun = snapshot.runs.find(value => value.id === runId);
  const claimedRuns = snapshot.runs.filter(value => activeStatuses.includes(value.status));
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
    setPending(name); onError('');
    try { await work(); await refresh(); void toast.success(name); return true; }
    catch (cause) { void toast.error({ content: message(cause), duration: 8 }); return false; }
    finally { setPending(''); }
  };

  function setRunId(id: string) { void navigate(`/runs/${encode(id)}`); }

  async function changeMode(mode: Mode) {
    if (!repo || mode === repo.mode) return;
    if (mode === 'automatic' && !await modal.confirm({ title: 'Enable automatic execution?', content: 'New valid tickets and eligible requirement or attachment revisions may run without individual approval. OMP can execute commands with your filesystem permissions. Nothing is sandboxed. Completion authority is configured separately; the saved project completion policy still applies.', okText: 'Enable automatic execution', cancelText: 'Keep current permission' })) return;
    await execute('Repository permission saved.', async () => { await api(`/api/repos/${encode(repo.id)}`, json('PATCH', { mode })); });
  }

  const scheduler = <div className={`execution-strip${snapshot.settings.paused ? ' scheduler-paused' : ''}`} aria-label="Scheduler">
    <div><strong>{snapshot.settings.paused ? <PauseIcon size={16} aria-hidden="true" /> : <PlayIcon size={16} aria-hidden="true" />}Scheduler: {snapshot.settings.paused ? 'new starts paused' : 'following project permissions'}</strong><small>{claimedRuns.length}/{snapshot.settings.maxConcurrentTickets} slots in use · one run per project<Tooltip title="Slots include paused and stopping runs. Pausing new starts lets current runs continue."><Button type="text" size="small" aria-label="About scheduler slots" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip>{claimedRuns.length > snapshot.settings.maxConcurrentTickets && <span className="warning-text"> · Over capacity; no new starts until a slot frees</span>}</small></div>
    <Button icon={snapshot.settings.paused ? <PlayIcon size={16} aria-hidden="true" /> : <PauseIcon size={16} aria-hidden="true" />} disabled={busy} onClick={() => void execute(snapshot.settings.paused ? 'New starts enabled.' : 'All new starts paused. Current runs continue.', async () => { await api('/api/settings', json('PATCH', { paused: !snapshot.settings.paused })); })}>{snapshot.settings.paused ? 'Allow new starts' : 'Pause all new starts'}</Button>
  </div>;

  return <>
    {modalContext}{toastContext}
    {claimedRuns.map(run => <section key={run.id} className="active-run" aria-label={`Claimed run ${run.ticketId} in ${snapshot.repos.find(value => value.id === run.repoId)?.name ?? run.repoId}`}><div><Status value={run.status} /><strong>{snapshot.repos.find(value => value.id === run.repoId)?.name} / {run.ticketId}</strong>{run.dialog && <Tag className="attention">Answer needed</Tag>}</div><div className="toolbar"><Button onClick={() => setRunId(run.id)}>Open run</Button><RunControls run={run} api={api} execute={execute} busy={busy} /></div>{run.dialog && runId !== run.id && <DialogForm key={run.dialog.id} dialog={run.dialog} runId={run.id} repoId={run.repoId} api={api} execute={execute} busy={busy} />}</section>)}
    <p className="operation-status" role="status" aria-live="polite">{pending ? 'Working...' : ''}</p>
    {home || picking ? <section className="home-view" aria-labelledby="home-heading">
      <div className="section-heading"><div><h1 id="home-heading">Projects</h1></div><Button type="primary" icon={<PlusIcon size={16} aria-hidden="true" />} href="/projects/new" onClick={openProjectPicker}>Add project</Button></div>
      {home && scheduler}
      {snapshot.repos.length ? <ul className="project-grid" aria-label="Projects">
        {snapshot.repos.map(project => {
          const summary = queueSummaries.get(project.id);
          return <li key={project.id}>
          <Link className="project-folder" to={`/projects/${encode(project.id)}`}>
            <FolderIcon className="project-folder-icon" size={30} weight="duotone" aria-hidden="true" />
            <strong>{project.name}</strong>
            <span className="path" title={project.path}>{project.path}</span>
            <span className="project-folder-meta"><span className="meta-item">{(() => { const ModeIcon = modeIcons[project.mode]; return <ModeIcon size={16} aria-hidden="true" />; })()}{modes[project.mode]}</span><span className="meta-item"><TicketIcon size={16} aria-hidden="true" />{summary?.total ?? 0} tickets</span></span>
            <span className="project-folder-meta"><span className="meta-item" title={project.completion?.mode === 'autonomous' ? 'Autonomous local commit & Done' : 'Human review'}>{project.completion?.mode === 'autonomous' ? <RobotIcon size={16} aria-hidden="true" /> : <SealCheckIcon size={16} aria-hidden="true" />}Completion: {project.completion?.mode === 'autonomous' ? 'Autonomous' : 'Human review'}</span></span>
            <span className="project-folder-meta"><span className="meta-item"><LightningIcon size={16} aria-hidden="true" />{claimedRuns.filter(run => run.repoId === project.id).map(run => `${run.ticketId} (${run.status})`).join(', ') || 'No active runs'}</span></span>
            {project.handoff && <span className="warning-text">Operator reconciliation required · new starts blocked</span>}
            <span className="project-queue" aria-label="Ticket status counts">{summary ? queueStatuses.map(status => summary.counts[status] ? <span key={status}><Status value={status} /> <span>{summary.counts[status]}</span></span> : null) : <span>No tickets</span>}</span>
          </Link>
          </li>;
        })}
      </ul> : <div className="panel empty-state"><FolderIcon className="project-folder-icon" size={40} weight="duotone" aria-hidden="true" /><h2>No projects yet</h2><p>Add a local folder to get started. New projects start paused.</p></div>}
    </section> : settingsView ? <SettingsPanel key="settings" settings={snapshot.settings} api={api} execute={execute} busy={busy} /> : repo ? <>
      {assisting ? <TicketEditor key={`agent-${repo.id}`} assisted repo={repo} api={api} execute={execute} busy={busy} onCreated={id => { void navigate(`/projects/${encode(repo.id)}/tickets/${encode(id)}`); }} onRun={setRunId} runs={[]} /> : <>
      <header className="project-header">
        <div className="project-title"><h1 title={repo.path}>{repo.name}</h1><p className="execution-context">{repo.mode === 'paused' ? 'New starts paused. Current runs continue.' : repo.mode === 'approved' ? 'Only approved revisions may start. Dependencies and global capacity still apply.' : 'Automatic execution enabled. Eligible revisions may run without individual approval.'}{snapshot.settings.paused && ' Global scheduler also paused.'} {claimedRuns.length}/{snapshot.settings.maxConcurrentTickets} global slots occupied. One run per project.</p></div>
        <div className="project-controls">
          <div className="execution-control" title="Execution permission"><Select aria-label="Execution permission" popupMatchSelectWidth={280} disabled={busy} value={repo.mode} onChange={value => void changeMode(value)} options={modeOptions} /></div>
          <Tooltip title={`Completion: ${repo.completion?.mode === 'autonomous' ? 'Autonomous' : 'Human review'}`}><Button className="completion-policy-trigger" aria-label={`Completion: ${repo.completion?.mode === 'autonomous' ? 'Autonomous' : 'Human review'}`} icon={<SealCheckIcon size={16} aria-hidden="true" />} disabled={busy || !!ticketId || creating} onClick={() => setCompletionOpen(true)} /></Tooltip>
          <Button type="primary" className="new-ticket-link" ref={element => { newTicketLink.current = element instanceof HTMLAnchorElement ? element : null; }} href={newTicketPath} icon={<PlusIcon size={16} aria-hidden="true" />} onClick={event => { if (event.currentTarget instanceof HTMLAnchorElement) returnFocus.current = event.currentTarget; openNewTicket(event); }}>New ticket</Button>
          <Tooltip title="Create with agent"><Button href={`${newTicketPath}/agent`} aria-label="Create with agent" icon={<ChatCircleDotsIcon size={16} aria-hidden="true" />} onClick={openAgentTicket} /></Tooltip>
        </div>
      </header>
      {completionOpen && !ticketId && !creating && <CompletionPolicy key={`completion-${repo.id}`} repo={repo} api={api} execute={execute} busy={busy} owned={snapshot.runs.some(run => run.repoId === repo.id && activeStatuses.includes(run.status))} onClose={() => setCompletionOpen(false)} />}
      {!repo.git && <p className="warning-text">Non-Git workspace. Git changed-file tracking is unavailable.</p>}
      {repo.handoff && <section className="workspace-handoff" aria-label="Workspace handoff">
        <div className="workspace-handoff-summary">
          <div className="workspace-handoff-message"><h2>New starts blocked</h2><p>{repo.handoff.files.length ? `Review workspace changes before the next ticket · ${repo.handoff.files.length} recorded ${repo.handoff.files.length === 1 ? 'path' : 'paths'}.` : 'Workspace inspection needs operator review before the next ticket.'}</p></div>
          <div className="toolbar workspace-handoff-actions"><WorkspaceCommit key={repo.handoff.id} repo={repo} api={api} disabled={busy || snapshot.runs.some(run => run.repoId === repo.id && activeStatuses.includes(run.status))} onCommitted={refresh} /><Button disabled={busy || snapshot.runs.some(run => run.repoId === repo.id && activeStatuses.includes(run.status))} onClick={async () => {
            if (!await modal.confirm({ title: 'Recheck reconciled workspace?', content: 'This only inspects Git status. A clean result releases this project gate; eligible tickets may start under existing permissions. Dirty or unavailable Git remains blocked. No files will be changed.', okText: 'Recheck workspace', cancelText: 'Keep blocked' })) return;
            await execute('Workspace reconciled. Existing execution permissions still apply.', async () => { await api(`/api/repos/${encode(repo.id)}/reconcile-workspace`, json('POST', { handoffId: repo.handoff!.id })); });
          }}>Recheck workspace</Button></div>
        </div>
        <details className="workspace-handoff-details" key={repo.handoff.id}>
          <summary>Details &amp; recovery</summary>
          <div className="workspace-handoff-body"><p>{repo.handoff.reason}</p>{repo.handoff.runId && <Link to={`/runs/${encode(repo.handoff.runId)}`}>Review originating run</Link>}
            <ol><li>Review evidence and partial work. Preserve unrelated edits.</li><li>Use Review &amp; commit for an explicitly confirmed local commit, or reconcile in your terminal. No automatic commits, pushes, stashes, resets or file deletion.</li><li>When Git is clean outside <code>.omp-backlog/</code>, recheck above. Eligible queued tickets may then start under existing permissions. Marking a ticket Done does not clear this gate.</li></ol>
            {repo.handoff.files.length > 0 && <><h3>Recorded paths</h3><pre tabIndex={0} aria-label="Recorded workspace paths">{repo.handoff.files.map(file => JSON.stringify(file)).join('\n')}</pre></>}
          </div>
        </details>
      </section>}
      <TicketBoard key={repo.id} repo={repo} tickets={tickets} snapshot={snapshot} selectedId={ticket?.id} busy={busy} api={api} execute={execute} onOpen={element => { returnFocus.current = element; }} />
      <Modal className="ticket-modal" centered width={880} footer={null} title={creating ? 'New ticket' : ticket?.id ?? 'Ticket unavailable'} open={creating || !!ticketId} onCancel={() => { void navigate(`/projects/${encode(repo.id)}`); }} destroyOnHidden afterOpenChange={open => { if (!open) (returnFocus.current?.isConnected ? returnFocus.current : newTicketLink.current)?.focus({ preventScroll: true }); }}>
        {creating ? <TicketEditor key={`new-${repo.id}`} repo={repo} api={api} execute={execute} busy={busy} onCreated={id => { void navigate(`/projects/${encode(repo.id)}/tickets/${encode(id)}`); }} onRun={setRunId} runs={[]} /> : ticket ? <TicketEditor key={`${repo.id}-${ticket.id}`} repo={repo} ticket={ticket} tickets={tickets} settings={snapshot.settings} api={api} execute={execute} busy={busy} runs={snapshot.runs.filter(value => value.repoId === repo.id && value.ticketId === ticket.id).sort((a, b) => b.started - a.started)} onCreated={() => undefined} onRun={setRunId} /> : ticketId ? <div className="empty-state"><h2>Ticket not found</h2><p>This ticket is not available in this project.</p><Link to={`/projects/${encode(repo.id)}`}>Return to board</Link></div> : null}
      </Modal>
      </>}
    </> : !selectedRun && <section className="panel empty-state"><h1>Page not found</h1><p>This project, run, or page is unavailable.</p><Link to="/">Return to projects</Link></section>}
    {selectedRun && <RunPanel key={selectedRun.id} run={selectedRun} ticket={snapshot.tickets.find(value => value.repoId === selectedRun.repoId && value.id === selectedRun.ticketId)} repo={snapshot.repos.find(value => value.id === selectedRun.repoId)} api={api} execute={execute} busy={busy} onClose={() => { void navigate(`/projects/${encode(selectedRun.repoId)}/tickets/${encode(selectedRun.ticketId)}`); }} />}
    {picking && <FolderPicker api={api} execute={execute} busy={busy} onClose={() => { void navigate('/'); }} onRegistered={id => { void navigate(`/projects/${encode(id)}`); }} />}
  </>;
}

function RunControls({ run, api, execute, busy }: { run: Run; api: RequestApi; execute: Execute; busy: boolean }) {
  const [modal, modalContext] = Modal.useModal();
  async function cancel() {
    if (!await modal.confirm({ title: `Cancel run ${run.ticketId}?`, autoFocusButton: 'cancel', okText: 'Cancel selected run', okButtonProps: { danger: true }, cancelText: 'Keep run', content: 'This stops only the selected run. Partial work remains in its project; completed actions are not rolled back. Other runs and new-start permissions are unchanged.' })) return;
    await execute('Cancellation requested for selected run. Partial work remains; no rollback.', async () => { await api(`/api/runs/${encode(run.id)}/control`, json('POST', { action: 'cancel' })); });
  }
  return <>{modalContext}{run.status === 'running' && <Button disabled={busy} onClick={() => void execute('Pause requested. Wait for the selected run to stop.', async () => { await api(`/api/runs/${encode(run.id)}/control`, json('POST', { action: 'pause' })); })}>Pause run</Button>}{run.status === 'paused' && <Button disabled={busy} onClick={() => void execute('Explicit run resume requested.', async () => { await api(`/api/runs/${encode(run.id)}/control`, json('POST', { action: 'resume' })); })}>Resume run</Button>}{['running', 'paused'].includes(run.status) && <Button danger disabled={busy} onClick={() => void cancel()}>Cancel run</Button>}</>;
}

interface EditorProps { repo: Repo; ticket?: Ticket; tickets?: Ticket[]; settings?: Settings; api: RequestApi; execute: Execute; busy: boolean; runs: Run[]; onCreated: (id: string) => void; onRun: (id: string) => void; assisted?: boolean }
type TicketPublication = { publicationId: string; workspaceId: string; reviewId: string; reviewVersion: number; proposalSetId: string | null; sourcePlanRevisionId: string | null; taskKey: string; dependencies: string[]; originalRevision: string | null };
const template = '---\nid: T001\ntitle: \ndepends_on: []\n---\n\n[What to change and where.]\n\n[Constraints or reference, if needed.]\n\nDone when:\n- [Observable result.]\n- [How to verify it.]\n';
function TicketEditor({ repo, ticket, tickets = [], settings, api, execute, busy, runs, onCreated, onRun, assisted = false }: EditorProps) {
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
  const [agentDirty, setAgentDirty] = useState(false);
  const [recoveryDirty, setRecoveryDirty] = useState(false);
  const [executionDirty, setExecutionDirty] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [publications, setPublications] = useState<TicketPublication[]>([]);
  const [publicationError, setPublicationError] = useState('');
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
  const actionsBusy = busy || uploading || stagedCount > 0 || executionDirty;
  const savedNavigation = useRef(false);
  const editorBusy = busy || agentBusy;
  const unsaved = (!assisted && dirty) || recoveryDirty || executionDirty || agentDirty || agentBusy || stagedCount > 0 || (!ticket && hasServerTicket);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && !savedNavigation.current && currentLocation.pathname !== nextLocation.pathname);
  const working = !!ticket && activeStatuses.includes(ticket.status);
  const path = ticket ? `/api/repos/${encode(ticket.repoId)}/tickets/${encode(ticket.id)}` : '';
  const attachmentBase = path ? `${path}/attachments/` : '';
  const currentRun = runs.find(run => run.id === ticket?.runId);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void api<TicketPublication[]>(`${path}/publications`).then(value => { if (!cancelled) setPublications(value); }).catch(cause => { if (!cancelled) setPublicationError(message(cause)); });
    return () => { cancelled = true; };
  }, [api, path]);

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
    if ((value === 'done' || value === 'changes') && lifecycleOwnsCompletion(currentRun)) return;
    if ((value === 'retry' || value === 'approve') && currentRun?.status === 'blocked') { document.querySelector<HTMLElement>('.blocked-recovery')?.scrollIntoView({ block: 'start' }); return; }
    if (value === 'retry' && ticket.status === 'interrupted' && !await modal.confirm({ title: 'Retry interrupted run?', content: 'Have you reviewed this interrupted run and its partial filesystem changes? Retrying starts a fresh session and may repeat actions.', okText: 'Retry reviewed run', cancelText: 'Cancel' })) return;
    if (value === 'done' && !await modal.confirm({ title: 'Mark this revision Done?', content: 'Confirm every acceptance criterion has revision-bound evidence and any visual or subjective requirements have been reviewed.', okText: 'Mark revision Done', cancelText: 'Keep in review' })) return;
    const feedback = value === 'changes' ? await requestReviewFeedback(modal, <p>{ticket.id}: describe the missing behavior or evidence.</p>) : undefined;
    if (feedback === null) return;
    await execute(value === 'done' ? 'Reviewed revision marked Done.' : `Ticket ${value} recorded.`, async () => { await api(`/api/tickets/${encode(ticket.repoId)}/${encode(ticket.id)}/action`, json('POST', { action: value, revision: ticket.revision, executionVersion: ticket.executionVersion ?? null, ...(order !== undefined ? { order } : {}), ...(feedback ? { feedback } : {}) })); });
  }


  const ticketForm = editing && <form onSubmit={event => void save(event)}>
      {!ticket && !assisted && <details className="import-options"><summary>Import existing Markdown</summary><label className="import-draft">Markdown file<input type="file" disabled={editorBusy} accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { setDraft(text); setConflict(''); }).catch(cause => setConflict(message(cause))); event.target.value = ''; }} /><small>Explicit import only. Existing BACKLOG.md is never rewritten. Use a unique frontmatter id/title, describe what to change, and add Done when: bullets with observable results and how to verify them.</small></label></details>}
      <div className="editor-tabs"><Segmented aria-label="Ticket view" options={[{ value: 'Markdown', label: <Tooltip title="Markdown"><span className="view-label"><CodeIcon size={16} aria-hidden="true" /><span className="visually-hidden">Markdown</span></span></Tooltip> }, { value: 'Preview', label: <Tooltip title="Preview"><span className="view-label"><EyeIcon size={16} aria-hidden="true" /><span className="visually-hidden">Preview</span></span></Tooltip> }]} value={preview ? 'Preview' : 'Markdown'} onChange={value => setPreview(value === 'Preview')} /><span className={dirty ? 'warning-text status-note' : 'muted status-note'}>{dirty ? <WarningCircleIcon size={16} aria-hidden="true" /> : <CheckCircleIcon size={16} aria-hidden="true" />}{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
      {preview ? <div className="ticket-preview"><Suspense fallback={<p role="status" aria-live="polite">Loading editable Preview… Your Markdown is preserved.</p>}><RichMarkdownEditor value={draft} onChange={setDraft} disabled={editorBusy} onUpload={uploadFiles} attachmentBase={attachmentBase} attachmentUrls={attachmentUrls} /></Suspense></div> : <MarkdownEditor label="Ticket Markdown" value={draft} onChange={setDraft} repoId={repo.id} api={api} disabled={editorBusy} onUpload={uploadFiles} />}
      <div className="attachment-paste-status" aria-live="polite">
        <p className="muted" role="status">{uploading ? `Uploading pasted attachments… ${stagedCount} remaining. Keep editing; your Markdown is not saved automatically.` : stagedCount ? `${stagedCount} pasted attachment${stagedCount === 1 ? '' : 's'} ${hasServerTicket ? 'waiting to upload' : 'staged in this tab until Create ticket'}.` : 'Paste images or supported files directly into Markdown or Preview to attach them.'}</p>
        {uploadError && <div className="error-banner" role="alert"><p>{uploadError}</p>{hasServerTicket && <Button icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} disabled={busy || uploading || stale} onClick={() => void flushUploads().catch(() => undefined)}>Retry uploads</Button>}</div>}
      </div>
      <div className="toolbar editor-actions"><Button icon={<FloppyDiskIcon size={16} aria-hidden="true" />} type="primary" htmlType="submit" className="primary" disabled={editorBusy || uploading || !!ticket?.removed || !draft}>{ticket ? 'Save revision' : hasServerTicket ? 'Finish creating ticket' : 'Create ticket'}</Button><Tooltip title="Every uploaded file needs a Markdown link or image with a descriptive purpose label or title before execution. Explain what screenshots demonstrate, including viewport and acceptable differences. Purpose quality remains part of human review."><Button type="text" aria-label="About attachment purpose labels" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip><small>Explicit save only. Edits never silently replace an active run's instructions.</small></div>
    </form>;
  return <div className={assisted ? 'panel editor-panel agent-creation-page' : 'panel editor-panel'}>
    {modalContext}
    <Modal title="Leave unsaved changes?" open={blocker.state === 'blocked'} okText="Leave page" cancelText="Keep editing" onOk={() => blocker.state === 'blocked' && blocker.proceed()} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>Unsaved editor changes and unsubmitted tab-local attachments will be lost. Saved conversations and accepted ticket-creation operations remain available; leaving does not cancel accepted work.</p></Modal>
    {assisted ? <h1 className="visually-hidden">Create with Agent</h1> : <div className="section-heading"><div>{ticket && <p className="ticket-reference">Revision {ticket.revision.slice(0, 10)}</p>}<h2>{ticket ? ticket.title : 'Describe the change'}</h2></div>{ticket && <Status value={ticket.status} />}</div>}
    {ticket?.removed && <p className="error-banner" role="alert">Ticket file is missing. Restore its file in the repository before taking action.</p>}
    {ticket?.error && <p className="error-banner" role="alert">{ticket.error}</p>}
    {ticket?.creationHold && <p className="notice" role="status">Created from chat; held from execution, including Automatic mode. Approve this revision to release the hold. Existing project permissions, pauses and dependency gates still apply.</p>}
    {stale && <div className="notice"><div><h3>Requirements changed{working ? ' during execution' : ' outside this editor'}.</h3><p>Your editor has not been overwritten. The current run keeps its immutable revision; changed requirements require new approval.</p></div></div>}
    {(stale || conflict) && <div className="conflict-box" role="alert"><p>{conflict || 'A newer ticket or attachment revision is available. Preserve your draft and reconcile before saving.'}</p><div className="toolbar"><Button icon={<CopyIcon size={16} aria-hidden="true" />} onClick={() => { void navigator.clipboard.writeText(draft).catch(() => setConflict('Clipboard unavailable. Select and copy the Markdown from the editor before loading the current version.')); }}>Copy my draft</Button><Button icon={<DownloadSimpleIcon size={16} aria-hidden="true" />} download={`${ticket?.id ?? 'ticket'}-draft.md`} href={`data:text/markdown;charset=utf-8,${encode(draft)}`}>Download draft</Button><Button icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} disabled={busy || uploading} onClick={() => void loadCurrentVersion()}>Load current version</Button></div></div>}
    {ticket && <div className="ticket-facts"><p><TreeStructureIcon size={16} aria-hidden="true" /><span>Dependencies</span>{ticket.dependencies.length ? ticket.dependencies.join(', ') : 'None'}</p><p><SealCheckIcon size={16} aria-hidden="true" /><span>Approval</span>{ticket.approvedRevision === ticket.revision ? 'Current revision approved' : 'Current revision not approved'}</p><p><ListChecksIcon size={16} aria-hidden="true" /><span>Acceptance criteria</span>{ticket.criteria.length}</p></div>}
    {ticket && <>
      <section className="ticket-actions" aria-label="Ticket actions"><div className="toolbar">
        <Button icon={<CheckCircleIcon size={16} aria-hidden="true" />} disabled={actionsBusy || ticket.removed || !!ticket.error || dirty || stale || working || currentRun?.status === 'blocked' || ticket.status === 'done' || ticket.approvedRevision === ticket.revision} onClick={() => void action('approve')}>Approve this revision</Button>
        {['blocked', 'failed', 'interrupted'].includes(ticket.status) && <Button icon={<ArrowCounterClockwiseIcon size={16} aria-hidden="true" />} disabled={actionsBusy || dirty || stale || ticket.removed || !!ticket.error} onClick={() => void action('retry')}>{ticket.status === 'blocked' ? 'Review recovery' : 'Review & retry'}</Button>}
        {ticket.status === 'needs_review' && !lifecycleOwnsCompletion(currentRun) && <><Button icon={<SealCheckIcon size={16} aria-hidden="true" />} type="primary" className="primary" disabled={actionsBusy || dirty || stale} onClick={() => void action('done')}>Accept evidence · Done</Button><Button icon={<ChatCircleDotsIcon size={16} aria-hidden="true" />} disabled={actionsBusy || dirty || stale} onClick={() => void action('changes')}>Request changes</Button></>}
        {tickets.length > 1 && <><Button icon={<ArrowUpIcon size={16} aria-hidden="true" />} disabled={actionsBusy || tickets[0]?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i - 1]?.order ?? ticket.order) - 0.5); }}>Move up</Button><Button icon={<ArrowDownIcon size={16} aria-hidden="true" />} disabled={actionsBusy || tickets.at(-1)?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i + 1]?.order ?? ticket.order) + 0.5); }}>Move down</Button></>}
      <Tooltip title="Approval is revision-bound, not a command to bypass dependencies or pauses. Dependencies wait for Done, not Needs review."><Button type="text" aria-label="About approval" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></div>{ticket.status === 'interrupted' && <p className="warning-text">Recovery required: inspect the previous transcript and partial changes before explicitly retrying. No mutating action is replayed automatically.</p>}{working && <p className="warning-text">To stop active work, open its run and pause it. Repository pause only prevents future starts.</p>}</section>
      {currentRun?.lifecycle && <p className={currentRun.lifecycle.phase === 'assistance' ? 'warning-text' : 'muted'}><Tag>{lifecycleLabels[currentRun.lifecycle.phase]}</Tag> {lifecycleOwnsCompletion(currentRun) ? 'The autonomous lifecycle owns completion; routine human Done is unavailable.' : currentRun.lifecycle.exception} <Button icon={<ArrowSquareOutIcon size={16} aria-hidden="true" />} type="link" onClick={() => onRun(currentRun.id)}>Review lifecycle evidence</Button></p>}
    </>}
    {ticket && currentRun?.status === 'blocked' && <BlockedRecovery key={ticket.runId} repo={repo} ticket={ticket} run={currentRun} api={api} execute={execute} disabled={actionsBusy || dirty || stale || ticket.removed || !!ticket.error} onDirtyChange={setRecoveryDirty} />}
    {ticket && <Tabs className="ticket-tabs" tabBarGutter={20} aria-label="Ticket sections" items={[
      { key: 'requirements', label: <span className="tab-label"><ListChecksIcon size={16} aria-hidden="true" />Requirements</span>, children: <>
    {ticket && <div className="requirements-heading"><h3><FileTextIcon size={16} aria-hidden="true" />Requirements</h3><Button icon={<PencilSimpleIcon size={16} aria-hidden="true" />} disabled={actionsBusy || (editing && unsaved)} onClick={() => setEditing(value => !value)}>{editing ? 'Reading view' : 'Edit Markdown'}</Button></div>}
    {!editing && <article className="ticket-reading" aria-label="Ticket requirements"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => url.startsWith('attachments/') ? `${attachmentBase}${url.slice('attachments/'.length)}` : defaultUrlTransform(url)} components={{ a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a> }}>{draft.replace(/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/, '')}</Markdown></article>}
{!assisted && ticketForm}
      </> },
      { key: 'execution', label: <span className="tab-label"><GaugeIcon size={16} aria-hidden="true" />Execution</span>, children: <>
{ticket && settings && <TicketExecution ticket={ticket} settings={settings} api={api} execute={execute} disabled={busy || uploading || stagedCount > 0 || dirty || stale || working || ticket.removed || !!ticket.error} onDirtyChange={setExecutionDirty} />}
      </> },
      { key: 'activity', label: <span className="tab-label"><ClockCounterClockwiseIcon size={16} aria-hidden="true" />Activity{runs.length ? ` (${runs.length})` : ''}</span>, children: <>
    {publicationError && <p className="warning-text" role="alert">Publication source could not be loaded: {publicationError}</p>}
      <section className="activity-section" aria-labelledby="history-heading"><h3 id="history-heading"><ClockCounterClockwiseIcon size={16} aria-hidden="true" />Run history</h3>{runs.length ? <ul className="run-list">{runs.map(run => <li key={run.id}><Button className="run-history-entry" onClick={() => onRun(run.id)}><span><Status value={run.status} /> <time dateTime={new Date(run.started).toISOString()}>{new Date(run.started).toLocaleString()}</time></span><small>Revision {run.revision.slice(0, 10)}{run.revision !== ticket.revision ? ' · Older requirements' : ' · Current requirements'} · {run.configuration?.engineeringMode === 'standard' ? 'Standard OMP' : 'OMP + pstack'}</small>{run.dialog && <Tag className="attention">Answer needed</Tag>}</Button></li>)}</ul> : <p className="muted">No runs yet. A session starts only when this revision is eligible and permitted.</p>}</section>
      <section className="activity-section" aria-labelledby="attachment-heading"><h3 id="attachment-heading"><PaperclipIcon size={16} aria-hidden="true" />Attachments<Tooltip title="Paste files into either editor to attach them. References are not executable instructions. Describe each file's purpose in the Markdown. Use synthetic examples, never credentials."><Button type="text" size="small" aria-label="About attachments" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></h3>{ticket.attachments.length ? <ul className="attachment-list">{ticket.attachments.map(file => <li key={file.name}><Button type="link" href={`${path}/attachments/${encode(file.name)}`} target="_blank" rel="noreferrer">{file.name}</Button><small>{(file.size / 1024).toFixed(1)} KB</small><Button icon={<EyeIcon size={16} aria-hidden="true" />} onClick={() => setAttachment(attachment === file.name ? '' : file.name)}>{attachment === file.name ? 'Close preview' : 'Preview'}</Button></li>)}</ul> : <p className="muted">No attachments. Paste files into the editor to add them.</p>}{attachment && ticket.attachments.some(file => file.name === attachment) && <AttachmentPreview key={`${attachment}-${ticket.revision}`} name={attachment} url={`${path}/attachments/${encode(attachment)}`} api={api} />}</section>
    {ticket && publications.map(source => <section className="activity-section" aria-labelledby={`publication-${source.publicationId}`} key={source.publicationId}><h3 id={`publication-${source.publicationId}`}><GitBranchIcon size={16} aria-hidden="true" />Published from workspace</h3><p><Link to={`/projects/${encode(repo.id)}/tickets/new/agent?workspace=${encode(source.workspaceId)}${source.sourcePlanRevisionId ? `&plan=${encode(source.sourcePlanRevisionId)}` : ''}`}><ArrowSquareOutIcon size={16} aria-hidden="true" /> Open source workspace</Link>{source.originalRevision && source.originalRevision !== ticket.revision && <span className="warning-text"> · Modified since publication</span>}</p><details className="run-technical-details"><summary>Identifiers</summary><dl className="publication-identifiers"><dt>Workspace</dt><dd>{source.workspaceId}</dd><dt>Plan revision</dt><dd>{source.sourcePlanRevisionId ?? 'No plan'}</dd><dt>Proposal set</dt><dd>{source.proposalSetId ?? 'Unavailable'}</dd><dt>Review</dt><dd>{source.reviewId} (version {source.reviewVersion})</dd><dt>Publication</dt><dd>{source.publicationId}</dd><dt>Task</dt><dd>{source.taskKey}</dd><dt>Published dependencies</dt><dd>{source.dependencies.join(', ') || 'None'}</dd><dt>Original revision</dt><dd>{source.originalRevision ?? 'Unavailable'}</dd><dt>Current revision</dt><dd>{ticket.revision}</dd></dl></details></section>)}
      </> },
    ]} />}
    {assisted && <AgentTicketDraft repoId={repo.id} api={api} files={draftFiles} onUpload={uploadFiles} onDirtyChange={setAgentDirty} onBusyChange={setAgentBusy} disabled={busy || uploading} onClearFiles={() => {
      for (const file of staged.current) if (file.objectUrl) URL.revokeObjectURL(file.objectUrl);
      staged.current = []; setDraftFiles([]); setStagedCount(0); setAttachmentUrls({}); setUploadError('');
    }} onBeforeWorkspaceChange={async () => {
      if (staged.current.length && !await modal.confirm({ title: 'Discard unsubmitted attachments?', content: 'Switching drops files staged in this tab. Submitted conversation attachments remain saved.', okText: 'Discard files and continue', cancelText: 'Keep this conversation', okButtonProps: { danger: true } })) return false;
      return true;
    }} />}
    {!ticket && !assisted && ticketForm}
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
  const [browseError, setBrowseError] = useState<{ path: string; cause: string }>();
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const browse = useCallback(async (path = '') => {
    const next = ++sequence.current;
    setLoading(true); setError(''); setBrowseError(undefined);
    try { const value = await api<FolderListing>(`/api/folders${path ? `?path=${encode(path)}` : ''}`); if (next === sequence.current) setListing(value); }
    catch (cause) { if (next === sequence.current) setBrowseError({ path, cause: message(cause) }); }
    finally { if (next === sequence.current) setLoading(false); }
  }, [api]);
  useEffect(() => {
    let cancelled = false;
    const initialSequence = sequence.current;
    void api<FolderListing>('/api/folders').then(value => {
      if (!cancelled && sequence.current === initialSequence) setListing(value);
    }).catch(cause => {
      if (!cancelled && sequence.current === initialSequence) setBrowseError({ path: '', cause: message(cause) });
    }).finally(() => {
      if (!cancelled && sequence.current === initialSequence) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api]);
  async function register() {
    if (!listing?.path || loading || browseError || busy) return;
    setError('');
    await execute('Repository registered paused.', async () => {
      try { const repo = await api<Repo>('/api/repos', json('POST', { path: listing.path })); onRegistered(repo.id); }
      catch (cause) { setError(message(cause)); throw cause; }
    });
  }
  return <Modal open className="folder-dialog" title={<span className="icon-heading"><FolderOpenIcon size={16} aria-hidden="true" />Choose a repository<Tooltip title="Only permitted roots are browsable. The backend resolves the real execution directory and detects its Git root."><Button type="text" size="small" aria-label="About folder browsing" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></span>} width={720} onCancel={onClose} mask={{ closable: false }} footer={<div className="dialog-actions"><Button icon={<XIcon size={16} aria-hidden="true" />} onClick={onClose}>Cancel</Button><Button type="primary" className="primary" icon={<FolderPlusIcon size={16} aria-hidden="true" />} disabled={busy || loading || !!browseError || !listing?.path} onClick={() => void register()}>Register directory</Button></div>}>
    <p className="muted">New projects start paused.</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {browseError && <div role="alert" className="error-banner"><p>Could not read {browseError.path || 'permitted roots'}: {browseError.cause}</p><Button icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} onClick={() => void browse(browseError.path)}>Retry</Button></div>}
    <div className="folder-bar"><Tooltip title="Permitted roots"><Button aria-label="Permitted roots" icon={<HouseLineIcon size={16} aria-hidden="true" />} disabled={loading} onClick={() => void browse()} /></Tooltip><Tooltip title="Parent folder"><Button aria-label="Parent folder" icon={<ArrowUpIcon size={16} aria-hidden="true" />} disabled={loading || !listing?.parent} onClick={() => void browse(listing?.parent ?? '')} /></Tooltip><p className="path folder-path" title={listing?.path}>{listing?.path || 'Permitted roots'}</p></div>
    {loading ? <p role="status">Reading directories…</p> : <ul className="folder-list">{listing?.directories.map(path => <li key={path}><Button onClick={() => void browse(path)}><span className="meta-item"><FolderSimpleIcon size={16} aria-hidden="true" />{path.split('/').filter(Boolean).at(-1) || path}</span><CaretRightIcon size={16} aria-hidden="true" /></Button></li>)}{listing?.directories.length === 0 && <li className="muted">No child folders.</li>}</ul>}
  </Modal>;
}

interface ExecutionModels {
  models: { provider: string; id: string; name: string }[];
  model: string;
  thinkingLevels: string[];
}

function SettingsPanel({ settings, api, execute, busy }: { settings: Settings; api: RequestApi; execute: Execute; busy: boolean }) {
  const [draft, setDraft] = useState(settings);
  const [base, setBase] = useState(settings);
  const finiteTokenBudget = useRef(settings.tokenBudget ?? 100000);
  const [modal, modalContext] = Modal.useModal();
  const [roots, setRoots] = useState(settings.roots.join('\n'));
  const [discovery, setDiscovery] = useState<(ExecutionModels & { executable: string; requestedModel: string })>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const initialSettings = useRef(settings);
  const discover = useCallback(async (executable: string, model: string, resetIncompatible = false) => {
    const next = ++sequence.current;
    setLoading(true); setError('');
    try {
      const result = await api<ExecutionModels>('/api/settings/models', json('POST', { executable, model }));
      if (next !== sequence.current) return;
      setDiscovery({ ...result, executable, requestedModel: model });
      if (resetIncompatible) setDraft(current => current.executable === executable && current.model === model && current.thinking && !result.thinkingLevels.includes(current.thinking) ? { ...current, thinking: '' } : current);
    } catch (cause) {
      if (next === sequence.current) setError(message(cause));
    } finally {
      if (next === sequence.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const requests = sequence;
    void discover(initialSettings.current.executable, initialSettings.current.model);
    return () => { ++requests.current; };
  }, [discover]);

  const catalogue = discovery?.executable === draft.executable ? discovery : undefined;
  const currentDiscovery = catalogue?.requestedModel === draft.model && !loading && !error ? catalogue : undefined;
  const modelOptions = [
    { value: '', label: 'OMP configured default' },
    ...(catalogue?.models ?? []).map(model => ({ value: `${model.provider}/${model.id}`, label: `${model.name} · ${model.provider}/${model.id}` })),
  ];
  if (draft.model && !modelOptions.some(option => option.value === draft.model)) modelOptions.push({ value: draft.model, label: `${draft.model} · ${currentDiscovery ? 'unavailable' : 'not verified'}` });
  const thinkingOptions = [
    { value: '', label: 'OMP default' },
    ...(currentDiscovery?.thinkingLevels ?? []).map(level => ({ value: level, label: level })),
  ];
  if (draft.thinking && !thinkingOptions.some(option => option.value === draft.thinking)) thinkingOptions.push({ value: draft.thinking, label: `${draft.thinking} · ${currentDiscovery ? 'unsupported' : 'not verified'}` });
  const executionChanged = draft.executable !== settings.executable || draft.model !== settings.model;
  const thinkingNeedsDiscovery = !!draft.thinking && !currentDiscovery?.thinkingLevels.includes(draft.thinking) && (executionChanged || draft.thinking !== (settings.thinking ?? ''));
  const editableKeys = ['engineeringMode', 'executable', 'model', 'thinking', 'roots', 'timeLimitMinutes', 'tokenBudget', 'maxConcurrentTickets'] as const;
  const stale = editableKeys.some(key => JSON.stringify(settings[key] ?? (key === 'engineeringMode' ? 'standard' : '')) !== JSON.stringify(base[key] ?? (key === 'engineeringMode' ? 'standard' : '')));
  const dirty = draft.executable !== base.executable || draft.model !== base.model || (draft.thinking ?? '') !== (base.thinking ?? '') || (draft.engineeringMode ?? 'standard') !== (base.engineeringMode ?? 'standard') || draft.timeLimitMinutes !== base.timeLimitMinutes || draft.tokenBudget !== base.tokenBudget || draft.maxConcurrentTickets !== base.maxConcurrentTickets || roots !== base.roots.join('\n');
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const timeInvalid = !Number.isInteger(draft.timeLimitMinutes) || draft.timeLimitMinutes < 1 || draft.timeLimitMinutes > 1440;
  const tokensInvalid = draft.tokenBudget !== null && (!Number.isInteger(draft.tokenBudget) || draft.tokenBudget < 1 || draft.tokenBudget > 10000000);
  const capacityInvalid = !Number.isInteger(draft.maxConcurrentTickets) || draft.maxConcurrentTickets < 1 || draft.maxConcurrentTickets > 4;

  function changeModel(model: string) {
    setDraft(current => ({ ...current, model }));
    void discover(draft.executable, model, true);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || stale || thinkingNeedsDiscovery || timeInvalid || tokensInvalid || capacityInvalid) return;
    if (draft.tokenBudget === null && settings.tokenBudget !== null && !await modal.confirm({ title: 'Remove the workspace cumulative token limit?', autoFocusButton: 'cancel', okText: 'Save uncapped default', cancelText: 'Keep editing', content: <p>New attempts inheriting workspace settings will have no cumulative token cap. Usage and cost may keep growing until the run finishes or another stop condition applies. Ticket-specific caps still override this default. Existing runs keep their recorded limits. Native auto-compaction, the time limit, pause controls and human acceptance remain.</p> })) return;
    await execute('Settings saved. Existing runs are not restarted.', async () => {
      const saved = await api<Settings>('/api/settings', json('PATCH', { engineeringMode: draft.engineeringMode ?? 'standard', executable: draft.executable, model: draft.model, thinking: draft.thinking ?? '', roots: roots.split('\n').map(value => value.trim()).filter(Boolean), timeLimitMinutes: draft.timeLimitMinutes, tokenBudget: draft.tokenBudget, maxConcurrentTickets: draft.maxConcurrentTickets }));
      setBase(saved); setDraft(saved); setRoots(saved.roots.join('\n'));
    });
  }
  return <section id="execution-settings" className="settings-view">
    {modalContext}
    {blocker.state === 'blocked' && <div className="notice" role="alert"><p>Leave execution settings and discard unsaved changes?</p><div className="toolbar"><Button onClick={() => blocker.reset()}>Keep editing settings</Button><Button danger onClick={() => blocker.proceed()}>Discard changes &amp; leave</Button></div></div>}
    <h2 className="icon-heading"><SlidersIcon size={16} aria-hidden="true" />Execution settings<Tooltip title="Defaults for new ticket runs. Existing sessions and your global OMP configuration stay unchanged."><Button type="text" size="small" aria-label="About execution settings" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></h2>
    <form className="panel settings-form" onSubmit={event => void save(event)}>
      <section className="settings-section" aria-labelledby="settings-agent-heading">
        <div className="settings-section-intro"><h3 id="settings-agent-heading"><RobotIcon size={16} aria-hidden="true" />OMP &amp; model<Tooltip title="Agent and reasoning defaults used across projects. Standard OMP uses native implementation without pstack; OMP + pstack requires its installed capabilities. Existing runs keep their mode and limits."><Button type="text" size="small" aria-label="About OMP and model settings" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></h3></div>
        <div className="settings-fields">
          <label htmlFor="settings-engineering-mode"><span>Engineering mode</span><Select suffixIcon={<GearSixIcon size={16} aria-hidden="true" />} id="settings-engineering-mode" aria-label="Global engineering mode" value={draft.engineeringMode ?? 'standard'} options={[{ value: 'standard', label: 'Standard OMP' }, { value: 'pstack', label: 'OMP + pstack' }]} disabled={busy} onChange={engineeringMode => { if (engineeringMode === 'standard' || engineeringMode === 'pstack') setDraft(current => ({ ...current, engineeringMode })); }} aria-describedby="settings-engineering-mode-help" /><small id="settings-engineering-mode-help">Used by new attempts unless a ticket overrides it.</small></label>
          <label htmlFor="settings-executable"><span>OMP executable</span><Input suffix={<TerminalWindowIcon size={16} aria-hidden="true" />} id="settings-executable" value={draft.executable} disabled={busy} onChange={event => {
            const executable = event.target.value;
            ++sequence.current;
            setLoading(false); setError('');
            setDraft(current => ({ ...current, executable }));
          }} required /><small>Command on PATH or absolute path.</small></label>
          <ModelPicker model={draft.model} thinking={draft.thinking ?? ''} modelOptions={modelOptions} thinkingOptions={thinkingOptions.map(option => ({ ...option, disabled: !!option.value && !currentDiscovery?.thinkingLevels.includes(option.value) }))} disabled={busy} loading={loading} modelLabel="Model" modelIcon={<CpuIcon size={16} aria-hidden="true" />} modelAriaLabel="Execution model" thinkingLabel="Thinking level" thinkingIcon={<BrainIcon size={16} aria-hidden="true" />} thinkingAriaLabel="Execution thinking level" modelHelp="Search by name or provider." thinkingHelp="Supported levels depend on the model." onModelChange={changeModel} onThinkingChange={thinking => setDraft(current => ({ ...current, thinking }))} />
          <div className="settings-discovery">
            <Button icon={<ArrowClockwiseIcon size={16} aria-hidden="true" />} htmlType="button" disabled={busy || loading || !draft.executable.trim()} onClick={() => void discover(draft.executable, draft.model, executionChanged)}>{error ? 'Retry model discovery' : 'Refresh models'}</Button>
            <span role="status">{loading ? 'Discovering models…' : currentDiscovery ? `${currentDiscovery.models.length} models available${currentDiscovery.model ? '' : '. Pick a model for thinking levels.'}` : 'Refresh to verify this executable.'}</span>
          </div>
          {error && <p role="alert" className="error-banner">Model discovery failed: {error}. Saved settings are unchanged.</p>}
          {thinkingNeedsDiscovery && <p role="alert" className="warning-text">Refresh models to validate this thinking level, or select OMP default.</p>}
          {currentDiscovery && draft.thinking && !currentDiscovery.thinkingLevels.includes(draft.thinking) && !thinkingNeedsDiscovery && <p className="warning-text">Saved thinking level is unsupported by this model. Choose another.</p>}
          <details className="settings-details"><summary>Model discovery &amp; defaults</summary><p>The catalogue uses a restricted profile; custom models and global configuration are not inherited. Credentials stay outside this website. Discovery does not start a ticket run.</p><p>Changing models resets incompatible thinking to OMP default. Explicit thinking applies only to new sessions, not resumed work.</p>{currentDiscovery?.model && <p>Discovery model: <code>{currentDiscovery.model}</code>. The configured execution default can differ.</p>}</details>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-limits-heading">
        <div className="settings-section-intro"><h3 id="settings-limits-heading"><GaugeIcon size={16} aria-hidden="true" />Run limits<Tooltip title="Global capacity and per-run guardrails, not spending limits. Exhaustion requires review and explicit retry. Paused and stopping runs keep their slots; lowering capacity does not stop existing runs. Pausing does not roll back changes."><Button type="text" size="small" aria-label="About run limits" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></h3></div>
        <div className="settings-fields">
          <label htmlFor="settings-concurrency"><span>Concurrent tickets</span><InputNumber suffix={<StackIcon size={16} aria-hidden="true" />} id="settings-concurrency" type="number" min={1} max={4} step={1} required disabled={busy} status={capacityInvalid ? 'error' : undefined} aria-invalid={capacityInvalid} aria-describedby="settings-concurrency-help" value={Number.isNaN(draft.maxConcurrentTickets) ? null : draft.maxConcurrentTickets} onChange={value => setDraft({ ...draft, maxConcurrentTickets: value ?? NaN })} /><small id="settings-concurrency-help" className={capacityInvalid ? 'warning-text' : undefined}>{capacityInvalid ? 'Enter a whole number from 1 to 4.' : '1–4 across projects; one per project.'}</small></label>
          <div className="form-columns">
            <label htmlFor="settings-time"><span>Time limit (minutes)</span><InputNumber suffix={<TimerIcon size={16} aria-hidden="true" />} id="settings-time" type="number" min={1} max={1440} step={1} required disabled={busy} status={timeInvalid ? 'error' : undefined} aria-invalid={timeInvalid} aria-describedby="settings-time-help" value={Number.isNaN(draft.timeLimitMinutes) ? null : draft.timeLimitMinutes} onChange={value => setDraft({ ...draft, timeLimitMinutes: value ?? NaN })} /><small id="settings-time-help" className={timeInvalid ? 'warning-text' : undefined}>{timeInvalid ? 'Enter a whole number from 1 to 1,440.' : '1–1,440 minutes per run.'}</small></label>
            <label htmlFor="settings-tokens"><span>Token budget</span><InputNumber<number> suffix={<CoinsIcon size={16} aria-hidden="true" />} id="settings-tokens" min={1} max={10000000} step={10000} required={draft.tokenBudget !== null} disabled={busy || draft.tokenBudget === null} placeholder={draft.tokenBudget === null ? 'No cumulative token limit' : undefined} status={tokensInvalid ? 'error' : undefined} aria-invalid={tokensInvalid} aria-describedby="settings-tokens-help" formatter={(value, info) => info.userTyping ? info.input : value === undefined || value === null || String(value) === '' ? '' : Number(value).toLocaleString('en-US')} value={Number.isNaN(draft.tokenBudget) ? null : draft.tokenBudget} onChange={value => setDraft({ ...draft, tokenBudget: value ?? NaN })} /><small id="settings-tokens-help" className={tokensInvalid ? 'warning-text' : undefined}>{tokensInvalid ? 'Enter a whole number from 1 to 10,000,000.' : draft.tokenBudget === null ? 'No cap for new attempts.' : 'Counts input, output and cache tokens.'}</small></label>
          </div>
          <Checkbox checked={draft.tokenBudget === null} disabled={busy} onChange={event => {
            if (event.target.checked && draft.tokenBudget !== null && !tokensInvalid) finiteTokenBudget.current = draft.tokenBudget;
            setDraft(current => ({ ...current, tokenBudget: event.target.checked ? null : finiteTokenBudget.current }));
          }}>No cumulative token limit</Checkbox>
          {draft.tokenBudget === null && <p className="warning-text">No token cap. Time limit and safety gates still apply.</p>}
          <p className="settings-safety">Limits stop work; they never restart it. Human review is still required before Done.</p>
          <details className="settings-details"><summary>Pause and restart controls</summary><p>Use Pause all new starts on Projects to prevent new sessions. Pause a selected run separately to interrupt its execution. Saving these settings does neither.</p></details>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-folders-heading">
        <div className="settings-section-intro"><h3 id="settings-folders-heading"><FolderOpenIcon size={16} aria-hidden="true" />Folder access<Tooltip title="Limits which project directories the folder picker can browse. Browsing cannot escape these roots, including through symlinks."><Button type="text" size="small" aria-label="About folder access" icon={<InfoIcon size={16} aria-hidden="true" />} /></Tooltip></h3></div>
        <div className="settings-fields"><label htmlFor="settings-roots"><span className="field-label"><FolderOpenIcon size={16} aria-hidden="true" />Permitted folder roots</span><Input.TextArea id="settings-roots" autoSize={{ minRows: 2, maxRows: 5 }} value={roots} disabled={busy} onChange={event => setRoots(event.target.value)} required spellCheck={false} aria-describedby="settings-roots-help" /><small id="settings-roots-help">One absolute directory per line.</small></label><p className="settings-safety">Not a sandbox: agents keep the OS user's permissions.</p></div>
      </section>
      {stale && <p className="error-banner" role="alert">Saved execution settings changed elsewhere. Your selections are preserved. Load saved settings before saving again.</p>}
      <div className="settings-actions">
        <span role="status" className={dirty ? 'settings-unsaved status-note' : 'muted status-note'}>{dirty ? <WarningCircleIcon size={16} aria-hidden="true" /> : <CheckCircleIcon size={16} aria-hidden="true" />}{busy ? 'Saving settings…' : dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
        <div className="toolbar"><Button icon={<ArrowCounterClockwiseIcon size={16} aria-hidden="true" />} htmlType="button" disabled={busy || !dirty && !stale} onClick={async () => {
          if (dirty && !await modal.confirm({ title: 'Replace unsaved execution settings?', okText: 'Load saved settings', cancelText: 'Keep editing' })) return;
          setBase(settings); setDraft(settings); setRoots(settings.roots.join('\n'));
          finiteTokenBudget.current = settings.tokenBudget ?? 100000;
          if (draft.executable !== settings.executable || draft.model !== settings.model) void discover(settings.executable, settings.model);
        }}>Load saved settings</Button><Button icon={<FloppyDiskIcon size={16} aria-hidden="true" />} type="primary" htmlType="submit" disabled={busy || !dirty || stale || thinkingNeedsDiscovery || timeInvalid || tokensInvalid || capacityInvalid}>Save settings</Button></div>
      </div>
    </form>
  </section>;
}

function RunPanel({ run, ticket, repo, api, execute, busy, onClose }: { run: Run; ticket?: Ticket; repo?: Repo; api: RequestApi; execute: Execute; busy: boolean; onClose: () => void }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => { section.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); section.current?.focus({ preventScroll: true }); }, [run.id]);
  const old = !!ticket && run.revision !== ticket.revision;
  const [view, setView] = useState('transcript');
  const unresolvedSummary = useRef<HTMLElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const firstUnresolved = run.verification?.find(receipt => receipt.outcome !== 'passed');
  useEffect(() => {
    if (view !== 'evidence' || !focusRequest || !unresolvedSummary.current) return;
    const frame = requestAnimationFrame(() => {
      const summary = unresolvedSummary.current;
      if (!summary) return;
      if (summary.parentElement instanceof HTMLDetailsElement) summary.parentElement.open = true;
      summary.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [view, focusRequest]);
  return <section ref={section} className="panel run-panel" tabIndex={-1} aria-labelledby="run-heading"><div className="section-heading"><div><p className="run-reference">{repo?.name ?? run.repoId} / {run.ticketId}</p><h1 id="run-heading">Run details</h1></div><Button onClick={onClose}>Close run</Button></div><div className="toolbar"><Status value={run.status} /><span className="muted">{new Date(run.started).toLocaleString()}</span><RunControls run={run} api={api} execute={execute} busy={busy} /></div>{run.status === 'stopping' && <p className="notice" role="status">Stopping... Waiting for the agent and its child work to actually stop. Completed actions are not rolled back.</p>}{old && <p className="warning-text">Requirements changed during or after this run. This evidence belongs to an older revision and cannot complete the current ticket.</p>}{run.error && <p role="alert" className="error-banner">{run.error}</p>}{run.blocker && <section className="blocker-box"><h3>Blocked · prerequisite needed</h3><p>{run.blocker}</p></section>}{run.dialog && <DialogForm key={run.dialog.id} dialog={run.dialog} runId={run.id} repoId={run.repoId} api={api} execute={execute} busy={busy} />}
    {run.reviewFeedback && <section className="detail-section"><h3>Human change request</h3><p>Linked to this run and revision; supplied to the next authorized attempt.</p><pre tabIndex={0}>{run.reviewFeedback.message}</pre></section>}
    {run.blocker && <p><Link to={`/projects/${encode(run.repoId)}/tickets/${encode(run.ticketId)}`}>Review blocker recovery instructions on ticket</Link></p>}
    {run.recoveryNote && <section className="detail-section"><h3>Recovery note</h3><p>{run.recoveryNote.reviewed ? 'Operator reviewed for retry' : 'Saved only · not approved for execution'} · revision {run.recoveryNote.revision.slice(0, 10)}</p><pre className="recovery-text" tabIndex={0}>{run.recoveryNote.instructions}</pre></section>}
    {run.recoveryContext && <section className="detail-section"><h3>Reviewed recovery handoff</h3><p>Received from <Link to={`/runs/${encode(run.recoveryContext.sourceRunId)}`}>blocked source run</Link>. Previous evidence is context, not fresh verification.</p><pre className="recovery-text" tabIndex={0}>{run.recoveryContext.note.instructions}</pre></section>}
      <span>Engineering Mode: {run.configuration?.engineeringMode === 'standard' ? 'Standard OMP' : 'OMP + pstack'}{!run.configuration?.engineeringMode && ' · legacy mode'}</span>
    <nav className="run-context-links" aria-label="Run context">
      {ticket && <Link to={`/projects/${encode(run.repoId)}/tickets/${encode(run.ticketId)}`}>{ticket.id} · {ticket.title}</Link>}
      <span className="muted">Revision {run.revision.slice(0, 10)}</span>
    </nav>
    <div className="run-summary-line">
      <span>{run.verification?.length ?? 0} checks reported · {run.evidence.length} evidence notes</span>
      {run.lifecycle && <><Tag className={run.lifecycle.phase === 'assistance' ? 'attention' : ''}>{lifecycleLabels[run.lifecycle.phase]}</Tag><Button type="link" onClick={() => setView('evidence')}>{run.lifecycle.verification.length} host checks · {run.lifecycle.reviews.length} independent reviews</Button></>}
      {firstUnresolved && <Button type="link" onClick={() => { setView('evidence'); setFocusRequest(value => value + 1); }}>Review unresolved checks</Button>}
      {run.status === 'needs_review' && !lifecycleOwnsCompletion(run) && <span className="warning-text">Awaiting human review · not accepted</span>}
    </div>
    {run.lifecycle?.phase === 'assistance' && <p className="error-banner" role="alert"><strong>Needs assistance.</strong> {run.lifecycle.exception || 'Autonomous completion stopped without establishing Done.'} <Button type="link" onClick={() => setView('evidence')}>Inspect lifecycle &amp; recovery evidence</Button></p>}
    <Tabs className="run-views" activeKey={view} onChange={setView} tabBarGutter={20} aria-label="Run sections" items={[
      { key: 'transcript', label: 'Transcript', forceRender: true, children: <RunTranscript key={run.id} run={run} /> },
      { key: 'evidence', label: `Evidence (${run.evidence.length + (run.verification?.length ?? 0) + (run.lifecycle?.verification.length ?? 0) + (run.lifecycle?.reviews.length ?? 0)})`, forceRender: true, children: <>
        <LifecycleProgress run={run} />
        <section className="detail-section"><h3>Acceptance evidence</h3><p className="muted">Agent claims, not independent verification. Review every criterion before accepting this revision.</p>
          {ticket && !old && ticket.criteria.length > 0 && <details className="run-record"><summary>Requirements · {ticket.criteria.length} criteria</summary><ol className="criteria-list">{ticket.criteria.map((criterion, i) => <li key={`${i}-${criterion}`}>{criterion}</li>)}</ol></details>}
          {run.evidence.length ? <div className="run-records">{run.evidence.map((item, i) => <details className="run-record" key={i}><summary><span className="run-record-index">{i + 1}.</span> {item.split('\n').find(line => line.trim()) || 'Recorded evidence'}</summary><pre tabIndex={0}>{item}</pre></details>)}</div> : <p className="muted">No verification evidence recorded.</p>}
        </section>
        <section className="detail-section"><h3>Verification receipts</h3><p className="muted">Outcomes, commands and recipe identities are agent-reported. Host records receipt time and artifact bytes/hash, not whether a check ran or its conclusion is correct.</p>
          {run.verification?.length ? <div className="run-records">{run.verification.map(receipt => <details className="run-record" key={receipt.id}><summary ref={receipt.id === firstUnresolved?.id ? unresolvedSummary : undefined}><Tag className={`run-outcome run-outcome-${receipt.outcome}`}>{receipt.outcome.replaceAll('_', ' ')}</Tag> {receipt.criterion}</summary><div className="run-record-body"><p>{receipt.feature} → {receipt.entryPoint}</p><pre tabIndex={0}>{receipt.method}{'\n'}{receipt.details}</pre><p>Recipe (reported): {receipt.recipe}</p><small>Run {receipt.runId} · revision {receipt.revision} · recorded {new Date(receipt.recorded).toLocaleString()}</small>{receipt.artifact && <p><a href={`/api/runs/${encode(run.id)}/proof/${encode(receipt.artifact.id)}`} download>{receipt.artifact.name}</a> · {receipt.artifact.size} bytes · SHA-256 <code>{receipt.artifact.sha256}</code></p>}</div></details>)}</div> : <p className="muted">No structured receipts. Legacy text evidence is unverified.</p>}
        </section>
      </> },
      { key: 'files', label: 'Files', children: <section className="detail-section"><h3>Changed files</h3><p className="muted">Recorded workspace changes, not an acceptance decision.</p><pre className="transcript" tabIndex={0}>{run.changedFiles || (repo?.git ? 'No changed-file summary recorded.' : 'Git change tracking unavailable for this workspace.')}</pre></section> },
      { key: 'runtime', label: 'Usage', children: <>
        <RunUsage run={run} />
        <details className="run-technical-details"><summary>Run identifiers &amp; timing</summary><dl className="run-metadata"><div><dt>Run</dt><dd>{run.id}</dd></div><div><dt>Revision</dt><dd>{run.revision}</dd></div><div><dt>OMP session</dt><dd>{run.sessionId || 'Not recorded yet'}</dd></div><div><dt>Finished</dt><dd>{run.finished ? new Date(run.finished).toLocaleString() : 'Not settled'}</dd></div></dl></details>
        {run.progress && <section className="detail-section" aria-label="Observed progress"><h3>Observed progress</h3><p>{run.progress.phase}</p><p>Latest tool/action: {run.progress.latestAction}</p><p>Run time limit: {new Date(run.progress.deadline).toLocaleString()}</p><p className="muted">Activity and token percentages are not percentage completion or proof of correctness. Criterion outcomes remain agent-reported.</p></section>}
      </> },
    ]} />
  </section>;
}

function DialogForm({ dialog, runId, repoId, api, execute, busy }: { dialog: Dialog; runId: string; repoId: string; api: RequestApi; execute: Execute; busy: boolean }) {
  const headingId = useId();
  const [value, setValue] = useState(typeof dialog.prefill === 'string' ? dialog.prefill : '');
  const method = dialog.method.replace(/^.*\./, '');
  const options = (dialog.options ?? []).filter((option): option is string => typeof option === 'string');
  async function answer(response: Record<string, unknown>) { await execute('Answer sent to this dialog.', async () => { await api(`/api/runs/${encode(runId)}/answer`, json('POST', { id: dialog.id, ...response })); }); }
  return <section className="agent-dialog" aria-labelledby={headingId}><h3 id={headingId}>{dialog.title || 'Agent response required'}</h3>{dialog.message && <pre className="dialog-message">{dialog.message}</pre>}{method === 'confirm' ? <div className="toolbar"><Button type="primary" className="primary" disabled={busy} onClick={() => void answer({ confirmed: true })}>Confirm / allow</Button><Button disabled={busy} onClick={() => void answer({ confirmed: false })}>Decline</Button></div> : ['select', 'input', 'editor'].includes(method) ? <form onSubmit={event => { event.preventDefault(); if (value) void answer({ value }); }}>{method === 'editor' ? <MarkdownEditor label="Your answer" value={value} onChange={setValue} repoId={repoId} api={api} disabled={busy} /> : <label>{method === 'select' ? 'Choose a response' : 'Your answer'}{method === 'select' ? <Select aria-label="Choose a response" placeholder="Select an option" value={value || undefined} onChange={setValue} disabled={busy} options={options.map(option => ({ value: option, label: option }))} /> : <Input.TextArea required value={value} onChange={event => setValue(event.target.value)} rows={3} disabled={busy} />}</label>}<Button type="primary" htmlType="submit" className="primary" disabled={busy || !value}>Send answer</Button></form> : <p className="warning-text">Unsupported interactive request ({dialog.method}). It cannot be silently approved. Cancel this request and review the run.</p>}<Button className="quiet" disabled={busy} onClick={() => void answer({ cancelled: true })}>Cancel request · do not approve</Button><p className="muted">Responses are bound to this dialog. Approval is never assumed if you disconnect.</p></section>;
}
