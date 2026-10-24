import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Repo } from './contracts';
import type { DraftPreparation, DraftSnapshot } from './drafting-contracts';
import { closeDrafts, handleDraftRequest } from './drafting';
import { resolveDraftReference } from './completions';
import { closeStore, createStore } from './store';
import { HttpError } from './tickets';

async function fixture(run: (context: { repo: Repo; call(path?: string, method?: string, value?: unknown): Promise<Response>; root: string }) => Promise<void>, mode = '') {
  const root = await mkdtemp(join(tmpdir(), 'omp-drafting-test-'));
  const store = createStore(join(root, 'private'));
  const previous = { agent: process.env.PI_CODING_AGENT_DIR, profile: process.env.OMP_PROFILE, node: process.env.NODE_OPTIONS, bun: process.env.BUN_OPTIONS, config: process.env.PI_CONFIG_FILES };
  try {
    const repo: Repo = { id: 'repo', name: 'draft fixture', path: join(root, 'repo'), mode: 'automatic', git: false, lastStarted: 0 };
    await mkdir(repo.path); await mkdir(join(root, 'auth'));
    process.env.PI_CODING_AGENT_DIR = join(root, 'auth'); process.env.OMP_PROFILE = '';
    process.env.NODE_OPTIONS = '--require /must-not-be-loaded.js'; process.env.BUN_OPTIONS = '--preload /must-not-be-loaded.js'; process.env.PI_CONFIG_FILES = '/must-not-be-read.yml';
    const executable = join(root, 'omp-fixture');
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(import.meta.dir, 'fixtures/drafting-child.ts'))} ${quote(mode)} "$@"\n`);
    await chmod(executable, 0o700);
    store.setSettings({ ...store.settings(), executable, roots: [repo.path] }); store.save('repos', repo);
    const call = async (path = '', method = 'GET', value?: unknown) => {
      const url = `http://localhost/api/repos/repo/drafts${path}`;
      const request = new Request(url, { method, ...(value instanceof FormData ? { body: value } : value === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) });
      try { return await handleDraftRequest(store, repo, request, new URL(url).pathname.split('/').filter(Boolean)); }
      catch (error) { if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
    };
    await run({ repo, call, root });
    expect(store.list('tickets')).toEqual([]); expect(store.list('runs')).toEqual([]);
    expect(store.get('repos', repo.id)?.mode).toBe('automatic');
  } finally {
    await closeDrafts(store); closeStore(store);
    for (const [name, value] of [['PI_CODING_AGENT_DIR', previous.agent], ['OMP_PROFILE', previous.profile], ['NODE_OPTIONS', previous.node], ['BUN_OPTIONS', previous.bun], ['PI_CONFIG_FILES', previous.config]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}
function form(prompt: string, files: File[] = [], excluded: string[] = []) {
  const data = new FormData(); data.set('prompt', prompt); data.set('excluded', JSON.stringify(excluded));
  for (const file of files) data.append('files', file);
  return data;
}
async function settled(call: (path?: string, method?: string, value?: unknown) => Promise<Response>, id: string) {
  // Integration boundary: the real owned child and server's one-second state
  // sampler must run on the platform clock; wait on observable settlement.
  const until = Date.now() + 7000;
  while (Date.now() < until) {
    const snapshot = await (await call(`/${id}`)).json() as DraftSnapshot;
    if (snapshot.status !== 'busy') return snapshot;
    await Bun.sleep(30);
  }
  throw new Error('Draft protocol fixture did not settle');
}
const png = () => new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], 'reference.png');

