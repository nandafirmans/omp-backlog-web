import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentWorkspaceSnapshot, AgentWorkspaceSummary } from './agent-workspace-contracts';
import type { Repo, Store, Ticket } from './contracts';
import type { DraftPreparation, DraftSnapshot } from './drafting-contracts';
import { handleAgentWorkspaceRequest, WORKSPACE_LIMITS } from './agent-workspaces';
import { closeDrafts, handleDraftRequest } from './drafting';
import { closeStore, createStore } from './store';
import { HttpError } from './tickets';
import { settleResponseOperations } from './response-operations';

interface WorkspaceFixture {
  root: string; repo: Repo;
  call(path?: string, method?: string, value?: unknown, key?: string, repo?: Repo): Promise<Response>;
  legacyTurn(id: string): Promise<Response>;
  tickets(): Ticket[];
  store(): Store;
  reopen(): Promise<void>;
}
async function fixture(run: (context: WorkspaceFixture) => Promise<void>, mode = '', allowTickets = false) {
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
      store: () => store,
      legacyTurn: id => {
        const url = `http://localhost/api/repos/${repo.id}/drafts/${id}/turn`;
        return handleDraftRequest(store, repo, new Request(url, { method: 'POST', body: form('Rejected direct turn') }), new URL(url).pathname.split('/').filter(Boolean));
      },
      tickets: () => store.list('tickets'),
      reopen: async () => { await closeDrafts(store); closeStore(store); store = createStore(join(root, 'private')); },
    });
    if (!allowTickets) expect(store.list('tickets')).toEqual([]);
    expect(store.list('runs')).toEqual([]);
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
async function log(root: string) { return (await readFile(join(root, 'child.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { event: string; command?: string; message?: string }); }
test('a completed response creates one held batch once and retains its result after reload', async () => {
  await fixture(async ({ call, reopen, tickets, root }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const id = created.workspace.id;
    const initial = form('Describe a useful change');
    initial.append('files', new File(['durable source'], 'source.txt', { type: 'text/plain' }));
    expect((await call(`/${id}/session/turn`, 'POST', initial, crypto.randomUUID())).status).toBe(200);
    await waitFor(call, id, draft => draft.messages[1]?.status === 'complete');
    const before = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(before.eligibleResponseIndices).toEqual([1]);
    expect(await (await call(`/${id}/attachments/1/source.txt`)).text()).toBe('durable source');
    expect((await call(`/${id}/attachments/1/missing.txt`)).status).toBe(404);
    expect(JSON.stringify(before)).not.toContain('durable source');
    expect(before.responseOperations).toEqual([]);
    expect((await call(`/${id}/session/turn`, 'POST', form('Later unrelated requirement'), crypto.randomUUID())).status).toBe(200);
    await waitFor(call, id, draft => draft.messages[3]?.status === 'complete');
    const [first, duplicate] = await Promise.all([call(`/${id}/responses/1/tickets`, 'POST', {}), call(`/${id}/responses/1/tickets`, 'POST', {})]);
    expect(first.status).toBe(202); expect(duplicate.status).toBe(202);
    const until = Date.now() + 15000;
    let saved = before;
    // The isolated child and its settlement sampler require the real platform clock.
    while (Date.now() < until) {
      saved = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
      if (saved.responseOperations?.[0]?.state !== 'generating' && saved.responseOperations?.[0]?.state !== 'publishing') break;
      await Bun.sleep(20);
    }
    expect(saved.responseOperations).toHaveLength(1);
    expect(saved.responseOperations![0]!.state).toBe('complete');
    expect(saved.responseOperations![0]!.tickets).toHaveLength(1);
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]!.creationHold).toBe(true);
    expect(await readFile(join(root, 'repo', '.omp-backlog', 'tickets', tickets()[0]!.id, 'attachments', 'source.txt'), 'utf8')).toBe('durable source');
    const generation = (await log(root)).filter(entry => entry.event === 'prompt').at(-1)?.message;
    expect(generation).toContain('Describe a useful change');
    expect(generation).not.toContain('Later unrelated requirement');
    await reopen();
    const reloaded = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect((await call(`/${id}/responses/1/tickets/retry`, 'POST', {})).status).toBe(409);
    expect(reloaded.responseOperations).toEqual(saved.responseOperations);
    expect(await (await call(`/${id}/attachments/1/source.txt`)).text()).toBe('durable source');
    expect((await call(`/${id}/responses/1/tickets`, 'POST', {})).status).toBe(202);
    expect((await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot).responseOperations).toHaveLength(1);
  }, 'extraction-valid', true);
}, 30000);

test('ticket generation can explicitly replace an unavailable model without changing frozen source or chat settings', async () => {
  await fixture(async ({ call, store, tickets, reopen }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const id = created.workspace.id;
    await call(`/${id}/session/turn`, 'POST', form('Document the expense tracker setup'), crypto.randomUUID());
    await waitFor(call, id, draft => draft.messages[1]?.status === 'complete');
    const original = store().get('agentWorkspaces', id)!;
    original.acceptedTurns[0]!.model = { provider: 'fixture', id: 'retired' };
    original.prompt = 'Keep this unsent message';
    store().save('agentWorkspaces', original);
    expect((await call(`/${id}/responses/1/tickets`, 'POST', { model: 'fixture/text' })).status).toBe(400);
    expect((await call(`/${id}/responses/1/tickets`, 'POST', {})).status).toBe(202);
    await settleResponseOperations(store());
    const failed = store().get('agentWorkspaces', id)!.responseOperations![0]!;
    expect(failed.state).toBe('interrupted');
    expect(failed.error).toContain('fixture/retired is unavailable');
    const discovered = await (await call(`/${id}/responses/1/models`, 'POST', { model: 'fixture/text' })).json();
    expect(discovered.models).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'vision', images: true }), expect.objectContaining({ id: 'text', images: false })]));
    expect(discovered.thinkingLevels).toEqual(['off']);
    expect(discovered.saved.model).toEqual({ provider: 'fixture', id: 'retired' });
    expect(discovered.requiresImages).toBe(false);
    expect((await call(`/${id}/responses/1/tickets/retry`, 'POST', { model: 'fixture/text', thinking: 'off' })).status).toBe(202);
    await settleResponseOperations(store());
    const saved = store().get('agentWorkspaces', id)!;
    expect(saved.responseOperations![0]).toMatchObject({ state: 'complete', sourceHash: failed.sourceHash, generation: { model: { provider: 'fixture', id: 'text' }, thinking: 'off' } });
    expect(saved.acceptedTurns).toEqual(original.acceptedTurns);
    expect(saved.messages).toEqual(original.messages);
    expect(saved.model).toEqual(original.model);
    expect(saved.thinking).toBe(original.thinking);
    expect(saved.prompt).toBe(original.prompt);
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]!.creationHold).toBe(true);
    expect((await call(`/${id}/responses/1/tickets/retry`, 'POST', { model: 'fixture/vision', thinking: 'medium' })).status).toBe(409);
    await reopen();
    expect(store().get('agentWorkspaces', id)!.responseOperations![0]!.generation).toEqual({ model: { provider: 'fixture', id: 'text' }, thinking: 'off' });
    expect(tickets()).toHaveLength(1);
  }, 'extraction-valid', true);
}, 30000);

