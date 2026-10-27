import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api';
import { closeStore, createStore, database, digest, token } from './store';
import type { Runtime } from './contracts';

test('settings preserve legacy defaults and other values while validating thinking and discovery boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-settings-api-'));
  const store = createStore(join(root, 'private'));
  const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
  const api = createApi(store, runtime);
  const origin = 'http://localhost:4310';
  const cookie = token(); const csrf = token();
  database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
  const call = (path: string, method: string, value: unknown, authenticated = true, validCsrf = true) => api(new Request(`${origin}/api/${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': validCsrf ? csrf : 'wrong' } : {}) }, body: JSON.stringify(value),
  }));
  try {
    const before = store.settings();
    expect(before.thinking).toBeUndefined();
    expect((await call('settings/models', 'POST', { executable: 'unused', model: '' }, false)).status).toBe(401);
    expect((await call('settings/models', 'POST', { executable: 'unused', model: '' }, true, false)).status).toBe(403);
    for (const value of [
      { executable: 'unused', model: '', args: [] }, { executable: '', model: '' }, { executable: 'a'.repeat(4097), model: '' },
      { executable: 'unused\0', model: '' }, { executable: 'unused', model: 'alias' }, { executable: 'unused', model: 'p/' },
      { executable: 'unused', model: 'p/' + 'm'.repeat(512) }, { executable: 'unused' },
    ]) expect((await call('settings/models', 'POST', value)).status).toBe(400);
    expect(store.settings()).toEqual(before);
    for (const thinking of ['unknown', 'HIGH', null, 1, 'high ']) expect((await call('settings', 'PATCH', { thinking })).status).toBe(400);
    expect(store.settings()).toEqual(before);
    expect((await call('settings', 'PATCH', { thinking: 'high' })).status).toBe(200);
    expect(store.settings()).toEqual({ ...before, thinking: 'high' });
    expect((await call('settings', 'PATCH', { paused: !before.paused })).status).toBe(200);
    expect(store.settings()).toEqual({ ...before, thinking: 'high', paused: !before.paused });
    expect((await call('settings', 'PATCH', { thinking: '' })).status).toBe(200);
    expect(store.settings().thinking).toBe('');
    expect((await call('settings', 'PATCH', { model: 'provider/id/with/slashes' })).status).toBe(200);
    expect(store.settings().model).toBe('provider/id/with/slashes');
    expect((await call('settings', 'PATCH', { model: 'model-alias' })).status).toBe(400);
    expect(store.list('runs')).toEqual([]);
    expect(store.list('tickets')).toEqual([]);
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