test('draft protocol supports exact models, clamped thinking, safe host context and follow-up without ticket side effects', async () => {
  await fixture(async ({ call, repo }) => {
    expect((await call('', 'POST', { args: ['--tools', 'write'], rpc: 'bash' })).status).toBe(400);
    const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
    expect(opened.status).toBe('idle'); expect(opened.models.map(item => item.id)).toEqual(['vision', 'text']);
    expect((await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'unknown' })).status).toBe(400);
    expect((await call(`/${opened.id}/model`, 'POST', { thinking: 'unsupported' })).status).toBe(400);
    const textOnly = await (await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'text' })).json() as DraftSnapshot;
    expect(textOnly.thinking).toBe('off'); expect(textOnly.thinkingLevels).toEqual(['off']);
    await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'vision' });
    await writeFile(join(repo.path, 'two words.txt'), 'repository fixture body');
    await mkdir(join(repo.path, '.omp/skills/procedure'), { recursive: true });
    await writeFile(join(repo.path, '.omp/skills/procedure/SKILL.md'), '---\nname: draft-procedure\ndescription: Draft fixture\n---\nskill fixture body; never execute scripts');
    const prompt = '/bash touch forbidden; @"two words.txt" /skill:draft-procedure ^other-model';
    const prepared = await (await call(`/${opened.id}/context`, 'POST', form(prompt, [png()]))).json() as DraftPreparation;
    expect(prepared.ready).toBe(true); expect(prepared.contexts.map(item => item.status)).toEqual(['ready', 'ready', 'ready']);
    const sending = await (await call(`/${opened.id}/turn`, 'POST', form(prompt, [png()]))).json() as DraftSnapshot;
    expect(sending.status).toBe('busy');
    expect((await call(`/${opened.id}/model`, 'POST', { thinking: 'off' })).status).toBe(409);
    const answer = await settled(call, opened.id);
    expect(answer.status).toBe('idle'); expect(answer.messages[1].text).toContain('wireSafe=true; context=true; skill=true; images=1');
    expect((await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'text' })).status).toBe(400);
    await call(`/${opened.id}/turn`, 'POST', form('Clarify the acceptance criteria', [png()], ['upload:reference.png', 'file:two words.txt']));
    const followup = await settled(call, opened.id);
    expect(followup.messages).toHaveLength(4); expect(followup.messages[3].text).toContain('Partial turn 2.');
    const disconnected = await call(`/${opened.id}`, 'DELETE');
    expect(disconnected.status).toBe(200);
    const retained = await disconnected.json() as DraftSnapshot;
    expect(retained.status).toBe('stopped');
    expect(retained.messages).toEqual(followup.messages);
    expect((await call(`/${opened.id}`)).status).toBe(404);
  });
}, 20000);

test('an unavailable OMP default requires explicit model selection rather than fallback or sending', async () => {
  await fixture(async ({ call }) => {
    const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
    expect(opened.status).toBe('idle');
    expect(opened.model).toBeNull();
    expect((await call(`/${opened.id}/turn`, 'POST', form('Draft only'))).status).toBe(400);
    const selected = await (await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'text' })).json() as DraftSnapshot;
    expect(selected.model).toEqual({ provider: 'fixture', id: 'text' });
    await call(`/${opened.id}/turn`, 'POST', form('Draft only'));
    const answer = await settled(call, opened.id);
    expect(answer.status).toBe('idle');
    expect(answer.messages.map(item => item.role)).toEqual(['user', 'assistant']);
  }, 'unselected');
});

test('preparation discloses unsupported, failed and excluded inputs and independently blocks unsafe direct references', async () => {
  await fixture(async ({ call, repo, root }) => {
    const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
    await writeFile(join(root, 'outside.txt'), 'must not be read');
    await symlink(join(root, 'outside.txt'), join(repo.path, 'linked.txt'));
    const privateNames = ['.env', 'auth.json', 'cookies.json', 'session.json', 'access_token.txt', 'kubeconfig'];
    for (const name of privateNames) await writeFile(join(repo.path, name), 'must not be read');
    const unsafe = ['../outside.txt', '/etc/passwd', 'linked.txt', ...privateNames];
    for (const name of unsafe) {
      const prepared = await (await call(`/${opened.id}/context`, 'POST', form(`@${name}`))).json() as DraftPreparation;
      expect(prepared.ready).toBe(false); expect(prepared.contexts[0].status).toBe('failed');
      expect(JSON.stringify(prepared)).not.toContain('must not be read');
      expect((await call(`/${opened.id}/turn`, 'POST', form(`@${name}`))).status).toBe(400);
    }
    const files = [new File(['not extracted'], 'document.pdf'), new File(['x'.repeat(128 * 1024 + 1)], 'oversize.txt'), new File([Uint8Array.from([255, 254])], 'bad.txt')];
    const unsupported = await (await call(`/${opened.id}/context`, 'POST', form('Draft a ticket', files))).json() as DraftPreparation;
    expect(unsupported.ready).toBe(false); expect(unsupported.contexts.map(item => item.status)).toEqual(['unsupported', 'failed', 'failed']);
    expect(JSON.stringify(unsupported)).toContain('No partial extraction');
    const excluded = await (await call(`/${opened.id}/context`, 'POST', form('Draft a ticket', files, files.map(file => `upload:${file.name}`)))).json() as DraftPreparation;
    expect(excluded.ready).toBe(true); expect(excluded.contexts.every(item => item.status === 'excluded')).toBe(true);
    const malformedImage = await (await call(`/${opened.id}/context`, 'POST', form('image', [new File(['not an image'], 'broken.png')]))).json() as DraftPreparation;
    expect(malformedImage.ready).toBe(false); expect(malformedImage.contexts[0].status).toBe('failed');
    const webp = await (await call(`/${opened.id}/context`, 'POST', form('image', [new File(['reference only'], 'reference.webp')]))).json() as DraftPreparation;
    expect(webp.ready).toBe(false); expect(webp.contexts[0].status).toBe('unsupported');
    const combined = await (await call(`/${opened.id}/context`, 'POST', form('bounded context', [0, 1, 2].map(index => new File(['x'.repeat(100 * 1024)], `large-${index}.txt`))))).json() as DraftPreparation;
    expect(combined.ready).toBe(false); expect(combined.contexts.at(-1)?.detail).toContain('256 KiB');
    const forged = form('hello'); forged.set('command', 'bash');
    expect((await call(`/${opened.id}/turn`, 'POST', forged)).status).toBe(400);
    await call(`/${opened.id}/model`, 'POST', { provider: 'fixture', modelId: 'text' });
    const imageUnsupported = await (await call(`/${opened.id}/context`, 'POST', form('image', [png()]))).json() as DraftPreparation;
    expect(imageUnsupported.ready).toBe(false); expect(imageUnsupported.contexts[0].status).toBe('unsupported');
  });
});

