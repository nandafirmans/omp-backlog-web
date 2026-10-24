import type { Ticket } from '../server/contracts';

export const boardGroups: { id: string; label: string; statuses: Ticket['status'][] }[] = [
  { id: 'draft', label: 'Draft', statuses: ['draft'] },
  { id: 'ready', label: 'Ready', statuses: ['ready'] },
  { id: 'active', label: 'In progress', statuses: ['running', 'stopping', 'paused'] },
  { id: 'attention', label: 'Needs attention', statuses: ['failed', 'blocked', 'interrupted'] },
  { id: 'review', label: 'Needs review', statuses: ['needs_review'] },
  { id: 'done', label: 'Done', statuses: ['done'] },
];

export function groupFor(status: Ticket['status']) {
  return boardGroups.find(group => group.statuses.includes(status))!;
}

export function canMoveTicket(ticket: Ticket) {
  return !ticket.removed && !ticket.error && !['running', 'stopping', 'paused'].includes(ticket.status);
}

export function transitionFor(ticket: Ticket, destination: string) {
  if (!canMoveTicket(ticket)) return null;
  if (destination === 'ready') {
    if (ticket.status === 'draft') return 'approve';
    if (['failed', 'blocked', 'interrupted'].includes(ticket.status)) return 'retry';
    if (ticket.status === 'needs_review') return 'changes';
  }
  if (destination === 'done' && ticket.status === 'needs_review') return 'done';
  return null;
}

export function sameBoardRevision(current: Ticket | undefined, expected: Ticket) {
  return !!current && current.revision === expected.revision && current.status === expected.status && !current.removed;
}

// Use global neighbors so moving within a group never renumbers hidden tickets.
export function insertionOrder(tickets: Ticket[], moving: Ticket, groupId: string, beforeId?: string) {
  if (beforeId === moving.id) return null;
  const grouped = tickets.filter(ticket => groupFor(ticket.status).id === groupId);
  const currentIndex = grouped.findIndex(ticket => ticket.id === moving.id);
  if (currentIndex >= 0 && (beforeId ? grouped[currentIndex + 1]?.id === beforeId : grouped.at(-1)?.id === moving.id)) return null;
  const remaining = tickets.filter(ticket => ticket.id !== moving.id);
  let index: number;
  if (beforeId) {
    index = remaining.findIndex(ticket => ticket.id === beforeId && groupFor(ticket.status).id === groupId);
    if (index < 0) return null;
  } else {
    index = remaining.findLastIndex(ticket => groupFor(ticket.status).id === groupId) + 1;
    if (index === 0) return null;
  }
  const previous = remaining[index - 1]?.order;
  const next = remaining[index]?.order;
  const order = previous === undefined ? next! - 1 : next === undefined ? previous + 1 : previous + (next - previous) / 2;
  if (!Number.isFinite(order) || (previous !== undefined && order <= previous) || (next !== undefined && order >= next)) return null;
  return order === moving.order ? null : order;
}
