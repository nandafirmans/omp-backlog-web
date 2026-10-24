import { expect, test } from 'bun:test';
import type { Ticket } from '../server/contracts';
import { boardGroups, canMoveTicket, groupFor, insertionOrder, sameBoardRevision, transitionFor } from './ticketBoard.ts';

function ticket(id: string, status: Ticket['status'], order = 1): Ticket {
  return { id, status, order, repoId: 'repo', revision: 'revision', title: id, markdown: '', approvedRevision: null, dependencies: [], criteria: [], attachments: [], error: null, removed: false, runId: null };
}

test('six visual groups retain every exact lifecycle state once', () => {
  expect(boardGroups).toHaveLength(6);
  const statuses = boardGroups.flatMap(group => group.statuses);
  expect(statuses).toHaveLength(10);
  expect(new Set(statuses).size).toBe(10);
  for (const status of ['failed', 'blocked', 'interrupted'] as const) expect(groupFor(status).id).toBe('attention');
  for (const status of ['running', 'stopping', 'paused'] as const) expect(groupFor(status).id).toBe('active');
});

test('only explicit supported lifecycle actions can cross columns', () => {
  expect(transitionFor(ticket('A', 'draft'), 'ready')).toBe('approve');
  for (const status of ['failed', 'blocked', 'interrupted'] as const) expect(transitionFor(ticket('A', status), 'ready')).toBe('retry');
  expect(transitionFor(ticket('A', 'needs_review'), 'ready')).toBe('changes');
  expect(transitionFor(ticket('A', 'needs_review'), 'done')).toBe('done');
  for (const status of boardGroups.flatMap(group => group.statuses)) {
    for (const destination of ['active', 'attention', 'review', 'draft']) expect(transitionFor(ticket('A', status), destination)).toBeNull();
    if (status !== 'needs_review') expect(transitionFor(ticket('A', status), 'done')).toBeNull();
  }
});

test('active, invalid, and removed tickets cannot be moved', () => {
  for (const status of ['running', 'stopping', 'paused'] as const) expect(canMoveTicket(ticket('A', status))).toBe(false);
  for (const value of [{ ...ticket('A', 'draft'), error: 'invalid' }, { ...ticket('A', 'draft'), removed: true }]) {
    expect(transitionFor(value, 'ready')).toBeNull();
    expect(canMoveTicket(value)).toBe(false);
  }
});

test('confirmation snapshots reject changed status, revision, and missing tickets', () => {
  const original = ticket('A', 'needs_review');
  expect(sameBoardRevision(original, original)).toBe(true);
  expect(sameBoardRevision({ ...original, status: 'done' }, original)).toBe(false);
  expect(sameBoardRevision({ ...original, revision: 'new' }, original)).toBe(false);
  expect(sameBoardRevision({ ...original, removed: true }, original)).toBe(false);
  expect(sameBoardRevision(undefined, original)).toBe(false);
});

test('reordering grouped statuses respects global and hidden neighbors', () => {
  const values = [ticket('A', 'failed', 10), ticket('hidden', 'ready', 20), ticket('B', 'blocked', 30), ticket('C', 'interrupted', 40), ticket('done', 'done', 50)];
  expect(insertionOrder(values, values[2]!, 'attention', 'A')).toBe(9);
  expect(insertionOrder(values, values[3]!, 'attention', 'B')).toBe(25);
  expect(insertionOrder(values, values[0]!, 'attention', 'B')).toBeNull();
  expect(insertionOrder(values, values[3]!, 'attention')).toBeNull();
  expect(insertionOrder(values, values[0]!, 'attention')).toBe(45);
  expect(insertionOrder(values, values[0]!, 'attention', 'A')).toBeNull();
  expect(insertionOrder(values, values[0]!, 'attention', 'hidden')).toBeNull();
  expect(insertionOrder([ticket('A', 'failed'), ticket('B', 'blocked'), ticket('C', 'interrupted')], ticket('C', 'interrupted'), 'attention', 'B')).toBeNull();
});
