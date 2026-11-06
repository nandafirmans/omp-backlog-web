import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime } from './contracts';
import { closeStore, createStore } from './store';
import { createRuntime } from './runtime';
import { writeTicket } from './tickets';

const liveTest = process.env.OMP_BACKLOG_LIVE_TESTS === '1' ? test : test.skip;

liveTest('two native OMP pstack sessions overlap and retain repository-specific provider evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-concurrency-live-'));
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [root], executable: 'omp', maxConcurrentTickets: 2, model: process.env.OMP_BACKLOG_LIVE_MODEL || 'openai-codex/gpt-6.1-sol', thinking: 'low', tokenBudget: 600000, timeLimitMinutes: 4, paused: true });
  const projects: { repo: Repo; marker: string }[] = [];
  let runtime: Runtime | undefined;
  let overlap: { id: string; pid: number | null; sessionId: string | null; sessionFile: string | null }[] | undefined;
  let overlapObservedAt: number | undefined;
  try {
    for (const id of ['alpha', 'beta']) {
      const path = join(root, id);
      await mkdir(path);
      const marker = `isolated-${id}-${crypto.randomUUID()}`;
      await writeFile(join(path, 'marker.txt'), `${marker}\n`);
      const repo: Repo = { id, name: `Disposable ${id}`, path, git: false, mode: 'approved', lastStarted: 0 };
      store.save('repos', repo);
      const ticket = await writeTicket(store, repo, `---\nid: T001\ntitle: Explain this repository marker\ndepends_on: []\n---\n\nRead-only investigation. Read marker.txt in this repository and report its exact value as acceptance evidence. Do not modify any files. No installation, credentials, network tools, commits, PRs, docs or external actions. Native OMP provider inference is authorized only for this bounded investigation. Verify by reading marker.txt through a real file tool. Do not inspect sibling repositories.\n\nDone when:\n- The evidence reports exactly ${marker} from this repository's marker.txt.\n`);
      store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
      projects.push({ repo, marker });
    }
    runtime = await createRuntime(store);
    store.setSettings({ ...store.settings(), paused: false });
    await runtime.reconcile();
    const deadline = Date.now() + 260000;
    while (Date.now() < deadline) {
      const runs = store.list('runs');
      const live = runs.filter(run => run.status === 'running' && run.pid !== null && run.sessionId !== null);
      if (!overlap && live.length === 2) {
        for (const run of live) process.kill(run.pid!, 0);
        overlap = live.map(({ id, pid, sessionId, sessionFile }) => ({ id, pid, sessionId, sessionFile }));
        overlapObservedAt = Date.now();
      }
      if (runs.length === 2 && runs.every(run => !['running', 'stopping', 'paused'].includes(run.status))) break;
      await Bun.sleep(100);
    }
    const runs = store.list('runs');
    expect(overlap).toHaveLength(2);
    expect(new Set(overlap!.map(run => run.pid)).size).toBe(2);
    expect(new Set(overlap!.map(run => run.sessionId)).size).toBe(2);
    expect(new Set(overlap!.map(run => run.sessionFile)).size).toBe(2);
    expect(runs).toHaveLength(2);
    for (const { repo, marker } of projects) {
      const run = runs.find(run => run.repoId === repo.id)!;
      expect(run.status).toBe('needs_review');
      expect(run.pid).toBeNull();
      expect(run.lifecycle).toBeUndefined();
      expect(run.evidence.join('\n')).toContain(marker);
      expect(run.verification?.some(receipt => receipt.runId === run.id && receipt.revision === run.revision && receipt.outcome === 'passed' && receipt.details.includes(marker))).toBe(true);
      const other = projects.find(project => project.repo.id !== repo.id)!;
      expect(run.evidence.join('\n')).not.toContain(other.marker);
      expect(run.conversation?.some(entry => entry.kind === 'system' && entry.text.includes('OMP recorded the native poteto-mode skill-prompt'))).toBe(true);
      expect(await readFile(join(repo.path, 'marker.txt'), 'utf8')).toBe(`${marker}\n`);
    }
  } finally {
    await runtime?.close();
    const runs: Run[] = store.list('runs');
    await writeFile(join(root, 'proof.json'), JSON.stringify({ tier: 'live_provider_concurrent_native_sessions', overlapObservedAt, overlap, runs: runs.map(run => ({ id: run.id, repoId: run.repoId, status: run.status, error: run.error, pid: run.pid, started: run.started, finished: run.finished, sessionId: run.sessionId, sessionFile: run.sessionFile, model: run.progress?.model, evidence: run.evidence, receipts: run.verification, routerProvenance: run.conversation?.filter(entry => entry.kind === 'system' && entry.text.startsWith('Pstack initialization')) })) }, null, 2), { mode: 0o600 });
    closeStore(store);
    console.log(`Concurrent native/provider proof retained at ${join(root, 'proof.json')}`);
  }
}, 280000);
