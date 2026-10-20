import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, InputNumber, Modal, Segmented, Select, Tag } from 'antd';
import { Link, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import type { Dialog, Mode, Repo, Run, Settings, Snapshot, Ticket } from '../server/contracts';
import MarkdownPreview from './MarkdownPreview';
import MarkdownEditor from './MarkdownEditor';

export type RequestApi = <T>(path: string, init?: RequestInit) => Promise<T>;
type Execute = (name: string, work: () => Promise<void>) => Promise<boolean>;
interface Props { snapshot: Snapshot; api: RequestApi; refresh: () => Promise<void>; onError: (message: string) => void }
const encode = encodeURIComponent;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const activeStatuses = ['running', 'stopping', 'paused'];
const modes: Record<Mode, string> = { paused: 'Paused', approved: 'Approved tickets only', automatic: 'Automatic' };

function Status({ value }: { value: string }) { return <Tag className={`badge status-${value}`}>{value.replaceAll('_', ' ')}</Tag>; }

export default function Workspace({ snapshot, api, refresh, onError }: Props) {
  const { repoId, ticketId, runId } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const home = pathname === '/';
  const settingsView = pathname === '/settings';
  const picking = pathname === '/projects/new';
  const creating = !!repoId && pathname.endsWith('/tickets/new');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const repo = snapshot.repos.find(value => value.id === repoId);
  const tickets = snapshot.tickets.filter(value => value.repoId === repo?.id).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ticket = tickets.find(value => value.id === ticketId);
  const selectedRun = snapshot.runs.find(value => value.id === runId);
  const activeRun = snapshot.runs.find(value => activeStatuses.includes(value.status));
  const busy = !!pending;

  const execute: Execute = async (name, work) => {
    setPending(name); setNotice(''); onError('');
    try { await work(); await refresh(); setNotice(name); return true; }
    catch (cause) { onError(message(cause)); return false; }
    finally { setPending(''); }
  };

  function selectRepo(id: string) { void navigate(`/projects/${encode(id)}`); }
  function setRunId(id: string) { void navigate(`/runs/${encode(id)}`); }

  async function changeMode(mode: Mode) {
    if (!repo || mode === repo.mode) return;
    if (mode === 'automatic' && !await modal.confirm({ title: 'Enable automatic execution?', content: 'New valid tickets and eligible requirement or attachment revisions may run without individual approval. OMP can execute commands with your filesystem permissions. Nothing is sandboxed; completed tickets still require revision review.', okText: 'Enable automatic execution', cancelText: 'Keep current permission' })) return;
    await execute('Repository permission saved.', async () => { await api(`/api/repos/${encode(repo.id)}`, json('PATCH', { mode })); });
  }

  return <>
    {modalContext}
    <div className="execution-strip">
      <div><span className="small-label">Scheduler</span><strong>{snapshot.settings.paused ? 'All new starts paused' : 'Following repository permissions'}</strong><small>One active ticket globally. Pausing new starts lets the current run continue.</small></div>
      <Button disabled={busy} onClick={() => void execute(snapshot.settings.paused ? 'New starts enabled.' : 'All new starts paused. Current run continues.', async () => { await api('/api/settings', json('PATCH', { paused: !snapshot.settings.paused })); })}>{snapshot.settings.paused ? 'Allow new starts' : 'Pause all new starts'}</Button>
    </div>
    {activeRun && <section className="active-run" aria-label="Current run"><div><Status value={activeRun.status} /><strong>{snapshot.repos.find(value => value.id === activeRun.repoId)?.name} / {activeRun.ticketId}</strong>{activeRun.dialog && <Tag className="attention">Answer needed</Tag>}</div><div className="toolbar"><Button onClick={() => setRunId(activeRun.id)}>Open current run</Button>{activeRun.status === 'running' && <Button disabled={busy} onClick={() => void execute('Pause requested. Wait for the run to stop.', async () => { await api(`/api/runs/${encode(activeRun.id)}/control`, json('POST', { action: 'pause' })); })}>Pause current run</Button>}{activeRun.status === 'paused' && <Button disabled={busy} onClick={() => void execute('Run resume requested.', async () => { await api(`/api/runs/${encode(activeRun.id)}/control`, json('POST', { action: 'resume' })); })}>Resume current run</Button>}</div></section>}
    {activeRun?.dialog && runId !== activeRun.id && <DialogForm key={activeRun.dialog.id} dialog={activeRun.dialog} runId={activeRun.id} repoId={activeRun.repoId} api={api} execute={execute} busy={busy} />}
    <p className="operation-status" role="status" aria-live="polite">{pending ? 'Working...' : notice}</p>
    {home || picking ? <section className="home-view" aria-labelledby="home-heading">
      <div className="section-heading"><div><h1 id="home-heading">Home</h1><p className="muted">Choose a project to manage tickets and review runs.</p></div><Link className="home-action" to="/projects/new">Add project +</Link></div>
      <div className="panel project-selector"><label>Project<Select aria-label="Project" placeholder="Select a project" value={undefined} onChange={selectRepo} options={snapshot.repos.map(value => ({ value: value.id, label: `${value.name} / ${modes[value.mode]}` }))} notFoundContent="No projects registered" /></label>
        {!snapshot.repos.length && <p className="muted">No projects yet. Add a local folder to get started. New projects start paused.</p>}
      </div>
      <nav className="home-navigation" aria-label="Home navigation"><Link to="/settings">Settings</Link><Link to="/plan">Implementation plan</Link></nav>
      <p className="muted">Permission before execution. Local folders are not sandboxes. Closing this tab or logging out does not stop work.</p>
    </section> : settingsView ? <SettingsPanel key="settings" settings={snapshot.settings} api={api} execute={execute} busy={busy} /> : repo ? <>
      <div className="section-heading workspace-heading"><h1>{repo.name}</h1><Link to="/">Choose project</Link></div>
        {repo && <section className="panel repo-summary" aria-label="Repository execution permission"><div><h2>{repo.name}</h2><code className="path">{repo.path}</code>{!repo.git && <p className="warning-text">Non-Git workspace. Git changed-file tracking is unavailable.</p>}</div><label>Execution permission<Select aria-label="Execution permission" disabled={busy} value={repo.mode} onChange={value => void changeMode(value)} options={Object.entries(modes).map(([value, label]) => ({ value: value as Mode, label }))} /><small>{repo.mode === 'paused' ? 'No new starts. A current run continues.' : repo.mode === 'approved' ? 'Only explicitly approved revisions may start.' : 'Standing permission: eligible revisions may run automatically.'}</small></label></section>}
        <div className="backlog-layout">
          <section className="ticket-queue" aria-labelledby="queue-heading"><div className="section-heading"><h2 id="queue-heading">Backlog</h2><Link to={`/projects/${encode(repo.id)}/tickets/new`}>New ticket +</Link></div>{tickets.length === 0 && <div className="empty-state"><p>No tickets yet.</p><small>Create a Markdown ticket, or add one under .omp-backlog/tickets/ in this repository.</small></div>}<ol className="ticket-list">{tickets.map((value, index) => <li key={value.id}><Link className={`ticket-card ${ticket?.id === value.id ? 'selected' : ''}`} aria-current={ticket?.id === value.id ? 'page' : undefined} to={`/projects/${encode(repo.id)}/tickets/${encode(value.id)}`}><span className="ticket-meta"><span>{String(index + 1).padStart(2, '0')} · {value.id}</span><Status value={value.status} /></span><strong>{value.title || value.id}</strong><small>{value.removed ? 'Ticket file removed' : value.dependencies.length ? `Depends on ${value.dependencies.join(', ')}` : 'No dependencies'}</small>{value.error && <span className="ticket-error">{value.error}</span>}{value.approvedRevision === value.revision && <span className="permission-note">This revision approved</span>}</Link></li>)}</ol></section>
          <section className="ticket-detail" aria-label="Ticket details">{creating ? <TicketEditor key={`new-${repo.id}`} repo={repo} api={api} execute={execute} busy={busy} onCreated={id => { void navigate(`/projects/${encode(repo.id)}/tickets/${encode(id)}`); }} onRun={setRunId} runs={[]} /> : ticket ? <TicketEditor key={`${repo.id}-${ticket.id}`} repo={repo} ticket={ticket} tickets={tickets} api={api} execute={execute} busy={busy} runs={snapshot.runs.filter(value => value.repoId === repo.id && value.ticketId === ticket.id).sort((a, b) => b.started - a.started)} onCreated={() => undefined} onRun={setRunId} /> : <div className="empty-state detail-empty"><h2>{ticketId ? 'Ticket not found' : 'No ticket selected'}</h2><p>{ticketId ? 'This ticket is not available in this project.' : 'Select a ticket to review requirements, attachments, permissions, and run evidence.'}</p></div>}</section>
        </div>
    </> : !selectedRun && <section className="panel empty-state"><h1>Page not found</h1><p>This project, run, or page is unavailable.</p><Link to="/">Return Home</Link></section>}
    {selectedRun && <RunPanel run={selectedRun} ticket={snapshot.tickets.find(value => value.repoId === selectedRun.repoId && value.id === selectedRun.ticketId)} repo={snapshot.repos.find(value => value.id === selectedRun.repoId)} api={api} execute={execute} busy={busy} onClose={() => { void navigate(`/projects/${encode(selectedRun.repoId)}/tickets/${encode(selectedRun.ticketId)}`); }} />}
    {picking && <FolderPicker api={api} execute={execute} busy={busy} onClose={() => { void navigate('/'); }} onRegistered={selectRepo} />}
  </>;
}

interface EditorProps { repo: Repo; ticket?: Ticket; tickets?: Ticket[]; api: RequestApi; execute: Execute; busy: boolean; runs: Run[]; onCreated: (id: string) => void; onRun: (id: string) => void }
const template = '---\nid: T001\ntitle: \ndepends_on: []\n---\n\n# Goal\n\n\n# Requirements\n- \n\n# Acceptance criteria\n- \n\n# Out of scope\n- \n\n# Verification\n- \n\n# Attachments\n';
function TicketEditor({ repo, ticket, tickets = [], api, execute, busy, runs, onCreated, onRun }: EditorProps) {
  const [draft, setDraft] = useState(ticket?.markdown ?? template);
  const [base, setBase] = useState({ markdown: ticket?.markdown ?? template, revision: ticket?.revision ?? '' });
  const [preview, setPreview] = useState(false);
  const [conflict, setConflict] = useState('');
  const [attachment, setAttachment] = useState('');
  const [modal, modalContext] = Modal.useModal();
  const stale = !!ticket && ticket.revision !== base.revision;
  const dirty = draft !== base.markdown;
  const savedNavigation = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !savedNavigation.current && currentLocation.pathname !== nextLocation.pathname);
  const working = !!ticket && activeStatuses.includes(ticket.status);
  const path = ticket ? `/api/repos/${encode(ticket.repoId)}/tickets/${encode(ticket.id)}` : '';
  const source = draft.replace(/(\]\()(?:\.\/)?attachments\//g, `$1${path}/attachments/`);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    await execute(ticket ? 'Ticket saved. Revision permissions refreshed.' : 'Ticket created. Repository permission still applies.', async () => {
      try {
        const saved = await api<Ticket>(ticket ? path : `/api/repos/${encode(repo.id)}/tickets`, json(ticket ? 'PUT' : 'POST', ticket ? { markdown: draft, revision: base.revision } : { markdown: draft }));
        setBase({ markdown: saved.markdown, revision: saved.revision }); setDraft(saved.markdown); setConflict('');
        if (!ticket) { savedNavigation.current = true; onCreated(saved.id); }
      } catch (cause) {
        if (typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 409) setConflict('This save conflicted with a newer revision. Your draft is preserved below. Copy it before loading the current file, then reconcile the changes.');
        throw cause;
      }
    });
  }

  async function action(value: 'approve' | 'retry' | 'done' | 'changes' | 'reorder', order?: number) {
    if (!ticket) return;
    if (value === 'retry' && ticket.status === 'interrupted' && !await modal.confirm({ title: 'Retry interrupted run?', content: 'Have you reviewed this interrupted run and its partial filesystem changes? Retrying starts a fresh session and may repeat actions.', okText: 'Retry reviewed run', cancelText: 'Cancel' })) return;
    if (value === 'done' && !await modal.confirm({ title: 'Mark this revision Done?', content: 'Confirm every acceptance criterion has revision-bound evidence and any visual or subjective requirements have been reviewed.', okText: 'Mark revision Done', cancelText: 'Keep in review' })) return;
    await execute(value === 'done' ? 'Reviewed revision marked Done.' : `Ticket ${value} recorded.`, async () => { await api(`/api/tickets/${encode(ticket.repoId)}/${encode(ticket.id)}/action`, json('POST', { action: value, revision: ticket.revision, ...(order !== undefined ? { order } : {}) })); });
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set('revision', ticket.revision);
    await execute('Attachment uploaded. Reference its purpose in the ticket before approving this revision.', async () => {
      const saved = await api<Ticket>(`${path}/attachments`, { method: 'POST', body: data });
      if (!dirty && !stale) { setBase({ markdown: saved.markdown, revision: saved.revision }); setDraft(saved.markdown); }
      form.reset();
    });
  }

  return <div className="panel editor-panel">
    {modalContext}
    <Modal title="Leave unsaved changes?" open={blocker.state === 'blocked'} okText="Discard changes" cancelText="Keep editing" onOk={() => blocker.state === 'blocked' && blocker.proceed()} onCancel={() => blocker.state === 'blocked' && blocker.reset()}><p>Your unsaved ticket changes will be discarded.</p></Modal>
    <div className="section-heading"><div>{ticket && <p className="ticket-reference">{ticket.id} · {ticket.revision.slice(0, 10)}</p>}<h2>{ticket ? ticket.title : 'New ticket'}</h2></div>{ticket && <Status value={ticket.status} />}</div>
    {ticket?.removed && <p className="error-banner" role="alert">Ticket file is missing. Restore its file in the repository before taking action.</p>}
    {ticket?.error && <p className="error-banner" role="alert">{ticket.error}</p>}
    {stale && <div className="notice"><div><h3>Requirements changed{working ? ' during execution' : ' outside this editor'}.</h3><p>Your editor has not been overwritten. The current run keeps its immutable revision; changed requirements require new approval.</p></div></div>}
    {(stale || conflict) && <div className="conflict-box" role="alert"><p>{conflict || 'A newer ticket or attachment revision is available. Preserve your draft and reconcile before saving.'}</p><div className="toolbar"><Button onClick={() => { void navigator.clipboard.writeText(draft).catch(() => setConflict('Clipboard unavailable. Select and copy the Markdown from the editor before loading the current version.')); }}>Copy my draft</Button><Button download={`${ticket?.id ?? 'ticket'}-draft.md`} href={`data:text/markdown;charset=utf-8,${encode(draft)}`}>Download draft</Button><Button onClick={async () => { if (!ticket || (dirty && !await modal.confirm({ title: 'Replace unsaved draft?', content: 'Replace your unsaved editor contents with the current file? Copy or download your draft first.', okText: 'Load current version', cancelText: 'Keep draft', okButtonProps: { danger: true } }))) return; setDraft(ticket.markdown); setBase({ markdown: ticket.markdown, revision: ticket.revision }); setConflict(''); }}>Load current version</Button></div></div>}
    {ticket && <div className="ticket-facts"><p><span>Dependencies</span>{ticket.dependencies.length ? ticket.dependencies.join(', ') : 'None'}</p><p><span>Approval</span>{ticket.approvedRevision === ticket.revision ? 'Current revision approved' : 'Current revision not approved'}</p><p><span>Acceptance criteria</span>{ticket.criteria.length}</p></div>}
    <form onSubmit={event => void save(event)}>
      {!ticket && <label className="import-draft">Import Markdown into this draft<input type="file" disabled={busy} accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(text => { setDraft(text); setConflict(''); }).catch(cause => setConflict(message(cause))); event.target.value = ''; }} /><small>Explicit import only. Existing BACKLOG.md is never rewritten. Adapt the content to one ticket with a unique frontmatter id/title, Goal, Requirements, Acceptance criteria, and Verification before creating it.</small></label>}
      <div className="editor-tabs"><Segmented aria-label="Ticket view" options={['Markdown', 'Preview']} value={preview ? 'Preview' : 'Markdown'} onChange={value => setPreview(value === 'Preview')} /><span className="muted">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span></div>
      {preview ? <div className="ticket-preview"><MarkdownPreview source={source} /></div> : <MarkdownEditor label="Ticket Markdown" value={draft} onChange={setDraft} repoId={repo.id} api={api} disabled={busy} />}
      <div className="toolbar editor-actions"><Button type="primary" htmlType="submit" className="primary" disabled={busy || !!ticket?.removed || !draft}>{ticket ? 'Save revision' : 'Create ticket'}</Button><small>Explicit save only. Edits never silently replace an active run's instructions.</small></div>
    </form>
    {ticket && <>
      <section className="detail-section" aria-label="Ticket actions"><h3>Permission & review</h3><div className="toolbar"><Button disabled={busy || ticket.removed || !!ticket.error || dirty || stale || working || ticket.status === 'done' || ticket.approvedRevision === ticket.revision} onClick={() => void action('approve')}>Approve this revision</Button>{['blocked', 'failed', 'interrupted'].includes(ticket.status) && <Button disabled={busy || dirty || stale || ticket.removed || !!ticket.error} onClick={() => void action('retry')}>Review & retry</Button>}{ticket.status === 'needs_review' && <><Button type="primary" className="primary" disabled={busy || dirty || stale} onClick={() => void action('done')}>Accept evidence · Done</Button><Button disabled={busy || dirty || stale} onClick={() => void action('changes')}>Request changes</Button></>}{tickets.length > 1 && <><Button disabled={busy || tickets[0]?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i - 1]?.order ?? ticket.order) - 0.5); }}>Move up</Button><Button disabled={busy || tickets.at(-1)?.id === ticket.id || working} onClick={() => { const i = tickets.findIndex(value => value.id === ticket.id); void action('reorder', (tickets[i + 1]?.order ?? ticket.order) + 0.5); }}>Move down</Button></>}</div><p className="muted">Approval is revision-bound, not a command to bypass dependencies or pauses. Dependencies wait for Done, not Needs review.</p>{ticket.status === 'interrupted' && <p className="warning-text">Recovery required: inspect the previous transcript and partial changes before explicitly retrying. No mutating action is replayed automatically.</p>}{working && <p className="warning-text">To stop active work, open its run and pause it. Repository pause only prevents future starts.</p>}</section>
      <section className="detail-section" aria-labelledby="attachment-heading"><h3 id="attachment-heading">Attachments</h3><p className="muted">References are not executable instructions. Describe each file's purpose in the Markdown. Use synthetic examples, never credentials.</p>{ticket.attachments.length ? <ul className="attachment-list">{ticket.attachments.map(file => <li key={file.name}><Button type="link" href={`${path}/attachments/${encode(file.name)}`} target="_blank" rel="noreferrer">{file.name}</Button><small>{(file.size / 1024).toFixed(1)} KB</small><Button onClick={() => setAttachment(attachment === file.name ? '' : file.name)}>{attachment === file.name ? 'Close preview' : 'Preview'}</Button></li>)}</ul> : <p className="muted">No attachments.</p>}{attachment && ticket.attachments.some(file => file.name === attachment) && <AttachmentPreview key={`${attachment}-${ticket.revision}`} name={attachment} url={`${path}/attachments/${encode(attachment)}`} api={api} />}<form className="upload-form" onSubmit={event => void upload(event)}><label>Attach reference file<input type="file" name="file" accept=".png,.jpg,.jpeg,.gif,.webp,.json,.txt,.md,.csv,.pdf,.doc,.docx,.xls,.xlsx,.odt" required disabled={busy || stale || dirty || ticket.removed} /></label><Button htmlType="submit" disabled={busy || stale || dirty || ticket.removed}>Upload attachment</Button></form>{(dirty || stale) && <p className="muted">Save or reconcile the editor before uploading attachments.</p>}</section>
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
    <section className="detail-section"><h3>Acceptance evidence</h3><p className="muted">An agent's success claim is not independent verification. Review evidence against every criterion before accepting this revision.</p>{ticket && !old && ticket.criteria.length > 0 && <ol className="criteria-list">{ticket.criteria.map((criterion, i) => <li key={`${i}-${criterion}`}>{criterion}</li>)}</ol>}{run.evidence.length ? <ol className="evidence-list">{run.evidence.map((item, i) => <li key={i}><pre tabIndex={0}>{item}</pre></li>)}</ol> : <p className="muted">No verification evidence recorded.</p>}</section>
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
