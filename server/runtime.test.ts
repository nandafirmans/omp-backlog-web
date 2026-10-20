import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore, closeStore } from './store';
import { eligible, parseResult } from './runtime';
import { FrameDecoder } from './rpc';
import type { Repo, Run, Ticket } from './contracts';
const root = await mkdtemp(join(tmpdir(), 'omp-scheduler-acceptance-'));
const store = createStore(root);
afterAll(async () => { closeStore(store); await rm(root, { recursive: true, force: true }); });
const repo: Repo = { id: 'repo', name: 'Disposable', path: root, git: false, mode: 'approved', lastStarted: 0 };
const ticket: Ticket = { id: 'T001', repoId: repo.id, title: 'Proof', markdown: '', revision: 'new', approvedRevision: 'new', status: 'ready', dependencies: [], criteria: ['Proof is checked', 'No unrelated edits'], attachments: [], error: null, order: 1, removed: false, runId: null };
test('only permitted current revisions with Done dependencies are eligible', () => {
  expect(eligible(store, { ...repo, mode: 'paused' }, ticket)).toBe(false);
  expect(eligible(store, repo, { ...ticket, approvedRevision: 'old' })).toBe(false);
  expect(eligible(store, repo, { ...ticket, dependencies: ['T002'] })).toBe(false);
  store.save('tickets', { ...ticket, id: 'T002', status: 'needs_review' });
  expect(eligible(store, repo, { ...ticket, dependencies: ['T002'] })).toBe(false);
  store.save('tickets', { ...ticket, id: 'T002', status: 'done' });
  expect(eligible(store, repo, { ...ticket, dependencies: ['T002'] })).toBe(true);
  for (const status of ['blocked', 'failed', 'interrupted', 'paused', 'needs_review', 'done', 'running', 'stopping'] as const) {
    expect(eligible(store, { ...repo, mode: 'automatic' }, { ...ticket, status })).toBe(false);
  }
});
test('editing previously executed work cannot silently rerun in automatic mode', () => {
  const run: Run = { id: 'run', repoId: repo.id, ticketId: ticket.id, revision: 'old', status: 'done', started: 1, finished: 2, pid: null, sessionId: null, sessionFile: null, snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null };
  store.save('runs', run);
  expect(eligible(store, { ...repo, mode: 'automatic' }, { ...ticket, status: 'draft' })).toBe(false);
});
test('completion evidence cannot omit criteria, duplicate them or use another revision', () => {
  const result = { revision: ticket.revision, status: 'complete', evidence: ticket.criteria.map(criterion => ({ criterion, evidence: 'Observed disposable proof file with expected content' })) };
  expect(parseResult(result, ticket).evidence).toHaveLength(2);
  expect(() => parseResult({ ...result, revision: 'old' }, ticket)).toThrow();
  expect(() => parseResult({ ...result, evidence: result.evidence.slice(0, 1) }, ticket)).toThrow();
  expect(() => parseResult({ ...result, evidence: [result.evidence[0], result.evidence[0]] }, ticket)).toThrow();
  expect(() => parseResult({ ...result, status: 'blocked' }, ticket)).toThrow();
  expect(parseResult({ ...result, status: 'blocked', prerequisite: 'Missing test input', unblock: 'Owner supplies synthetic test input' }, ticket).blocker).toContain('Owner supplies');
});
test('RPC reassembly rejects interleaved chunks and incomplete UTF-8 payloads', () => {
  const payload = Buffer.from(JSON.stringify({ type: 'message_end', text: 'checked ✓' }));
  const split = Math.floor(payload.length / 2);
  const chunk = (index: number, data: Buffer) => Buffer.from(JSON.stringify({ type: 'rpc_chunk', chunkId: 'one', index, count: 2, byteLength: payload.length, data: data.toString('base64') }));
  const decoder = new FrameDecoder();
  expect(decoder.decode(chunk(0, payload.subarray(0, split)))).toBeNull();
  expect(decoder.decode(chunk(1, payload.subarray(split)))?.text).toBe('checked ✓');
  decoder.end();
  const interrupted = new FrameDecoder();
  interrupted.decode(chunk(0, payload.subarray(0, split)));
  expect(() => interrupted.decode(Buffer.from('{"type":"agent_end"}'))).toThrow();
  expect(() => interrupted.end()).toThrow();
  expect(() => new FrameDecoder().decode(Buffer.from([0xff]))).toThrow();
});
