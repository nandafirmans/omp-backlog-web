import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Run, Snapshot, Status } from '../server/contracts';

const needsYou: Status[] = ['needs_review', 'failed', 'blocked'];
const labels: Partial<Record<Status, string>> = { needs_review: 'needs review', failed: 'failed', blocked: 'is blocked' };
const baseTitle = document.title;
const supported = typeof Notification !== 'undefined';

/** A run needs the operator when it asks a question or its ticket stopped on it for review, failure or a blocker. */
function waiting(snapshot: Snapshot): Run[] {
  return snapshot.runs.filter(run => run.dialog || needsYou.includes(run.status) && snapshot.tickets.some(ticket => ticket.repoId === run.repoId && ticket.id === run.ticketId && ticket.runId === run.id && ticket.status === run.status));
}

/**
 * Puts the count of runs waiting on the operator in the tab title, and shows a
 * browser notification when a run newly needs them while the tab is hidden.
 */
export default function useRunAlerts(snapshot: Snapshot | undefined) {
  const navigate = useNavigate();
  const seen = useRef<Map<string, string> | null>(null);
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');

  useEffect(() => {
    if (!snapshot) { document.title = baseTitle; return; }
    const pending = waiting(snapshot);
    document.title = pending.length ? `(${pending.length}) ${baseTitle}` : baseTitle;
    const current = new Map(pending.map(run => [run.id, run.dialog ? `dialog:${run.dialog.id}` : run.status]));
    const previous = seen.current;
    seen.current = current;
    // The first snapshot is the existing state, not news.
    if (!previous || !supported || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    for (const run of pending) {
      const key = current.get(run.id)!;
      if (previous.get(run.id) === key) continue;
      const project = snapshot.repos.find(repo => repo.id === run.repoId)?.name ?? run.repoId;
      const notice = new Notification(`${project} / ${run.ticketId} ${run.dialog ? 'needs an answer' : labels[run.status]}`, { body: run.dialog?.title ?? run.error ?? 'Open the run to review it.', tag: `${run.id}:${key}` });
      notice.onclick = () => { window.focus(); void navigate(`/runs/${encodeURIComponent(run.id)}`); notice.close(); };
    }
  }, [snapshot, navigate]);

  useEffect(() => () => { document.title = baseTitle; }, []);

  const enable = supported && permission === 'default' ? () => { void Notification.requestPermission().then(setPermission); } : undefined;
  return { enable };
}
