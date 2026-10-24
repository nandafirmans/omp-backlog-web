import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Button, Checkbox, Dropdown, Input, Modal, Popover, Segmented, Tag } from 'antd';
import { ColumnsIcon, DotsSixVerticalIcon, DotsThreeIcon, FolderIcon, ListBulletsIcon, MagnifyingGlassIcon, SlidersHorizontalIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import type { Repo, Snapshot, Ticket } from '../server/contracts';
import type { RequestApi } from './Workspace';
import { boardGroups, canMoveTicket, groupFor, insertionOrder, sameBoardRevision, transitionFor } from './ticketBoard';
import './TicketBoard.css';
import { requestReviewFeedback } from './reviewFeedback';

interface Props {
  repo: Repo;
  tickets: Ticket[];
  snapshot: Snapshot;
  selectedId?: string;
  busy: boolean;
  api: RequestApi;
  execute: (notice: string, work: () => Promise<void>) => Promise<boolean>;
  onOpen: (element: HTMLAnchorElement) => void;
}

const statuses = boardGroups.flatMap(group => group.statuses);
const label = (status: string) => status.replaceAll('_', ' ');
const encode = encodeURIComponent;
type DropTarget = { group: string; before?: string };

export default function TicketBoard({ repo, tickets, snapshot, selectedId, busy, api, execute, onOpen }: Props) {
  const [modal, modalContext] = Modal.useModal();
  const [layout, setLayout] = useState(() => localStorage.getItem('omp-ticket-layout') === 'list' ? 'list' : 'board');
  const [showEmpty, setShowEmpty] = useState(() => localStorage.getItem('omp-ticket-empty') === 'true');
  const [hidden, setHidden] = useState(() => (localStorage.getItem('omp-ticket-hidden') ?? '').split(',').filter(value => statuses.includes(value as Ticket['status'])));
  const [search, setSearch] = useState('');
  const [attentionFilter, setAttentionFilter] = useState<Ticket['status'] | null>(null);
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const latest = useRef({ tickets, snapshot });
  const locked = useRef(false);
  const dragSource = useRef<Ticket | null>(null);
  const controls = useRef(new Map<string, HTMLElement>());
  useEffect(() => { latest.current = { tickets, snapshot }; }, [tickets, snapshot]);
  useEffect(() => {
    localStorage.setItem('omp-ticket-layout', layout);
    localStorage.setItem('omp-ticket-empty', String(showEmpty));
    localStorage.setItem('omp-ticket-hidden', hidden.join(','));
  }, [layout, showEmpty, hidden]);

  const disabled = busy || confirming;
  const matching = tickets.filter(ticket => `${ticket.id} ${ticket.title}`.toLowerCase().includes(search.trim().toLowerCase()));
  const columns = boardGroups.map(group => ({ ...group, tickets: matching.filter(ticket => group.statuses.includes(ticket.status) && !hidden.includes(ticket.status)) }));
  const visibleColumns = matching.length === 0 && search.trim() ? [] : columns.filter(group => group.statuses.some(status => !hidden.includes(status)) && (showEmpty || group.tickets.length > 0 || !!dragging && !!transitionFor(dragging, group.id)));
  const hiddenCount = matching.filter(ticket => hidden.includes(ticket.status)).length;
  const emptyCount = columns.filter(group => group.tickets.length === 0 && group.statuses.some(status => !hidden.includes(status))).length;
  const activeRun = snapshot.runs.find(run => ['running', 'stopping', 'paused'].includes(run.status));

  function focusCard(id: string) {
    requestAnimationFrame(() => {
      const control = controls.current.get(id);
      if (control) control.focus({ preventScroll: true });
      else document.getElementById('ticket-board-region')?.focus({ preventScroll: true });
    });
  }

  async function move(source: Ticket, destination: string, before?: string) {
    if (disabled || locked.current) return;
    const current = latest.current.tickets.find(ticket => ticket.id === source.id);
    if (!sameBoardRevision(current, source) || !current || !canMoveTicket(current)) {
      setAnnouncement('Ticket changed or is unavailable. Review its current state before moving it.');
      focusCard(source.id);
      return;
    }
    const sameGroup = groupFor(current.status).id === destination;
    const action = sameGroup ? 'reorder' : transitionFor(current, destination);
    if (!action) return;
    const order = sameGroup ? insertionOrder(latest.current.tickets, current, destination, before) : null;
    if (sameGroup && order === null) {
      setAnnouncement('Position unchanged. No queue changes saved.');
      focusCard(source.id);
      return;
    }
    locked.current = true;
    setConfirming(action !== 'reorder');
    setAnnouncement('');
    try {
      let feedback: string | null = null;
      if (action !== 'reorder') {
        const run = latest.current.snapshot.runs.find(run => run.id === current.runId && run.revision === current.revision);
        if (((action === 'done' || action === 'changes') && !run) || (action === 'done' && !run?.evidence.length)) {
          setAnnouncement('Current-revision run evidence is unavailable. Open the ticket to review it.');
          return;
        }
        const titles = { approve: 'Approve this revision for execution?', retry: 'Retry this ticket?', changes: 'Request changes and queue another run?', done: 'Accept evidence and mark Done?' };
        const consequences = {
          approve: 'Approves this exact revision. Execution may start when repository permissions, dependencies, and the global execution slot allow.',
          retry: current.status === 'interrupted' ? 'Review the previous transcript and partial filesystem changes first. Retrying starts a fresh session and may repeat actions. Partial changes are not rolled back.' : 'Resolve the blocker or inspect the failure first. Retrying approves this revision and may start another run; completed side effects are not rolled back.',
          changes: 'Requests another run for this revision. Execution may start when permissions, dependencies, and the execution slot allow.',
          done: 'Confirm every acceptance criterion has current-revision evidence and any visual or subjective requirements have been reviewed. Dependent tickets may become eligible to run.',
        };
        const confirmed = action === 'changes' ? !!(feedback = await requestReviewFeedback(modal, <p>{current.id} · {current.title}. {consequences.changes}</p>, () => focusCard(source.id))) : await modal.confirm({
          title: titles[action],
          width: 560,
          autoFocusButton: 'cancel',
          afterClose: () => focusCard(source.id),
          mask: { closable: false },
          okText: action === 'done' ? 'Yes, mark Done' : action === 'approve' ? 'Yes, approve revision' : 'Yes, retry reviewed ticket',
          cancelText: `No, keep ${label(current.status)}`,
          content: <div className="board-confirmation">
            <strong>{current.id} · {current.title}</strong>
            <p>{label(current.status)} → {destination === 'done' ? 'Done' : 'Ready'}</p>
            <p>{consequences[action]}</p>
            {action === 'done' && <><h3>Acceptance criteria</h3><ul>{current.criteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul><h3>Recorded evidence</h3><ul>{run!.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul><p>Need the full transcript? Choose No and open Review evidence on the card.</p></>}
            {action === 'retry' && <p>Not reviewed yet? Choose No and open this ticket’s run history first.</p>}
          </div>,
        });
        if (!confirmed) {
          setAnnouncement(`${current.id} unchanged; kept ${label(current.status)}.`);
          return;
        }
      }
      const success = await execute(action === 'reorder' ? `${current.id} queue position saved.` : `${current.id}: ${action === 'done' ? 'reviewed revision marked Done' : 'Ready requested; execution permissions still apply'}.`, async () => {
        const latestTicket = latest.current.tickets.find(ticket => ticket.id === source.id);
        if (!sameBoardRevision(latestTicket, source) || !latestTicket || !canMoveTicket(latestTicket)) throw new Error('Ticket changed during confirmation. Review the current revision and try again.');
        await api(`/api/tickets/${encode(repo.id)}/${encode(current.id)}/action`, { method: 'POST', body: JSON.stringify({ action, revision: current.revision, ...(order !== null ? { order } : {}), ...(feedback ? { feedback } : {}) }) });
      });
      if (!success) setAnnouncement(`${current.id} move was not confirmed saved. Review the error and current board before retrying.`);
    } finally {
      locked.current = false;
      setConfirming(false);
      focusCard(source.id);
    }
  }

  function clearDrag() {
    dragSource.current = null;
    setDragging(null);
    setOver(null);
  }

  function dragOver(event: DragEvent<HTMLElement>, group: string, before?: string) {
    const source = dragSource.current;
    if (!source || disabled) return;
    event.stopPropagation();
    const valid = groupFor(source.status).id === group || !!transitionFor(source, group);
    event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    if (!valid) { setOver(null); return; }
    event.preventDefault();
    setOver({ group, before });
  }

  function drop(event: DragEvent<HTMLElement>, group: string, before?: string) {
    event.preventDefault();
    event.stopPropagation();
    const source = dragSource.current;
    clearDrag();
    if (source) void move(source, group, before);
  }

  return <section className="ticket-workspace" aria-label="Project tickets">
    {modalContext}
    <div className="board-toolbar">
      <Segmented aria-label="Ticket layout" value={layout} onChange={value => { clearDrag(); setLayout(value); }} options={[{ value: 'board', label: <span className="view-label"><ColumnsIcon size={16} aria-hidden="true" />Board</span> }, { value: 'list', label: <span className="view-label"><ListBulletsIcon size={16} aria-hidden="true" />List</span> }]} />
      <Input className="ticket-search" aria-label="Search tickets" placeholder="Search by title or ID…" prefix={<MagnifyingGlassIcon size={16} aria-hidden="true" />} value={search} allowClear onChange={event => setSearch(event.target.value)} />
      <Popover trigger="click" placement="bottomRight" title="Display" content={<div className="board-display">
        <Checkbox checked={showEmpty} onChange={event => setShowEmpty(event.target.checked)}>Show empty columns</Checkbox>
        <div className="display-statuses"><strong>Visible ticket statuses</strong>{statuses.map(status => <Checkbox key={status} checked={!hidden.includes(status)} onChange={event => setHidden(previous => event.target.checked ? previous.filter(value => value !== status) : [...previous, status])}><span className={`status-label status-dot-${status}`}><span aria-hidden="true" />{label(status)}</span><span className="display-count">{matching.filter(ticket => ticket.status === status).length}</span></Checkbox>)}</div>
        <Button type="link" onClick={() => { setShowEmpty(false); setHidden([]); setAttentionFilter(null); }}>Reset display</Button>
      </div>}><Button className="display-button" icon={<SlidersHorizontalIcon size={16} aria-hidden="true" />}>Display{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}</Button></Popover>
    </div>
    <p className="board-instructions" id="board-move-help">{dragging ? 'Drop into a highlighted column. Ready and Done require confirmation; execution determines other statuses.' : 'Drag by the grip to reorder or request a move. Use each card’s Actions menu without dragging.'}</p>
    <p className="board-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <div id="ticket-board-region" className={`ticket-surface ${layout === 'list' ? 'ticket-list-view' : 'kanban-board'}`} role="region" aria-label="Tickets grouped by workflow stage" aria-busy={busy} tabIndex={0}>
      {visibleColumns.map(column => {
        const validDrop = !!dragging && (groupFor(dragging.status).id === column.id || !!transitionFor(dragging, column.id));
        const shownTickets = column.id === 'attention' && attentionFilter ? column.tickets.filter(ticket => ticket.status === attentionFilter) : column.tickets;
        return <section key={column.id} className={`kanban-column board-group-${column.id}${dragging ? validDrop ? ' can-drop' : ' cannot-drop' : ''}${over?.group === column.id && !over.before ? ' drop-at-end' : ''}`} aria-labelledby={`column-${column.id}`} onDragOver={event => dragOver(event, column.id)} onDrop={event => drop(event, column.id)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(null); }}>
          <div className="kanban-heading"><h2 id={`column-${column.id}`}>{column.label}</h2><span className="kanban-count">{column.tickets.length}</span></div>
          {column.id === 'active' && <p className="board-group-note">Agent-managed · paused work still holds the slot</p>}
          {column.id === 'attention' && <div className="board-status-filters" aria-label="Filter attention statuses">{column.statuses.map(status => <button type="button" key={status} aria-pressed={attentionFilter === status} onClick={() => setAttentionFilter(previous => previous === status ? null : status)}>{label(status)} <span>{column.tickets.filter(ticket => ticket.status === status).length}</span></button>)}</div>}
          <ol className="ticket-list">{shownTickets.map((value, index) => {
            const run = snapshot.runs.find(run => run.id === value.runId);
            const movable = canMoveTicket(value) && !disabled;
            const previous = shownTickets[index - 1];
            const next = shownTickets[index + 1];
            const afterNext = shownTickets[index + 2];
            const reason = value.error || run?.blocker || run?.error;
            const details = `/projects/${encode(repo.id)}/tickets/${encode(value.id)}`;
            return <li key={value.id} className={`${dragging?.id === value.id ? 'is-dragging ' : ''}${over?.group === column.id && over.before === value.id ? 'drop-before' : ''}`} onDragOver={event => dragOver(event, column.id, value.id)} onDrop={event => drop(event, column.id, value.id)}>
              <article className={`ticket-card board-ticket ${selectedId === value.id ? 'selected' : ''}`} aria-label={`${value.id}: ${value.title}, ${label(value.status)}`}>
                <div className="board-card-top"><button type="button" className="board-drag-handle" disabled={!movable} draggable={movable && layout === 'board'} aria-label={`Drag ${value.id}; use Actions for keyboard or touch moves`} aria-describedby="board-move-help" title={movable ? 'Drag to move; use Actions without dragging' : 'Unavailable while active, invalid, or saving'} onDragStart={event => { if (!movable) { event.preventDefault(); return; } dragSource.current = value; setDragging(value); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', value.id); }} onDragEnd={clearDrag}><DotsSixVerticalIcon size={18} aria-hidden="true" /></button><span className="ticket-meta">{value.id}</span><Tag className={`badge status-${value.status}`}>{label(value.status)}</Tag></div>
                <Link className="board-ticket-title" aria-current={selectedId === value.id ? 'page' : undefined} onClick={event => onOpen(event.currentTarget)} to={details}><strong>{value.title || value.id}</strong></Link>
                {(value.removed || value.dependencies.length > 0) && <small>{value.removed ? 'Ticket file removed' : `Depends on ${value.dependencies.join(', ')}`}</small>}
                {reason && <span className="ticket-error" title={reason}>{reason}</span>}
                {value.status === 'interrupted' && <small className="warning-text">Partial changes may remain. Review before retrying.</small>}
                {value.approvedRevision === value.revision && <span className="permission-note">✓ Revision approved</span>}
                <div className="board-card-actions">
                  <Link to={run?.dialog ? `/runs/${encode(run.id)}` : details} onClick={event => onOpen(event.currentTarget)}>{run?.dialog ? 'Answer needed' : value.status === 'interrupted' ? 'Review recovery' : value.status === 'blocked' ? 'View blocker' : value.status === 'failed' ? 'View error' : value.status === 'needs_review' ? 'Review evidence' : 'Open ticket'}</Link>
                  <Dropdown trigger={['click']} menu={{ items: [
                    { key: 'ready', label: value.status === 'needs_review' ? 'Request changes → Ready' : 'Move to Ready…', disabled: disabled || !transitionFor(value, 'ready'), onClick: () => void move(value, 'ready') },
                    { key: 'done', label: 'Accept evidence → Done…', disabled: disabled || !transitionFor(value, 'done'), onClick: () => void move(value, 'done') },
                    { type: 'divider' },
                    { key: 'up', label: 'Move up in column', disabled: !movable || !previous, onClick: () => void move(value, column.id, previous?.id) },
                    { key: 'down', label: 'Move down in column', disabled: !movable || !next, onClick: () => void move(value, column.id, afterNext?.id) },
                  ] }}><Button ref={element => { if (element) controls.current.set(value.id, element); else controls.current.delete(value.id); }} size="small" type="text" aria-label={`Actions for ${value.id}`} disabled={disabled} icon={<DotsThreeIcon size={20} aria-hidden="true" />} /></Dropdown>
                </div>
              </article>
            </li>;
          })}</ol>
          {shownTickets.length === 0 && <p className="kanban-empty">{validDrop ? 'Drop here to request a move' : column.tickets.length ? 'No tickets with this status. Select its filter again to show all.' : 'No tickets in this stage'}</p>}
          {dragging && !validDrop && <p className="board-group-note">{column.id === 'active' || column.id === 'attention' || column.id === 'review' ? 'Execution determines this stage' : 'No supported move from this ticket’s status'}</p>}
        </section>;
      })}
      {visibleColumns.length === 0 && <div className="board-empty"><FolderIcon size={32} weight="duotone" aria-hidden="true" /><h2>{tickets.length === 0 ? 'A clear board. A place to start.' : matching.length === 0 ? 'No matching tickets' : 'All matching tickets are hidden'}</h2><p>{tickets.length === 0 ? 'Create a draft, describe the change, and define what done looks like.' : matching.length === 0 ? 'Try another title or ticket ID.' : 'Open Display to reveal their statuses.'}</p>{tickets.length === 0 ? <Link to={`/projects/${encode(repo.id)}/tickets/new`}>Create your first ticket</Link> : <Button onClick={() => { setSearch(''); setHidden([]); setAttentionFilter(null); }}>Show all tickets</Button>}</div>}
    </div>
    <footer className="board-footer"><span>{matching.length} of {tickets.length} tickets{hiddenCount > 0 && <span className="warning-text"> · {hiddenCount} hidden by Display</span>}{!showEmpty && emptyCount > 0 && ` · ${emptyCount} empty columns hidden`}{attentionFilter && <> · Attention filtered: {label(attentionFilter)} <button className="board-clear-filter" type="button" onClick={() => setAttentionFilter(null)}>Clear</button></>}</span><span>{confirming ? 'Confirming move · no changes until Yes' : activeRun ? `${activeRun.repoId === repo.id ? 'Active run' : 'Global slot in use'} · ${activeRun.ticketId}` : 'No active run'}</span></footer>
  </section>;
}
