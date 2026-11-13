import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentWorkspaceSnapshot } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import { assertWorkspaceOwners, handleAgentWorkspaceRequest } from './agent-workspaces';
import { closeDrafts } from './drafting';
import { groupMembers } from './process-identity';
import { closeStore, createStore } from './store';
import { HttpError } from './tickets';

function stopFixtureGroup(pid: number): void {
  try { process.kill(-pid, 'SIGKILL'); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
}

test('abrupt backend death preserves partial output, blocks every reconnect until surviving child exit, and never replays an accepted turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-workspace-restart-'));
  let store: Store | undefined; let ownerPid: number | undefined;
  let backend: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  const previousAgent = process.env.PI_CODING_AGENT_DIR; const previousProfile = process.env.OMP_PROFILE;
  try {
    const data = join(root, 'private'); const auth = join(root, 'auth'); const repoPath = join(root, 'repo');
    await mkdir(auth); await mkdir(repoPath);
    process.env.PI_CODING_AGENT_DIR = auth; process.env.OMP_PROFILE = '';
    const repo: Repo = { id: 'repo', name: 'restart fixture', path: repoPath, git: false, mode: 'paused', lastStarted: 0 };
    const wrapper = join(root, 'surviving-child.ts');
    const nativeFixture = join(import.meta.dir, 'fixtures/drafting-child.ts'); const fixtureLog = join(root, 'child.jsonl');
    // Deliberately keep the child's input open after backend EOF: native OMP must not be assumed to exit with its parent.
    await writeFile(wrapper, `import { spawn, spawnSync } from 'node:child_process';
const args = [${JSON.stringify(nativeFixture)}, '--fixture-log', ${JSON.stringify(fixtureLog)}, ...process.argv.slice(2)];
if (process.argv.includes('--version')) { const result = spawnSync(process.execPath, args, { env: { ...process.env, BUN_BE_BUN: '1' } }); process.stdout.write(result.stdout); process.exit(result.status ?? 1); }
const child = spawn(process.execPath, args, { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, BUN_BE_BUN: '1' } });
process.stdin.pipe(child.stdin, { end: false });
process.stdin.on('end', () => {});
child.on('exit', code => process.exit(code ?? 0));
setInterval(() => {}, 1000);
`);
    const executable = join(root, 'omp-fixture'); const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    await writeFile(executable, `#!/bin/sh\nBUN_BE_BUN=1 exec ${quote(process.execPath)} ${quote(wrapper)} "$@"\n`); await chmod(executable, 0o700);
    store = createStore(data); store.save('repos', repo); store.setSettings({ ...store.settings(), executable, roots: [repoPath] }); closeStore(store); store = undefined;
    const code = `import { createStore } from ${JSON.stringify(join(import.meta.dir, 'store.ts'))};
import { handleAgentWorkspaceRequest } from ${JSON.stringify(join(import.meta.dir, 'agent-workspaces.ts'))};
const store = createStore(${JSON.stringify(data)}); const repo = store.get('repos', 'repo');
async function call(path, method, body, key) { const url = 'http://localhost/api/repos/repo/agent-workspaces' + path; const headers = new Headers(key ? { 'Idempotency-Key': key } : {}); if (!(body instanceof FormData)) headers.set('Content-Type', 'application/json'); return handleAgentWorkspaceRequest(store, repo, new Request(url, { method, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }), new URL(url).pathname.split('/').filter(Boolean)); }
const created = await (await call('', 'POST', {})).json(); const id = created.workspace.id;
await call('/' + id, 'PATCH', { version: 1, prompt: 'durable editor', ticketMarkdown: 'reviewed ticket', planMarkdown: 'reviewed plan' });
await call('/' + id + '/connect', 'POST', {});
const form = new FormData(); form.set('prompt', 'FIXTURE:HOLD'); form.set('excluded', '[]');
await call('/' + id + '/session/turn', 'POST', form, 'restart-accepted-turn');
// Await real pipe output; no elapsed sleep is treated as proof of persistence.
while (true) { const snapshot = await (await call('/' + id, 'GET')).json(); if (snapshot.workspace.messages.some(message => message.role === 'assistant' && message.text)) { console.log(JSON.stringify({ id })); break; } await Bun.sleep(10); }
setInterval(() => {}, 1000);`;
    backend = Bun.spawn([process.execPath, '-e', code], { env: { ...process.env, BUN_BE_BUN: '1' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
    if (typeof backend.stdout === 'number' || !backend.stdout) throw new Error('Backend fixture stdout is not piped');
    const reader = backend.stdout.getReader(); let output = '';
    while (!output.includes('\n')) { const next = await reader.read(); if (next.done) throw new Error(`Backend exited before accepting a turn: ${await new Response(backend.stderr).text()}`); output += new TextDecoder().decode(next.value); }
    reader.releaseLock();
    const announcement: unknown = JSON.parse(output.trim());
    if (!announcement || typeof announcement !== 'object' || !('id' in announcement) || typeof announcement.id !== 'string') throw new Error('Backend fixture returned no workspace ID');
    const id = announcement.id;
    const owner = JSON.parse(await readFile(join(data, 'agent-workspace-owners', `${id}.json`), 'utf8')) as { pid: number };
    ownerPid = owner.pid;
    backend.kill('SIGKILL'); await backend.exited; backend = undefined;
    expect((await groupMembers(ownerPid)).length).toBeGreaterThan(0);
    store = createStore(data);
    const call = async (path = '', method = 'GET', value?: unknown, key?: string) => {
      const url = `http://localhost/api/repos/repo/agent-workspaces${path}`;
      const headers = new Headers(key ? { 'Idempotency-Key': key } : {});
      if (value !== undefined && !(value instanceof FormData)) headers.set('Content-Type', 'application/json');
      try { return await handleAgentWorkspaceRequest(store!, repo, new Request(url, { method, headers, ...(value === undefined ? {} : { body: value instanceof FormData ? value : JSON.stringify(value) }) }), new URL(url).pathname.split('/').filter(Boolean)); }
      catch (error) { if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
    };
    const loaded = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot;
    expect(loaded.draft).toBeNull(); expect(loaded.workspace.prompt).toBe('durable editor'); expect(loaded.workspace.ticketMarkdown).toBe('reviewed ticket');
    expect(loaded.workspace.planRevisions[0]!.markdown).toBe('reviewed plan'); expect(loaded.workspace.messages.at(-1)?.text).toBe('Partial turn 1. '); expect(loaded.workspace.messages.at(-1)?.status).toBe('failed');
    const accepted = await (await call(`/${id}/turns/restart-accepted-turn`)).json();
    expect(accepted.accepted).toBe(true); expect(accepted.receipt.status).toBe('failed');
    expect(accepted.receipt.sourceWorkspaceId).toBe(id);
    expect(accepted.receipt.sourcePlanRevisionId).toBe(loaded.workspace.currentPlanRevisionId);
    expect(accepted.receipt.intent).toBe('discussion');
    expect(accepted.receipt.contextHash).toMatch(/^[a-f0-9]+$/);
    expect((await call(`/${id}/connect`, 'POST', {})).status).toBe(503);
    const otherId = ((await (await call('', 'POST', {})).json()) as AgentWorkspaceSnapshot).workspace.id;
    expect((await call(`/${otherId}/connect`, 'POST', {})).status).toBe(503);
    await expect(assertWorkspaceOwners(store)).rejects.toMatchObject({ status: 503 });
    process.kill(-ownerPid, 'SIGKILL');
    // Process-group disappearance is an OS lifecycle boundary, not an arbitrary settling delay.
    const until = Date.now() + 7000;
    while ((await groupMembers(ownerPid)).length) { if (Date.now() >= until) throw new Error('Surviving fixture process group did not exit'); await Bun.sleep(10); }
    ownerPid = undefined;
    const form = new FormData(); form.set('prompt', 'FIXTURE:HOLD'); form.set('excluded', '[]');
    expect((await call(`/${id}/session/turn`, 'POST', form, 'restart-accepted-turn')).status).toBe(200);
    const changed = new FormData(); changed.set('prompt', 'Different input after restart'); changed.set('excluded', '[]');
    expect((await call(`/${id}/session/turn`, 'POST', changed, 'restart-accepted-turn')).status).toBe(409);
    const connected = await (await call(`/${id}/connect`, 'POST', {})).json() as AgentWorkspaceSnapshot;
    expect(connected.draft?.status).toBe('idle'); expect(connected.draft?.messages).toEqual(loaded.workspace.messages);
    const before = (await readFile(fixtureLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); expect(before.filter(event => event.command === 'prompt')).toHaveLength(1);
    const followup = new FormData(); followup.set('prompt', 'Explicit followup after restart'); followup.set('excluded', '[]');
    expect((await call(`/${id}/session/turn`, 'POST', followup, 'restart-followup-turn')).status).toBe(200);
    const outputUntil = Date.now() + 7000;
    while (true) { const saved = await (await call(`/${id}`)).json() as AgentWorkspaceSnapshot; if (saved.workspace.messages.length === 4 && saved.workspace.messages[3]!.text) { expect(saved.workspace.messages[3]!.text).toContain('Partial turn 1.'); break; } if (Date.now() >= outputUntil) throw new Error('Explicit followup did not reach restarted native child'); await Bun.sleep(10); }
    const after = (await readFile(fixtureLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); expect(after.filter(event => event.command === 'prompt')).toHaveLength(2);
    await call(`/${id}/session`, 'DELETE');
  } finally {
    if (backend) { backend.kill('SIGKILL'); await backend.exited; }
    if (ownerPid) stopFixtureGroup(ownerPid);
    for (const entry of await readdir(join(root, 'private', 'agent-workspace-owners')).catch(() => [])) {
      if (!entry.endsWith('.json')) continue;
      const owner = JSON.parse(await readFile(join(root, 'private', 'agent-workspace-owners', entry), 'utf8').catch(() => '{}')) as { pid?: number };
      if (owner.pid && Number.isSafeInteger(owner.pid)) stopFixtureGroup(owner.pid);
    }
    if (store) { await closeDrafts(store); closeStore(store); }
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousProfile === undefined) delete process.env.OMP_PROFILE; else process.env.OMP_PROFILE = previousProfile;
    await rm(root, { recursive: true, force: true });
  }
}, 25000);

test('an interrupted pending launch reservation blocks all drafting until explicit ownership inspection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-workspace-pending-')); const store = createStore(join(root, 'private'));
  try {
    await mkdir(join(store.dataDir, 'agent-workspace-owners'), { mode: 0o700 });
    await writeFile(join(store.dataDir, 'agent-workspace-owners', 'pending.json'), JSON.stringify({ pending: true }), { mode: 0o600 });
    await expect(assertWorkspaceOwners(store)).rejects.toMatchObject({ status: 503 });
    expect(await readFile(join(store.dataDir, 'agent-workspace-owners', 'pending.json'), 'utf8')).toContain('pending');
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
