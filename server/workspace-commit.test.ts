import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApi } from './api';
import { closeStore, createStore, database } from './store';
import { commitWorkspace, reviewWorkspace, workspaceOperation } from './workspace-commit';
import type { Repo, Run, Runtime, WorkspaceReview } from './contracts';

async function fixture(work: (context: { repo: Repo; store: ReturnType<typeof createStore>; git: (...args: string[]) => Promise<string>; request: (action: string, input: unknown, auth?: boolean, csrf?: boolean) => Promise<Response> }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-commit-test-'));
  const path = join(root, 'repo'); await mkdir(path);
  const store = createStore(join(root, 'private'));
  const git = async (...args: string[]) => {
    const child = Bun.spawn(['git', '-C', path, ...args], { stdout: 'pipe', stderr: 'ignore' });
    const output = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error('Fixture Git command failed');
    return output;
  };
  try {
    await git('init', '--quiet');
    await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    store.setSettings({ ...store.settings(), roots: [path], paused: true });
    const repo: Repo = { id: 'repo', name: 'Fixture', path, git: true, mode: 'paused', lastStarted: 0, handoff: { id: 'gate', files: [], detected: Date.now(), reason: 'Fixture gate', runId: null } };
    store.save('repos', repo);
    const runtime: Runtime = { wake() { throw new Error('Commit/review must not wake execution'); }, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(store, runtime);
    const password = crypto.randomUUID() + crypto.randomUUID();
    database(store).query('INSERT INTO owner VALUES(1,?,?)').run('fixture', await Bun.password.hash(password));
    const origin = 'http://127.0.0.1:4310';
    const login = await api(new Request(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password }) }));
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const { csrf } = await login.json() as { csrf: string };
    const request = (action: string, input: unknown, auth = true, token = true) => api(new Request(`${origin}/api/repos/repo/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}), ...(token ? { 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(input) }));
    await work({ repo, store, git, request });
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); } // Only this test's disposable repository/private data.
}

test('authenticated initial commit uses reviewed selection; handoff, permissions and unselected data survive', async () => {
  await fixture(async ({ repo, store, git, request }) => {
    await writeFile(join(repo.path, 'starter.txt'), 'starter\n');
    await writeFile(join(repo.path, 'other.txt'), 'keep untracked\n');
    expect((await request('workspace-review', { handoffId: 'gate' }, false)).status).toBe(401);
    expect((await request('workspace-review', { handoffId: 'gate' }, true, false)).status).toBe(403);
    const response = await request('workspace-review', { handoffId: 'gate' }); expect(response.status).toBe(200);
    const review = await response.json() as WorkspaceReview;
    expect(review.head).toBeNull();
    expect(review.files.find(file => file.path === 'starter.txt')!.diff).toContain('+starter');
    const input = { handoffId: 'gate', reviewId: review.id, files: ['starter.txt'], message: 'chore: initialize starter', confirm: true };
    expect((await request('workspace-commit', input, false)).status).toBe(401);
    expect((await request('workspace-commit', input, true, false)).status).toBe(403);
    const committed = await request('workspace-commit', input); expect(committed.status).toBe(200);
    const { commit } = await committed.json() as { commit: string };
    expect((await git('rev-parse', 'HEAD')).trim()).toBe(commit);
    expect(await git('ls-tree', '--name-only', 'HEAD')).toBe('starter.txt\n');
    expect(await git('status', '--porcelain')).toBe('?? other.txt\n');
    expect(await readFile(join(repo.path, 'other.txt'), 'utf8')).toBe('keep untracked\n');
    expect(store.get('repos', repo.id)!.handoff!.id).toBe('gate');
    expect(store.settings().paused).toBe(true); expect(store.get('repos', repo.id)!.mode).toBe('paused'); expect(store.list('runs')).toHaveLength(0);
    expect((await request('workspace-commit', input)).status).toBe(409); // No replay.
  });
});

test('selected working-tree version is committed; unselected staged entries, deletions and executable modes are preserved correctly', async () => {
  await fixture(async ({ repo, store, git }) => {
    await writeFile(join(repo.path, 'selected.txt'), 'base\n'); await writeFile(join(repo.path, 'removed.txt'), 'delete me\n');
    await git('add', '--', 'selected.txt', 'removed.txt'); await git('commit', '-qm', 'fixture baseline');
    await writeFile(join(repo.path, 'selected.txt'), 'previous staged\n'); await git('add', '--', 'selected.txt');
    await writeFile(join(repo.path, 'selected.txt'), 'reviewed working tree\n');
    await writeFile(join(repo.path, 'other.txt'), 'keep staged\n'); await git('add', '--', 'other.txt');
    await writeFile(join(repo.path, 'other.txt'), 'keep unstaged too\n');
    await unlink(join(repo.path, 'removed.txt'));
    await writeFile(join(repo.path, 'script.sh'), '#!/bin/sh\nexit 0\n'); await chmod(join(repo.path, 'script.sh'), 0o700);
    const review = await reviewWorkspace(store, repo, 'gate');
    await commitWorkspace(store, repo, { handoffId: 'gate', reviewId: review.id, files: ['selected.txt', 'removed.txt', 'script.sh'], message: 'feat: selected work', confirm: true });
    expect(await git('show', 'HEAD:selected.txt')).toBe('reviewed working tree\n');
    expect(await git('show', ':other.txt')).toBe('keep staged\n'); expect(await readFile(join(repo.path, 'other.txt'), 'utf8')).toBe('keep unstaged too\n');
    expect(await git('diff', '--cached', '--name-only')).toBe('other.txt\n');
    expect(await git('ls-tree', 'HEAD', '--', 'removed.txt')).toBe('');
    expect(await git('ls-tree', 'HEAD', '--', 'script.sh')).toStartWith('100755');
    expect(await git('status', '--porcelain')).toBe('AM other.txt\n');
  });
});

test('stale content/index/gate, unsupported paths and unconfirmed commits fail without touching index or history', async () => {
  await fixture(async ({ repo, store, git, request }) => {
    await writeFile(join(repo.path, 'safe.txt'), 'before\n');
    await writeFile(join(repo.path, '.env'), 'fixture only\n');
    await writeFile(join(repo.path, 'binary.dat'), Buffer.from([0, 1, 2]));
    await writeFile(join(repo.path, 'config.json'), '{"password":"synthetic-placeholder"}');
    await symlink('safe.txt', join(repo.path, 'linked.txt'));
    let review = await reviewWorkspace(store, repo, 'gate');
    expect(review.files.filter(file => file.blocked).map(file => file.path).sort()).toEqual(['.env', 'binary.dat', 'config.json', 'linked.txt']);
    expect(JSON.stringify(review)).not.toContain('synthetic-placeholder');
    const input = (files: string[], confirm = true) => ({ handoffId: 'gate', reviewId: review.id, files, message: 'chore: fixture', confirm });
    expect((await request('workspace-commit', input(['.env']))).status).toBe(400);
    expect((await request('workspace-commit', input(['../safe.txt']))).status).toBe(400);
    expect((await request('workspace-commit', input(['safe.txt'], false))).status).toBe(400);
    expect((await request('workspace-commit', { ...input(['safe.txt']), message: ' ' })).status).toBe(400);
    expect((await request('workspace-commit', { ...input(['safe.txt']), handoffId: 'stale' })).status).toBe(409);
    await writeFile(join(repo.path, 'safe.txt'), 'changed after review\n');
    expect((await request('workspace-commit', input(['safe.txt']))).status).toBe(409);
    expect(await git('ls-files')).toBe('');
    review = await reviewWorkspace(store, repo, 'gate');
    await git('add', '--', 'safe.txt');
    expect((await request('workspace-commit', input(['safe.txt']))).status).toBe(409);
    expect(await git('diff', '--cached', '--name-only')).toBe('safe.txt\n');
    expect(await readFile(join(repo.path, 'safe.txt'), 'utf8')).toBe('changed after review\n');
  });
});

test('Git hooks never execute and failed identity leaves HEAD/index/worktree intact', async () => {
  await fixture(async ({ repo, store, git, request }) => {
    await writeFile(join(repo.path, 'safe.txt'), 'fixture\n');
    const marker = join(repo.path, 'hook-ran');
    const hooks = join(repo.path, '.git/hooks');
    for (const name of ['pre-commit', 'commit-msg', 'post-commit', 'reference-transaction']) await writeFile(join(hooks, name), `#!/bin/sh\nprintf ran > '${marker}'\nexit 1\n`, { mode: 0o700 });
    await git('config', 'user.name', ''); await git('config', 'user.email', '');
    let review = await reviewWorkspace(store, repo, 'gate');
    const input = () => ({ handoffId: 'gate', reviewId: review.id, files: ['safe.txt'], message: 'chore: safe commit', confirm: true });
    expect((await request('workspace-commit', input())).status).toBe(409);
    expect(await git('ls-files')).toBe('');
    expect(await readFile(join(repo.path, 'safe.txt'), 'utf8')).toBe('fixture\n');
    await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    review = await reviewWorkspace(store, repo, 'gate');
    expect((await request('workspace-commit', input())).status).toBe(200);
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});

test('active/paused ownership and concurrent workspace operations cannot bypass the gate', async () => {
  await fixture(async ({ repo, store, request }) => {
    const run: Run = { id: 'run', repoId: repo.id, ticketId: 'T001', revision: '', status: 'paused', started: 1, finished: null, pid: null, sessionId: null, sessionFile: null, snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null };
    store.save('runs', run);
    expect((await request('workspace-review', { handoffId: 'gate' })).status).toBe(409);
    await workspaceOperation(store, repo.id, async () => {
      expect((await request('reconcile-workspace', { handoffId: 'gate' })).status).toBe(409);
      expect((await request('workspace-commit', {})).status).toBe(409);
    });
    expect(store.get('repos', repo.id)!.handoff!.id).toBe('gate');
  });
});

test('review binds HEAD and handoff identity; existing Git locks and custom filters fail closed', async () => {
  await fixture(async ({ repo, store, git, request }) => {
    await writeFile(join(repo.path, 'base.txt'), 'base\n');
    await git('add', '--', 'base.txt'); await git('commit', '-qm', 'fixture baseline');
    await writeFile(join(repo.path, 'safe.txt'), 'selected\n');
    let review = await reviewWorkspace(store, repo, 'gate');
    const input = () => ({ handoffId: 'gate', reviewId: review.id, files: ['safe.txt'], message: 'chore: fixture', confirm: true });
    await git('commit', '--allow-empty', '-qm', 'external fixture commit');
    expect((await request('workspace-commit', input())).status).toBe(409);
    review = await reviewWorkspace(store, repo, 'gate');
    store.save('repos', { ...repo, handoff: { ...repo.handoff!, id: 'new-gate' } });
    expect((await request('workspace-commit', { ...input(), handoffId: 'new-gate' })).status).toBe(409);
    store.save('repos', repo);
    review = await reviewWorkspace(store, repo, 'gate');
    await writeFile(join(repo.path, '.git/index.lock'), 'external lock');
    expect((await request('workspace-commit', input())).status).toBe(409);
    expect(await readFile(join(repo.path, '.git/index.lock'), 'utf8')).toBe('external lock');
    await unlink(join(repo.path, '.git/index.lock'));
    await writeFile(join(repo.path, '.gitattributes'), 'safe.txt filter=custom\n');
    const guarded = await reviewWorkspace(store, repo, 'gate');
    expect(guarded.files.find(file => file.path === 'safe.txt')!.blocked).toBeDefined();
    expect(await readFile(join(repo.path, 'safe.txt'), 'utf8')).toBe('selected\n');
    expect((await git('log', '--format=%s')).trim().split('\n')).toEqual(['external fixture commit', 'fixture baseline']);
  });
});

test('confirmed discard backs up selected files, restores tracked ones to HEAD, deletes new ones and leaves the rest', async () => {
  await fixture(async ({ repo, store, git, request }) => {
    await writeFile(join(repo.path, 'app.txt'), 'base\n'); await writeFile(join(repo.path, 'gone.txt'), 'keep me\n'); await writeFile(join(repo.path, 'kept.txt'), 'base\n');
    await git('add', '.'); await git('commit', '--quiet', '-m', 'base');
    await writeFile(join(repo.path, 'app.txt'), 'agent edit\n');
    await unlink(join(repo.path, 'gone.txt'));
    await mkdir(join(repo.path, 'src'));
    await writeFile(join(repo.path, 'src', 'new.txt'), 'new file\n');
    await git('add', 'src/new.txt'); // A staged new file must leave the index too.
    await writeFile(join(repo.path, 'kept.txt'), 'operator edit\n');
    const review = await (await request('workspace-review', { handoffId: 'gate' })).json() as WorkspaceReview;
    const input = { handoffId: 'gate', reviewId: review.id, files: ['app.txt', 'gone.txt', 'src/new.txt'], confirm: true };
    expect((await request('workspace-discard', { ...input, confirm: false })).status).toBe(400);
    expect((await request('workspace-discard', { ...input, files: ['missing.txt'] })).status).toBe(400);
    const response = await request('workspace-discard', input); expect(response.status).toBe(200);
    const { files, backup } = await response.json() as { files: number; backup: string };
    expect(files).toBe(3);
    expect(backup.startsWith(join(store.dataDir, 'discarded'))).toBe(true);
    expect(await readFile(join(backup, 'files', 'app.txt'), 'utf8')).toBe('agent edit\n');
    expect(await readFile(join(backup, 'files', 'src', 'new.txt'), 'utf8')).toBe('new file\n');
    expect(JSON.parse(await readFile(join(backup, 'manifest.json'), 'utf8')).files.map((file: { path: string }) => file.path)).toEqual(['app.txt', 'gone.txt', 'src/new.txt']);
    expect(await readFile(join(repo.path, 'app.txt'), 'utf8')).toBe('base\n');
    expect(await readFile(join(repo.path, 'gone.txt'), 'utf8')).toBe('keep me\n');
    expect(await git('status', '--porcelain')).toBe(' M kept.txt\n');
    expect(await readFile(join(repo.path, 'kept.txt'), 'utf8')).toBe('operator edit\n');
    expect(store.get('repos', repo.id)!.handoff!.id).toBe('gate'); // Only a recheck clears the gate.
    expect((await request('workspace-discard', input)).status).toBe(409); // No replay.
  });
});

test('discard refuses a workspace that changed after review and touches nothing', async () => {
  await fixture(async ({ repo, git, request }) => {
    await writeFile(join(repo.path, 'app.txt'), 'base\n'); await git('add', '.'); await git('commit', '--quiet', '-m', 'base');
    await writeFile(join(repo.path, 'app.txt'), 'agent edit\n');
    const review = await (await request('workspace-review', { handoffId: 'gate' })).json() as WorkspaceReview;
    await writeFile(join(repo.path, 'app.txt'), 'edited again\n');
    expect((await request('workspace-discard', { handoffId: 'gate', reviewId: review.id, files: ['app.txt'], confirm: true })).status).toBe(409);
    expect(await readFile(join(repo.path, 'app.txt'), 'utf8')).toBe('edited again\n');
  });
});
