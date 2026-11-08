import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Repo, Run, Runtime, Store } from './contracts';
import { createStore, closeStore, subscribe } from './store';
import { assertAutonomyAuthority, createRuntime, safeIncompleteVerificationRecovery } from './runtime';
import { recipeIdentity } from './autonomy';
import { parseIndependentReview } from './autonomy-review';
import { writeTicket } from './tickets';

async function git(path: string, ...args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd: path, stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(await new Response(child.stderr).text());
  return output.trim();
}
async function until<T>(observe: () => T | undefined | false | Promise<T | undefined | false>, timeout = 18000): Promise<T> {
  // Detached native children and fs.watch use the platform clock; fake timers cannot drive their progress.
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await observe(); if (result !== undefined && result !== false) return result; await Bun.sleep(20); }
  throw new Error('Autonomous protocol fixture timed out');
}
interface Harness { root: string; store: Store; repo: Repo; config: string; runtime: Runtime | null; start(): Promise<void> }
async function fixture(scenario: string, run: (h: Harness) => Promise<void>, options: { engineeringMode?: 'standard' | 'pstack'; mode?: Repo['mode']; human?: boolean; holdAuthor?: boolean; holdReview?: boolean; slowVerification?: boolean; probeBarrier?: boolean; inheritReviewer?: boolean; dependent?: boolean; authorBarrier?: boolean; recoveryBarrier?: boolean; repairTokens?: number; tokenBudget?: number; timeLimitMinutes?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omp-autonomous-protocol-'));
  const store = createStore(join(root, 'private'));
  const path = join(root, 'project'); await mkdir(path);
  const config = join(root, 'fixture.json');
  await writeFile(config, JSON.stringify({ scenario, holdAuthor: options.holdAuthor, holdReview: options.holdReview, authorBarrier: options.authorBarrier, recoveryBarrier: options.recoveryBarrier, repairTokens: options.repairTokens }));
  const executable = join(root, 'protocol-child');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(join(import.meta.dir, 'fixtures/autonomy-child.ts'))} --fixture-config ${quote(config)} "$@"\n`, { mode: 0o700 });
  store.setSettings({ ...store.settings(), engineeringMode: options.engineeringMode ?? 'pstack', executable, roots: [root], paused: false, model: 'fixture/author', thinking: 'medium', tokenBudget: options.tokenBudget ?? 10000, timeLimitMinutes: options.timeLimitMinutes ?? 5 });
  let repo: Repo = { id: 'project', name: 'Synthetic autonomous project', path, git: true, mode: options.mode ?? 'automatic', lastStarted: 0 };
  store.save('repos', repo);
  await writeFile(join(path, 'proof.txt'), scenario === 'noop' ? 'verified\n' : 'pending\n');
  await writeFile(join(path, 'verify.ts'), `import assert from 'node:assert/strict';\nimport { readFile, writeFile } from 'node:fs/promises';\nimport { existsSync } from 'node:fs';\n${options.probeBarrier ? `await writeFile(${JSON.stringify(join(root, 'probe-started'))}, 'started'); while (!existsSync(${JSON.stringify(join(root, 'probe-release'))})) await Bun.sleep(20);\n` : ''}${options.slowVerification ? 'await Bun.sleep(60000);\n' : ''}assert.equal((await readFile('proof.txt','utf8')).trim(), 'verified', 'proof.txt implementation must contain verified'); console.log('host proof verified');\n`);
  await git(path, 'init', '-b', 'main'); await git(path, 'config', 'user.name', 'Protocol Fixture'); await git(path, 'config', 'user.email', 'fixture@example.invalid');
  await git(path, 'add', 'proof.txt', 'verify.ts'); await git(path, 'commit', '-m', 'Synthetic baseline');
  const recipe = { argv: ['/usr/bin/env', 'BUN_BE_BUN=1', process.execPath, 'verify.ts'], files: ['verify.ts'], timeoutSeconds: 90 };
  if (!options.human) {
    repo = { ...repo, completion: { mode: 'autonomous', revision: 'policy-1', updated: Date.now(), verification: recipe, recipeHash: await recipeIdentity(repo, recipe), reviewerModel: options.inheritReviewer ? '' : 'fixture/reviewer', maxCorrections: 2, maxRecoveries: 1 } };
    store.save('repos', repo);
  }
  const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Disposable proof\ndepends_on: []\n---\n\nImplement the disposable proof only.\n\nDone when:\n- proof.txt contains verified.\n');
  store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
  if (options.dependent) {
    const dependent = await writeTicket(store, repo, '---\nid: T002\ntitle: Dependent disposable proof\ndepends_on: [T001]\n---\n\nCheck the prerequisite is actually Done.\n\nDone when:\n- proof.txt contains verified.\n');
    store.save('tickets', { ...dependent, status: 'ready', approvedRevision: dependent.revision });
  }
  const harness: Harness = { root, store, repo, config, runtime: null, async start() { this.runtime = await createRuntime(store); await this.runtime.reconcile(); } };
  try { await run(harness); }
  finally {
    await harness.runtime?.close(); closeStore(store);
    const unlock = async (directory: string) => { await chmod(directory, 0o700); for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) await unlock(join(directory, entry.name)); };
    await unlock(root); await rm(root, { recursive: true, force: true });
  }
}
const terminal = (h: Harness) => until(() => h.store.list('runs').find(run => ['done', 'failed', 'blocked', 'needs_review', 'interrupted'].includes(run.status)));
interface ProtocolEvent { event: string; pid: number; sessionId: string; reviewer: boolean; resumed?: boolean; command?: string; op?: string; message?: string; objective?: string; tools?: string[]; id?: string; rejected?: boolean; args?: string[]; turn?: number; proof?: string; tokens?: number }
async function protocolEvents(h: Harness): Promise<ProtocolEvent[]> {
  return (await readFile(`${h.config}.events`, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as ProtocolEvent);
}
function expectNativeAuthorLifecycle(events: ProtocolEvent[], attempts: number) {
  const authors = events.filter(event => !event.reviewer);
  const prompts = authors.filter(event => event.event === 'prompt');
  expect(prompts.map(event => event.message?.startsWith('/skill:poteto-mode\n'))).toEqual(Array.from({ length: attempts }, (_, index) => index === 0));
  expect(authors.filter(event => event.command === 'get_available_commands')).toHaveLength(attempts);
  expect(authors.filter(event => event.command === 'get_messages')).toHaveLength(2);
  expect(authors.filter(event => event.event === 'native-skill-record')).toHaveLength(1);
  expect(authors.filter(event => event.command === 'goal' && event.op === 'create')).toHaveLength(1);
  expect(authors.find(event => event.command === 'goal' && event.op === 'create')?.objective?.startsWith('/skill:')).toBe(false);
  for (const spawn of authors.filter(event => event.event === 'spawn')) {
    const commands = authors.filter(event => event.pid === spawn.pid && event.event === 'command');
    expect(commands.findIndex(event => event.command === 'get_available_commands')).toBeLessThan(commands.findIndex(event => event.command === 'set_host_tools'));
    if (spawn.resumed) expect(commands.some(event => event.command === 'get_messages')).toBe(false);
  }
  const reviewers = events.filter(event => event.reviewer);
  expect(reviewers.some(event => ['get_available_commands', 'get_messages', 'goal'].includes(String(event.command)) || event.message?.startsWith('/skill:'))).toBe(false);
  for (const registration of reviewers.filter(event => event.command === 'set_host_tools')) expect(registration.tools).toEqual(['candidate_diff', 'candidate_source', 'backlog_review']);
}

test('autonomous author report alone never accepts; host recipe, independent session and local publication complete Done', async () => {
  await fixture('pass', async h => {
    const before = await git(h.repo.path, 'rev-parse', 'HEAD'); await h.start(); const run = await terminal(h);
    expect(run.status).toBe('done'); expect(run.lifecycle?.phase).toBe('complete'); expect(run.pid).toBeNull();
    expect(run.lifecycle?.verification[0]?.source).toBe('host_execution'); expect(run.lifecycle?.verification[0]?.outcome).toBe('passed');
    expect(run.lifecycle?.reviews[0]?.sessionId).not.toBe(run.lifecycle?.authorSessionId);
    expect(run.lifecycle?.publication?.parent).toBe(before); expect(await git(h.repo.path, 'status', '--porcelain', '--', 'proof.txt')).toBe('');
    expect(run.lifecycle?.authorTokens).toBe(11); expect(run.lifecycle?.reviewerTokens).toBe(7);
    const events = await protocolEvents(h);
    expectNativeAuthorLifecycle(events, 1);
    expect(events.filter(event => event.event === 'prompt' && event.reviewer)).toHaveLength(1);
  });
}, 30000);

test('a different OMP major stops author admission before provider work or publication', async () => {
  await fixture('unsupported-major', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(['blocked', 'failed']).toContain(run.status);
    expect(run.sessionId).toBeNull();
    expect(run.pid).toBeNull();
    expect(run.lifecycle?.verification).toEqual([]);
    expect(run.lifecycle?.reviews).toEqual([]);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('pending\n');
    await expect(readFile(`${h.config}.events`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, { engineeringMode: 'standard' });
}, 30000);

for (const scenario of ['reviewer-startup-tools', 'reviewer-startup-goal', 'reviewer-missing-tools', 'reviewer-extra-tools']) test(`${scenario} blocks reviewer inference and publication`, async () => {
  await fixture(scenario, async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(['blocked', 'failed']).toContain(run.status);
    expect(run.lifecycle?.verification.at(-1)?.outcome).toBe('passed');
    expect(run.lifecycle?.reviews).toEqual([]);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect((await protocolEvents(h)).filter(event => event.reviewer && event.event === 'prompt')).toEqual([]);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect(run.pid).toBeNull();
  }, { engineeringMode: 'standard' });
}, 30000);

for (const engineeringMode of ['standard', 'pstack'] as const) test(`${engineeringMode} repairs eligible blocked engineering in its original session before one verified local commit`, async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('done');
    expect(run.configuration?.engineeringMode).toBe(engineeringMode);
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.corrections).toBe(0);
    expect(run.lifecycle?.authorTokens).toBe(22);
    expect(run.lifecycle?.reviewerTokens).toBe(7);
    expect(run.progress?.tokens?.total).toBe(29);
    expect(run.progress?.tokenBudget).toBe(10000);
    expect(run.progress?.deadline).toBe(run.started + 5 * 60000);
    const history = run.lifecycle?.recoveryHistory;
    expect(history).toHaveLength(1);
    expect(history![0]).toMatchObject({ runId: run.id, ticketId: run.ticketId, revision: run.revision, engineeringMode, source: 'author_blocked', category: 'engineering_failure', state: 'recovered', allowance: 'recoveries', ordinal: 1, tokensBefore: 11 });
    expect(history![0]!.tokensAfter).toBeGreaterThanOrEqual(22);
    expect(history![0]!.diagnostic).toContain('AssertionError');
    expect(history![0]!.fingerprint).not.toBe('');
    expect(history![0]!.diagnosticFingerprint).not.toBe('');
    expect(history![0]!.originalDetails?.attempted).not.toBe('');
    expect(history![0]!.originalDetails?.verification).not.toBe('');
    expect(history![0]!.originalDetails?.permission).toBeUndefined();
    expect(history![0]!.originalBlocker).not.toBeNull();
    expect(history![0]!.hostVerificationId).toBe(run.lifecycle?.verification.at(-1)?.id);
    expect(history![0]!.reviewSessionId).toBe(run.lifecycle?.reviews.at(-1)?.sessionId);
    expect(history![0]!.finished).toBeGreaterThanOrEqual(history![0]!.started!);
    expect(run.lifecycle?.verification.at(-1)).toMatchObject({ source: 'host_execution', outcome: 'passed', exitCode: 0 });
    expect(run.lifecycle?.reviews.at(-1)).toMatchObject({ verdict: 'pass', candidateTree: run.lifecycle?.candidate?.tree });
    expect(run.lifecycle?.reviews.at(-1)?.sessionId).not.toBe(run.sessionId);
    expect(run.lifecycle?.publication).toMatchObject({ state: 'complete', parent });
    expect(await git(h.repo.path, 'rev-list', '--count', `${parent}..HEAD`)).toBe('1');
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('verified\n');
    const events = await protocolEvents(h);
    expect(events.filter(event => event.event === 'proof-written').map(event => event.proof)).toEqual(['broken\n', 'verified\n']);
    const authors = events.filter(event => event.event === 'spawn' && !event.reviewer);
    expect(authors).toHaveLength(2);
    expect(authors[1]).toMatchObject({ resumed: true, sessionId: authors[0]!.sessionId });
    expect(authors[1]!.args).toContain(run.sessionFile!);
    if (engineeringMode === 'pstack') expectNativeAuthorLifecycle(events, 2);
    else expect(events.some(event => event.event === 'native-skill-record' || ['get_available_commands', 'get_messages'].includes(String(event.command)))).toBe(false);
  }, { engineeringMode });
}, 30000);

test('failed original host recipe diagnoses broken implementation then verifies repaired evidence and fresh review', async () => {
  await fixture('engineering-host-failure', async h => {
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('done');
    expect(run.lifecycle?.corrections).toBe(1);
    expect(run.lifecycle?.recoveries).toBe(0);
    expect(run.lifecycle?.verification.map(receipt => receipt.outcome)).toEqual(['failed', 'passed']);
    expect(run.lifecycle?.verification[0]?.output).toContain('AssertionError');
    expect(run.lifecycle?.verification[0]?.candidateTree).not.toBe(run.lifecycle?.candidate?.tree);
    expect(run.lifecycle?.verification.at(-1)?.candidateTree).toBe(run.lifecycle?.candidate?.tree);
    expect(run.verification).toHaveLength(1);
    expect(run.verification?.[0]?.outcome).toBe('passed');
    expect(run.lifecycle?.reviews).toHaveLength(1);
    expect(run.lifecycle?.reviews[0]?.candidateTree).toBe(run.lifecycle?.candidate?.tree);
    expect(run.lifecycle?.recoveryHistory).toHaveLength(1);
    const recovery = run.lifecycle!.recoveryHistory![0]!;
    expect(recovery).toMatchObject({ source: 'host_verification', category: 'engineering_failure', allowance: 'corrections', ordinal: 1, state: 'recovered' });
    expect(recovery.candidateTree).toBe(run.lifecycle?.verification[0]?.candidateTree);
    expect(recovery.originalVerification).toHaveLength(1);
    expect(recovery.originalVerification[0]?.id).not.toBe(run.verification?.[0]?.id);
    expect(recovery.hostVerificationId).toBe(run.lifecycle?.verification.at(-1)?.id);
    expect(recovery.reviewSessionId).toBe(run.lifecycle?.reviews.at(-1)?.sessionId);
    expectNativeAuthorLifecycle(await protocolEvents(h), 2);
  });
}, 30000);

for (const scenario of ['engineering-credentials', 'engineering-installation', 'engineering-requirements', 'engineering-spoofed', 'engineering-artifact-credentials', 'engineering-artifact-installation', 'engineering-artifact-unsafe', 'engineering-no-work', 'engineering-no-verification']) test(`${scenario} cannot turn a category claim into recovery authority`, async () => {
  await fixture(scenario, async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('blocked');
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.recoveries).toBe(0);
    expect(run.lifecycle?.corrections).toBe(0);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(run.lifecycle?.reviews).toEqual([]);
    expect(run.lifecycle?.recoveryHistory).toHaveLength(1);
    expect(run.lifecycle?.recoveryHistory?.[0]).toMatchObject({ source: 'author_blocked', state: 'needs_assistance' });
    expect(run.lifecycle?.recoveryHistory?.[0]?.started).toBeUndefined();
    expect(run.lifecycle?.recoveryHistory?.[0]?.originalDetails?.attempted).not.toBe('');
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    const events = await protocolEvents(h);
    expect(events.filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
    expect(events.some(event => event.reviewer)).toBe(false);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(1);
  });
}, 30000);

for (const scenario of ['engineering-repeated', 'engineering-cosmetic']) test(`${scenario} stops ineffective repairs without spending a second author cycle`, async () => {
  await fixture(scenario, async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.status).not.toBe('done');
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.corrections).toBe(0);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(2);
  });
}, 30000);

for (const limit of ['tokens', 'deadline'] as const) test(`engineering recovery preserves a tight ${limit} limit instead of resetting it`, async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.status).not.toBe('done');
    expect(run.lifecycle?.recoveries).toBe(0);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(run.progress?.tokenBudget).toBe(limit === 'tokens' ? 6000 : 10000);
    expect(run.progress?.deadline).toBe(run.started + (limit === 'deadline' ? 2 : 5) * 60000);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
  }, limit === 'tokens' ? { tokenBudget: 6000 } : { timeLimitMinutes: 2 });
}, 30000);

test('author repair cannot consume the independent reviewer reserve', async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.status).not.toBe('done');
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.authorTokens).toBe(7000);
    expect(run.progress?.tokenBudget).toBe(10000);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect((await protocolEvents(h)).some(event => event.reviewer)).toBe(false);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
  }, { repairTokens: 7000 });
}, 30000);

const recoveryBarrier = (h: Harness) => until(() => h.store.list('runs').find(run => run.status === 'running' && run.dialog?.id === 'recovery-barrier' && run.pid !== null));

test('pause retains final observed author usage and attempt consumption after cancellation', async () => {
  await fixture('engineering-stop-accounting', async h => {
    await h.start();
    const held = await recoveryBarrier(h);
    await writeFile(`${h.config}.usage`, '999');
    await h.runtime!.control(held.id, 'pause');
    const paused = h.store.get('runs', held.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.lifecycle?.authorTokens).toBe(999);
    expect(paused.progress?.tokens?.total).toBe(999);
    expect(paused.lifecycle?.recoveryHistory?.[0]?.tokensAfter).toBe(999);
    expect(paused.lifecycle?.publication).toBeUndefined();
    expect((await protocolEvents(h)).filter(event => event.event === 'usage').at(-1)?.tokens).toBe(999);
  }, { recoveryBarrier: true });
}, 30000);

test('pausing independent recovery review retains its final usage within the original aggregate limit', async () => {
  await fixture('engineering-reviewer-stop-accounting', async h => {
    await h.start();
    await until(() => h.store.list('runs').find(run => run.lifecycle?.phase === 'reviewing' && run.pid !== null));
    await until(async () => (await protocolEvents(h)).find(event => event.reviewer && event.event === 'prompt'));
    const held = h.store.list('runs')[0]!;
    expect(held.lifecycle?.phase).toBe('reviewing');
    await writeFile(`${h.config}.usage`, '999');
    await h.runtime!.control(held.id, 'pause');
    const paused = h.store.get('runs', held.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.lifecycle?.authorTokens).toBe(22);
    expect(paused.lifecycle?.reviewerTokens).toBe(999);
    expect(paused.progress?.tokens?.total).toBe(1021);
    expect(paused.lifecycle?.recoveryHistory?.[0]?.tokensAfter).toBe(1021);
    expect(paused.progress?.tokenBudget).toBe(10000);
    expect(paused.lifecycle?.publication).toBeUndefined();
  }, { holdReview: true });
}, 30000);

for (const engineeringMode of ['standard', 'pstack'] as const) test(`${engineeringMode} pause and resume retain the authorized recovery without spending it twice`, async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const held = await recoveryBarrier(h);
    const history = held.lifecycle!.recoveryHistory![0]!;
    expect(history).toMatchObject({ state: 'dispatched', allowance: 'recoveries', ordinal: 1 });
    expect(history.originalDetails?.attempted).not.toBe('');
    expect(history.originalDetails?.verification).not.toBe('');
    const original = { sessionId: held.sessionId, sessionFile: held.sessionFile, deadline: held.progress!.deadline, tokenBudget: held.progress!.tokenBudget };
    expect(held.lifecycle?.recoveries).toBe(1);
    expect(held.lifecycle?.verification.at(-1)?.outcome).toBe('failed');
    expect(held.lifecycle?.candidate).toBeUndefined();
    expect(held.verification ?? []).toEqual([]);
    await h.runtime!.control(held.id, 'pause');
    const paused = h.store.get('runs', held.id)!;
    expect(paused).toMatchObject({ status: 'paused', pid: null, sessionId: original.sessionId, sessionFile: original.sessionFile });
    expect(paused.lifecycle?.recoveries).toBe(1);
    expect(paused.lifecycle?.recoveryHistory?.[0]).toMatchObject({ id: history.id, state: 'paused', instructions: history.instructions, ordinal: 1 });
    const resuming = h.runtime!.control(held.id, 'resume');
    try {
      const resumed = await recoveryBarrier(h);
      expect(resumed.lifecycle?.recoveryHistory?.[0]).toMatchObject({ id: history.id, state: 'dispatched', instructions: history.instructions, ordinal: 1 });
      expect(resumed.sessionId).toBe(original.sessionId);
      expect(resumed.sessionFile).toBe(original.sessionFile);
      expect(resumed.progress?.deadline).toBe(original.deadline);
      expect(resumed.progress?.tokenBudget).toBe(original.tokenBudget);
      expect(resumed.configuration?.engineeringMode).toBe(engineeringMode);
      expect(resumed.lifecycle?.recoveries).toBe(1);
      await h.runtime!.answer(resumed.id, { id: 'recovery-barrier', value: 'release' });
      await resuming;
      const run = await terminal(h);
      expect(run.status).toBe('done');
      expect(run.lifecycle?.recoveries).toBe(1);
      expect(run.lifecycle?.authorTokens).toBe(22);
      expect(run.lifecycle?.reviewerTokens).toBe(7);
      expect(await git(h.repo.path, 'rev-list', '--count', `${parent}..HEAD`)).toBe('1');
      const events = await protocolEvents(h);
      expect(new Set(events.filter(event => event.event === 'spawn' && !event.reviewer).map(event => event.sessionId)).size).toBe(1);
      expect(events.filter(event => event.event === 'native-skill-record')).toHaveLength(engineeringMode === 'pstack' ? 1 : 0);
    } finally {
      await h.runtime!.close();
      await resuming;
    }
  }, { engineeringMode, recoveryBarrier: true });
}, 30000);

test('restart retains uncertain recovery and workspace claim without replaying author mutation', async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const held = await recoveryBarrier(h);
    const history = held.lifecycle!.recoveryHistory![0]!;
    const dispatchedSnapshot = structuredClone(held);
    await h.runtime!.close();
    h.runtime = null;
    h.store.save('runs', dispatchedSnapshot);
    await h.start();
    const run = h.store.get('runs', held.id)!;
    expect(run.status).toBe('interrupted');
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.recoveryHistory?.[0]).toMatchObject({ id: history.id, state: 'needs_assistance', ordinal: 1, instructions: history.instructions, fingerprint: history.fingerprint });
    expect(run.sessionId).toBe(held.sessionId);
    expect(run.sessionFile).toBe(held.sessionFile);
    expect(run.workspace).toEqual(held.workspace);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(h.store.list('runs')).toHaveLength(1);
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(2);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('broken\n');
  }, { recoveryBarrier: true });
}, 30000);

test('paused blocker verification cannot resume as a completed-author host phase or replay uncertain checks', async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const probing = await until(async () => {
      if (!await Bun.file(join(h.root, 'probe-started')).exists()) return;
      return h.store.list('runs').find(run => run.lifecycle?.phase === 'verifying' && run.pid !== null);
    });
    await h.runtime!.control(probing.id, 'pause');
    const paused = h.store.get('runs', probing.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.lifecycle?.recoveries).toBe(0);
    await writeFile(join(h.root, 'probe-release'), 'release');
    await expect(h.runtime!.control(probing.id, 'resume')).rejects.toBeInstanceOf(Error);
    const stopped = h.store.get('runs', probing.id)!;
    expect(stopped.status).toBe('paused');
    expect(stopped.pid).toBeNull();
    expect(stopped.lifecycle?.corrections).toBe(0);
    expect(stopped.lifecycle?.recoveries).toBe(0);
    expect(stopped.lifecycle?.publication).toBeUndefined();
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
  }, { probeBarrier: true });
}, 30000);

for (const authority of ['policy', 'revision'] as const) test(`revoked ${authority} stops an admitted recovery before publication`, async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const held = await recoveryBarrier(h);
    if (authority === 'policy') h.store.save('repos', { ...h.store.get('repos', h.repo.id)!, completion: { mode: 'human', revision: 'revoked-policy', updated: Date.now() } });
    else {
      const ticket = h.store.get('tickets', `${h.repo.id}/T001`)!;
      await writeTicket(h.store, h.repo, ticket.markdown.replace('Implement the disposable proof only.', 'Changed requirements during recovery.'), ticket.revision, ticket.id);
    }
    await h.runtime!.reconcile();
    const run = await terminal(h);
    expect(run.pid).toBeNull();
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(run.lifecycle?.reviews).toEqual([]);
    expect(() => process.kill(held.pid!, 0)).toThrow();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
  }, { recoveryBarrier: true });
}, 30000);

test('pausing new starts leaves admitted recovery authorized with its original limits', async () => {
  await fixture('engineering-blocked', async h => {
    await h.start();
    const held = await recoveryBarrier(h);
    h.store.setSettings({ ...h.store.settings(), paused: true, tokenBudget: 20000, timeLimitMinutes: 10, engineeringMode: 'standard' });
    h.store.save('repos', { ...h.store.get('repos', h.repo.id)!, mode: 'paused' });
    await h.runtime!.reconcile();
    expect(h.store.get('runs', held.id)?.status).toBe('running');
    await h.runtime!.answer(held.id, { id: 'recovery-barrier', value: 'release' });
    const run = await terminal(h);
    expect(run.status).toBe('done');
    expect(run.configuration?.engineeringMode).toBe('pstack');
    expect(run.progress?.tokenBudget).toBe(10000);
    expect(run.progress?.deadline).toBe(held.progress?.deadline);
    expect(run.lifecycle?.recoveries).toBe(1);
    expectNativeAuthorLifecycle(await protocolEvents(h), 2);
  }, { recoveryBarrier: true });
}, 30000);

test('duplicate blocked submissions authorize only one original-session repair', async () => {
  await fixture('engineering-duplicate', async h => {
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('done');
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.recoveryHistory).toHaveLength(1);
    expect(run.lifecycle?.recoveryHistory?.[0]?.state).toBe('recovered');
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(2);
  });
}, 30000);

test('engineering repair and incomplete verification share the original recovery allowance', async () => {
  await fixture('engineering-chain', async h => {
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('blocked');
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.recoveries).toBe(1);
    expect(run.lifecycle?.corrections).toBe(0);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(2);
  });
}, 30000);

test('host failures and independent review findings share the aggregate correction bound', async () => {
  await fixture('engineering-host-review-bound', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('failed');
    expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.lifecycle?.corrections).toBe(2);
    expect(run.lifecycle?.recoveries).toBe(0);
    expect(run.lifecycle?.verification.map(receipt => receipt.outcome)).toEqual(['failed', 'passed', 'passed']);
    expect(run.lifecycle?.reviews.map(review => review.verdict)).toEqual(['changes_required', 'changes_required']);
    expect(new Set(run.lifecycle?.reviews.map(review => review.sessionId)).size).toBe(2);
    expect(run.lifecycle?.authorTokens).toBe(33);
    expect(run.lifecycle?.reviewerTokens).toBe(14);
    expect(run.progress?.tokens?.total).toBe(47);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expectNativeAuthorLifecycle(await protocolEvents(h), 3);
  });
}, 30000);

test('human completion policy never grants engineering recovery authority', async () => {
  await fixture('engineering-blocked', async h => {
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('blocked');
    expect(run.lifecycle).toBeUndefined();
    expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
  }, { human: true });
}, 30000);

test('paused repair retains its repository claim while an independent repository repairs and publishes', async () => {
  await fixture('engineering-blocked', async h => {
    const secondPath = join(h.root, 'independent');
    await mkdir(secondPath);
    await writeFile(join(secondPath, 'proof.txt'), 'pending\n');
    await writeFile(join(secondPath, 'verify.ts'), await readFile(join(h.repo.path, 'verify.ts')));
    await git(secondPath, 'init', '-b', 'main');
    await git(secondPath, 'config', 'user.name', 'Protocol Fixture');
    await git(secondPath, 'config', 'user.email', 'fixture@example.invalid');
    await git(secondPath, 'add', 'proof.txt', 'verify.ts');
    await git(secondPath, 'commit', '-m', 'Independent baseline');
    const second: Repo = { ...structuredClone(h.repo), id: 'independent', name: 'Independent repair', path: secondPath, lastStarted: 0 };
    if (second.completion?.mode === 'autonomous') second.completion.recipeHash = await recipeIdentity(second, second.completion.verification);
    h.store.save('repos', second);
    const ticket = await writeTicket(h.store, second, '---\nid: T001\ntitle: Independent repair\ndepends_on: []\n---\n\nImplement disposable proof.\n\nDone when:\n- proof.txt contains verified.\n');
    h.store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision, execution: { engineeringMode: 'standard' } });
    h.store.setSettings({ ...h.store.settings(), maxConcurrentTickets: 2 });
    const parent = await git(h.repo.path, 'rev-parse', 'HEAD');
    const peerParent = await git(secondPath, 'rev-parse', 'HEAD');
    await h.start();
    const initial = await until(() => {
      const runs = h.store.list('runs');
      return runs.length === 2 && runs.every(run => run.dialog?.id === 'author-barrier') ? runs : undefined;
    });
    const owner = initial.find(run => run.repoId === h.repo.id)!;
    const peer = initial.find(run => run.repoId === second.id)!;
    await h.runtime!.answer(owner.id, { id: 'author-barrier', value: 'release' });
    const held = await until(() => {
      const run = h.store.get('runs', owner.id)!;
      return run.dialog?.id === 'recovery-barrier' ? run : undefined;
    });
    await h.runtime!.control(owner.id, 'pause');
    const waiting = await writeTicket(h.store, h.repo, '---\nid: T002\ntitle: Same repository waits\ndepends_on: []\n---\n\nImplement another disposable proof.\n\nDone when:\n- proof.txt contains verified.\n');
    h.store.save('tickets', { ...waiting, status: 'ready', approvedRevision: waiting.revision });
    await h.runtime!.answer(peer.id, { id: 'author-barrier', value: 'release' });
    await until(() => h.store.get('runs', peer.id)?.dialog?.id === 'recovery-barrier');
    await h.runtime!.answer(peer.id, { id: 'recovery-barrier', value: 'release' });
    const completed = await until(() => {
      const run = h.store.get('runs', peer.id)!;
      return run.status === 'done' ? run : undefined;
    });
    const paused = h.store.get('runs', owner.id)!;
    expect(paused).toMatchObject({ status: 'paused', pid: null, sessionId: held.sessionId, sessionFile: held.sessionFile, workspace: held.workspace });
    expect(paused.lifecycle?.recoveries).toBe(1);
    expect(paused.lifecycle?.recoveryHistory?.[0]?.state).toBe('paused');
    expect(paused.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(parent);
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('broken\n');
    expect(completed.lifecycle?.recoveries).toBe(1);
    expect(completed.lifecycle?.publication).toMatchObject({ parent: peerParent, state: 'complete' });
    expect(completed.lifecycle?.verification.every(receipt => receipt.recipeHash === completed.lifecycle?.recipeHash)).toBe(true);
    expect(completed.lifecycle?.reviews[0]?.sessionId).not.toBe(held.sessionId);
    expect(await git(secondPath, 'rev-list', '--count', `${peerParent}..HEAD`)).toBe('1');
    expect(await readFile(join(secondPath, 'proof.txt'), 'utf8')).toBe('verified\n');
    expect(h.store.list('runs')).toHaveLength(2);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(2);
    expect(h.store.get('runs', owner.id)?.status).toBe('paused');
    expect(h.store.get('tickets', `${h.repo.id}/T002`)?.runId).toBeNull();
  }, { authorBarrier: true, recoveryBarrier: true });
}, 30000);

test('two independent autonomous owners verify and publish only their own candidates', async () => {
  await fixture('pass', async h => {
    const secondPath = join(h.root, 'second');
    await mkdir(secondPath);
    await writeFile(join(secondPath, 'proof.txt'), 'pending\n');
    await writeFile(join(secondPath, 'repository-marker.txt'), 'second-repository-only\n');
    await writeFile(join(secondPath, 'verify.ts'), `import { readFile } from 'node:fs/promises';\nif (await readFile('proof.txt', 'utf8') !== 'verified\\n' || await readFile('repository-marker.txt', 'utf8') !== 'second-repository-only\\n') process.exit(1); console.log('second repository proof verified');\n`);
    await git(secondPath, 'init', '-b', 'main');
    await git(secondPath, 'config', 'user.name', 'Protocol Fixture');
    await git(secondPath, 'config', 'user.email', 'fixture@example.invalid');
    await git(secondPath, 'add', 'proof.txt', 'verify.ts', 'repository-marker.txt');
    await git(secondPath, 'commit', '-m', 'Second synthetic baseline');
    const second: Repo = { ...structuredClone(h.repo), id: 'second', name: 'Second disposable project', path: secondPath };
    if (second.completion?.mode !== 'autonomous') throw new Error('Second fixture requires autonomous completion');
    second.completion.recipeHash = await recipeIdentity(second, second.completion.verification);
    h.store.save('repos', second);
    const ticket = await writeTicket(h.store, second, '---\nid: T001\ntitle: Second disposable proof\ndepends_on: []\n---\n\nImplement proof.txt in this repository only, preserving repository-marker.txt.\n\nDone when:\n- proof.txt contains verified and repository-marker.txt retains second-repository-only.\n');
    h.store.save('tickets', { ...ticket, execution: { engineeringMode: 'standard' }, status: 'ready', approvedRevision: ticket.revision });
    h.store.setSettings({ ...h.store.settings(), maxConcurrentTickets: 2 });
    const parents = new Map(await Promise.all([h.repo, second].map(async repo => [repo.id, await git(repo.path, 'rev-parse', 'HEAD')] as const)));
    await h.start();
    const held = await until(() => {
      const runs = h.store.list('runs');
      return runs.length === 2 && runs.every(run => run.status === 'running' && run.dialog?.id === 'author-barrier') ? runs : undefined;
    });
    expect(new Set(held.map(run => run.pid)).size).toBe(2);
    expect(new Set(held.map(run => run.sessionId)).size).toBe(2);
    expect(new Set(held.map(run => run.sessionFile)).size).toBe(2);
    for (const run of held) {
      expect(run.pid).toBeNumber();
      process.kill(run.pid!, 0);
      expect(run.lifecycle?.verification).toEqual([]);
      expect(run.lifecycle?.publication).toBeUndefined();
    }
    await Promise.all(held.map(run => h.runtime!.answer(run.id, { id: 'author-barrier', value: 'release' })));
    const completed = await until(() => {
      const runs = h.store.list('runs');
      return runs.length === 2 && runs.every(run => run.status === 'done' && run.pid === null) ? runs : undefined;
    });
    const allSessions = completed.flatMap(run => [run.lifecycle!.authorSessionId!, ...run.lifecycle!.reviews.map(review => review.sessionId)]);
    expect(new Set(allSessions).size).toBe(4);
    expect(new Set(completed.map(run => run.lifecycle!.candidate!.tree)).size).toBe(2);
    for (const run of completed) {
      const repo = run.repoId === h.repo.id ? h.repo : second;
      const lifecycle = run.lifecycle!;
      expect(lifecycle.phase).toBe('complete');
      expect(lifecycle.verification).toHaveLength(1);
      expect(lifecycle.verification[0]).toMatchObject({ source: 'host_execution', outcome: 'passed', exitCode: 0, candidateTree: lifecycle.candidate!.tree, recipeHash: lifecycle.recipeHash });
      expect(lifecycle.verification[0]!.output.trim()).toBe(repo.id === second.id ? 'second repository proof verified' : 'host proof verified');
      expect(lifecycle.reviews).toHaveLength(1);
      expect(lifecycle.reviews[0]).toMatchObject({ verdict: 'pass', candidateTree: lifecycle.candidate!.tree });
      expect(lifecycle.publication).toMatchObject({ state: 'complete', parent: parents.get(repo.id), tree: lifecycle.candidate!.tree });
      expect(await git(repo.path, 'rev-parse', 'HEAD')).toBe(lifecycle.publication!.commit!);
      expect(await git(repo.path, 'rev-list', '--count', `${parents.get(repo.id)}..HEAD`)).toBe('1');
      expect(await readFile(join(repo.path, 'proof.txt'), 'utf8')).toBe('verified\n');
      if (repo.id === second.id) {
        expect(await readFile(join(repo.path, 'repository-marker.txt'), 'utf8')).toBe('second-repository-only\n');
        expect(await git(repo.path, 'show', 'HEAD:repository-marker.txt')).toBe('second-repository-only');
      }
      expect(await git(repo.path, 'status', '--porcelain', '--', 'proof.txt', 'verify.ts')).toBe('');
      expect(run.verification?.every(receipt => receipt.runId === run.id && receipt.revision === run.revision)).toBe(true);
      expect(run.verification?.map(receipt => receipt.criterion)).toEqual([repo.id === second.id ? 'proof.txt contains verified and repository-marker.txt retains second-repository-only.' : 'proof.txt contains verified.']);
      expect(run.configuration?.engineeringMode).toBe(repo.id === second.id ? 'standard' : 'pstack');
      expect(run.conversation?.some(entry => entry.text.includes('OMP recorded native poteto-mode skill-prompt'))).toBe(repo.id !== second.id);
    }
    await h.runtime!.close();
    h.runtime = await createRuntime(h.store);
    await h.runtime.reconcile();
    expect(h.store.list('runs')).toHaveLength(2);
    for (const run of completed) {
      const repo = run.repoId === h.repo.id ? h.repo : second;
      expect(await git(repo.path, 'rev-parse', 'HEAD')).toBe(run.lifecycle!.publication!.commit!);
    }
  }, { authorBarrier: true });
}, 30000);

test('standard preserves mode and cumulative author/reviewer usage through autonomous correction and recovery', async () => {
  for (const scenario of ['pass', 'findings', 'recovery', 'disabled-plugin']) {
    await fixture(scenario, async h => {
      await h.start();
      const run = await terminal(h);
      expect(run.status).toBe('done');
      expect(run.pid).toBeNull();
      expect(run.configuration?.engineeringMode).toBe('standard');
      expect(run.lifecycle?.verification.at(-1)?.outcome).toBe('passed');
      expect(run.lifecycle?.reviews.at(-1)?.verdict).toBe('pass');
      expect(run.lifecycle?.reviews.every(review => review.sessionId !== run.sessionId)).toBe(true);
      expect(run.lifecycle?.publication?.state).toBe('complete');
      expect(run.progress?.tokens?.total).toBe(run.lifecycle!.authorTokens + (run.lifecycle!.reviewerTokens ?? 0));
      expect(run.lifecycle?.authorTokens).toBe(scenario === 'findings' || scenario === 'recovery' ? 22 : 11);
      expect(run.lifecycle?.corrections).toBe(scenario === 'findings' ? 1 : 0);
      expect(run.lifecycle?.recoveries).toBe(scenario === 'recovery' ? 1 : 0);
      const events = await protocolEvents(h);
      expect(events.some(event => ['get_available_commands', 'get_messages'].includes(String(event.command)) || event.event === 'native-skill-record')).toBe(false);
      expect(events.filter(event => event.event === 'prompt').every(event => !event.message?.startsWith('/skill:'))).toBe(true);
      expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('verified\n');
    }, { engineeringMode: 'standard' });
  }
}, 60000);

test('review findings resume exactly original author session, invalidate reports and count cumulative role tokens', async () => {
  await fixture('findings', async h => {
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('done'); expect(run.lifecycle?.corrections).toBe(1);
    expect(run.lifecycle?.reviews.map(review => review.verdict)).toEqual(['changes_required', 'pass']);
    expect(run.lifecycle?.authorTokens).toBe(22); expect(run.lifecycle?.reviewerTokens).toBe(14);
    const events = (await readFile(`${h.config}.events`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const authors = events.filter(event => event.event === 'spawn' && !event.reviewer);
    expect(authors).toHaveLength(2); expect(authors[0].sessionId).toBe(authors[1].sessionId); expect(authors[1].resumed).toBe(true);
    expect(run.verification).toHaveLength(1);
    expect(run.lifecycle?.verification).toHaveLength(2);
    expect(run.lifecycle?.verification[0]?.candidateTree).toBe(run.lifecycle?.verification[1]?.candidateTree);
    expect(run.lifecycle?.verification[0]?.id).not.toBe(run.lifecycle?.verification[1]?.id);
    expect(run.lifecycle?.reviews[0]?.sessionId).not.toBe(run.lifecycle?.reviews[1]?.sessionId);
    const recovery = run.lifecycle?.recoveryHistory?.[0];
    expect(recovery).toMatchObject({ source: 'reviewer', category: 'review_changes', allowance: 'corrections', state: 'recovered', ordinal: 1 });
    expect(recovery?.originalVerification[0]?.id).not.toBe(run.verification?.[0]?.id);
    expect(recovery?.hostVerificationId).toBe(run.lifecycle?.verification[1]?.id);
    expect(recovery?.reviewSessionId).toBe(run.lifecycle?.reviews[1]?.sessionId);
    expectNativeAuthorLifecycle(await protocolEvents(h), 2);
  });
}, 30000);

test('corrections are bounded and unresolved findings require assistance without publication', async () => {
  await fixture('always-findings', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('failed'); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.corrections).toBe(1); expect(run.lifecycle?.reviews).toHaveLength(2); expect(run.lifecycle?.publication).toBeUndefined(); });
}, 30000);

test('one incomplete-original-verification recovery is scoped, while permission blockers require assistance', async () => {
  await fixture('recovery', async h => {
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('done'); expect(run.lifecycle?.recoveries).toBe(1); expect(run.lifecycle?.authorTokens).toBe(22);
    const events = await protocolEvents(h);
    const authors = events.filter(event => event.event === 'spawn' && !event.reviewer);
    expect(authors).toHaveLength(2); expect(authors[1]?.sessionId).toBe(authors[0]?.sessionId); expect(authors[1]?.resumed).toBe(true);
    expectNativeAuthorLifecycle(events, 2);
  });
  await fixture('blocked', async h => {
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('blocked'); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.recoveries).toBe(0);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(1);
    expect(h.store.get('tickets', `${h.repo.id}/T002`)?.runId).toBeNull();
    expect((await protocolEvents(h)).some(event => event.reviewer)).toBe(false);
  }, { dependent: true });
}, 30000);

test('completion policy is independent of approved start mode and human default remains Needs review', async () => {
  await fixture('pass', async h => { await h.start(); expect((await terminal(h)).status).toBe('done'); }, { mode: 'approved' });
  await fixture('pass', async h => {
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('needs_review'); expect(run.lifecycle).toBeUndefined();
    expectNativeAuthorLifecycle(await protocolEvents(h), 1);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(1);
    expect(h.store.get('tickets', `${h.repo.id}/T002`)?.runId).toBeNull();
  }, { human: true, dependent: true });
}, 30000);

test('blank reviewer choice inherits the actual attempt model in a separate session', async () => {
  await fixture('pass', async h => {
    await h.start();
    const run = await terminal(h);
    expect(run.status).toBe('done');
    expect(run.lifecycle?.policy.reviewerModel).toBe('');
    expect(run.lifecycle?.reviews[0]?.model).toBe('fixture/author');
    expect(run.lifecycle?.reviews[0]?.sessionId).not.toBe(run.lifecycle?.authorSessionId);
  }, { inheritReviewer: true });
}, 30000);

test('pausing new starts does not revoke an admitted autonomous attempt', async () => {
  await fixture('pass', async h => {
    let paused = false;
    const unsubscribe = subscribe(h.store, () => {
      if (paused || !h.store.list('runs').some(run => run.lifecycle?.phase === 'reviewing')) return;
      paused = true;
      h.store.setSettings({ ...h.store.settings(), paused: true });
      h.store.save('repos', { ...h.store.get('repos', h.repo.id)!, mode: 'paused' });
    });
    try {
      await h.start();
      expect((await terminal(h)).status).toBe('done');
      expect(paused).toBe(true);
      expect(h.store.settings().paused).toBe(true);
      expect(h.store.get('repos', h.repo.id)?.mode).toBe('paused');
    } finally { unsubscribe(); }
  });
}, 30000);

test('no-op candidate completes without an empty commit', async () => {
  await fixture('noop', async h => { const before = await git(h.repo.path, 'rev-parse', 'HEAD'); await h.start(); const run = await terminal(h); expect(run.status).toBe('done'); expect(run.lifecycle?.publication?.noChanges).toBe(true); expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(before); });
}, 30000);

test('revoking policy during author or review stops ownership before any publication', async () => {
  for (const phase of ['implementing', 'reviewing'] as const) await fixture('pass', async h => {
    await h.start(); await until(() => h.store.list('runs').find(run => run.lifecycle?.phase === phase && run.pid !== null));
    const current = h.store.get('repos', h.repo.id)!; h.store.save('repos', { ...current, completion: { mode: 'human', revision: 'revoked', updated: Date.now() } });
    await h.runtime!.reconcile(); const run = await terminal(h); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.publication).toBeUndefined(); expect(run.pid).toBeNull();
  }, phase === 'implementing' ? { holdAuthor: true } : { holdReview: true });
}, 30000);

test('candidate drift and recipe drift during independent review fail closed', async () => {
  for (const path of ['proof.txt', 'verify.ts']) await fixture('pass', async h => {
    await h.start(); await until(() => h.store.list('runs').find(run => run.lifecycle?.phase === 'reviewing' && run.pid !== null));
    await writeFile(join(h.repo.path, path), 'external drift\n'); const run = await terminal(h);
    expect(run.status).toBe('failed'); expect(run.lifecycle?.publication).toBeUndefined(); expect(run.lifecycle?.phase).toBe('assistance');
  }, { holdReview: true });
}, 30000);

test('pause aborts host verification and restricted reviewer, retaining claim without late publication', async () => {
  for (const phase of ['verifying', 'reviewing'] as const) await fixture('pass', async h => {
    await h.start(); const run = await until(() => h.store.list('runs').find(value => value.lifecycle?.phase === phase && value.pid !== null && (phase !== 'verifying' || value.progress?.phase === 'Host verification executing')));
    await h.runtime!.control(run.id, 'pause'); const paused = h.store.get('runs', run.id)!;
    expect(paused.status).toBe('paused'); expect(paused.pid).toBeNull(); expect(paused.lifecycle?.publication).toBeUndefined();
    await h.runtime!.reconcile(); expect(h.store.list('runs')).toHaveLength(1);
  }, phase === 'verifying' ? { slowVerification: true } : { holdReview: true });
}, 30000);

test('legacy autonomous resume cannot manufacture missing admitted workspace authority', async () => {
  await fixture('pass', async h => {
    await h.start();
    const run = await until(() => h.store.list('runs').find(value => value.lifecycle?.phase === 'reviewing' && value.pid !== null));
    await h.runtime!.control(run.id, 'pause');
    const paused = h.store.get('runs', run.id)!;
    h.store.save('runs', { ...paused, workspace: undefined });
    const before = await protocolEvents(h);
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    let rejected: boolean | undefined;
    const resuming = h.runtime!.control(run.id, 'resume').then(() => { rejected = false; }, () => { rejected = true; });
    try {
      await until(() => rejected !== undefined || h.store.get('runs', run.id)?.status === 'running');
      expect(rejected).toBe(true);
      const current = h.store.get('runs', run.id)!;
      expect(current.status).toBe('paused');
      expect(current.workspace).toBeUndefined();
      expect(current.pid).toBeNull();
      expect(current.lifecycle?.publication).toBeUndefined();
      expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
      expect((await protocolEvents(h)).filter(event => event.event === 'spawn')).toEqual(before.filter(event => event.event === 'spawn'));
    } finally {
      await h.runtime!.close();
      await resuming;
    }
  }, { holdReview: true });
}, 30000);

for (const action of ['pause', 'cancel'] as const) test(`${action} stops a resumed autonomous reviewer without disturbing another repository`, async () => {
  await fixture('pass', async h => {
    const secondPath = join(h.root, 'second');
    await mkdir(secondPath);
    await writeFile(join(secondPath, 'proof.txt'), 'pending\n');
    await writeFile(join(secondPath, 'verify.ts'), await readFile(join(h.repo.path, 'verify.ts')));
    await git(secondPath, 'init', '-b', 'main');
    await git(secondPath, 'config', 'user.name', 'Protocol Fixture');
    await git(secondPath, 'config', 'user.email', 'fixture@example.invalid');
    await git(secondPath, 'add', 'proof.txt', 'verify.ts');
    await git(secondPath, 'commit', '-m', 'Held peer baseline');
    const second: Repo = { ...structuredClone(h.repo), id: 'second', name: 'Held peer project', path: secondPath };
    h.store.save('repos', second);
    const ticket = await writeTicket(h.store, second, '---\nid: T001\ntitle: Held peer proof\ndepends_on: []\n---\n\nImplement the peer proof only.\n\nDone when:\n- proof.txt contains verified.\n');
    h.store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
    h.store.setSettings({ ...h.store.settings(), maxConcurrentTickets: 2 });
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    const peerHead = await git(second.path, 'rev-parse', 'HEAD');
    await h.start();
    const authors = await until(() => {
      const runs = h.store.list('runs');
      return runs.length === 2 && runs.every(run => run.dialog?.id === 'author-barrier') ? runs : undefined;
    });
    const owner = authors.find(run => run.repoId === h.repo.id)!;
    const peer = authors.find(run => run.repoId === second.id)!;
    await h.runtime!.answer(owner.id, { id: 'author-barrier', value: 'release' });
    const firstReviewer = await until(async () => {
      const events = await protocolEvents(h);
      const prompt = events.find(event => event.reviewer && event.event === 'prompt');
      const run = h.store.get('runs', owner.id)!;
      return prompt && run.lifecycle?.phase === 'reviewing' && run.pid === prompt.pid ? prompt : undefined;
    });
    await h.runtime!.control(owner.id, 'pause');
    expect(h.store.get('runs', owner.id)).toMatchObject({ status: 'paused', pid: null });
    let resumeSettled = false;
    let resumeError: unknown;
    void h.runtime!.control(owner.id, 'resume').catch(error => { resumeError = error; }).finally(() => { resumeSettled = true; });
    try {
      const resumedReviewer = await until(async () => {
        const events = await protocolEvents(h);
        const spawns = events.filter(event => event.reviewer && event.event === 'spawn');
        const prompt = events.find(event => event.reviewer && event.event === 'prompt' && event.sessionId !== firstReviewer.sessionId);
        const run = h.store.get('runs', owner.id)!;
        return spawns.length === 2 && prompt && run.status === 'running' && run.lifecycle?.phase === 'reviewing' && run.pid === prompt.pid ? prompt : undefined;
      });
      expect(resumedReviewer.sessionId).not.toBe(firstReviewer.sessionId);
      expect(resumeSettled).toBe(false);
      await h.runtime!.control(owner.id, action);
      await until(() => resumeSettled);
      expect(resumeError).toBeUndefined();
      expect(h.store.get('runs', owner.id)).toMatchObject({ status: action === 'pause' ? 'paused' : 'interrupted', pid: null });
      expect(() => process.kill(resumedReviewer.pid, 0)).toThrow();
      await h.runtime!.reconcile();
      expect(h.store.get('runs', owner.id)?.lifecycle?.publication).toBeUndefined();
      expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
      expect(h.store.get('tickets', `${h.repo.id}/T001`)?.status).not.toBe('done');
      expect(h.store.get('runs', peer.id)).toMatchObject({ status: 'running', pid: peer.pid, sessionId: peer.sessionId, dialog: { id: 'author-barrier' } });
      process.kill(peer.pid!, 0);
      expect(h.store.get('runs', peer.id)?.lifecycle?.publication).toBeUndefined();
      expect(await git(second.path, 'rev-parse', 'HEAD')).toBe(peerHead);
      expect(await readFile(join(second.path, 'proof.txt'), 'utf8')).toBe('pending\n');
      expect((await protocolEvents(h)).filter(event => event.event === 'spawn' && event.sessionId === peer.sessionId)).toHaveLength(1);
      expect(h.store.list('runs')).toHaveLength(2);
    } finally {
      await h.runtime!.close();
    }
  }, { holdReview: true, authorBarrier: true });
}, 30000);

test('crash reconciliation recognizes the exact published object without duplicate commit or author replay', async () => {
  await fixture('pass', async h => {
    await h.start(); const complete = await terminal(h); expect(complete.status).toBe('done'); await h.runtime!.close(); h.runtime = null;
    const head = await git(h.repo.path, 'rev-parse', 'HEAD'); const lifecycle = structuredClone(complete.lifecycle!); lifecycle.phase = 'publishing'; lifecycle.publication!.state = 'published';
    h.store.save('runs', { ...complete, status: 'running', finished: null, lifecycle });
    const ticket = h.store.list('tickets')[0]!; h.store.save('tickets', { ...ticket, status: 'running', runId: complete.id });
    await h.start(); const recovered = h.store.get('runs', complete.id)!;
    expect(recovered.status).toBe('done'); expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
    const events = (await readFile(`${h.config}.events`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
  });
}, 30000);

test('self-pass, missing criterion evidence, pass findings and stale trees are rejected', async () => {
  await fixture('pass', async h => {
    await h.start(); const run = await terminal(h); const ticket = h.store.list('tickets')[0]!; const valid = { revision: run.revision, sessionId: 'independent', candidateTree: run.lifecycle!.candidate!.tree, verdict: 'pass', findings: [], criteria: ticket.criteria.map(criterion => ({ criterion, evidence: 'Inspected immutable source and host output.' })) };
    expect(() => parseIndependentReview({ ...valid, sessionId: run.lifecycle!.authorSessionId }, run, ticket, run.lifecycle!.authorSessionId!)).toThrow();
    expect(() => parseIndependentReview({ ...valid, criteria: [] }, run, ticket, 'independent')).toThrow();
    expect(() => parseIndependentReview({ ...valid, findings: ['Unresolved'] }, run, ticket, 'independent')).toThrow();
    expect(() => parseIndependentReview({ ...valid, candidateTree: 'wrong' }, run, ticket, 'independent')).toThrow();
    expect(() => parseIndependentReview(valid, { ...run, lifecycle: { ...run.lifecycle!, verification: [] } }, ticket, 'independent')).toThrow();
    expect(safeIncompleteVerificationRecovery({ ...run, lifecycle: { ...run.lifecycle!, recoveries: 1 } }, ticket, { status: 'blocked', recoverableCause: 'incomplete_verification', evidence: valid.criteria })).toBe(false);
    expect(() => assertAutonomyAuthority(h.store, { ...run, status: 'running', revision: 'stale' } as Run)).toThrow();
    expect(() => assertAutonomyAuthority(h.store, { ...run, status: 'running', progress: { ...run.progress!, deadline: Date.now() - 1 } })).toThrow('deadline');
    expect(() => assertAutonomyAuthority(h.store, { ...run, status: 'running', progress: { ...run.progress!, tokenBudget: run.lifecycle!.authorTokens + (run.lifecycle!.reviewerTokens ?? 0) } })).toThrow('token');
  });
}, 30000);

test('interrupted author mutation is never automatically replayed after restart', async () => {
  await fixture('pass', async h => {
    await h.start();
    const running = await until(() => h.store.list('runs').find(run => run.lifecycle?.phase === 'implementing' && run.pid !== null && run.sessionId !== null));
    await until(async () => await readFile(join(h.repo.path, 'proof.txt'), 'utf8') === 'partial');
    await h.runtime!.close(); h.runtime = null;
    expect(h.store.get('runs', running.id)?.status).toBe('interrupted');
    await h.start();
    expect(h.store.list('runs')).toHaveLength(1);
    expect(h.store.get('runs', running.id)?.lifecycle?.phase).toBe('assistance');
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('partial');
    const events = (await readFile(`${h.config}.events`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events.filter(event => event.event === 'spawn' && !event.reviewer)).toHaveLength(1);
  }, { holdAuthor: true });
}, 30000);

test('autonomous missing or disabled pstack and stale native invocation metadata never mutate proof or enter host acceptance', async () => {
  for (const scenario of ['missing-router', 'missing-adapter', 'disabled-plugin', 'missing-invocation']) await fixture(scenario, async h => {
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('failed'); expect(run.pid).toBeNull();
    expect(run.error).toContain(scenario === 'missing-invocation' ? 'native poteto-mode skill-prompt record' : 'Required pstack engineering workflow unavailable');
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('pending\n');
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
    expect(run.verification ?? []).toEqual([]);
    expect(run.lifecycle?.verification).toEqual([]);
    expect(run.lifecycle?.reviews).toEqual([]);
    expect(run.lifecycle?.publication).toBeUndefined();
    const events = await protocolEvents(h);
    expect(events.filter(event => event.command === 'get_available_commands')).toHaveLength(1);
    expect(events.some(event => event.command === 'goal' && ['create', 'resume'].includes(String(event.op)) || event.reviewer)).toBe(false);
    expect(events.filter(event => event.event === 'prompt')).toHaveLength(scenario === 'missing-invocation' ? 1 : 0);
    expect(events.filter(event => event.command === 'get_messages')).toHaveLength(scenario === 'missing-invocation' ? 2 : 0);
    if (scenario !== 'missing-invocation') expect(events.some(event => event.command === 'set_host_tools')).toBe(false);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(1);
  });
}, 30_000);

test('a native-routed malicious author cannot claim Done or self-review past host lifecycle gates', async () => {
  await fixture('author-bypass', async h => {
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start();
    const run = await until(() => h.store.list('runs').find(value => value.dialog?.id === 'bypass-held'));
    const events = await protocolEvents(h);
    expectNativeAuthorLifecycle(events, 1);
    expect(events.filter(event => event.event === 'bypass-result').map(event => ({ id: event.id, rejected: event.rejected }))).toEqual([{ id: 'bypass-done', rejected: true }, { id: 'bypass-review', rejected: true }]);
    expect(run.status).toBe('running'); expect(run.lifecycle?.phase).toBe('implementing');
    expect(run.lifecycle?.verification).toEqual([]); expect(run.lifecycle?.reviews).toEqual([]);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(h.store.get('tickets', `${h.repo.id}/T001`)?.status).toBe('running');
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(join(h.repo.path, 'proof.txt'), 'utf8')).toBe('pending\n');
    await h.runtime!.control(run.id, 'pause');
    expect(h.store.get('runs', run.id)?.status).toBe('paused');
  });
}, 30_000);

test('inconclusive independent review blocks publication and never releases a dependent ticket', async () => {
  await fixture('inconclusive', async h => {
    const head = await git(h.repo.path, 'rev-parse', 'HEAD');
    await h.start(); const run = await terminal(h);
    expect(run.status).toBe('failed'); expect(run.lifecycle?.phase).toBe('assistance');
    expect(run.error).toContain('Independent review inconclusive');
    expect(run.lifecycle?.verification[0]?.outcome).toBe('passed');
    expect(run.lifecycle?.reviews.map(review => review.verdict)).toEqual(['inconclusive']);
    expect(run.lifecycle?.publication).toBeUndefined();
    expect(await git(h.repo.path, 'rev-parse', 'HEAD')).toBe(head);
    await h.runtime!.reconcile();
    expect(h.store.list('runs')).toHaveLength(1);
    expect(h.store.get('tickets', `${h.repo.id}/T002`)?.runId).toBeNull();
    expectNativeAuthorLifecycle(await protocolEvents(h), 1);
  }, { dependent: true });
}, 30_000);

test('dependent execution starts only after prerequisite host verification, independent review and actual Done', async () => {
  await fixture('pass', async h => {
    const premature: string[] = [];
    let observedReviewBeforeDone = false;
    let prerequisiteDoneAtDependentStart = false;
    const unsubscribe = subscribe(h.store, () => {
      const first = h.store.list('runs').find(run => run.ticketId === 'T001');
      const dependent = h.store.list('runs').find(run => run.ticketId === 'T002');
      if (first?.lifecycle?.phase === 'reviewing' && first.status !== 'done') observedReviewBeforeDone = true;
      if (!dependent) return;
      if (first?.status !== 'done' || h.store.get('tickets', `${h.repo.id}/T001`)?.status !== 'done') premature.push(dependent.id);
      else prerequisiteDoneAtDependentStart = true;
    });
    try {
      await h.start();
      const dependent = await until(() => h.store.list('runs').find(run => run.ticketId === 'T002' && run.status === 'done'));
      const first = h.store.list('runs').find(run => run.ticketId === 'T001')!;
      expect(observedReviewBeforeDone).toBe(true);
      expect(prerequisiteDoneAtDependentStart).toBe(true);
      expect(premature).toEqual([]);
      expect(first.status).toBe('done');
      expect(first.lifecycle?.verification[0]?.outcome).toBe('passed');
      expect(first.lifecycle?.reviews[0]?.verdict).toBe('pass');
      expect(first.lifecycle?.publication?.state).toBe('complete');
      expect(first.lifecycle?.authorFiles).toEqual(['proof.txt']);
      expect(dependent.lifecycle?.authorFiles).toEqual([]);
      expect(dependent.lifecycle?.publication?.noChanges).toBe(true);
      expect(dependent.lifecycle?.verification[0]?.outcome).toBe('passed');
      expect(dependent.lifecycle?.reviews[0]?.verdict).toBe('pass');
      expect(dependent.started).toBeGreaterThanOrEqual(first.finished!);
      expect(h.store.list('runs')).toHaveLength(2);
      expect(h.store.list('tickets').every(ticket => ticket.status === 'done')).toBe(true);
    } finally { unsubscribe(); }
  }, { dependent: true });
}, 30_000);