test('generation model replacement cannot drop retained images or bypass thinking validation', async () => {
  await fixture(async ({ call, store, tickets, root }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const id = created.workspace.id;
    const initial = form('Implement the tracker shown in the reference');
    initial.append('files', new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')], 'reference.png'));
    expect((await call(`/${id}/session/turn`, 'POST', initial, crypto.randomUUID())).status).toBe(200);
    await waitFor(call, id, draft => draft.messages[1]?.status === 'complete');
    expect((await call(`/${id}/responses/1/tickets`, 'POST', { model: 'fixture/text', thinking: 'off' })).status).toBe(202);
    await settleResponseOperations(store());
    expect(store().get('agentWorkspaces', id)!.responseOperations![0]).toMatchObject({ state: 'interrupted', error: expect.stringContaining('does not support them') });
    expect(tickets()).toHaveLength(0);
    const models = await (await call(`/${id}/responses/1/models`, 'POST', {})).json();
    expect(models.requiresImages).toBe(true);
    expect((await call(`/${id}/responses/1/tickets/retry`, 'POST', { model: 'fixture/vision', thinking: 'unsupported' })).status).toBe(202);
    await settleResponseOperations(store());
    expect(store().get('agentWorkspaces', id)!.responseOperations![0]).toMatchObject({ state: 'interrupted', error: 'The saved thinking level is unavailable' });
    expect(tickets()).toHaveLength(0);
    expect((await call(`/${id}/responses/1/tickets/retry`, 'POST', { model: 'fixture/vision', thinking: 'off' })).status).toBe(202);
    await settleResponseOperations(store());
    expect(store().get('agentWorkspaces', id)!.responseOperations![0]!.state).toBe('complete');
    const prompts = (await log(root)).filter(entry => entry.event === 'prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts.at(-1)).toMatchObject({ images: 1 });
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]!.creationHold).toBe(true);
  }, 'extraction-valid', true);
}, 30000);

