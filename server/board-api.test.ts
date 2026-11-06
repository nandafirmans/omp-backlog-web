import { expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApi } from './api';
import { closeStore, createStore, database, digest, token } from './store';
import { writeTicket } from './tickets';
import type { Runtime } from './contracts';

test('board transitions save position together and reject invalid placement before approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backlog-board-test-'));
  const store = createStore(join(root, 'private'));
  try {
    const workspace = join(root, 'repo');
    await mkdir(workspace);
    const repo = { id: 'repo', path: workspace, name: 'Board fixture', git: false, mode: 'paused' as const, lastStarted: 0 };
    store.save('repos', repo);
    const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Move card\ndepends_on: []\n---\n\nSave the requested board position without changing execution permission.\n\nDone when:\n- Position is saved.\n');
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
    }
    expect((await call('approve', 12, 'stale')).status).toBe(409);
    expect((await call('done', 12)).status).toBe(409);
    expect(store.get('tickets', 'repo/T001')!.order).toBe(ticket.order);
    expect((await call('approve', 12.5)).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.status).toBe('ready');
    expect(store.get('tickets', 'repo/T001')!.order).toBe(12.5);
    expect(store.get('tickets', 'repo/T001')!.approvedRevision).toBe(ticket.revision);
    expect((await call('reorder', undefined)).status).toBe(400);
    expect((await call('reorder', 8)).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.order).toBe(8);
    expect(store.get('tickets', 'repo/T001')!.status).toBe('ready');
    expect(store.list('runs')).toHaveLength(0);
  } finally { closeStore(store); }
});
