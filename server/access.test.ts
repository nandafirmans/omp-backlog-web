import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api';
import { parseRemoteOrigin } from './access';
import { closeStore, createStore, database } from './store';
import type { Runtime } from './contracts';

const root = await mkdtemp(join(tmpdir(), 'omp-backlog-tailnet-'));
const store = createStore(root);
const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
const origin = 'https://backlog.example.com';
const api = createApi(store, runtime, origin);
const request = (path: string, init?: RequestInit) => api(new Request(`${origin}${path}`, init));
afterAll(async () => { closeStore(store); await rm(root, { recursive: true, force: true }); });

test('tailnet access is opt-in, exact-host, HTTPS-only and ignores forwarded host claims', async () => {
  expect((await createApi(store, runtime)(new Request(`${origin}/api/health`))).status).toBe(403);
  expect((await request('/api/health')).status).toBe(200);
  expect((await api(new Request('http://127.0.0.1:4310/api/health'))).status).toBe(200);
  for (const url of ['http://backlog.example.com', 'https://other.example.com', `${origin}:8443`, 'https://backlog.example.com.evil.invalid']) {
    expect((await api(new Request(`${url}/api/health`))).status).toBe(403);
  }
  expect((await request('/api/health', { headers: { Host: 'evil.invalid' } })).status).toBe(403);
  expect((await api(new Request('http://evil.invalid/api/health', { headers: { 'X-Forwarded-Host': 'dashboard.example.ts.net', 'X-Forwarded-Proto': 'https' } }))).status).toBe(403);
  for (const value of ['http://backlog.example.com', `${origin}:8443`, `${origin}/path`, `${origin}?query=1`, `${origin}#fragment`, 'https://user@backlog.example.com']) {
    expect(() => parseRemoteOrigin(value)).toThrow();
  }
});

test('existing ts.net origins remain explicitly selectable', async () => {
  const tailnet = createApi(store, runtime, 'https://dashboard.example.ts.net');
  expect((await tailnet(new Request('https://dashboard.example.ts.net/api/health'))).status).toBe(200);
  expect((await tailnet(new Request(`${origin}/api/health`))).status).toBe(403);
});

test('tailnet login keeps secure cookies, authentication, same-origin and CSRF enforcement', async () => {
  expect((await request('/api/state')).status).toBe(401);
  const session = await request('/api/session');
  expect(session.headers.get('set-cookie')).toContain('; Secure');
  const password = crypto.randomUUID();
  database(store).query('INSERT INTO owner (id, username, hash) VALUES (1, ?, ?)').run('tailnet-test', await Bun.password.hash(password, { algorithm: 'argon2id' }));
  const login = await request('/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tailnet-test', password }) });
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('; Secure');
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const { csrf } = await login.json() as { csrf: string };
  expect((await request('/api/state', { headers: { Cookie: cookie } })).status).toBe(200);
  const mutation = (headers: HeadersInit) => request('/api/settings', { method: 'PATCH', headers, body: JSON.stringify({ paused: true }) });
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
  expect((await mutation({ ...headers, Origin: 'https://evil.invalid' })).status).toBe(403);
  expect((await mutation({ ...headers, Origin: 'http://127.0.0.1:4310' })).status).toBe(403);
  expect((await mutation({ ...headers, 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  expect((await mutation({ ...headers, 'X-CSRF-Token': '' })).status).toBe(403);
  expect((await mutation({ Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf })).status).toBe(403);
  expect((await mutation(headers)).status).toBe(200);
  expect(store.settings().paused).toBe(true);
  const logout = await request('/api/logout', { method: 'POST', headers });
  expect(logout.status).toBe(200);
  expect(logout.headers.get('set-cookie')).toContain('; Secure');
  expect((await request('/api/state', { headers: { Cookie: cookie } })).status).toBe(401);
});