test('older completed responses create from their saved prefix without requiring a legacy wizard or later context', async () => {
  await fixture(async ({ call, tickets, store, root }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const id = created.workspace.id;
    await call(`/${id}/session/turn`, 'POST', form('Document the expense tracker setup'), crypto.randomUUID());
    await waitFor(call, id, draft => draft.messages[1]?.status === 'complete');
    await call(`/${id}/session`, 'DELETE');
    const saved = store().get('agentWorkspaces', id)!;
    delete saved.acceptedTurns[0]!.sourceContext;
    saved.messages.push({ role: 'user', text: 'LATER PRIVATE REQUIREMENT', status: 'complete' });
    saved.planRevisions.push({ id: 'later-plan', revisionHash: 'later', markdown: 'LATER PLAN MUST NOT LEAK', createdAt: Date.now() });
    saved.currentPlanRevisionId = 'later-plan';
    store().save('agentWorkspaces', saved);
    const before = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(before.eligibleResponseIndices).toEqual([1]);
    expect(tickets()).toEqual([]);
    expect((await call(`/${id}/responses/1/tickets`, 'POST', {})).status).toBe(202);
    await settleResponseOperations(store());
    const result = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(result.responseOperations?.[0]?.state).toBe('complete');
    expect(tickets()).toHaveLength(1);
    expect(tickets()[0]!.creationHold).toBe(true);
    const generation = (await log(root)).filter(entry => entry.event === 'prompt').at(-1)?.message;
    expect(generation).toContain('Document the expense tracker setup');
    expect(generation).not.toContain('LATER PRIVATE REQUIREMENT');
    expect(generation).not.toContain('LATER PLAN MUST NOT LEAK');
  }, 'extraction-valid', true);
}, 20000);

test('automatic decomposition preserves dependencies and clarification creates no tickets', async () => {
  await fixture(async ({ call, tickets }) => {
    for (const [prompt, expected] of [['FIXTURE:RESPONSE:MULTIPLE', 'complete'], ['FIXTURE:RESPONSE:QUESTIONS', 'clarification']] as const) {
      const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
      const id = created.workspace.id;
      expect((await call(`/${id}/session/turn`, 'POST', form(prompt), crypto.randomUUID())).status).toBe(200);
      await waitFor(call, id, draft => draft.messages[1]?.status === 'complete');
      expect((await call(`/${id}/responses/1/tickets`, 'POST', {})).status).toBe(202);
      const until = Date.now() + 15000;
      let result: AgentWorkspaceSnapshot | undefined;
      // Real child processes and native settlement use the platform clock.
      while (Date.now() < until) {
        result = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
        if (result.responseOperations?.[0]?.state !== 'generating' && result.responseOperations?.[0]?.state !== 'publishing') break;
        await Bun.sleep(20);
      }
      expect(result?.responseOperations?.[0]?.state).toBe(expected);
      if (expected === 'complete') {
        expect(result?.responseOperations?.[0]?.tickets).toHaveLength(2);
        expect(tickets()).toHaveLength(2);
        expect(tickets().find(ticket => ticket.dependencies.length)?.dependencies).toEqual([tickets().find(ticket => !ticket.dependencies.length)!.id]);
        expect(tickets().every(ticket => ticket.creationHold)).toBe(true);
      } else {
        expect(result?.responseOperations?.[0]?.questions?.length).toBeGreaterThan(0);
        expect(tickets()).toHaveLength(2);
      }
      await call(`/${id}/session`, 'DELETE');
    }
  }, 'extraction-valid', true);
}, 45000);

