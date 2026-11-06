import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineeringMode, Repo, Run, Runtime } from './contracts';
import { createStore, closeStore } from './store';
import { createRuntime } from './runtime';
import { writeTicket } from './tickets';
import { recipeIdentity } from './autonomy';
import { object } from './rpc';

const liveTest = process.env.OMP_BACKLOG_LIVE_TESTS === '1' ? test : test.skip;

async function git(path: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd: path, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`Disposable Git setup failed: ${stderr}`);
  return stdout.trim();
}

for (const engineeringMode of ['standard', 'pstack'] as const) {
  for (const autonomous of [false, true]) {
    liveTest(`native ${engineeringMode} completes ${autonomous ? 'host verification, restricted review and publication' : 'human-reviewed implementation'}`, async () => {
      await liveWorkflow(engineeringMode, autonomous);
    }, 280000);
  }
}

liveTest('native standard without pstack extensions completes directly', async () => {
  await liveWorkflow('standard', false, true);
}, 280000);

async function liveWorkflow(engineeringMode: EngineeringMode, autonomous: boolean, withoutPstack = false) {
  const root = await mkdtemp(join(tmpdir(), `omp-engineering-${engineeringMode}-live-`));
  const path = join(root, 'project');
  const recipe = join(path, '.omp', 'skills', 'verify-synthetic');
  await mkdir(recipe, { recursive: true, mode: 0o700 });
  await writeFile(join(recipe, 'SKILL.md'), '---\nname: verify-synthetic\ndescription: Verify the disposable greeting CLI.\n---\nRun `bun greeting.ts` and `bun greeting.ts Ada` independently. Expect exactly `Hello, world!` and `Hello, Ada!`, exiting 0. No installation, network, commits or other setup.\n');
  await writeFile(join(path, 'greeting.ts'), 'console.log(`Hello, ${process.argv[2] ?? "wrong"}!`);\n');
  await writeFile(join(path, 'verify.ts'), 'for (const [args, expected] of [[[], "Hello, world!\\n"], [["Ada"], "Hello, Ada!\\n"]] as const) { const child = Bun.spawn([process.execPath, "greeting.ts", ...args], {stdout:"pipe", stderr:"pipe", env:{...process.env,BUN_BE_BUN:"1"}}); const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (out !== expected || err !== "" || code !== 0) throw new Error("Greeting output failed"); } console.log("Both greeting entry points passed");\n');
  const store = createStore(join(root, 'private'));
  let executable = 'omp';
  if (withoutPstack) {
    executable = join(root, 'omp-without-extensions');
    await writeFile(executable, '#!/bin/sh\nexec omp --no-extensions "$@"\n', { mode: 0o700 });
  }
  store.setSettings({ ...store.settings(), engineeringMode, roots: [root], executable, model: process.env.OMP_BACKLOG_LIVE_MODEL || 'openai-codex/gpt-6.1-sol', thinking: 'low', tokenBudget: 600000, timeLimitMinutes: 4, paused: false });
  let repo: Repo = { id: 'synthetic', name: 'Disposable live workflow', path, git: autonomous, mode: 'approved', lastStarted: 0 };
  let initialHead: string | undefined;
  if (autonomous) {
    await git(path, 'init', '-b', 'main');
    await git(path, 'config', 'user.name', 'Disposable Native Smoke');
    await git(path, 'config', 'user.email', 'smoke@example.invalid');
    await git(path, 'add', 'greeting.ts', 'verify.ts', '.omp/skills/verify-synthetic/SKILL.md');
    await git(path, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Disposable smoke baseline');
    initialHead = await git(path, 'rev-parse', 'HEAD');
    const verification = { argv: [process.execPath, 'verify.ts'], files: ['verify.ts'], timeoutSeconds: 30 };
    repo = { ...repo, completion: { mode: 'autonomous', revision: 'smoke-policy', updated: Date.now(), verification, recipeHash: await recipeIdentity(repo, verification), reviewerModel: store.settings().model, maxCorrections: 1, maxRecoveries: 1 } };
  }
  store.save('repos', repo);
  const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Fix default CLI greeting\ndepends_on: []\n---\n\nFix greeting.ts so omitting a name greets world, not wrong. Preserve explicit-name behavior. Edit only greeting.ts. Read project-local verify-synthetic recipe. No installation, commits, PRs, external actions, docs or unrelated files.\n\nDone when:\n- Running bun greeting.ts prints exactly Hello, world! and exits 0.\n- Running bun greeting.ts Ada prints exactly Hello, Ada! and exits 0.\n');
  store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
  let runtime: Runtime | undefined;
  let final: Run | undefined;
  try {
    runtime = await createRuntime(store);
    await runtime.reconcile();
    const deadline = Date.now() + 260000;
    // Native processes and provider RPC use the platform clock, outside fake timers.
    while (Date.now() < deadline) {
      final = store.list('runs')[0];
      if (final && !['running', 'stopping', 'paused'].includes(final.status)) break;
      await Bun.sleep(100);
    }
    expect(final?.status).toBe(autonomous ? 'done' : 'needs_review');
    expect(final?.configuration?.engineeringMode).toBe(engineeringMode);
    expect(final?.pid).toBeNull();
    const tools = final?.conversation?.filter(entry => entry.kind === 'tool' && entry.state === 'complete') ?? [];
    const reads = tools.filter(entry => entry.toolName === 'read').map(entry => {
      try { return String(object(JSON.parse(entry.input ?? '{}')).path ?? ''); } catch { return ''; }
    });
    expect(reads.some(path => path === 'skill://verify-synthetic' || path.includes('.omp/skills/verify-synthetic/SKILL.md'))).toBe(true);
    const routerInvoked = final?.conversation?.some(entry => entry.kind === 'system' && entry.text.includes('OMP recorded native poteto-mode skill-prompt'));
    expect(routerInvoked).toBe(engineeringMode === 'pstack');
    if (engineeringMode === 'pstack') expect(reads).toContain('skill://pstack-pi');
    else expect(reads.some(path => /poteto-mode|pstack-pi/.test(path))).toBe(false);
    for (const criterion of ticket.criteria) expect(final?.verification?.some(receipt => receipt.criterion === criterion && receipt.outcome === 'passed')).toBe(true);
    if (autonomous) {
      expect(final?.lifecycle?.verification.at(-1)?.outcome).toBe('passed');
      expect(final?.lifecycle?.reviews.at(-1)?.verdict).toBe('pass');
      expect(final?.lifecycle?.reviews.at(-1)?.sessionId).not.toBe(final?.sessionId);
      expect(final?.lifecycle?.publication?.state).toBe('complete');
      expect(final?.lifecycle?.publication?.parent).toBe(initialHead!);
      expect(await git(path, 'rev-parse', 'HEAD')).toBe(final!.lifecycle!.publication!.commit!);
      expect(final?.progress?.tokens?.total).toBe(final!.lifecycle!.authorTokens + (final!.lifecycle!.reviewerTokens ?? 0));
    } else expect(final?.lifecycle).toBeUndefined();
    const check = Bun.spawn([process.execPath, 'verify.ts'], { cwd: path, env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL' });
    const [stdout, stderr, code] = await Promise.all([new Response(check.stdout).text(), new Response(check.stderr).text(), check.exited]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toBe('Both greeting entry points passed\n');
  } finally {
    await runtime?.close();
    const recorded = store.list('runs')[0];
    await writeFile(join(root, 'proof.json'), JSON.stringify({ tier: 'live_provider', engineeringMode, autonomous, dataDir: store.dataDir, status: recorded?.status, error: recorded?.error, pid: recorded?.pid, sessionId: recorded?.sessionId, model: recorded?.progress?.model, thinking: recorded?.progress?.thinking, configuration: recorded?.configuration, tokens: recorded?.progress?.tokens, lifecycle: recorded?.lifecycle, receipts: recorded?.verification, routerProvenance: recorded?.conversation?.filter(entry => entry.kind === 'system' && entry.text.includes('native poteto-mode skill-prompt')) }, null, 2), { mode: 0o600 });
    closeStore(store);
    console.log(`Native ${engineeringMode} ${autonomous ? 'autonomous' : 'human'} proof: ${join(root, 'proof.json')}`);
  }
}
