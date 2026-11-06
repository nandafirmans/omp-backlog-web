import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime, WorkspaceIdentity } from './contracts';
import { createApi } from './api';
import { saveCompletionPolicy } from './autonomy-policy';
import { closeStore, createStore, database, digest, token } from './store';
import { commitWorkspace, reviewWorkspace, workspaceOperation } from './workspace-commit';
import { assertWorkspaceIdentity, claimedWorkspaceConflict, inspectWorkspaceIdentity, workspaceConflict } from './workspace-identity';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omp-workspace-identity-'));
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [root], paused: true });
  const register = async (name: string, path = join(root, name)): Promise<Repo> => {
    await mkdir(path, { recursive: true });
    const repo: Repo = { id: name, name, path, git: false, mode: 'paused', lastStarted: 0 };
    store.save('repos', repo);
    return repo;
  };
  const git = async (repo: Repo, ...args: string[]) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const child = Bun.spawn(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', repo.path, ...args], {
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdout: 'pipe', stderr: 'pipe',
    });
    const [output, error] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (await child.exited !== 0) throw new Error(error);
    return output;
  };
  return { root, store, register, git, async close() { closeStore(store); await rm(root, { recursive: true, force: true }); } };
}

function owner(repo: Repo, workspace?: WorkspaceIdentity): Run {
  return { id: 'owner', repoId: repo.id, workspace, ticketId: 'T1', revision: 'r1', status: 'running', started: 1, finished: null, pid: null, sessionId: null, sessionFile: null, snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null };
}

test('canonical identities exclude duplicate, symlink and parent/child registrations without excluding siblings', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    const duplicate = await f.register('duplicate', repo.path);
    await symlink(repo.path, join(f.root, 'alias'));
    const alias = await f.register('alias', join(f.root, 'alias'));
    const child = await f.register('child', join(repo.path, 'child'));
    const sibling = await f.register('project-other');
    const identity = await inspectWorkspaceIdentity(repo);
    expect(await inspectWorkspaceIdentity(duplicate)).toEqual(identity);
    expect(await inspectWorkspaceIdentity(alias)).toEqual(identity);
    const nested = await inspectWorkspaceIdentity(child);
    expect(workspaceConflict(identity, nested)).toBe(true);
    expect(workspaceConflict(nested, identity)).toBe(true);
    expect(workspaceConflict(identity, await inspectWorkspaceIdentity(sibling))).toBe(false);
    expect(workspaceConflict(identity, { ...identity, root: sibling.path })).toBe(true);
    await assertWorkspaceIdentity(alias, identity);
  } finally { await f.close(); }
});

test('Git detection ignores false metadata and excludes linked worktrees through canonical common identity', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    await f.git(repo, 'init', '-q');
    await f.git(repo, 'commit', '--allow-empty', '-qm', 'Disposable baseline');
    const linkedPath = join(f.root, 'linked');
    await f.git(repo, 'worktree', 'add', '-q', '-b', 'fixture-linked', linkedPath);
    const linked = await f.register('linked', linkedPath);
    const identity = await inspectWorkspaceIdentity(repo);
    const other = await inspectWorkspaceIdentity(linked);
    expect(repo.git).toBe(false);
    expect(identity.commonDir).toBe(join(repo.path, '.git'));
    expect(other.root).not.toBe(identity.root);
    expect(other.commonDir).toBe(identity.commonDir);
    expect(other.commonDev).toBe(identity.commonDev);
    expect(other.commonIno).toBe(identity.commonIno);
    expect(workspaceConflict(identity, other)).toBe(true);
    const metadata = await f.register('metadata', identity.commonDir);
    expect(workspaceConflict(other, await inspectWorkspaceIdentity(metadata))).toBe(true);
    const physicalAlias = { ...other, commonDir: join(f.root, 'different-metadata-name') };
    expect(workspaceConflict(identity, physicalAlias)).toBe(true);
    await rename(join(repo.path, '.git'), join(f.root, 'canonical-metadata'));
    await symlink(join(f.root, 'canonical-metadata'), join(repo.path, '.git'));
    const relocated = await inspectWorkspaceIdentity(repo);
    expect(relocated.commonDir).toBe(join(f.root, 'canonical-metadata'));
    expect((await inspectWorkspaceIdentity(linked)).commonDir).toBe(relocated.commonDir);
    expect(workspaceConflict(relocated, await inspectWorkspaceIdentity(linked))).toBe(true);
  } finally { await f.close(); }
});

