import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApi } from './api';
import { closeStore, createStore, database, digest } from './store';
import { closeDrafts } from './drafting';
import type { Repo, Runtime } from './contracts';
import type { AgentWorkspaceSnapshot } from './agent-workspace-contracts';

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
function request(path: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) headers.set('Cookie', `omp_session=${cookie}`);
  if (init.method && init.method !== 'GET') { headers.set('Origin', origin); if (authenticated) headers.set('X-CSRF-Token', csrf); }
  return api(new Request(`${origin}/api/repos/${repo.id}/${path}`, { ...init, headers }));
}
afterAll(async () => { await closeDrafts(store); closeStore(store); await rm(root, { recursive: true, force: true }); });

test('drafting and assisted publication cannot bypass owner authentication or CSRF', async () => {
  for (const path of ['drafts', 'drafts/unknown/context', 'drafts/unknown/turn', 'assisted-prepare', 'assisted-create', 'agent-workspaces', 'agent-workspaces/unknown/connect', 'agent-workspaces/unknown/session/turn']) {
    expect((await request(path, { method: 'POST', body: '{}' }, false)).status).toBe(401);
    const denied = await api(new Request(`${origin}/api/repos/${repo.id}/${path}`, {
      method: 'POST', headers: { Origin: origin, Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': 'invalid' }, body: '{}',
    }));
    expect(denied.status).toBe(403);
  }
  expect(store.list('tickets')).toEqual([]);
  expect(store.list('runs')).toEqual([]);
});

test('retired creation routes cannot publish, spawn or wake execution even in Automatic mode', async () => {
  for (const path of ['drafts', 'drafts/unknown/turn', 'assisted-prepare', 'assisted-create']) {
    const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(410);
    expect((await response.json() as { error: string }).error).toContain('Create tickets');
  }
  expect(store.list('tickets')).toEqual([]);
  expect(store.list('runs')).toEqual([]);
  expect(wakes).toBe(0);
});

test('conversation saves remain scoped without granting execution authority', async () => {
  const before = store.list('tickets').map(ticket => ticket.id);
  const startsBefore = wakes;
  const post = (value: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const created = await request('agent-workspaces', post({ title: 'CSV discussion' }));
  expect(created.status).toBe(201);
  const initial = await created.json() as AgentWorkspaceSnapshot;
  const path = `agent-workspaces/${initial.workspace.id}`;
  expect(initial.draft).toBeNull();
  const saved = await request(path, post({
    version: initial.workspace.version,
    prompt: 'Explore CSV quoting before extracting a ticket',
  }, 'PATCH'));
  expect(saved.status).toBe(200);
  const edited = await saved.json() as AgentWorkspaceSnapshot;
  const rejected = await request(path, post({ version: edited.workspace.version, approvePlanRevisionId: 'old-plan' }, 'PATCH'));
  expect(rejected.status).toBe(410);
  const stale = await request(path, post({ version: initial.workspace.version, prompt: 'Overwrite from stale tab' }, 'PATCH'));
  expect(stale.status).toBe(409);
  const restored = await (await request(path)).json() as AgentWorkspaceSnapshot;
  expect(restored.workspace.prompt).toBe('Explore CSV quoting before extracting a ticket');
  expect(restored.workspace.ticketMarkdown).toBe('');
  expect(restored.draft).toBeNull();
  const other = { ...repo, id: 'other-project', name: 'Other project' };
  store.save('repos', other);
  const foreign = await api(new Request(`${origin}/api/repos/${other.id}/${path}`, { headers: { Cookie: `omp_session=${cookie}` } }));
  expect(foreign.status).toBe(404);
  const blocked = await api(new Request(`${origin}/api/repos/${repo.id}/${path}`, {
    ...post({ version: restored.workspace.version, archived: true }, 'PATCH'),
    headers: { Origin: origin, Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': 'invalid', 'Content-Type': 'application/json' },
  }));
  expect(blocked.status).toBe(403);
  expect((await (await request(path)).json() as AgentWorkspaceSnapshot).workspace.archived).toBe(false);
  expect(store.list('tickets').map(ticket => ticket.id)).toEqual(before);
  expect(store.list('runs')).toEqual([]);
  expect(wakes).toBe(startsBefore);
});

