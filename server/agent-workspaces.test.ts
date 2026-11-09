import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentWorkspaceSnapshot, AgentWorkspaceSummary } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import type { DraftPreparation, DraftSnapshot } from './drafting-contracts';
import { handleAgentWorkspaceRequest, WORKSPACE_LIMITS } from './agent-workspaces';
import { closeDrafts, handleDraftRequest } from './drafting';
import { closeStore, createStore } from './store';
import { HttpError } from './tickets';

interface WorkspaceFixture {
  root: string; repo: Repo;
  call(path?: string, method?: string, value?: unknown, key?: string, repo?: Repo): Promise<Response>;
  legacyTurn(id: string): Promise<Response>;
  reopen(): Promise<void>;
}
async function fixture(run: (context: WorkspaceFixture) => Promise<void>, mode = '') {
  const root = await mkdtemp(join(tmpdir(), 'omp-agent-workspaces-'));
  let store: Store = createStore(join(root, 'private'));
  const previousAgent = process.env.PI_CODING_AGENT_DIR; const previousProfile = process.env.OMP_PROFILE;
  try {
    const repo: Repo = { id: 'repo', name: 'workspace fixture', path: join(root, 'repo'), git: false, mode: 'paused', lastStarted: 0 };
    await mkdir(repo.path); await mkdir(join(root, 'auth'));
    process.env.PI_CODING_AGENT_DIR = join(root, 'auth'); process.env.OMP_PROFILE = '';
    const executable = join(root, 'omp-fixture');
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    await writeFile(executable, `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(join(import.meta.dir, 'fixtures/drafting-child.ts'))} ${quote(mode)} --fixture-log ${quote(join(root, 'child.jsonl'))} "$@"\n`);
    await chmod(executable, 0o700); store.setSettings({ ...store.settings(), executable, roots: [repo.path] }); store.save('repos', repo);
    const call: WorkspaceFixture['call'] = async (path = '', method = 'GET', value?: unknown, key?: string, project = repo) => {
      const url = `http://localhost/api/repos/${project.id}/agent-workspaces${path}`;
      const headers = new Headers(key ? { 'Idempotency-Key': key } : {});
      if (value !== undefined && !(value instanceof FormData)) headers.set('Content-Type', 'application/json');
      const request = new Request(url, { method, headers, ...(value === undefined ? {} : { body: value instanceof FormData ? value : JSON.stringify(value) }) });
      try { return await handleAgentWorkspaceRequest(store, project, request, new URL(url).pathname.split('/').filter(Boolean)); }
      catch (error) { if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
    };
    await run({
      root, repo, call,
      legacyTurn: id => {
        const url = `http://localhost/api/repos/${repo.id}/drafts/${id}/turn`;
        return handleDraftRequest(store, repo, new Request(url, { method: 'POST', body: form('Rejected direct turn') }), new URL(url).pathname.split('/').filter(Boolean));
      },
      reopen: async () => { await closeDrafts(store); closeStore(store); store = createStore(join(root, 'private')); },
    });
    expect(store.list('tickets')).toEqual([]); expect(store.list('runs')).toEqual([]);
  } finally {
    await closeDrafts(store); closeStore(store);
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousProfile === undefined) delete process.env.OMP_PROFILE; else process.env.OMP_PROFILE = previousProfile;
    await rm(root, { recursive: true, force: true });
  }
}
function form(prompt: string) { const value = new FormData(); value.set('prompt', prompt); value.set('excluded', '[]'); return value; }
async function waitFor(call: WorkspaceFixture['call'], id: string, predicate: (draft: DraftSnapshot) => boolean) {
  // Real child pipe output and the native one-second settlement sampler must run on the platform clock.
  const until = Date.now() + 7000;
  while (Date.now() < until) {
    const draft = await (await call(`/${id}/session`)).json() as DraftSnapshot;
    if (predicate(draft)) return draft;
    await Bun.sleep(20);
  }
  throw new Error('Workspace fixture did not reach the observable state');
}
async function log(root: string) { return (await readFile(join(root, 'child.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; command?: string }); }

test('workspace editors, immutable plan approvals and scoping survive a Store reopen without starting OMP', async () => {
  await fixture(async ({ call, reopen, repo, root }) => {
    const createdResponse = await call('', 'POST', { title: 'Review checkout' }); expect(createdResponse.status).toBe(201);
    let saved = await createdResponse.json() as AgentWorkspaceSnapshot; const id = saved.workspace.id;
    expect(saved.draft).toBeNull(); expect(saved.workspace.version).toBe(1);
    saved = await (await call(`/${id}`, 'PATCH', { version: 1, prompt: 'Discuss checkout', ticketMarkdown: '---\nid: checkout\n---\nDone when: tests pass', planMarkdown: 'Inspect → propose → review', title: 'Checkout plan' })).json() as AgentWorkspaceSnapshot;
    const first = saved.workspace.planRevisions[0]!;
    saved = await (await call(`/${id}`, 'PATCH', { version: 2, approvePlanRevisionId: first.id })).json() as AgentWorkspaceSnapshot;
    expect(saved.workspace.planRevisions[0]!.approvedAt).toBeNumber();
    expect((await call(`/${id}`, 'PATCH', { version: 1, prompt: 'stale tab' })).status).toBe(409);
    saved = await (await call(`/${id}`, 'PATCH', { version: 3, planMarkdown: 'Inspect → ask → review' })).json() as AgentWorkspaceSnapshot;
    expect(saved.workspace.planRevisions[0]).toEqual({ ...first, approvedAt: saved.workspace.planRevisions[0]!.approvedAt });
    expect(saved.workspace.planRevisions[1]!.approvedAt).toBeUndefined();
    expect((await call(`/${id}`, 'PATCH', { version: 4, approvePlanRevisionId: first.id })).status).toBe(409);
    const same = await (await call(`/${id}`, 'PATCH', { version: 4, planMarkdown: 'Inspect → ask → review', archived: true })).json() as AgentWorkspaceSnapshot;
    expect(same.workspace.planRevisions).toHaveLength(2);
    await reopen();
    const loaded = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(loaded).toEqual(same); expect(loaded.draft).toBeNull();
    expect((await call(`/${id}`, 'GET', undefined, undefined, { ...repo, id: 'other' })).status).toBe(404);
    expect((await call(`/${id}`, 'GET', undefined, undefined, { ...repo, path: `${repo.path}-moved` })).status).toBe(404);
    const list = await (await call()).json() as AgentWorkspaceSummary[];
    expect(list).toHaveLength(1); expect(list[0]!.title).toBe('Checkout plan'); expect(list[0]!.archived).toBe(true);
    expect(Object.keys(list[0]!)).toEqual(['id', 'repoId', 'title', 'createdAt', 'updatedAt', 'archived', 'version']);
    expect(JSON.stringify(loaded)).not.toContain(root); expect(await readFile(join(root, 'child.jsonl'), 'utf8').catch(() => '')).toBe('');
    expect((await call(`/${id}/connect`, 'POST', {})).status).toBe(409);
  });
});

test('native reconnect restores exact model/thinking, retains discussion and sends only on explicit idempotent Send', async () => {
  await fixture(async ({ call, reopen, root, legacyTurn }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const id = created.workspace.id;
    const opened = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(opened.draft?.status).toBe('idle'); expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(0);
    await expect(legacyTurn(opened.draft!.id)).rejects.toMatchObject({ status: 404 });
    const untouched = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(untouched.draft?.status).toBe('idle'); expect(untouched.workspace.messages).toEqual([]);
    await call(`/${id}/session/model`, 'POST', { provider: 'fixture', modelId: 'vision' });
    await call(`/${id}/session/model`, 'POST', { thinking: 'off' });
    const key = crypto.randomUUID();
    const accepted = await call(`/${id}/session/turn`, 'POST', form('Discuss the first requirement'), key);
    expect(accepted.status).toBe(200);
    const acceptedSnapshot = await accepted.json() as DraftSnapshot;
    expect(acceptedSnapshot.messages[1]).toEqual({ role: 'assistant', text: '', model: 'vision', thinking: 'off', status: 'partial' });
    expect((await call(`/${id}/session/turn`, 'POST', form('Discuss the first requirement'), key)).status).toBe(200);
    expect((await call(`/${id}/session/turn`, 'POST', form('different input'), key)).status).toBe(409);
    const first = await waitFor(call, id, draft => draft.status !== 'busy');
    expect(first.messages).toHaveLength(2); expect(first.messages[1]!.status).toBe('complete');
    const afterTurn = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(afterTurn.workspace.version).toBe(1);
    await reopen();
    const loaded = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(loaded.workspace.messages).toEqual(first.messages); expect(loaded.draft).toBeNull();
    expect((await call(`/${id}/session/turn`, 'POST', form('Discuss the first requirement'), key)).status).toBe(200);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(1);
    const reconnected = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(reconnected.draft?.model).toEqual({ provider: 'fixture', id: 'vision' }); expect(reconnected.draft?.thinking).toBe('off');
    expect(reconnected.draft?.messages).toEqual(first.messages);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(1);
    await call(`/${id}`, 'PATCH', { version: 1, planMarkdown: '@^'.repeat(16384) });
    const prepared = await (await call(`/${id}/session/context`, 'POST', form('Now clarify acceptance'))).json() as DraftPreparation;
    expect(prepared.contexts.at(-1)?.detail).toContain('image bytes');
    expect(prepared.contexts.at(-1)?.detail).toContain('plan truncated');
    await call(`/${id}/session/turn`, 'POST', form('Now clarify acceptance'), crypto.randomUUID());
    const followup = await waitFor(call, id, draft => draft.status !== 'busy');
    expect(followup.messages).toHaveLength(4); expect(followup.messages[3]!.text).toContain('Partial turn 1.');
    expect(followup.messages[3]!.text).toContain('wireSafe=true');
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(2);
    const seeded = await (await call(`/${id}/session/context`, 'POST', form('Preview another clarification'))).json() as DraftPreparation;
    expect(seeded.contexts.at(-1)?.detail).toContain('saved messages are not retransmitted');
  });
}, 20000);

test('streamed partials and provider failures are durable, honest and cannot be archived while busy', async () => {
  await fixture(async ({ call, reopen }) => {
    const opened = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const id = opened.workspace.id;
    await call(`/${id}/connect`, 'POST', {});
    expect((await call(`/${id}/session/turn`, 'POST', form('FIXTURE:HOLD'))).status).toBe(400);
    await call(`/${id}/session/turn`, 'POST', form('FIXTURE:HOLD'), crypto.randomUUID());
    await waitFor(call, id, draft => !!draft.messages.at(-1)?.text);
    const busy = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(busy.workspace.messages.at(-1)?.status).toBe('partial'); expect(busy.workspace.version).toBe(1);
    expect((await call(`/${id}`, 'PATCH', { version: 1, archived: true })).status).toBe(409);
    await call(`/${id}/session`, 'DELETE'); await reopen();
    const restored = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(restored.workspace.messages.at(-1)?.status).toBe('failed'); expect(restored.workspace.messages.at(-1)?.text).toContain('Partial turn 1.');
    const other = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const failedId = other.workspace.id;
    await call(`/${failedId}/connect`, 'POST', {}); const key = crypto.randomUUID();
    await call(`/${failedId}/session/turn`, 'POST', form('FIXTURE:PROVIDER'), key);
    await waitFor(call, failedId, draft => draft.status !== 'busy');
    const failed = await (await call(`/${failedId}`)).json() as AgentWorkspaceSnapshot;
    expect(failed.workspace.messages.at(-1)?.status).toBe('failed'); expect(JSON.stringify(failed)).not.toContain('DO-NOT-EXPOSE');
    await reopen();
    const durable = await (await call(`/${failedId}`)).json() as AgentWorkspaceSnapshot;
    expect(durable.workspace.messages).toEqual(failed.workspace.messages);
    expect((await call(`/${failedId}/session/turn`, 'POST', form('FIXTURE:PROVIDER'), key)).status).toBe(200);
  });
}, 20000);

test('editor/revision/workspace limits reject without deleting saved data and archived records count', async () => {
  await fixture(async ({ call }) => {
    let workspace = (await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot).workspace; const id = workspace.id;
    expect((await call(`/${id}`, 'PATCH', { version: 1, prompt: 'x'.repeat(32769) })).status).toBe(413);
    expect((await call(`/${id}`, 'PATCH', { version: 1, ticketMarkdown: 'x'.repeat(WORKSPACE_LIMITS.editorBytes + 1) })).status).toBe(413);
    expect((await call(`/${id}`, 'PATCH', { version: 1, planMarkdown: 'x'.repeat(WORKSPACE_LIMITS.planBytes + 1) })).status).toBe(413);
    for (let revision = 0; revision < WORKSPACE_LIMITS.revisions; revision++) workspace = (await (await call(`/${id}`, 'PATCH', { version: workspace.version, planMarkdown: `Revision ${revision}` })).json() as AgentWorkspaceSnapshot).workspace;
    const rejected = await call(`/${id}`, 'PATCH', { version: workspace.version, planMarkdown: 'one too many' }); expect(rejected.status).toBe(413);
    expect((await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot).workspace).toEqual(workspace);
    await call(`/${id}`, 'PATCH', { version: workspace.version, archived: true });
    for (let index = 1; index < WORKSPACE_LIMITS.perRepo; index++) expect((await call('', 'POST', {})).status).toBe(201);
    expect((await call('', 'POST', {})).status).toBe(429);
    expect(await (await call()).json()).toHaveLength(WORKSPACE_LIMITS.perRepo);
    for (let project = 1; project < WORKSPACE_LIMITS.global / WORKSPACE_LIMITS.perRepo; project++) {
      for (let index = 0; index < WORKSPACE_LIMITS.perRepo; index++) expect((await call('', 'POST', {}, undefined, { id: `repo-${project}`, name: 'other repo', path: `/fixture-repo-${project}`, mode: 'paused', git: false, lastStarted: 0 })).status).toBe(201);
    }
    expect((await call('', 'POST', {}, undefined, { id: 'overflow', name: 'overflow', path: '/overflow', mode: 'paused', git: false, lastStarted: 0 })).status).toBe(429);
  });
});

test('an unselected OMP default stays unselected until an exact available model is chosen', async () => {
  await fixture(async ({ call, root }) => {
    const id = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    const opened = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(opened.draft?.model).toBeNull();
    expect((await call(`/${id}/session/turn`, 'POST', form('No fallback'), crypto.randomUUID())).status).toBe(400);
    expect((await call(`/${id}/session/model`, 'POST', { provider: 'fixture', modelId: 'invented' })).status).toBe(400);
    expect((await log(root)).some(row => row.command === 'prompt')).toBe(false);
  }, 'unselected');
});

test('history exhaustion rejects the next turn without truncating or losing existing conversation', async () => {
  await fixture(async ({ call }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const id = created.workspace.id;
    await call(`/${id}/connect`, 'POST', {});
    for (let turn = 0; turn < 7; turn++) {
      expect((await call(`/${id}/session/turn`, 'POST', form('x'.repeat(32768)), crypto.randomUUID())).status).toBe(200);
      await waitFor(call, id, draft => draft.status !== 'busy');
    }
    await call(`/${id}/session`, 'DELETE');
    const saved = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    await call(`/${id}/connect`, 'POST', {});
    expect((await call(`/${id}/session/turn`, 'POST', form('x'.repeat(32768)), crypto.randomUUID())).status).toBe(413);
    const rejected = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(rejected.workspace.messages).toEqual(saved.workspace.messages);
    expect(rejected.workspace.messages).toHaveLength(14);
    expect(rejected.workspace.messages.reduce((total, message) => total + Buffer.byteLength(message.text), 0)).toBeLessThan(WORKSPACE_LIMITS.historyBytes);
  });
}, 20000);

test('an unavailable saved model preserves its preference but requires an explicit enumerated replacement before inference', async () => {
  await fixture(async ({ call, root, reopen }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const id = created.workspace.id;
    await call(`/${id}/connect`, 'POST', {});
    await call(`/${id}/session/model`, 'POST', { provider: 'fixture', modelId: 'vision' });
    await call(`/${id}/session`, 'DELETE');
    const filter = join(root, 'model-filter.ts');
    await writeFile(filter, `import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn(process.execPath, [${JSON.stringify(join(import.meta.dir, 'fixtures/drafting-child.ts'))}, '--fixture-log', ${JSON.stringify(join(root, 'child.jsonl'))}, ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, BUN_BE_BUN: '1' } });
process.stdin.pipe(child.stdin);
createInterface({ input: child.stdout }).on('line', line => { let frame; try { frame = JSON.parse(line); } catch { console.log(line); return; } if (frame.command === 'get_available_models' && frame.data?.models) frame.data.models = frame.data.models.filter(model => model.id === 'text'); console.log(JSON.stringify(frame)); });
child.on('exit', code => process.exit(code ?? 1));
`);
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    await writeFile(join(root, 'omp-fixture'), `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(filter)} "$@"\n`);
    await reopen();
    const connected = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(connected.draft?.status).toBe('idle'); expect(connected.draft?.model).toBeNull(); expect(connected.draft?.error).toContain('saved model is unavailable');
    expect(connected.workspace.model).toEqual({ provider: 'fixture', id: 'vision' });
    expect((await call(`/${id}/session/turn`, 'POST', form('No fallback'), crypto.randomUUID())).status).toBe(400);
    expect((await log(root)).some(row => row.command === 'prompt')).toBe(false);
    const selected = await (await call(`/${id}/session/model`, 'POST', { provider: 'fixture', modelId: 'text' })).json() as DraftSnapshot;
    expect(selected.model).toEqual({ provider: 'fixture', id: 'text' }); expect(selected.error).toBe('');
    const saved = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(saved.workspace.model).toEqual({ provider: 'fixture', id: 'text' });
    await call(`/${id}/session/turn`, 'POST', form('Explicit replacement selected'), crypto.randomUUID());
    const completed = await waitFor(call, id, draft => draft.status !== 'busy');
    expect(completed.messages.at(-1)?.status).toBe('complete');
  });
}, 20000);