test('root replacement, symlink retargeting and Git metadata replacement invalidate pinned identity', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    const expected = await inspectWorkspaceIdentity(repo);
    await rename(repo.path, join(f.root, 'original'));
    await mkdir(repo.path);
    await expect(assertWorkspaceIdentity(repo, expected)).rejects.toThrow('Workspace identity');
    const target = await f.register('target');
    const aliasPath = join(f.root, 'alias');
    await symlink(repo.path, aliasPath);
    const alias = { ...repo, id: 'alias', path: aliasPath };
    const aliasIdentity = await inspectWorkspaceIdentity(alias);
    await rm(aliasPath);
    await symlink(target.path, aliasPath);
    await expect(assertWorkspaceIdentity(alias, aliasIdentity)).rejects.toThrow('Workspace identity');
    await f.git(repo, 'init', '-q');
    const gitIdentity = await inspectWorkspaceIdentity(repo);
    await rename(join(repo.path, '.git'), join(f.root, 'old-git'));
    await f.git(repo, 'init', '-q');
    await expect(assertWorkspaceIdentity(repo, gitIdentity)).rejects.toThrow('Workspace identity');
  } finally { await f.close(); }
});

test('missing expected Git, broken hidden Git and inaccessible paths fail closed', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    await expect(inspectWorkspaceIdentity({ ...repo, git: true })).rejects.toThrow('Workspace identity');
    await writeFile(join(repo.path, '.git'), `gitdir: ${join(f.root, 'missing-git')}\n`);
    await expect(inspectWorkspaceIdentity(repo)).rejects.toThrow('Workspace identity');
    const child = await f.register('child', join(repo.path, 'child'));
    await expect(inspectWorkspaceIdentity(child)).rejects.toThrow('Workspace identity');
    await expect(inspectWorkspaceIdentity({ ...repo, path: join(f.root, 'missing') })).rejects.toThrow('Workspace identity');
  } finally { await f.close(); }
});

test('Git environment overrides cannot redirect inspection, and unavailable Git fails closed', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    await f.git(repo, 'init', '-q');
    const foreign = await f.register('foreign');
    await f.git(foreign, 'init', '-q');
    const source = `import { inspectWorkspaceIdentity } from ${JSON.stringify(join(import.meta.dir, 'workspace-identity.ts'))};
      try { console.log(JSON.stringify(await inspectWorkspaceIdentity(${JSON.stringify({ ...repo, git: true })}))); }
      catch { console.log('blocked'); }`;
    const redirected = Bun.spawn([process.execPath, '-e', source], { env: { ...process.env, GIT_DIR: join(foreign.path, '.git'), GIT_WORK_TREE: foreign.path, GIT_COMMON_DIR: join(foreign.path, '.git'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' }, stdout: 'pipe', stderr: 'pipe' });
    const inspected = await new Response(redirected.stdout).text();
    expect(await redirected.exited).toBe(0);
    expect(JSON.parse(inspected).commonDir).toBe(join(repo.path, '.git'));
    const unavailable = Bun.spawn([process.execPath, '-e', source], { env: { ...process.env, PATH: join(f.root, 'missing-binaries') }, stdout: 'pipe', stderr: 'pipe' });
    expect((await new Response(unavailable.stdout).text()).trim()).toBe('blocked');
    expect(await unavailable.exited).toBe(0);
  } finally { await f.close(); }
});

test('durable running, stopping and paused owners block aliases; unknown legacy identities block every workspace', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    const duplicate = await f.register('duplicate', repo.path);
    const independent = await f.register('independent');
    const identity = await inspectWorkspaceIdentity(repo);
    const other = await inspectWorkspaceIdentity(independent);
    for (const status of ['running', 'stopping', 'paused'] as const) {
      f.store.save('runs', { ...owner(duplicate, identity), status });
      expect(claimedWorkspaceConflict(f.store, repo, identity)).toBe(true);
      expect(claimedWorkspaceConflict(f.store, independent, other)).toBe(false);
      expect(claimedWorkspaceConflict(f.store, repo, identity, 'owner')).toBe(false);
      f.store.save('runs', { ...owner(duplicate), status });
      expect(claimedWorkspaceConflict(f.store, independent, other)).toBe(true);
      expect(claimedWorkspaceConflict(f.store, independent, other, 'owner')).toBe(false);
    }
    f.store.save('runs', owner(duplicate, { ...identity, commonDir: join(repo.path, '.git') }));
    expect(claimedWorkspaceConflict(f.store, independent, other)).toBe(true);
    for (const status of ['done', 'failed', 'interrupted', 'blocked', 'needs_review'] as const) {
      f.store.save('runs', { ...owner(duplicate), status });
      expect(claimedWorkspaceConflict(f.store, repo, identity)).toBe(false);
    }
  } finally { await f.close(); }
});

test('operation locks reject aliases and nested registrations in both directions, allowing independent work and own publication', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    const duplicate = await f.register('duplicate', repo.path);
    const child = await f.register('child', join(repo.path, 'child'));
    const independent = await f.register('independent');
    for (const [first, second] of [[repo, duplicate], [repo, child], [child, repo]]) {
      await workspaceOperation(f.store, first.id, async () => {
        await expect(workspaceOperation(f.store, second.id, async () => undefined)).rejects.toThrow('workspace operation');
        expect(await workspaceOperation(f.store, independent.id, async () => 'independent')).toBe('independent');
      });
    }
    f.store.save('runs', owner(repo, await inspectWorkspaceIdentity(repo)));
    expect(await workspaceOperation(f.store, repo.id, async identity => {
      expect(claimedWorkspaceConflict(f.store, repo, identity, 'owner')).toBe(false);
      return 'own publication';
    })).toBe('own publication');
    await expect(workspaceOperation(f.store, repo.id, async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
    expect(await workspaceOperation(f.store, duplicate.id, async () => 'released')).toBe('released');
  } finally { await f.close(); }
});

