import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApi } from './api';
import { closeStore, createStore, database, digest } from './store';
import { closeDrafts } from './drafting';
import type { Repo, Runtime } from './contracts';
import type { AssistedConfirmation } from './drafting-contracts';

const root = await mkdtemp(join(tmpdir(), 'backlog-drafting-api-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
const store = createStore(join(root, 'private'));
store.setSettings({ ...store.settings(), roots: [workspace] });
const repo: Repo = { id: 'fixture', name: 'Fixture', path: workspace, git: false, mode: 'automatic', lastStarted: 0 };
store.save('repos', repo);
let wakes = 0;
const runtime: Runtime = { wake() { wakes++; }, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
const api = createApi(store, runtime);
const origin = 'http://127.0.0.1:4310';
const cookie = randomBytes(32).toString('hex');
const csrf = randomBytes(32).toString('hex');
database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60_000);
const markdown = '---\nid: T001\ntitle: Synthetic drafting route proof\ndepends_on: []\n---\n\nPrepare a synthetic ticket only.\n\nDone when:\n- Reviewed bytes are preserved.\n';
function multipart(confirmation?: string) {
  const data = new FormData();
  data.set('markdown', markdown);
  if (confirmation) data.set('confirmation', confirmation);
  return data;
}
function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Cookie', `omp_session=${cookie}`);
  if (init.method && init.method !== 'GET') { headers.set('Origin', origin); if (authenticated) headers.set('X-CSRF-Token', csrf); }
  return api(new Request(`${origin}/api/repos/${repo.id}/${path}`, { ...init, headers }));
}
afterAll(async () => { await closeDrafts(store); closeStore(store); await rm(root, { recursive: true, force: true }); });

test('drafting and assisted publication cannot bypass owner authentication or CSRF', async () => {
  for (const path of ['drafts', 'drafts/unknown/context', 'drafts/unknown/turn', 'assisted-prepare', 'assisted-create']) {
    expect((await request(path, { method: 'POST', body: '{}' }, false)).status).toBe(401);
    const denied = await api(new Request(`${origin}/api/repos/${repo.id}/${path}`, {
      method: 'POST', headers: { Origin: origin, Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': 'invalid' }, body: '{}',
    }));
    expect(denied.status).toBe(403);
  }
  expect(store.list('tickets')).toEqual([]);
  expect(store.list('runs')).toEqual([]);
});

test('assisted prepare does not wake execution; stale mode confirmation cannot publish', async () => {
  const prepared = await request('assisted-prepare', { method: 'POST', body: multipart() });
  expect(prepared.status).toBe(200);
  const confirmation = await prepared.json() as AssistedConfirmation;
  expect(confirmation.mode).toBe('automatic');
  expect(store.list('tickets')).toEqual([]);
  expect(wakes).toBe(0);
  store.save('repos', { ...repo, mode: 'paused' });
  const rejected = await request('assisted-create', { method: 'POST', body: multipart(confirmation.confirmation) });
  expect(rejected.status).toBe(409);
  expect(store.list('tickets')).toEqual([]);
  expect(wakes).toBe(0);
  const reviewed = await request('assisted-prepare', { method: 'POST', body: multipart() });
  const next = await reviewed.json() as AssistedConfirmation;
  const published = await request('assisted-create', { method: 'POST', body: multipart(next.confirmation) });
  expect(published.status).toBe(201);
  expect((await published.json()).markdown).toBe(markdown);
  expect(store.list('tickets').map(ticket => ticket.id)).toEqual(['T001']);
  expect(store.list('runs')).toEqual([]);
  expect(wakes).toBe(1);
});
