import { expect, test } from 'bun:test';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repo, Run, Store, VerificationRecipe } from './contracts';
import { closeStore, createStore, digest } from './store';
import { assertCandidate, captureBaseline, captureCandidate, publishCandidate, recipeIdentity, reconcilePublication, verifyCandidate } from './autonomy';
import { assertWorkspaceIdentity, inspectWorkspaceIdentity } from './workspace-identity';

interface Fixture { repo: Repo; store: Store; run: Run; git: (...args: string[]) => Promise<string>; guard: () => void }
async function fixture(work: (context: Fixture) => Promise<void>, command = 'console.log("host checked");') {
  const root = await mkdtemp('/tmp/autonomy-test-');
  const path = join(root, 'repo'); await mkdir(path);
  const store = createStore(join(root, 'private'));
  const git = async (...args: string[]) => {
    const child = Bun.spawn(['git', '-C', path, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    if (await child.exited) throw new Error(stderr);
    return stdout;
  };
  try {
    await git('init', '-q'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(path, 'work.txt'), 'before\n'); await writeFile(join(path, 'check.js'), command);
    await git('add', '.'); await git('commit', '-qm', 'fixture baseline');
    store.setSettings({ ...store.settings(), roots: [path], paused: true });
    const recipe: VerificationRecipe = { argv: [process.execPath, 'check.js'], files: ['check.js'], timeoutSeconds: 2 };
    const repo: Repo = { id: 'fixture', name: 'fixture', path, git: true, mode: 'paused', lastStarted: 0, completion: { mode: 'autonomous', revision: 'policy', updated: Date.now(), verification: recipe, recipeHash: '', reviewerModel: 'reviewer', maxCorrections: 2, maxRecoveries: 1 } };
    if (repo.completion!.mode !== 'autonomous') throw new Error('fixture policy');
    repo.completion!.recipeHash = await recipeIdentity(repo, recipe); store.save('repos', repo);
    const run: Run = { id: 'run', repoId: repo.id, ticketId: 'ticket', revision: 'ticket-revision', status: 'running', started: Date.now(), finished: null, pid: null, sessionId: 'author', sessionFile: null, snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null, lifecycle: { policy: repo.completion!, phase: 'implementing', baseline: await captureBaseline(store, repo), recipeHash: repo.completion!.recipeHash, corrections: 0, recoveries: 0, authorSessionId: 'author', authorTokens: 0, verification: [], reviews: [] } };
    run.workspace = await inspectWorkspaceIdentity(repo);
    store.save('runs', run);
    await work({ repo, store, run, git, guard() { if (store.get('runs', run.id)?.revision !== run.revision) throw new Error('Stale run'); } });
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
}
async function ready(context: Fixture, change = true) {
  const { repo, store, run, guard } = context, life = run.lifecycle!;
  if (change) await writeFile(join(repo.path, 'work.txt'), 'after\n');
  life.authorFiles = change ? ['work.txt'] : [];
  life.candidate = await captureCandidate(store, repo, life.baseline, life.authorFiles);
  life.verification.push(await verifyCandidate(store, repo, run, new AbortController().signal, guard));
  life.reviews.push({ sessionId: 'independent', model: 'reviewer', candidateTree: life.candidate.tree, verdict: 'pass', findings: [], criteria: [{ criterion: 'fixture', evidence: 'read candidate' }], recorded: Date.now() });
  store.save('runs', run);
}

test('actual host receipt and independently reviewed candidate publish exactly once with clean index', async () => {
  await fixture(async context => {
    const { repo, store, run, git, guard } = context;
    await ready(context);
    const receipt = run.lifecycle!.verification[0];
    expect(receipt.outcome).toBe('passed'); expect(receipt.exitCode).toBe(0); expect(receipt.source).toBe('host_execution');
    expect(receipt.output).toContain('host checked'); expect(receipt.outputHash).toBe(digest(receipt.output)); expect(receipt.finished).toBeGreaterThanOrEqual(receipt.started);
    const publication = await publishCandidate(store, repo, run, guard);
    expect(publication.state).toBe('complete'); expect(publication.commit).toBe((await git('rev-parse', 'HEAD')).trim());
    expect(await git('show', 'HEAD:work.txt')).toBe('after\n'); expect(await git('status', '--porcelain')).toBe('');
    expect((await git('rev-list', '--count', 'HEAD')).trim()).toBe('2');
    expect(await reconcilePublication(store, repo, run, guard)).toBe(true);
    expect((await git('rev-list', '--count', 'HEAD')).trim()).toBe('2');
    expect(store.settings().paused).toBe(true);
  });
});

test('verified no-op completes without creating an empty commit', async () => {
  await fixture(async context => {
    await ready(context, false);
    const result = await publishCandidate(context.store, context.repo, context.run, context.guard);
    expect(result.noChanges).toBe(true); expect(result.commit).toBeNull();
    expect((await context.git('rev-list', '--count', 'HEAD')).trim()).toBe('1');
    expect(await reconcilePublication(context.store, context.repo, context.run, context.guard)).toBe(true);
  });
});

test('foreign files, index staging, content drift and hidden index flags are refused without altering them', async () => {
  await fixture(async context => {
    const { store, repo, run, git } = context;
    await writeFile(join(repo.path, 'work.txt'), 'after\n'); await writeFile(join(repo.path, 'foreign.txt'), 'foreign\n');
    await expect(captureCandidate(store, repo, run.lifecycle!.baseline, ['work.txt'])).rejects.toThrow('manifest');
    await rm(join(repo.path, 'foreign.txt'));
    await ready(context);
    await writeFile(join(repo.path, 'work.txt'), 'external\n');
    await expect(assertCandidate(store, repo, run.lifecycle!.candidate!)).rejects.toThrow('drifted');
    await git('add', 'work.txt');
    const staged = await git('show', ':work.txt');
    await expect(publishCandidate(store, repo, run, context.guard)).rejects.toThrow();
    expect(await git('show', ':work.txt')).toBe(staged);
    expect((await git('rev-list', '--count', 'HEAD')).trim()).toBe('1');
    await git('update-index', '--assume-unchanged', 'work.txt');
    await expect(captureBaseline(store, repo)).rejects.toThrow('flags');
  });
});

test('recipe byte changes and revoked policy block host checks and publication', async () => {
  await fixture(async context => {
    const { repo, store, run, guard } = context;
    await ready(context);
    await writeFile(join(repo.path, 'check.js'), 'console.log("weaker")');
    const receipt = await verifyCandidate(store, repo, run, new AbortController().signal, guard);
    expect(receipt.outcome).toBe('blocked'); expect(receipt.exitCode).toBeNull();
    await expect(publishCandidate(store, repo, run, guard)).rejects.toThrow();
    store.save('repos', { ...repo, completion: { mode: 'human', revision: 'revoked', updated: Date.now() } });
    await expect(publishCandidate(store, repo, run, guard)).rejects.toThrow('policy');
  });
});

test('host failures are honest; bounded output explicitly records truncation', async () => {
  await fixture(async context => {
    await ready(context);
    const receipt = context.run.lifecycle!.verification[0];
    expect(receipt.outcome).toBe('failed'); expect(receipt.exitCode).toBe(7); expect(receipt.outputTruncated).toBe(true);
    expect(receipt.output).toContain('not the complete command output'); expect(receipt.output.length).toBeLessThan(64 * 1024);
    await expect(publishCandidate(context.store, context.repo, context.run, context.guard)).rejects.toThrow('host verification');
  }, 'process.stdout.write("x".repeat(100000),()=>process.exit(7))');
});

test('cancelled verifier drains its owned group and cannot publish', async () => {
  await fixture(async context => {
    const { repo, store, run, guard } = context;
    await writeFile(join(repo.path, 'work.txt'), 'after\n');
    run.lifecycle!.authorFiles = ['work.txt']; run.lifecycle!.candidate = await captureCandidate(store, repo, run.lifecycle!.baseline, ['work.txt']);
    const controller = new AbortController();
    const save = store.save.bind(store);
    store.save = (kind, value) => { save(kind, value); if (kind === 'runs' && 'pid' in value && value.pid) controller.abort(); };
    let receipt;
    try { receipt = await verifyCandidate(store, repo, run, controller.signal, guard); }
    finally { store.save = save; }
    expect(receipt.outcome).toBe('blocked'); expect(run.pid).toBeNull(); expect(store.get('runs', run.id)!.pid).toBeNull();
    expect((await context.git('rev-list', '--count', 'HEAD')).trim()).toBe('1');
  }, 'setInterval(() => {}, 1000)');
});

test('generation guard immediately before ref CAS prevents stale completion', async () => {
  await fixture(async context => {
    await ready(context);
    await expect(publishCandidate(context.store, context.repo, context.run, () => { if (context.run.lifecycle!.publication) throw new Error('Stale ticket generation'); })).rejects.toThrow('Stale ticket');
    expect(context.run.lifecycle!.publication!.state).toBe('prepared');
    expect(await reconcilePublication(context.store, context.repo, context.run, context.guard)).toBe(false);
    expect((await context.git('rev-list', '--count', 'HEAD')).trim()).toBe('1');
  });
});

async function interrupted(context: Fixture, stage: 'published' | 'complete') {
  await ready(context);
  const save = context.store.save.bind(context.store);
  context.store.save = (kind, value) => {
    if (kind === 'runs' && 'lifecycle' in value && value.lifecycle?.publication?.state === stage) throw new Error('Simulated backend crash');
    save(kind, value);
  };
  try { await expect(publishCandidate(context.store, context.repo, context.run, context.guard)).rejects.toThrow('Simulated backend crash'); }
  finally { context.store.save = save; }
  context.run = context.store.get('runs', context.run.id)!;
}

for (const stage of ['published', 'complete'] as const) test(`crash at ${stage} is reconciled without duplicate commit`, async () => {
  await fixture(async context => {
    await interrupted(context, stage);
    expect(await reconcilePublication(context.store, context.repo, context.run, context.guard)).toBe(true);
    expect((await context.git('rev-list', '--count', 'HEAD')).trim()).toBe('2'); expect(await context.git('status', '--porcelain')).toBe('');
  });
});

async function withReplacementWorkspace(context: Fixture, work: () => Promise<void>) {
  const original = `${context.repo.path}-admitted`, replacement = `${context.repo.path}-replacement`;
  await cp(context.repo.path, replacement, { recursive: true, preserveTimestamps: true });
  await rename(context.repo.path, original);
  try {
    await rename(replacement, context.repo.path);
    await work();
  } finally {
    await rm(context.repo.path, { recursive: true, force: true });
    await rename(original, context.repo.path);
  }
}

test('publication identity rejects byte-identical root replacement after durable published intent', async () => {
  await fixture(async context => {
    const { repo, store, run } = context;
    await ready(context);
    const save = store.save.bind(store);
    store.save = (kind, value) => {
      save(kind, value);
      if (kind === 'runs' && 'lifecycle' in value && value.lifecycle?.publication?.state === 'published') throw new Error('Crash after durable published intent');
    };
    try { await expect(publishCandidate(store, repo, run, context.guard)).rejects.toThrow('Crash after durable published intent'); }
    finally { store.save = save; }
    context.run = store.get('runs', run.id)!;
    expect(context.run.lifecycle!.publication!.state).toBe('published');
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    const before = await readFile(index), head = await context.git('rev-parse', 'HEAD');
    const work = await readFile(join(repo.path, 'work.txt')), recipe = await readFile(join(repo.path, 'check.js'));
    await withReplacementWorkspace(context, async () => {
      expect((await inspectWorkspaceIdentity(repo)).rootIno).not.toBe(context.run.workspace!.rootIno);
      expect(await readFile(index)).toEqual(before); expect(await context.git('rev-parse', 'HEAD')).toBe(head);
      expect(await readFile(join(repo.path, 'work.txt'))).toEqual(work); expect(await readFile(join(repo.path, 'check.js'))).toEqual(recipe);
      await expect(reconcilePublication(store, repo, context.run, context.guard)).rejects.toThrow('Workspace identity');
      expect(await readFile(index)).toEqual(before); expect(await context.git('rev-parse', 'HEAD')).toBe(head);
      expect(store.get('runs', run.id)!.lifecycle!.publication!.state).toBe('published');
      expect(store.get('runs', run.id)!.status).toBe('running');
      expect(await lstat(`${index}.lock`).catch(() => null)).toBeNull();
    });
    expect(await readFile(index)).toEqual(before);
  });
});

test('publication identity rechecks replacement after caller admission check before publication boundary', async () => {
  await fixture(async context => {
    const { repo, store, run } = context;
    await ready(context);
    await assertWorkspaceIdentity(repo, run.workspace!);
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    const before = await readFile(index), head = await context.git('rev-parse', 'HEAD');
    await withReplacementWorkspace(context, async () => {
      await assertCandidate(store, repo, run.lifecycle!.candidate!);
      await expect(publishCandidate(store, repo, run, context.guard)).rejects.toThrow('Workspace identity');
      expect(await readFile(index)).toEqual(before); expect(await context.git('rev-parse', 'HEAD')).toBe(head);
      expect(store.get('runs', run.id)!.lifecycle!.publication).toBeUndefined();
      expect(await lstat(`${index}.lock`).catch(() => null)).toBeNull();
    });
    expect(await readFile(index)).toEqual(before); expect(await context.git('rev-parse', 'HEAD')).toBe(head);
  });
});

for (const operation of ['publication', 'reconciliation'] as const) test(`publication identity fails closed for missing legacy identity during ${operation}`, async () => {
  await fixture(async context => {
    const { repo, store, run } = context;
    if (operation === 'reconciliation') await interrupted(context, 'published');
    else await ready(context);
    delete context.run.workspace; store.save('runs', context.run);
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    const before = await readFile(index), head = await context.git('rev-parse', 'HEAD');
    const publication = structuredClone(context.run.lifecycle!.publication);
    await expect(operation === 'publication'
      ? publishCandidate(store, repo, context.run, context.guard)
      : reconcilePublication(store, repo, context.run, context.guard)).rejects.toThrow('Workspace identity');
    expect(await readFile(index)).toEqual(before); expect(await context.git('rev-parse', 'HEAD')).toBe(head);
    expect(store.get('runs', run.id)!.lifecycle!.publication).toEqual(publication);
    expect(store.get('runs', run.id)!.status).toBe('running');
    expect(await lstat(`${index}.lock`).catch(() => null)).toBeNull();
  });
});

test('post-publication foreign staging is preserved and prevents reconciliation', async () => {
  await fixture(async context => {
    await interrupted(context, 'published');
    await writeFile(join(context.repo.path, 'unrelated.txt'), 'foreign staged bytes\n'); await context.git('add', 'unrelated.txt');
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    const before = await readFile(index);
    await expect(reconcilePublication(context.store, context.repo, context.run, context.guard)).rejects.toThrow('External index');
    expect(await readFile(index)).toEqual(before); expect(await context.git('show', ':unrelated.txt')).toBe('foreign staged bytes\n');
  });
});

test('publication reconciliation rejects ref movement and unrelated index locks', async () => {
  await fixture(async context => {
    await interrupted(context, 'published');
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    await writeFile(`${index}.lock`, 'external lock');
    await expect(reconcilePublication(context.store, context.repo, context.run, context.guard)).rejects.toThrow();
    expect(await readFile(`${index}.lock`, 'utf8')).toBe('external lock'); await rm(`${index}.lock`);
    await context.git('update-ref', context.run.lifecycle!.baseline.ref, context.run.lifecycle!.baseline.head);
    expect(await reconcilePublication(context.store, context.repo, context.run, context.guard)).toBe(false);
    await context.git('symbolic-ref', 'HEAD', 'refs/heads/other');
    await expect(reconcilePublication(context.store, context.repo, context.run, context.guard)).rejects.toThrow();
  });
});

test('exact durable publisher lock may be recovered after ref CAS', async () => {
  await fixture(async context => {
    await interrupted(context, 'published');
    const { run, repo, store } = context;
    const index = (await context.git('rev-parse', '--path-format=absolute', '--git-path', 'index')).trim();
    const privateIndex = join(store.dataDir, 'recovery-index');
    const command = Bun.spawn(['git', '-C', repo.path, 'read-tree', run.lifecycle!.publication!.tree], { env: { ...process.env, GIT_INDEX_FILE: privateIndex }, stdout: 'ignore', stderr: 'ignore' });
    expect(await command.exited).toBe(0);
    const bytes = await readFile(privateIndex); await writeFile(`${index}.lock`, bytes);
    const identity = await lstat(`${index}.lock`);
    await writeFile(join(store.dataDir, 'runtime', run.id, 'publication-lock.json'), JSON.stringify({ operationId: run.lifecycle!.publication!.operationId, dev: identity.dev, ino: identity.ino, hash: digest(bytes) }));
    expect(await reconcilePublication(store, repo, run, context.guard)).toBe(true);
    expect(await context.git('status', '--porcelain')).toBe(''); expect((await context.git('rev-list', '--count', 'HEAD')).trim()).toBe('2');
  });
});

test('changed recipe is rejected even after the author recaptures an otherwise exact candidate', async () => {
  await fixture(async context => {
    await ready(context);
    const { repo, store, run, guard } = context;
    await writeFile(join(repo.path, 'check.js'), 'process.exit(0)');
    run.lifecycle!.authorFiles = ['check.js', 'work.txt'];
    run.lifecycle!.candidate = await captureCandidate(store, repo, run.lifecycle!.baseline, run.lifecycle!.authorFiles);
    const receipt = await verifyCandidate(store, repo, run, new AbortController().signal, guard);
    expect(receipt.outcome).toBe('blocked'); expect(receipt.exitCode).toBeNull(); expect(receipt.output).toContain('recipe changed');
  });
});

test('Git clean filters are refused before status can execute them', async () => {
  await fixture(async context => {
    const marker = join(context.repo.path, 'filter-executed.txt');
    await context.git('config', 'filter.trap.clean', `touch ${marker}; cat`);
    await writeFile(join(context.repo.path, '.gitattributes'), 'work.txt filter=trap\n');
    await expect(captureCandidate(context.store, context.repo, context.run.lifecycle!.baseline, ['.gitattributes'])).rejects.toThrow('Custom conversions');
    expect(await lstat(marker).catch(() => null)).toBeNull();
  });
});

test('completed command with inherited-pipe descendants is drained without waiting for timeout', async () => {
  await fixture(async context => {
    await ready(context);
    const receipt = context.run.lifecycle!.verification[0];
    expect(receipt.outcome).toBe('passed'); expect(context.run.pid).toBeNull();
    const pid = /descendant=(\d+)/.exec(receipt.output)?.[1]; expect(pid).toBeDefined();
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
    if (stat) expect(['Z', 'X']).toContain(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]);
  }, 'const {spawn}=require("node:child_process"); const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"}); console.log("descendant="+child.pid); child.unref(); process.exit(0)');
});