test('conversation edits and read-only historical records survive reopen without starting OMP', async () => {
  await fixture(async ({ call, reopen, repo, root, store }) => {
    const createdResponse = await call('', 'POST', { title: 'Review checkout' }); expect(createdResponse.status).toBe(201);
    const saved = await createdResponse.json() as AgentWorkspaceSnapshot; const id = saved.workspace.id;
    expect(saved.draft).toBeNull(); expect(saved.workspace.version).toBe(1);
    const retained = store().get('agentWorkspaces', id)!;
    retained.ticketMarkdown = 'Historical ticket text';
    retained.planRevisions = [{ id: 'old-plan', revisionHash: 'hash', markdown: 'Retained plan', createdAt: 1, approvedAt: 2 }];
    retained.currentPlanRevisionId = 'old-plan';
    store().save('agentWorkspaces', retained);
    expect((await call(`/${id}`, 'PATCH', { version: 1, prompt: 'Discuss checkout', title: 'Checkout plan' })).status).toBe(200);
    expect((await call(`/${id}`, 'PATCH', { version: 1, prompt: 'stale tab' })).status).toBe(409);
    for (const field of ['planMarkdown', 'ticketMarkdown', 'approvePlanRevisionId']) expect((await call(`/${id}`, 'PATCH', { version: 2, [field]: 'replacement' })).status).toBe(410);
    const same = await (await call(`/${id}`, 'PATCH', { version: 2, archived: true })).json() as AgentWorkspaceSnapshot;
    expect(same.workspace.planRevisions).toEqual(retained.planRevisions);
    expect(same.workspace.ticketMarkdown).toBe('Historical ticket text');
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
  await fixture(async ({ call, reopen, root, legacyTurn, store }) => {
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
    expect(afterTurn.workspace.title).toBe('Discuss the first requirement');
    expect(afterTurn.workspace.version).toBeGreaterThan(untouched.workspace.version);
    await reopen();
    const loaded = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(loaded.workspace.messages).toEqual(first.messages); expect(loaded.draft).toBeNull();
    expect((await call(`/${id}/session/turn`, 'POST', form('Discuss the first requirement'), key)).status).toBe(200);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(1);
    const reconnected = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(reconnected.draft?.model).toEqual({ provider: 'fixture', id: 'vision' }); expect(reconnected.draft?.thinking).toBe('off');
    expect(reconnected.draft?.messages).toEqual(first.messages);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(1);
    const historical = store().get('agentWorkspaces', id)!;
    historical.currentPlanRevisionId = 'retained-large-plan';
    historical.planRevisions.push({ id: 'retained-large-plan', revisionHash: 'historical', markdown: '@^'.repeat(16384), createdAt: 1 });
    store().save('agentWorkspaces', historical);
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


test('accepted chat clears the persisted composer, while a rejected request keeps its draft', async () => {
  await fixture(async ({ call, reopen }) => {
    const initial = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const id = initial.workspace.id;
    const message = 'Plan a small expense tracker\nKeep exports read-only';
    const edited = await (await call(`/${id}`, 'PATCH', { version: initial.workspace.version, prompt: message })).json() as AgentWorkspaceSnapshot;
    await call(`/${id}/connect`, 'POST', {});
    await call(`/${id}/session/model`, 'POST', { provider: 'fixture', modelId: 'vision' });
    expect((await call(`/${id}/session/turn`, 'POST', form(message))).status).toBe(400);
    expect((await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot).workspace.prompt).toBe(message);
    expect((await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot).workspace.title).toBe('Untitled workspace');
    const key = crypto.randomUUID();
    const response = await call(`/${id}/session/turn`, 'POST', form(message), key);
    expect(response.status).toBe(200);
    const acknowledgement = await response.json() as DraftSnapshot & { acceptedTurnKey?: string };
    expect(acknowledgement.acceptedTurnKey).toBe(key);
    expect(acknowledgement.messages[1]?.status).toBe('partial');
    const accepted = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(accepted.workspace.prompt).toBe('');
    expect(accepted.workspace.title).toBe('Plan a small expense tracker');
    expect(accepted.workspace.titleSource).toBe('automatic');
    expect(accepted.workspace.version).toBeGreaterThan(edited.workspace.version);
    expect(accepted.workspace.messages[0]?.text.replace(/\r\n/g, '\n')).toBe(message);
    const duplicate = await call(`/${id}/session/turn`, 'POST', form(message), key);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as DraftSnapshot & { acceptedTurnKey?: string }).acceptedTurnKey).toBe(key);
    await waitFor(call, id, draft => draft.status !== 'busy');
    await reopen();
    const restored = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(restored.workspace.prompt).toBe('');
    expect(restored.workspace.title).toBe('Plan a small expense tracker');
    expect((await (await call()).json() as AgentWorkspaceSummary[])[0]?.title).toBe('Plan a small expense tracker');
    expect(restored.workspace.messages[0]?.text.replace(/\r\n/g, '\n')).toBe(message);
  });
}, 20000);

test('existing untitled conversations get durable names without inference and manual names stay protected', async () => {
  await fixture(async ({ call, store, reopen, root }) => {
    const created = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const value = store().get('agentWorkspaces', created.workspace.id)!;
    value.messages = [{ role: 'user', text: '/skill:ponytail\n\n# **Personal expense tracker**\nUse React and TypeScript', status: 'complete' }];
    value.acceptedTurns = [{ key: 'old', hash: 'old', contextHash: 'old', contextVersion: 1, acceptedAt: 1, intent: 'discussion', sourceWorkspaceId: value.id, sourcePlanRevisionId: null, model: null, thinking: '', researchReferenceIds: [], userMessageIndex: 0, assistantMessageIndex: 1, status: 'failed' }];
    store().save('agentWorkspaces', value);
    const list = await (await call()).json() as AgentWorkspaceSummary[];
    expect(list[0]?.title).toBe('Personal expense tracker');
    await reopen();
    const restored = await (await call(`/${value.id}`)).json() as AgentWorkspaceSnapshot;
    expect(restored.workspace.title).toBe('Personal expense tracker');
    expect((await call(`/${value.id}`, 'PATCH', { version: restored.workspace.version, title: 'Untitled workspace' })).status).toBe(200);
    await reopen();
    expect((await (await call(`/${value.id}`)).json() as AgentWorkspaceSnapshot).workspace.title).toBe('Untitled workspace');
    const explicit = await (await call('', 'POST', { title: 'My custom name' })).json() as AgentWorkspaceSnapshot;
    const named = store().get('agentWorkspaces', explicit.workspace.id)!;
    named.messages = value.messages; named.acceptedTurns = value.acceptedTurns;
    store().save('agentWorkspaces', named);
    expect((await (await call(`/${named.id}`)).json() as AgentWorkspaceSnapshot).workspace.title).toBe('My custom name');
    const long = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot;
    const unicode = store().get('agentWorkspaces', long.workspace.id)!;
    unicode.messages = [{ role: 'user', text: '家計簿'.repeat(100), status: 'complete' }]; unicode.acceptedTurns = value.acceptedTurns;
    store().save('agentWorkspaces', unicode);
    const bounded = (await (await call(`/${unicode.id}`)).json() as AgentWorkspaceSnapshot).workspace.title;
    expect(bounded.endsWith('…')).toBe(true);
    expect(Buffer.byteLength(bounded)).toBeLessThanOrEqual(200);
    expect(bounded).not.toContain('\uFFFD');
    expect(await readFile(join(root, 'child.jsonl'), 'utf8').catch(() => '')).toBe('');
  });
});

test('streamed partials and provider failures are durable, honest and cannot be archived while busy', async () => {
  await fixture(async ({ call, reopen }) => {
    const opened = await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot; const id = opened.workspace.id;
    await call(`/${id}/connect`, 'POST', {});
    expect((await call(`/${id}/session/turn`, 'POST', form('FIXTURE:HOLD'))).status).toBe(400);
    await call(`/${id}/session/turn`, 'POST', form('FIXTURE:HOLD'), crypto.randomUUID());
    await waitFor(call, id, draft => !!draft.messages.at(-1)?.text);
    const busy = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(busy.workspace.messages.at(-1)?.status).toBe('partial'); expect(busy.workspace.title).toBe('FIXTURE:HOLD');
    expect((await call(`/${id}`, 'PATCH', { version: busy.workspace.version, archived: true })).status).toBe(409);
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

test('composer and workspace limits reject without deleting saved data and archived records count', async () => {
  await fixture(async ({ call }) => {
    const workspace = (await (await call('', 'POST', {})).json() as AgentWorkspaceSnapshot).workspace; const id = workspace.id;
    expect((await call(`/${id}`, 'PATCH', { version: 1, prompt: 'x'.repeat(32769) })).status).toBe(413);
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

test('a new chat selects an enumerated model without inference and rejects invented replacements', async () => {
  await fixture(async ({ call, root }) => {
    const id = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    const opened = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(opened.draft?.model).toEqual({ provider: 'fixture', id: 'vision' });
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

test('accepted receipts reconcile durably, pin original context, and abandoned keys can never dispatch', async () => {
  await fixture(async ({ call, reopen, root }) => {
    const id = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    await call(`/${id}/connect`, 'POST', {});
    const key = crypto.randomUUID();
    expect(await (await call(`/${id}/turns/${key}`)).json()).toEqual({ accepted: false });
    const send = form('Discuss this requirement'); send.set('contextVersion', '1'); send.set('intent', 'discussion');
    expect((await call(`/${id}/session/turn`, 'POST', send, key)).status).toBe(200);
    const accepted = await (await call(`/${id}/turns/${key}`)).json();
    expect(accepted.accepted).toBe(true); expect(accepted.receipt.intent).toBe('discussion');
    expect(accepted.receipt.contextHash).toMatch(/^[a-f0-9]+$/); expect(accepted.receipt.contextVersion).toBe(1);
    expect(accepted.receipt.sourceWorkspaceId).toBe(id); expect(accepted.receipt.sourcePlanRevisionId).toBeNull();
    await waitFor(call, id, draft => draft.status !== 'busy');
    await call(`/${id}`, 'PATCH', { version: 1, title: 'Later conversation title' });
    await call(`/${id}/session/model`, 'POST', { thinking: 'off' });
    await reopen();
    const reconciled = await (await call(`/${id}/turns/${key}`)).json();
    expect(reconciled.receipt.contextHash).toBe(accepted.receipt.contextHash); expect(reconciled.receipt.status).toBe('complete');
    expect(reconciled.receipt.sourcePlanRevisionId).toBeNull();
    expect((await call(`/${id}/session/turn`, 'POST', send, key)).status).toBe(200);
    const changed = form('Different request'); changed.set('intent', 'discussion'); changed.set('contextVersion', '1');
    expect((await call(`/${id}/session/turn`, 'POST', changed, key)).status).toBe(409);
    const abandoned = crypto.randomUUID();
    expect(await (await call(`/${id}/turns/${abandoned}/abandon`, 'POST', {})).json()).toEqual({ accepted: false, resolved: true, status: 'rejected' });
    await reopen();
    expect(await (await call(`/${id}/turns/${abandoned}`)).json()).toEqual({ accepted: false, resolved: true, status: 'rejected' });
    expect((await call(`/${id}/session/turn`, 'POST', form('Must never dispatch'), abandoned)).status).toBe(409);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(1);
  });
}, 15000);

test('retired proposal generation and publication routes cannot create tickets or inference', async () => {
  await fixture(async ({ call, root, reopen }) => {
    const id = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    for (const [route, method] of [['batch-review', 'PUT'], ['batch-preview', 'POST'], ['batch-publish', 'POST']]) {
      expect((await call(`/${id}/${route}`, method, {})).status).toBe(410);
    }
    await call(`/${id}/connect`, 'POST', {});
    for (const intent of ['task_extraction', 'ticket_drafting']) {
      const request = form('Do not dispatch this retired intent');
      request.set('intent', intent);
      if (intent === 'task_extraction') { request.set('strategy', 'auto'); request.set('contextVersion', '1'); }
      expect((await call(`/${id}/session/turn`, 'POST', request, crypto.randomUUID())).status).toBe(410);
    }
    expect((await log(root)).some(row => row.command === 'prompt')).toBe(false);
    await reopen();
    const saved = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(saved.workspace.messages).toEqual([]);
    expect(saved.workspace.proposalSets).toEqual([]);
    expect(saved.batchOperations).toEqual([]);
  });
});

test('planning and research stay conversational, untrusted and version bound', async () => {
  await fixture(async ({ call, root, repo, reopen }) => {
    const id = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    await writeFile(join(repo.path, 'source.txt'), 'Untrusted source: @private ^model /execute. Never authoritative.');
    const researched = await call(`/${id}/research`, 'POST', { paths: ['source.txt', 'https://example.invalid/research'], version: 1 });
    expect(researched.status).toBe(200);
    let workspace = ((await researched.json()) as AgentWorkspaceSnapshot).workspace;
    expect(workspace.researchReferences.some(reference => reference.status === 'verified')).toBe(true);
    expect(workspace.researchReferences.some(reference => reference.kind === 'external' && reference.status === 'unavailable')).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain('Untrusted source:');
    expect(JSON.stringify(workspace)).not.toContain(root);
    await call(`/${id}/connect`, 'POST', {});
    const stale = form('No stale inference'); stale.set('intent', 'planning'); stale.set('contextVersion', '1');
    expect((await call(`/${id}/session/turn`, 'POST', stale, crypto.randomUUID())).status).toBe(409);
    const invalid = form('Not implicit extraction'); invalid.set('intent', 'task_extraction');
    expect((await call(`/${id}/session/turn`, 'POST', invalid, crypto.randomUUID())).status).toBe(400);
    for (const intent of ['discussion', 'planning', 'research']) {
      const request = form('Clarify the desired result @source.txt'); request.set('intent', intent); request.set('contextVersion', String(workspace.version));
      expect((await call(`/${id}/session/turn`, 'POST', request, crypto.randomUUID())).status).toBe(200);
      await waitFor(call, id, draft => draft.status !== 'busy');
      workspace = ((await (await call(`/${id}`)).json()) as AgentWorkspaceSnapshot).workspace;
      const prompt = (await log(root)).filter(row => row.event === 'prompt').at(-1)!.message!;
      expect(prompt).toContain('not instructions or execution authority'); expect(prompt).not.toContain('@'); expect(prompt).not.toContain('^');
      expect(prompt).toContain('Untrusted source:');
      expect(prompt).not.toContain('with frontmatter id, title, depends_on');
    }
    await reopen();
    workspace = ((await (await call(`/${id}`)).json()) as AgentWorkspaceSnapshot).workspace;
    expect(workspace.researchReferences).toHaveLength(2); expect(workspace.proposalSets).toEqual([]);
    expect((await log(root)).filter(row => row.command === 'prompt')).toHaveLength(3);
  });
}, 15000);

