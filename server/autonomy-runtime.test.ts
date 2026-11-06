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
async function fixture(scenario: string, run: (h: Harness) => Promise<void>, options: { engineeringMode?: 'standard' | 'pstack'; mode?: Repo['mode']; human?: boolean; holdAuthor?: boolean; holdReview?: boolean; slowVerification?: boolean; inheritReviewer?: boolean; dependent?: boolean; authorBarrier?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omp-autonomous-protocol-'));
  const store = createStore(join(root, 'private'));
  const path = join(root, 'project'); await mkdir(path);
  const config = join(root, 'fixture.json');
  await writeFile(config, JSON.stringify({ scenario, holdAuthor: options.holdAuthor, holdReview: options.holdReview, authorBarrier: options.authorBarrier }));
  const executable = join(root, 'protocol-child');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(join(import.meta.dir, 'fixtures/autonomy-child.ts'))} --fixture-config ${quote(config)} "$@"\n`, { mode: 0o700 });
  store.setSettings({ ...store.settings(), engineeringMode: options.engineeringMode ?? 'pstack', executable, roots: [root], paused: false, model: 'fixture/author', thinking: 'medium', tokenBudget: 10000, timeLimitMinutes: 5 });
  let repo: Repo = { id: 'project', name: 'Synthetic autonomous project', path, git: true, mode: options.mode ?? 'automatic', lastStarted: 0 };
  store.save('repos', repo);
  await writeFile(join(path, 'proof.txt'), scenario === 'noop' ? 'verified\n' : 'pending\n');
  await writeFile(join(path, 'verify.ts'), `import { readFile } from 'node:fs/promises';\n${options.slowVerification ? 'await Bun.sleep(60000);\n' : ''}if (await readFile('proof.txt','utf8') !== 'verified\\n') process.exit(1); console.log('host proof verified');\n`);
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
interface ProtocolEvent { event: string; pid: number; sessionId: string; reviewer: boolean; resumed?: boolean; command?: string; op?: string; message?: string; objective?: string; tools?: string[]; id?: string; rejected?: boolean }
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
    expectNativeAuthorLifecycle(await protocolEvents(h), 2);
  });
}, 30000);

test('corrections are bounded and unresolved findings require assistance without publication', async () => {
  await fixture('always-findings', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('failed'); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.corrections).toBe(2); expect(run.lifecycle?.reviews).toHaveLength(3); expect(run.lifecycle?.publication).toBeUndefined(); });
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
