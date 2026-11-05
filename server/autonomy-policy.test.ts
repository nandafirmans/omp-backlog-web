import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime } from './contracts';
import { createApi } from './api';
import { closeStore, createStore, database, digest, token } from './store';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'omp-autonomy-policy-'));
  const repo: Repo = { id: 'policy-project', name: 'Policy project', path: join(root, 'project'), git: true, mode: 'paused', lastStarted: 0 };
  const git = async (...args: string[]) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const child = Bun.spawn(['git', ...args], { cwd: repo.path, stdout: 'pipe', stderr: 'pipe', env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    const error = await new Response(child.stderr).text();
    if (await child.exited) throw new Error(error);
  };
  await mkdir(repo.path);
  await git('init', '-q');
  await writeFile(join(repo.path, 'verify.mjs'), 'console.log("synthetic verification");\n');
  await git('add', 'verify.mjs');
  await git('-c', 'user.name=Synthetic owner', '-c', 'user.email=owner@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Synthetic baseline');
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [root], paused: true });
  store.save('repos', repo);
  let wakes = 0;
  const runtime: Runtime = { wake() { wakes++; }, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
  const api = createApi(store, runtime);
  const origin = 'http://localhost:4310';
  const cookie = token(); const csrf = token();
  database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(cookie), csrf, Date.now() + 60000);
  const call = (input: unknown, auth = true, validCsrf = true) => api(new Request(`${origin}/api/repos/${repo.id}/completion`, { method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: `omp_session=${cookie}`, 'X-CSRF-Token': validCsrf ? csrf : 'invalid' } : {}) }, body: JSON.stringify(input) }));
  const policy = { revision: null, mode: 'autonomous', confirm: true, verification: { argv: ['bun', 'verify.mjs'], files: ['verify.mjs'], timeoutSeconds: 15 }, reviewerModel: '', maxCorrections: 2, maxRecoveries: 1 };
  return { root, repo, store, call, policy, wakes: () => wakes, async close() { closeStore(store); await rm(root, { recursive: true, force: true }); } };
}

test('completion opt-in is authenticated, explicit, revision-bound and independent of start permission', async () => {
  const f = await fixture();
  try {
    expect((await f.call(f.policy, false)).status).toBe(401);
    expect((await f.call(f.policy, true, false)).status).toBe(403);
    expect((await f.call({ ...f.policy, confirm: false })).status).toBe(400);
    expect(f.store.get('repos', f.repo.id)?.completion).toBeUndefined();
    expect((await f.call(f.policy)).status).toBe(200);
    const enabled = f.store.get('repos', f.repo.id)!;
    expect(enabled.mode).toBe('paused');
    expect(enabled.completion?.mode).toBe('autonomous');
    if (enabled.completion?.mode !== 'autonomous') throw new Error('Expected authorized policy');
    expect(enabled.completion.recipeHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await f.call({ ...f.policy, mode: 'human' })).status).toBe(409);
    expect(f.store.get('repos', f.repo.id)?.completion).toEqual(enabled.completion);
    expect((await f.call({ mode: 'human', revision: enabled.completion.revision })).status).toBe(200);
    expect(f.store.get('repos', f.repo.id)?.mode).toBe('paused');
    expect(f.store.get('repos', f.repo.id)?.completion?.mode).toBe('human');
    expect(f.wakes()).toBe(2);
  } finally { await f.close(); }
});

test('commissioning rejects dirty, unsafe, unsupported and excessive policies without changing authority', async () => {
  const f = await fixture();
  try {
    for (const patch of [{ maxCorrections: 3 }, { maxRecoveries: 2 }, { reviewerModel: 'model-alias' }, { verification: { argv: ['bun'], files: ['../outside'], timeoutSeconds: 15 } }, { verification: { argv: ['bun'], files: ['verify.mjs'], timeoutSeconds: 0 } }, { verification: { argv: [], files: ['verify.mjs'], timeoutSeconds: 15 } }]) expect((await f.call({ ...f.policy, ...patch })).ok).toBe(false);
    await writeFile(join(f.repo.path, 'foreign.txt'), 'Preserve unrelated work');
    expect((await f.call(f.policy)).ok).toBe(false);
    expect(f.store.get('repos', f.repo.id)?.completion).toBeUndefined();
    expect(await Bun.file(join(f.repo.path, 'foreign.txt')).text()).toBe('Preserve unrelated work');
    f.store.save('repos', { ...f.repo, git: false });
    expect((await f.call(f.policy)).status).toBe(409);
  } finally { await f.close(); }
});

test('owned work prevents new grants but does not prevent revocation', async () => {
  const f = await fixture();
  try {
    expect((await f.call(f.policy)).status).toBe(200);
    const policy = f.store.get('repos', f.repo.id)!.completion!;
    const run: Run = { id: 'owned', repoId: f.repo.id, ticketId: 'T1', revision: 'r1', status: 'running', started: Date.now(), finished: null, pid: null, sessionId: 'author', sessionFile: 'author.jsonl', snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null };
    f.store.save('runs', run);
    expect((await f.call({ ...f.policy, revision: policy.revision })).status).toBe(409);
    expect((await f.call({ mode: 'human', revision: policy.revision })).status).toBe(200);
    expect(f.store.get('repos', f.repo.id)?.completion?.mode).toBe('human');
    expect(f.store.get('runs', run.id)).toEqual(run);
  } finally { await f.close(); }
});
