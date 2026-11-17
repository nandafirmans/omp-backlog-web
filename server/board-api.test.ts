import { expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApi } from './api';
import { closeStore, createStore, database, digest, token } from './store';
import { writeTicket } from './tickets';
import type { Runtime } from './contracts';
import { eligible } from './runtime';

test('board transitions save position together and reject invalid placement before approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backlog-board-test-'));
  const store = createStore(join(root, 'private'));
  try {
    const workspace = join(root, 'repo');
    await mkdir(workspace);
    const repo = { id: 'repo', path: workspace, name: 'Board fixture', git: false, mode: 'paused' as const, lastStarted: 0 };
    store.save('repos', repo);
    const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Move card\ndepends_on: []\n---\n\nSave the requested board position without changing execution permission.\n\nDone when:\n- Position is saved.\n');
    store.save('repos', { ...repo, mode: 'automatic' });
    store.save('tickets', { ...ticket, creationHold: true });
    expect(eligible(store, { ...repo, mode: 'automatic' }, store.get('tickets', 'repo/T001')!)).toBe(false);
    const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(store, runtime);
    const cookie = token(); const csrf = token();
    database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
    const origin = 'http://localhost:4310';
    const call = (action: string, order: unknown, revision = ticket.revision) => api(new Request(`${origin}/api/tickets/repo/T001/action`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': csrf },
      body: JSON.stringify({ action, revision, order }),
    }));
    for (const order of ['12', null, {}]) {
      expect((await call('approve', order)).status).toBe(400);
      expect(store.get('tickets', 'repo/T001')!.status).toBe('draft');
      expect(store.get('tickets', 'repo/T001')!.approvedRevision).toBeNull();
      expect(store.get('tickets', 'repo/T001')!.creationHold).toBe(true);
    }
    expect((await call('approve', 12, 'stale')).status).toBe(409);
    expect((await call('done', 12)).status).toBe(409);
    expect(store.get('tickets', 'repo/T001')!.order).toBe(ticket.order);
    expect(store.get('tickets', 'repo/T001')!.creationHold).toBe(true);
    expect((await call('reorder', 9)).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.creationHold).toBe(true);
    expect((await call('approve', 12.5)).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.status).toBe('ready');
    expect(store.get('tickets', 'repo/T001')!.order).toBe(12.5);
    expect(store.get('tickets', 'repo/T001')!.approvedRevision).toBe(ticket.revision);
    expect(store.get('tickets', 'repo/T001')!.creationHold).toBeUndefined();
    expect(eligible(store, store.get('repos', repo.id)!, store.get('tickets', 'repo/T001')!)).toBe(true);
    expect((await call('reorder', undefined)).status).toBe(400);
    expect((await call('reorder', 8)).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.order).toBe(8);
    expect(store.get('tickets', 'repo/T001')!.status).toBe('ready');
    expect(store.list('runs')).toHaveLength(0);
  } finally { closeStore(store); }
});

test('deleting a ticket cascades to dependents only when the confirmed list matches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backlog-delete-test-'));
  const store = createStore(join(root, 'private'));
  try {
    const workspace = join(root, 'repo');
    await mkdir(workspace);
    const repo = { id: 'repo', path: workspace, name: 'Delete fixture', git: false, mode: 'paused' as const, lastStarted: 0 };
    store.save('repos', repo);
    const make = (id: string, deps: string) => writeTicket(store, repo, `---\nid: ${id}\ntitle: Ticket ${id}\ndepends_on: [${deps}]\n---\n\nChange something observable.\n\nDone when:\n- It works.\n`);
    await make('T001', ''); await make('T002', 'T001'); await make('T003', 'T002'); await make('T004', '');
    const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(store, runtime);
    const cookie = token(); const csrf = token();
    database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
    const origin = 'http://localhost:4310';
    const remove = (id: string, ids: string[]) => api(new Request(`${origin}/api/repos/repo/tickets/${id}`, {
      method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': csrf }, body: JSON.stringify({ ids }),
    }));
    expect((await remove('T001', ['T001'])).status).toBe(409);
    store.save('tickets', { ...store.get('tickets', 'repo/T003')!, status: 'running' });
    expect((await remove('T001', ['T001', 'T002', 'T003'])).status).toBe(409);
    store.save('tickets', { ...store.get('tickets', 'repo/T003')!, status: 'draft' });
    expect((await remove('T001', ['T001', 'T002', 'T003'])).status).toBe(200);
    expect(store.list('tickets').map(ticket => ticket.id)).toEqual(['T004']);
    expect(await Bun.file(join(workspace, '.omp-backlog', 'tickets', 'T001', 'ticket.md')).exists()).toBe(false);
    expect(await Bun.file(join(workspace, '.omp-backlog', 'tickets', 'T004', 'ticket.md')).exists()).toBe(true);
  } finally { closeStore(store); }
});
