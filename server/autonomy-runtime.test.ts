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
async function fixture(scenario: string, run: (h: Harness) => Promise<void>, options: { mode?: Repo['mode']; human?: boolean; holdAuthor?: boolean; holdReview?: boolean; slowVerification?: boolean; inheritReviewer?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omp-autonomous-protocol-'));
  const store = createStore(join(root, 'private'));
  const path = join(root, 'project'); await mkdir(path);
  const config = join(root, 'fixture.json');
  await writeFile(config, JSON.stringify({ scenario, holdAuthor: options.holdAuthor, holdReview: options.holdReview }));
  const executable = join(root, 'protocol-child');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(executable, `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(join(import.meta.dir, 'fixtures/autonomy-child.ts'))} --fixture-config ${quote(config)} "$@"\n`, { mode: 0o700 });
  store.setSettings({ ...store.settings(), executable, roots: [root], paused: false, model: 'fixture/author', thinking: 'medium', tokenBudget: 10000, timeLimitMinutes: 5 });
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
  const harness: Harness = { root, store, repo, config, runtime: null, async start() { this.runtime = await createRuntime(store); await this.runtime.reconcile(); } };
  try { await run(harness); }
  finally {
    await harness.runtime?.close(); closeStore(store);
    const unlock = async (directory: string) => { await chmod(directory, 0o700); for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) await unlock(join(directory, entry.name)); };
    await unlock(root); await rm(root, { recursive: true, force: true });
  }
}
const terminal = (h: Harness) => until(() => h.store.list('runs').find(run => ['done', 'failed', 'blocked', 'needs_review', 'interrupted'].includes(run.status)));

test('autonomous author report alone never accepts; host recipe, independent session and local publication complete Done', async () => {
  await fixture('pass', async h => {
    const before = await git(h.repo.path, 'rev-parse', 'HEAD'); await h.start(); const run = await terminal(h);
    expect(run.status).toBe('done'); expect(run.lifecycle?.phase).toBe('complete'); expect(run.pid).toBeNull();
    expect(run.lifecycle?.verification[0]?.source).toBe('host_execution'); expect(run.lifecycle?.verification[0]?.outcome).toBe('passed');
    expect(run.lifecycle?.reviews[0]?.sessionId).not.toBe(run.lifecycle?.authorSessionId);
    expect(run.lifecycle?.publication?.parent).toBe(before); expect(await git(h.repo.path, 'status', '--porcelain', '--', 'proof.txt')).toBe('');
    expect(run.lifecycle?.authorTokens).toBe(11); expect(run.lifecycle?.reviewerTokens).toBe(7);
  });
}, 30000);

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
  });
}, 30000);

test('corrections are bounded and unresolved findings require assistance without publication', async () => {
  await fixture('always-findings', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('failed'); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.corrections).toBe(2); expect(run.lifecycle?.reviews).toHaveLength(3); expect(run.lifecycle?.publication).toBeUndefined(); });
}, 30000);

test('one incomplete-original-verification recovery is scoped, while permission blockers require assistance', async () => {
  await fixture('recovery', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('done'); expect(run.lifecycle?.recoveries).toBe(1); expect(run.lifecycle?.authorTokens).toBe(22); });
  await fixture('blocked', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('blocked'); expect(run.lifecycle?.phase).toBe('assistance'); expect(run.lifecycle?.recoveries).toBe(0); });
}, 30000);

test('completion policy is independent of approved start mode and human default remains Needs review', async () => {
  await fixture('pass', async h => { await h.start(); expect((await terminal(h)).status).toBe('done'); }, { mode: 'approved' });
  await fixture('pass', async h => { await h.start(); const run = await terminal(h); expect(run.status).toBe('needs_review'); expect(run.lifecycle).toBeUndefined(); }, { human: true });
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
