import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from './api';
import { completions } from './completions';
import { closeStore, createStore, database, digest, token } from './store';
import type { Repo, Runtime } from './contracts';

test('completion API authenticates and revalidates registered paths on every request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-completion-api-'));
  const store = createStore(join(root, 'private'));
  try {
    const allowed = join(root, 'allowed');
    const outside = join(root, 'outside');
    await mkdir(allowed); await mkdir(outside);
    await writeFile(join(allowed, 'visible.ts'), '');
    const repo: Repo = { id: 'repo', name: 'fixture', path: allowed, git: false, mode: 'paused', lastStarted: 0 };
    store.setSettings({ ...store.settings(), roots: [allowed] });
    store.save('repos', repo);
    const runtime: Runtime = { wake() { throw new Error('Completions must not launch execution'); }, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
    const api = createApi(store, runtime);
    const raw = token();
    database(store).query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(raw), token(), Date.now() + 60000);
    const request = (query: string, authenticated = true) => api(new Request(`http://127.0.0.1:4310/api/repos/repo/completions?${query}`, { headers: authenticated ? { Cookie: `omp_session=${raw}` } : {} }));
    expect((await request('kind=file', false)).status).toBe(401);
    expect((await request('kind=file')).status).toBe(200);
    expect((await request('kind=unknown')).status).toBe(400);
    expect((await request(`kind=file&q=${'a'.repeat(201)}`)).status).toBe(400);
    expect((await request('kind=file&q=..%2Foutside')).status).toBe(200);
    expect(await (await request('kind=file&q=..%2Foutside')).json()).toEqual({ items: [], truncated: false });
    store.save('repos', { ...repo, path: outside });
    expect((await request('kind=file')).status).toBe(403);
    await symlink(outside, join(allowed, 'escaped-repo'));
    store.save('repos', { ...repo, path: join(allowed, 'escaped-repo') });
    expect((await request('kind=skill')).status).toBe(403);
    store.save('repos', repo);
    store.setSettings({ ...store.settings(), roots: [outside] });
    expect((await request('kind=file')).status).toBe(403);
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});

test('safe walk filters sensitive names and symlinks, quotes spaces, and bounds results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-completion-files-'));
  try {
    const repo = join(root, 'repo');
    const privateDir = join(root, 'private');
    await mkdir(repo); await mkdir(privateDir);
    for (const name of ['source.ts', 'two words.md', '.env', '.env.local', 'credentials.json', 'private.key', 'id_rsa', '.npmrc']) await writeFile(join(repo, name), 'never return contents');
    for (const name of ['node_modules', '.git', '.omp-backlog', '.ssh']) { await mkdir(join(repo, name)); await writeFile(join(repo, name, 'hidden.txt'), ''); }
    await writeFile(join(privateDir, 'outside.txt'), '');
    await symlink(privateDir, join(repo, 'escape'));
    await symlink(join(privateDir, 'outside.txt'), join(repo, 'linked.txt'));
    expect(await completions(repo, false, privateDir, 'file', '')).toEqual({ items: [{ label: 'source.ts', value: '@source.ts' }, { label: 'two words.md', value: '@"two words.md"' }], truncated: false });
    expect((await completions(repo, false, privateDir, 'file', 'SOURCE')).items).toEqual([{ label: 'source.ts', value: '@source.ts' }]);
    for (let index = 0; index < 85; index++) await writeFile(join(repo, `candidate-${index}.txt`), '');
    const result = await completions(repo, false, privateDir, 'file', 'candidate-');
    expect(result.items).toHaveLength(80); expect(result.truncated).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('git enumeration includes tracked and untracked files but respects ignore rules and filtering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-completion-git-'));
  try {
    expect(await Bun.spawn(['git', 'init', '-q', root], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0);
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n');
    for (const name of ['tracked.ts', 'untracked.ts', 'ignored.txt', '.env.production']) await writeFile(join(root, name), '');
    expect(await Bun.spawn(['git', '-C', root, 'add', '--', 'tracked.ts', '.env.production'], { stdout: 'ignore', stderr: 'ignore' }).exited).toBe(0);
    const result = await completions(root, true, join(root, 'private'), 'file', '');
    expect(result.items.map(item => item.label)).toEqual(['.gitignore', 'tracked.ts', 'untracked.ts']);
    expect(result.truncated).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native OMP and Agent Dirs SKILL.md metadata is discovered without reading skill bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-completion-skills-'));
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  try {
    const repo = join(root, 'repo'); const agent = join(root, 'agent');
    process.env.PI_CODING_AGENT_DIR = agent;
    const skills = [
      ['repo/.omp/skills/procedure', '---\nname: fixture-native\ndescription: >\n  Native multiline\n  description\ndisable-model-invocation: true\n---\nBody must not be returned.'],
      ['repo/.omp/skills/disabled', '---\nname: fixture-disabled\ndescription: Disabled\nenabled: false\n---\n'],
      ['repo/.omp/skills/missing-description', '---\nname: fixture-missing\n---\n'],
      ['repo/.agents/skills/fixture-agent', '# Description is optional in Agent Dirs\n'],
      ['agent/skills/global', '---\nname: fixture-global\ndescription: Global skill\n---\n'],
      ['agent/managed-skills/learned', '---\nname: fixture-managed\ndescription: Learned skill\n---\n'],
    ];
    for (const [path, text] of skills) { await mkdir(join(root, path), { recursive: true }); await writeFile(join(root, path, 'SKILL.md'), text); }
    await mkdir(join(root, 'outside'), { recursive: true });
    await writeFile(join(root, 'outside', 'SKILL.md'), '---\nname: fixture-escaped\ndescription: Not permitted\n---\n');
    await symlink(join(root, 'outside'), join(repo, '.omp/skills/escape'));
    const result = await completions(repo, false, join(root, 'private'), 'skill', 'fixture-', root);
    expect(result.items.map(item => item.value)).toEqual(['/skill:fixture-agent', '/skill:fixture-global', '/skill:fixture-managed', '/skill:fixture-native']);
    expect(result.items.find(item => item.label === 'fixture-native')?.description).toBe('Native multiline description');
    expect(JSON.stringify(result)).not.toContain('Body must not be returned');
  } finally {
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    await rm(root, { recursive: true, force: true });
  }
});
