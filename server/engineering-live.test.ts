import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime } from './contracts';
import { createStore, closeStore } from './store';
import { createRuntime } from './runtime';
import { writeTicket } from './tickets';
import { object } from './rpc';

const liveTest = process.env.OMP_BACKLOG_LIVE_TESTS === '1' ? test : test.skip;

liveTest('ordinary live-provider ticket selects the bug-fix playbook, uses project verification and stops for human acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-engineering-live-'));
  const path = join(root, 'project');
  const recipe = join(path, '.omp', 'skills', 'verify-synthetic');
  await mkdir(recipe, { recursive: true, mode: 0o700 });
  await writeFile(join(recipe, 'SKILL.md'), '---\nname: verify-synthetic\ndescription: Verify the disposable greeting CLI.\n---\nRun `bun greeting.ts` and `bun greeting.ts Ada` independently. Expect exactly `Hello, world!` and `Hello, Ada!`, each exiting 0. No installation, network, commits or other setup.\n');
  await writeFile(join(path, 'greeting.ts'), 'console.log(`Hello, ${process.argv[2] ?? "wrong"}!`);\n');
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [root], executable: 'omp', model: process.env.OMP_BACKLOG_LIVE_MODEL || 'openai-codex/gpt-6.1-sol', thinking: 'low', tokenBudget: 600000, timeLimitMinutes: 4, paused: false });
  const repo: Repo = { id: 'synthetic', name: 'Disposable live workflow', path, git: false, mode: 'approved', lastStarted: 0 };
  store.save('repos', repo);
  const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Fix default CLI greeting\ndepends_on: []\n---\n\nFix greeting.ts so omitting the name greets world, not wrong. Preserve explicit-name behavior. Edit only greeting.ts. Read the project-local verify-synthetic recipe. No installation, commits, PRs, external actions, docs or unrelated files.\n\nDone when:\n- Running bun greeting.ts prints exactly Hello, world! and exits 0.\n- Running bun greeting.ts Ada prints exactly Hello, Ada! and exits 0.\n');
  store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
  let runtime: Runtime | undefined;
  let final: Run | undefined;
  try {
    runtime = await createRuntime(store);
    await runtime.reconcile();
    const deadline = Date.now() + 260000;
    // Detached OMP/provider work advances on the platform clock, not Bun's fake clock.
    while (Date.now() < deadline) {
      final = store.list('runs')[0];
      if (final && !['running', 'stopping', 'paused'].includes(final.status)) break;
      await Bun.sleep(100);
    }
    expect(final?.status).toBe('needs_review');
    expect(final?.pid).toBeNull();
    expect(final?.lifecycle).toBeUndefined();
    expect(store.get('tickets', `${repo.id}/${ticket.id}`)?.status).toBe('needs_review');
    const tools = final?.conversation?.filter(entry => entry.kind === 'tool' && entry.state === 'complete') ?? [];
    const reads = tools.filter(entry => entry.toolName === 'read').map(entry => {
      try { return String(object(JSON.parse(entry.input ?? '{}')).path ?? ''); } catch { return ''; }
    });
    expect(reads).toContain('skill://pstack-pi');
    expect(reads).toContain('skill://poteto-mode/playbooks/bug-fix.md');
    expect(reads.some(path => path === 'skill://verify-synthetic' || path.includes('.omp/skills/verify-synthetic/SKILL.md'))).toBe(true);
    expect(final?.conversation?.some(entry => entry.kind === 'system' && entry.text.includes('OMP recorded the native poteto-mode skill-prompt'))).toBe(true);
    for (const criterion of ticket.criteria) expect(final?.verification?.some(receipt => receipt.criterion === criterion && receipt.outcome === 'passed')).toBe(true);
    for (const [args, expected] of [[[], 'Hello, world!\n'], [['Ada'], 'Hello, Ada!\n']] as const) {
      const child = Bun.spawn([process.execPath, 'greeting.ts', ...args], { cwd: path, env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL' });
      try {
        const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(stdout).toBe(expected);
        expect(stderr).toBe('');
        expect(exitCode).toBe(0);
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }
    }
  } finally {
    await runtime?.close();
    const recorded = store.list('runs')[0];
    await writeFile(join(root, 'proof.json'), JSON.stringify({ tier: 'live_provider', dataDir: store.dataDir, status: recorded?.status, error: recorded?.error, pid: recorded?.pid, sessionId: recorded?.sessionId, model: recorded?.progress?.model, receipts: recorded?.verification, routerProvenance: recorded?.conversation?.filter(entry => entry.kind === 'system' && entry.text.startsWith('Pstack initialization')) }, null, 2), { mode: 0o600 });
    closeStore(store);
    console.log(`Live-provider proof retained at ${join(root, 'proof.json')}`);
  }
}, 280000);
