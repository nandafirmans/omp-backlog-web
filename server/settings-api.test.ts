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
    expect(before.maxConcurrentTickets).toBe(1);
    const { maxConcurrentTickets: omittedCapacity, ...legacy } = before;
    expect(omittedCapacity).toBe(1);
    database(store).query('UPDATE config SET value=? WHERE id=1').run(JSON.stringify(legacy));
    expect(store.settings()).toEqual(before);
    const legacyReload = createStore(store.dataDir);
    try { expect(legacyReload.settings()).toEqual(before); } finally { closeStore(legacyReload); }
    expect((await call('settings', 'PATCH', { maxConcurrentTickets: 2 }, false)).status).toBe(401);
    expect((await call('settings', 'PATCH', { maxConcurrentTickets: 2 }, true, false)).status).toBe(403);
    for (const maxConcurrentTickets of [0, -1, 5, 1.5, '2', null, false, NaN, Infinity]) {
      expect((await call('settings', 'PATCH', { maxConcurrentTickets, paused: true })).status).toBe(400);
      expect(store.settings()).toEqual(before);
    }
    for (const maxConcurrentTickets of [1, 2, 3, 4]) {
      const response = await call('settings', 'PATCH', { maxConcurrentTickets });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ...before, maxConcurrentTickets });
      expect(store.settings()).toEqual({ ...before, maxConcurrentTickets });
    }
    const capacityReload = createStore(store.dataDir);
    try { expect(capacityReload.settings()).toEqual({ ...before, maxConcurrentTickets: 4 }); } finally { closeStore(capacityReload); }
    expect((await call('settings', 'PATCH', { maxConcurrentTickets: 1 })).status).toBe(200);
    expect((await call('settings', 'PATCH', { tokenBudget: null }, false)).status).toBe(401);
    expect((await call('settings', 'PATCH', { tokenBudget: null }, true, false)).status).toBe(403);
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
    for (const tokenBudget of [0, -1, 10000001, 1.5, 'unlimited', false]) expect((await call('settings', 'PATCH', { tokenBudget })).status).toBe(400);
    const finite = store.settings();
    expect((await call('settings', 'PATCH', { tokenBudget: null })).status).toBe(200);
    expect(store.settings()).toEqual({ ...finite, tokenBudget: null });
    const reloaded = createStore(store.dataDir);
    try { expect(reloaded.settings().tokenBudget).toBeNull(); } finally { closeStore(reloaded); }
    expect((await call('settings', 'PATCH', { timeLimitMinutes: null })).status).toBe(400);
    expect(store.settings().timeLimitMinutes).toBe(finite.timeLimitMinutes);
    expect((await call('settings', 'PATCH', { tokenBudget: finite.tokenBudget })).status).toBe(200);
    expect(store.settings()).toEqual(finite);
    expect(store.list('runs')).toEqual([]);
    expect(store.list('tickets')).toEqual([]);
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