test('cancellation preserves partial output, blocks replay, and closed snapshots cannot exhaust live session slots', async () => {
  await fixture(async ({ call }) => {
    for (let index = 0; index < 6; index++) {
      const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
      expect(opened.status).toBe('idle');
      await call(`/${opened.id}/turn`, 'POST', form('FIXTURE:HOLD'));
      const until = Date.now() + 3000;
      // Await actual pipe output rather than guessing when the child has run.
      while (!(await (await call(`/${opened.id}`)).json() as DraftSnapshot).messages.some(item => item.role === 'assistant')) {
        if (Date.now() >= until) throw new Error('Fixture partial output did not arrive before cancellation');
        await Bun.sleep(10);
      }
      const cancelled = await (await call(`/${opened.id}/cancel`, 'POST', {})).json() as DraftSnapshot;
      expect(cancelled.status).toBe('stopped'); expect(cancelled.messages.at(-1)?.text).toContain('Partial turn 1.');
      expect((await call(`/${opened.id}/turn`, 'POST', form('do not replay'))).status).toBe(409);
    }
  });
}, 20000);

test('unexpected tools, host URIs, UI, oversize frames, provider errors and token exhaustion fail closed with partial output', async () => {
  await fixture(async ({ call }) => {
    for (const scenario of ['TOOL', 'URI', 'UI', 'OVERSIZE', 'PROVIDER', 'TOKENS']) {
      const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
      await call(`/${opened.id}/turn`, 'POST', form(`FIXTURE:${scenario}`));
      const failed = await settled(call, opened.id);
      expect(failed.status).toBe('failed'); expect(failed.messages.at(-1)?.text).toContain('Partial turn 1.');
      expect(JSON.stringify(failed)).not.toContain('DO-NOT-EXPOSE');
      expect((await call(`/${opened.id}`, 'DELETE')).status).toBe(200);
    }
  });
}, 20000);

test('metadata capability mismatch fails before a provider turn and retains an actionable snapshot', async () => {
  await fixture(async ({ call }) => {
    const opened = await (await call('', 'POST', {})).json() as DraftSnapshot;
    expect(opened.status).toBe('failed');
    expect(opened.messages).toEqual([]);
    expect((await call(`/${opened.id}/turn`, 'POST', form('not allowed'))).status).toBe(409);
  }, 'unsafe');
});

test('skill text resolution rejects symlinks and oversized bodies without executing scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-draft-context-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, 'empty-agent');
  try {
    const repo = join(root, 'repo'); const home = join(root, 'home');
    await mkdir(join(repo, '.omp/skills'), { recursive: true }); await mkdir(home);
    await mkdir(join(root, 'external'));
    await writeFile(join(root, 'external/SKILL.md'), '---\nname: escape\ndescription: Do not load\n---\n');
    await symlink(join(root, 'external'), join(repo, '.omp/skills/escape'));
    await expect(resolveDraftReference(repo, join(root, 'private'), 'skill', 'escape', home)).rejects.toThrow('unavailable');
    await mkdir(join(repo, '.omp/skills/large'));
    await writeFile(join(repo, '.omp/skills/large/SKILL.md'), `---\nname: large\ndescription: Too large\n---\n${'x'.repeat(32768)}`);
    await expect(resolveDraftReference(repo, join(root, 'private'), 'skill', 'large', home)).rejects.toThrow('oversized');
    await expect(resolveDraftReference(repo, join(root, 'private'), 'skill', '../escape', home)).rejects.toThrow('Invalid skill');
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