test('simultaneous alias admissions cannot both enter their async critical sections', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    await symlink(repo.path, join(f.root, 'alias'));
    const alias = await f.register('alias', join(f.root, 'alias'));
    let entered = 0;
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const { promise: entering, resolve: started } = Promise.withResolvers<void>();
    const operation = async () => { entered++; started(); await gate; };
    const attempts = [workspaceOperation(f.store, repo.id, operation), workspaceOperation(f.store, alias.id, operation)];
    const pending = Promise.allSettled(attempts);
    await entering;
    const firstSettled = await Promise.race(attempts.map(attempt => attempt.then(() => 'entered', () => 'excluded')));
    release();
    expect(firstSettled).toBe('excluded');
    const results = await pending;
    expect(entered).toBe(1);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  } finally { await f.close(); }
});

test('linked Git worktrees share operation exclusion even when registrations say non-Git', async () => {
  const f = await fixture();
  try {
    const repo = await f.register('project');
    await f.git(repo, 'init', '-q');
    await f.git(repo, 'commit', '--allow-empty', '-qm', 'Disposable baseline');
    await f.git(repo, 'worktree', 'add', '-q', '-b', 'fixture-linked', join(f.root, 'linked'));
    const linked = await f.register('linked');
    await workspaceOperation(f.store, repo.id, async () => {
      await expect(workspaceOperation(f.store, linked.id, async () => undefined)).rejects.toThrow('workspace operation');
    });
  } finally { await f.close(); }
});

test('operator review, commit, recheck and autonomous grants reject durable alias owners while revocation stays available', async () => {
  const f = await fixture();
  try {
    const plain = await f.register('project');
    await f.git(plain, 'init', '-q');
    const repo: Repo = { ...plain, git: true, handoff: { id: 'gate', runId: null, files: [], reason: 'Disposable gate', detected: 1 } };
    f.store.save('repos', repo);
    const duplicate = await f.register('duplicate', repo.path);
    f.store.save('runs', { ...owner(duplicate, await inspectWorkspaceIdentity(duplicate)), status: 'paused' });
    await expect(reviewWorkspace(f.store, repo, 'gate')).rejects.toThrow('Stop or finish owned work');
    await expect(commitWorkspace(f.store, repo, { handoffId: 'gate' })).rejects.toThrow('Stop or finish owned work');
    const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(f.store, runtime);
    const cookie = token(); const csrf = token();
    database(f.store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
    const origin = 'http://localhost:4310';
    const response = await api(new Request(`${origin}/api/repos/${repo.id}/reconcile-workspace`, { method: 'POST', headers: { Origin: origin, Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ handoffId: 'gate' }) }));
    expect(response.status).toBe(409);
    expect(f.store.get('repos', repo.id)?.handoff?.id).toBe('gate');
    const ungated = { ...repo, handoff: undefined };
    f.store.save('repos', ungated);
    await expect(saveCompletionPolicy(f.store, ungated, { revision: null, mode: 'autonomous', confirm: true })).rejects.toThrow('Stop or finish owned work');
    expect((await saveCompletionPolicy(f.store, ungated, { revision: null, mode: 'human' })).completion?.mode).toBe('human');
  } finally { await f.close(); }
});

test('operator commit rejects a replaced workspace even when selected contents are identical', async () => {
  const f = await fixture();
  try {
    const plain = await f.register('project');
    await f.git(plain, 'init', '-q');
    const repo: Repo = { ...plain, git: true, handoff: { id: 'gate', runId: null, files: [], reason: 'Disposable gate', detected: 1 } };
    f.store.save('repos', repo);
    await writeFile(join(repo.path, 'work.txt'), 'reviewed content\n');
    const review = await reviewWorkspace(f.store, repo, 'gate');
    await rename(repo.path, join(f.root, 'original'));
    await mkdir(repo.path);
    await f.git(repo, 'init', '-q');
    await writeFile(join(repo.path, 'work.txt'), 'reviewed content\n');
    await expect(commitWorkspace(f.store, repo, { handoffId: 'gate', reviewId: review.id, files: ['work.txt'], message: 'Disposable commit', confirm: true })).rejects.toThrow('Workspace identity');
    expect(await f.git(repo, 'ls-files')).toBe('');
    expect(await f.git({ ...repo, path: join(f.root, 'original') }, 'ls-files')).toBe('');
  } finally { await f.close(); }
});
