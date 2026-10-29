import { expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Run, Runtime } from './contracts';
import { createApi } from './api';
import { parseExecutionOverrides, resolveRunConfiguration, sampleRunState } from './execution';
import { closeStore, createStore, database, digest, token } from './store';
import { writeTicket } from './tickets';

test('ticket model/budget overrides preserve defaults, explicit OMP default and boundary validation', () => {
  for (const input of [null, [], { executable: 'other' }, { model: 'no-provider' }, { model: 'provider/id\n' }, { thinking: 'invalid' }, { tokenBudget: 0 }, { tokenBudget: 10000001 }, { tokenBudget: 1.5 }, { tokenBudget: '1000' }, { tokenBudget: false }, { tokenBudget: Infinity }, { tokenBudget: NaN }]) expect(() => parseExecutionOverrides(input)).toThrow();
  expect(parseExecutionOverrides({ model: '', thinking: '', tokenBudget: 1 })).toEqual({ model: '', thinking: '', tokenBudget: 1 });
  expect(parseExecutionOverrides({ tokenBudget: null })).toEqual({ tokenBudget: null });
  const settings = { executable: 'unused', model: 'provider/global', thinking: 'high', tokenBudget: 1000, timeLimitMinutes: 30, roots: [], paused: true };
  const ticket = { execution: undefined };
  expect(resolveRunConfiguration(settings, ticket)).toEqual({ model: 'provider/global', thinking: 'high', tokenBudget: 1000, timeLimitMinutes: 30 });
  expect(resolveRunConfiguration(settings, { ...ticket, execution: { model: 'provider/ticket', tokenBudget: 2000 } })).toEqual({ model: 'provider/ticket', thinking: '', tokenBudget: 2000, timeLimitMinutes: 30 });
  expect(resolveRunConfiguration(settings, { ...ticket, execution: { model: '', thinking: 'off' } }).model).toBe('');
  expect(resolveRunConfiguration(settings, { execution: { tokenBudget: null } })).toEqual({ model: 'provider/global', thinking: 'high', tokenBudget: null, timeLimitMinutes: 30 });
  expect(resolveRunConfiguration(settings, { execution: {} }).tokenBudget).toBe(1000);
  expect(resolveRunConfiguration({ ...settings, tokenBudget: null }, { execution: {} }).tokenBudget).toBeNull();
  expect(resolveRunConfiguration({ ...settings, tokenBudget: null }, { execution: { tokenBudget: 500 } }).tokenBudget).toBe(500);
});

test('context telemetry is separate from cumulative consumption and excludes raw state', () => {
  const run: Pick<Run, 'progress'> = { progress: { phase: 'Running', latestAction: 'read', tokenBudget: 1000, deadline: 1, tokens: { total: 950, sampled: 1, basis: 'session' } } };
  sampleRunState(run, { contextUsage: { tokens: 80, contextWindow: 100, percent: 999 }, autoCompactionEnabled: true, isCompacting: true, model: { provider: 'provider', id: 'model' }, thinkingLevel: 'high', systemPrompt: 'Never persist this field', dumpTools: ['Never persist'] });
  expect(run.progress!.tokens!.total).toBe(950);
  expect(run.progress!.context?.tokens).toBe(80); expect(run.progress!.context?.window).toBe(100);
  expect(run.progress!.compaction?.active).toBe(true); expect(run.progress!.model).toBe('provider/model');
  expect(JSON.stringify(run)).not.toContain('Never persist');
  sampleRunState(run, { contextUsage: { tokens: 20, contextWindow: 100 }, autoCompactionEnabled: true, isCompacting: false });
  expect(run.progress!.context?.tokens).toBe(20); expect(run.progress!.tokens!.total).toBe(950);
  sampleRunState(run, { contextUsage: { tokens: NaN, contextWindow: 0 } });
  expect(run.progress!.context).toBeUndefined();
});

test('ticket execution saves are stale-safe and cannot approve, retry or change active runs', async () => {
  const root = await mkdtemp('/tmp/opencode/backlog-execution-test-');
  const store = createStore(join(root, 'private'));
  try {
    const path = join(root, 'repo'); await mkdir(path);
    const repo = { id: 'repo', path, name: 'Execution fixture', git: false, mode: 'paused' as const, lastStarted: 0 };
    store.save('repos', repo);
    const original = await writeTicket(store, repo, '---\nid: T001\ntitle: Model selection\ndepends_on: []\n---\n\nDone when:\n- Original behavior works.\n');
    const failed = { ...original, status: 'failed' as const }; store.save('tickets', failed);
    const defaults = store.settings(); let wakes = 0;
    const runtime: Runtime = { wake() { wakes++; }, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(store, runtime); const cookie = token(); const csrf = token();
    database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
    const origin = 'http://localhost:4310';
    const input = { revision: original.revision, version: null, execution: { model: 'provider/ticket', thinking: 'off', tokenBudget: null } };
    const call = (value: unknown, authenticated = true, validCsrf = true) => api(new Request(`${origin}/api/tickets/repo/T001/execution`, { method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `omp_session=${cookie}` } : {}), ...(validCsrf ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(value) }));
    expect((await call(input, false)).status).toBe(401); expect((await call(input, true, false)).status).toBe(403);
    expect((await call({ ...input, revision: 'stale' })).status).toBe(409);
    expect((await call(input)).status).toBe(200);
    const saved = store.get('tickets', 'repo/T001')!;
    expect(saved.execution).toEqual(input.execution); expect(saved.status).toBe('failed');
    expect(resolveRunConfiguration(defaults, saved).tokenBudget).toBeNull();
    expect(resolveRunConfiguration(defaults, saved).timeLimitMinutes).toBe(defaults.timeLimitMinutes);
    expect(saved.revision).toBe(original.revision); expect(saved.approvedRevision).toBeNull();
    expect(store.settings()).toEqual(defaults); expect(wakes).toBe(0); expect(store.list('runs')).toHaveLength(0);
    expect((await call(input)).status).toBe(409);
    const retry = (executionVersion?: string) => api(new Request(`${origin}/api/tickets/repo/T001/action`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': csrf }, body: JSON.stringify({ action: 'retry', revision: saved.revision, executionVersion }) }));
    expect((await retry()).status).toBe(409); expect((await retry(saved.executionVersion)).status).toBe(200);
    for (const status of ['running', 'paused', 'stopping'] as const) {
      store.save('tickets', { ...saved, status });
      expect((await call({ ...input, version: saved.executionVersion })).status).toBe(409);
    }
    store.save('tickets', { ...saved, status: 'failed' });
    expect((await call({ ...input, version: saved.executionVersion, execution: {} })).status).toBe(200);
    expect(store.get('tickets', 'repo/T001')!.execution).toEqual({});
    expect(resolveRunConfiguration(defaults, store.get('tickets', 'repo/T001')!).tokenBudget).toBe(defaults.tokenBudget);
    expect(store.settings()).toEqual(defaults);
  } finally { closeStore(store); }
});
