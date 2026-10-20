import { expect, setSystemTime, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, closeStore, subscribe } from './store';
import { createRuntime } from './runtime';
import { writeTicket } from './tickets';
import type { Repo, Run } from './contracts';

test('paused queue never launches; duplicate wakes launch once; crash recovery never replays', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-queue-test-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [workspace], executable: join(root, 'deliberately-unavailable-omp') });
  const repo: Repo = { id: 'repo', name: 'Disposable', path: workspace, git: false, mode: 'paused', lastStarted: 0 };
  store.save('repos', repo);
  const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Proof\ndepends_on: []\n---\n# Goal\nWrite proof.\n# Requirements\n- Preserve files.\n# Acceptance criteria\n- Proof is verified.\n# Verification\nRead proof.\n');
  store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
  let runtime = await createRuntime(store);
  try {
    await runtime.reconcile(); setSystemTime(Date.now() + 1200); await runtime.reconcile();
    expect(store.list('runs')).toEqual([]);
    store.save('repos', { ...repo, mode: 'approved' });
    const failed = Promise.withResolvers<void>();
    const unsubscribe = subscribe(store, () => {
      if (store.list('runs').some(run => run.status === 'failed')) failed.resolve();
    });
    try {
      await Promise.all(Array.from({ length: 12 }, () => runtime.reconcile()));
      await failed.promise;
    } finally { unsubscribe(); }
    expect(store.list('runs').map(run => run.status)).toEqual(['failed']);
    await Promise.all(Array.from({ length: 12 }, () => runtime.reconcile()));
    expect(store.list('runs')).toHaveLength(1);
    await runtime.close();
    const interrupted: Run = { ...store.list('runs')[0], id: 'interrupted-run', status: 'running', finished: null, pid: null };
    store.save('runs', interrupted);
    store.save('tickets', { ...store.get('tickets', 'repo/T001')!, status: 'running', runId: interrupted.id });
    runtime = await createRuntime(store);
    expect(store.get('runs', interrupted.id)?.status).toBe('interrupted');
    await runtime.reconcile();
    expect(store.list('runs')).toHaveLength(2);
    expect(store.get('tickets', 'repo/T001')?.status).toBe('interrupted');
  } finally {
    setSystemTime();
    await runtime.close(); closeStore(store);
    async function writable(path: string) { await chmod(path, 0o700); for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await writable(join(path, entry.name)); }
    await writable(root); await rm(root, { recursive: true, force: true });
  }
}, 15000);
