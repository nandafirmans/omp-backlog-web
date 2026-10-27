import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime, Settings, Store } from './contracts';
import { createRuntime, inspectWorkspaceHandoff } from './runtime';
import { closeStore, createStore, database, subscribe } from './store';
import { writeTicket } from './tickets';
import { createApi } from './api';

// These are process/protocol acceptance tests. The child verifies a disposable
// proof file; it does not exercise a real OMP installation, model, or credentials.
interface Event { event: string; pid: number; sessionId: string; command?: string; op?: string; resumed?: boolean; revision?: string; sessionFile?: string; level?: string; thinking?: string }
interface Harness { root: string; store: Store; executable: string; runtime: Runtime | null }

// Real timers are intentional: detached children and fs.watch run outside the
// test clock. Poll persisted state with a deadline instead of guessing completion.
async function waitFor<T>(description: string, observe: () => T | undefined | false | Promise<T | undefined | false>, timeout = 10_000): Promise<T> {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await observe();
    if (value !== undefined && value !== false) return value;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function events(repo: Repo): Promise<Event[]> {
  try { return (await readFile(join(repo.path, 'fixture-events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Event); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

async function withHarness(run: (harness: Harness) => Promise<void>, settings: Partial<Settings> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'omp-runtime-integration-'));
  const executable = join(root, 'protocol-child');
  await writeFile(executable, `#!${process.execPath}\nimport ${JSON.stringify(new URL('./fixtures/runtime-child.ts', import.meta.url).href)};\n`, { mode: 0o700 });
  const store = createStore(join(root, 'private'));
  store.setSettings({ ...store.settings(), roots: [root], executable, ...settings });
  const harness: Harness = { root, store, executable, runtime: null };
  try { await run(harness); }
  finally {
    await harness.runtime?.close();
    closeStore(store);
    // Snapshot directories are deliberately immutable; unlock only this fixture.
    async function unlock(path: string) {
      await chmod(path, 0o700);
      for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory()) await unlock(join(path, entry.name));
    }
    await unlock(root);
    await rm(root, { recursive: true, force: true });
  }
}

async function repository(harness: Harness, id: string, lastStarted = 0, scenario = 'hold'): Promise<Repo> {
  const path = join(harness.root, id);
  await mkdir(path);
  await writeFile(join(path, 'fixture.json'), JSON.stringify({ scenario, tokens: 7 }));
  const repo: Repo = { id, name: id, path, git: false, mode: 'automatic', lastStarted };
  harness.store.save('repos', repo);
  return repo;
}

async function ticket(harness: Harness, repo: Repo, id = 'T001') {
  const markdown = `---\nid: ${id}\ntitle: Disposable proof\ndepends_on: []\n---\n# Goal\nWrite a disposable proof file.\n# Acceptance criteria\n- proof.txt contains verified.\n# Verification\nRead proof.txt.\n`;
  const value = await writeTicket(harness.store, repo, markdown);
  harness.store.save('tickets', { ...value, status: 'ready', approvedRevision: value.revision });
  return value;
}

async function start(harness: Harness) {
  harness.runtime = await createRuntime(harness.store);
  await harness.runtime.reconcile();
}

async function running(harness: Harness, repoId?: string): Promise<Run> {
  return waitFor('a running child with its completion barrier', () => harness.store.list('runs').find(run => run.status === 'running' && run.dialog?.id === 'finish' && (!repoId || run.repoId === repoId)));
}

async function finish(harness: Harness, run: Run) {
  await harness.runtime!.answer(run.id, { id: 'finish', value: 'finish' });
  return waitFor('revision-bound evidence and observed child exit', () => {
    const current = harness.store.get('runs', run.id);
    return current?.status === 'needs_review' && current.pid === null ? current : undefined;
  });
}

test('Run Live persists sanitized structured tool snapshots, settlement and same-session history', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'transcript', 0, 'transcript');
    await ticket(harness, repo);
    await start(harness);
    const first = await running(harness);
    expect(first.conversation?.[0]?.kind).toBe('user');
    expect(first.conversation?.[0]?.text).toContain('Disposable proof');
    expect(first.conversation?.[0]?.text).not.toContain('The web scheduler');
    expect(first.conversation?.filter(entry => entry.kind === 'agent')).toHaveLength(2);
    const tool = first.conversation?.find(entry => entry.toolName === 'bash');
    expect(tool?.state).toBe('running');
    expect(tool?.input).toContain('read proof.txt');
    expect(tool?.output).toContain('Reading proof.txt');
    expect(tool?.output?.match(/Reading/g)).toHaveLength(1);
    expect(JSON.stringify(first.conversation)).not.toContain('fixture-secret');
    expect(JSON.stringify(first.conversation)).not.toContain('fixture-nested-secret');
    await harness.runtime!.control(first.id, 'pause');
    const paused = harness.store.get('runs', first.id)!;
    expect(paused.conversation?.some(entry => entry.state === 'running')).toBe(false);
    expect(paused.conversation?.find(entry => entry.id === tool?.id)?.text).toContain('Stopped before completion');
    const prior = structuredClone(paused.conversation!);
    await harness.runtime!.control(first.id, 'resume');
    const resumed = await running(harness);
    expect(resumed.conversation?.slice(0, prior.length)).toEqual(prior);
    expect(resumed.conversation?.filter(entry => entry.kind === 'agent')).toHaveLength(4);
    const completed = await finish(harness, resumed);
    expect(completed.conversation?.some(entry => entry.state === 'running')).toBe(false);
    const bash = completed.conversation?.filter(entry => entry.toolName === 'bash');
    expect(bash?.map(entry => entry.state)).toEqual(['error', 'complete']);
    expect(bash?.at(-1)?.output).toContain('Proof checked; exit 0');
    const receipt = completed.conversation?.find(entry => entry.toolName === 'backlog_evidence');
    expect(receipt?.input).toContain('base64 bytes omitted');
    expect(receipt?.input).not.toContain('dmVyaWZpZWQK');
    expect(receipt?.state).toBe('complete');
    const reloaded = createStore(harness.store.dataDir);
    try {
      expect(reloaded.get('runs', completed.id)?.conversation).toEqual(completed.conversation);
      expect(reloaded.get('runs', completed.id)?.transcript).toBe(completed.transcript);
    } finally { closeStore(reloaded); }
    const log = await readFile(join(harness.store.dataDir, 'runtime', completed.id, 'transcript.log'), 'utf8');
    expect(log).toContain('Checking the **proof**');
    expect(log).not.toContain('fixture-secret');
    expect(log).not.toContain('fixture-nested-secret');
  });
}, 15_000);

test('fresh execution applies exact thinking before prompting and resume preserves session thinking', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'thinking');
    await ticket(harness, repo);
    await start(harness);
    const first = await running(harness);
    const log = await events(repo);
    expect(log.find(event => event.event === 'prompt-admitted')?.thinking).toBe('high');
    expect(log.findIndex(event => event.command === 'set_thinking_level' && event.level === 'high')).toBeLessThan(log.findIndex(event => event.command === 'prompt'));
    await harness.runtime!.control(first.id, 'pause');
    harness.store.setSettings({ ...harness.store.settings(), thinking: 'off', model: 'other/model' });
    await harness.runtime!.control(first.id, 'resume');
    const resumed = await running(harness);
    const resumedEvents = (await events(repo)).filter(event => event.pid === resumed.pid);
    expect(resumedEvents.some(event => event.command === 'set_thinking_level' || event.command === 'get_available_thinking_levels')).toBe(false);
    expect(resumedEvents.find(event => event.event === 'prompt-admitted')?.thinking).toBe('high');
    await finish(harness, resumed);
  }, { thinking: 'high' });
}, 15000);

test('absent and empty thinking retain the OMP default without override RPC', async () => {
  for (const settings of [{}, { thinking: '' }]) {
    await withHarness(async harness => {
      const repo = await repository(harness, 'default-thinking');
      await ticket(harness, repo);
      await start(harness);
      const run = await running(harness);
      const log = await events(repo);
      expect(log.some(event => event.command === 'set_thinking_level' || event.command === 'get_available_thinking_levels')).toBe(false);
      expect(log.find(event => event.event === 'prompt-admitted')?.thinking).toBe('medium');
      await finish(harness, run);
    }, settings);
  }
}, 15000);

test('unsupported or silently clamped thinking fails before prompting or starting a goal', async () => {
  for (const [thinking, scenario, error] of [['xhigh', 'hold', 'not supported'], ['high', 'clamp-thinking', 'exact configured thinking']] as const) {
    await withHarness(async harness => {
      const repo = await repository(harness, 'unsupported-thinking', 0, scenario);
      await ticket(harness, repo);
      await start(harness);
      const failed = await waitFor('thinking rejection and observed child exit', () => harness.store.list('runs').find(run => run.status === 'failed' && run.pid === null));
      expect(failed.error).toContain(error);
      const log = await events(repo);
      expect(log.some(event => event.command === 'prompt' || (event.command === 'goal' && ['create', 'resume'].includes(String(event.op))))).toBe(false);
      if (thinking === 'xhigh') expect(log.some(event => event.command === 'set_thinking_level')).toBe(false);
    }, { thinking });
  }
}, 15000);

test('actual child transport enforces the global slot and rotates fairly between repositories', async () => {
  await withHarness(async harness => {
    const first = await repository(harness, 'a', 0);
    const second = await repository(harness, 'b', 100);
    await ticket(harness, first, 'T001');
    await ticket(harness, first, 'T002');
    await ticket(harness, second, 'T001');
    await start(harness);
    const one = await running(harness, first.id);
    await Promise.all(Array.from({ length: 12 }, () => harness.runtime!.reconcile()));
    expect(harness.store.list('runs')).toHaveLength(1);
    expect((await events(second)).filter(event => event.event === 'spawn')).toHaveLength(0);
    await finish(harness, one);
    const two = await running(harness, second.id);
    expect(harness.store.list('runs')).toHaveLength(2);
    expect(two.started).toBeGreaterThanOrEqual(harness.store.get('runs', one.id)!.finished!);
    await finish(harness, two);
    const three = await running(harness, first.id);
    expect(three.ticketId).toBe('T002');
    expect(harness.store.list('runs').filter(run => run.pid !== null)).toHaveLength(1);
    await finish(harness, three);
    expect(harness.store.list('runs').every(run => run.status === 'needs_review' && run.pid === null)).toBe(true);
    expect(harness.store.list('tickets').every(value => value.status === 'needs_review')).toBe(true);
  });
}, 20_000);

test('operator reconciliation gates one Git project without consuming tickets; clean recheck never changes files or approval', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'git-handoff');
    const init = Bun.spawn(['git', 'init', '--quiet', repo.path], { stdout: 'ignore', stderr: 'ignore' });
    expect(await init.exited).toBe(0);
    // No commits/reset/stash, even in fixture. Preserve operator files by moving to owned archive.
    await writeFile(join(repo.path, '.git/info/exclude'), 'fixture.json\nfixture-events.jsonl\n');
    repo.git = true; harness.store.save('repos', repo);
    const first = await ticket(harness, repo);
    await ticket(harness, repo, 'T002');
    await writeFile(join(repo.path, 'operator.txt'), 'unrelated operator work\n');
    await start(harness);
    const gate = await waitFor('project-level dirty-workspace gate', () => harness.store.get('repos', repo.id)?.handoff);
    expect(gate.files).toContain('operator.txt');
    expect(harness.store.list('runs')).toHaveLength(0);
    expect(harness.store.list('tickets').every(value => value.status === 'ready')).toBe(true);
    expect(harness.store.get('tickets', `${repo.id}/T001`)!.approvedRevision).toBe(first.revision);

    const password = crypto.randomUUID() + crypto.randomUUID();
    database(harness.store).query('INSERT INTO owner VALUES(1,?,?)').run('fixture', await Bun.password.hash(password));
    const api = createApi(harness.store, harness.runtime!);
    const origin = 'http://127.0.0.1:4310';
    const login = await api(new Request(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fixture', password }) }));
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const { csrf } = await login.json() as { csrf: string };
    const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    const recheck = (handoffId: string, authenticated = true) => api(new Request(`${origin}/api/repos/${repo.id}/reconcile-workspace`, { method: 'POST', headers: authenticated ? headers : { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ handoffId }) }));
    expect((await recheck(gate.id, false)).status).toBe(401);
    expect((await recheck('stale')).status).toBe(409);
    expect((await recheck(gate.id)).status).toBe(409);
    expect(await readFile(join(repo.path, 'operator.txt'), 'utf8')).toBe('unrelated operator work\n');
    await rename(join(repo.path, 'operator.txt'), join(harness.root, 'preserved-operator.txt'));
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(0); // Merely becoming clean cannot clear gate.
    expect((await recheck(gate.id)).status).toBe(200);
    const run = await running(harness);
    await finish(harness, run);
    const after = harness.store.get('repos', repo.id)!.handoff!;
    expect(after.runId).toBe(run.id);
    expect(after.files).toContain('proof.txt');
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1);
    const done = await api(new Request(`${origin}/api/tickets/${repo.id}/T001/action`, { method: 'POST', headers, body: JSON.stringify({ action: 'done', revision: first.revision }) }));
    expect(done.status).toBe(200);
    expect(harness.store.get('repos', repo.id)!.handoff!.id).toBe(after.id);
    expect((await recheck(after.id)).status).toBe(409);
    await rename(join(repo.path, 'proof.txt'), join(harness.root, 'preserved-proof.txt'));
    const reviewed = harness.store.get('runs', run.id)!;
    harness.store.save('runs', { ...reviewed, status: 'paused' });
    expect((await recheck(after.id)).status).toBe(409); // Even clean work cannot bypass an owned slot.
    expect(harness.store.get('repos', repo.id)!.handoff!.id).toBe(after.id);
    harness.store.save('runs', reviewed);
    const unavailable = await inspectWorkspaceHandoff({ ...repo, path: join(harness.root, 'missing-repository') });
    expect(unavailable?.reason).toContain('inspection unavailable');
    harness.store.setSettings({ ...harness.store.settings(), paused: true });
    expect((await recheck(after.id)).status).toBe(200);
    expect(harness.store.get('repos', repo.id)!.handoff).toBeUndefined();
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1); // Global pause still applies.
    expect(await readFile(join(harness.root, 'preserved-operator.txt'), 'utf8')).toBe('unrelated operator work\n');
    expect(await readFile(join(harness.root, 'preserved-proof.txt'), 'utf8')).toBe('verified\n');
  });
}, 15_000);

test('duplicate real fs.watch events launch once without manual scheduler wakes', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'watched');
    const value = await ticket(harness, repo);
    await start(harness);
    // Drain createRuntime's initial wake while scheduling remains globally paused.
    await Bun.sleep(1_200);
    expect(harness.store.list('runs')).toHaveLength(0);
    const observed: string[] = [];
    const observer = watch(join(repo.path, '.omp-backlog'), { recursive: true }, (_event, name) => observed.push(String(name)));
    try {
      harness.store.setSettings({ ...harness.store.settings(), paused: false });
      const path = join(repo.path, '.omp-backlog', 'tickets', value.id, 'ticket.md');
      for (let index = 0; index < 6; index++) { await writeFile(path, value.markdown); await Bun.sleep(30); }
      await waitFor('multiple operating-system watch deliveries', () => observed.length >= 2);
      const run = await running(harness);
      expect(harness.store.list('runs')).toHaveLength(1);
      expect((await events(repo)).filter(event => event.event === 'spawn')).toHaveLength(1);
      await finish(harness, run);
      // More physical writes must not replay completed work in automatic mode.
      await writeFile(path, value.markdown);
      await Bun.sleep(1_300);
      expect(harness.store.list('runs')).toHaveLength(1);
    } finally { observer.close(); }
  }, { paused: true });
}, 15_000);

test('provider failure after successful prompt admission fails the run and never infers completion', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'provider-failure', 0, 'provider-failure');
    await ticket(harness, repo);
    await start(harness);
    const run = await waitFor('provider failure and observed shutdown', () => harness.store.list('runs').find(value => value.status === 'failed' && value.pid === null));
    const log = await events(repo);
    expect(log.some(event => event.event === 'prompt-admitted')).toBe(true);
    expect(log.some(event => event.event === 'executing')).toBe(true);
    expect(log.some(event => event.event === 'result-accepted')).toBe(false);
    expect(run.error).toContain('Deterministic provider failure after admission');
    expect(run.evidence).toEqual([]);
    expect(run.conversation?.some(entry => entry.text.includes('Partial investigation before provider failure.'))).toBe(true);
    expect(run.conversation?.some(entry => entry.state === 'running')).toBe(false);
    expect(run.conversation?.find(entry => entry.toolName === 'read')?.state).toBe('error');
    expect(harness.store.get('tickets', `${repo.id}/T001`)?.status).toBe('failed');
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1);
  });
}, 15_000);

test('pause retains the claim and resume uses the same durable session and immutable run', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'paused');
    await ticket(harness, repo);
    await ticket(harness, repo, 'T002');
    await start(harness);
    const before = await running(harness);
    const session = await readFile(before.sessionFile!, 'utf8');
    await harness.runtime!.control(before.id, 'pause');
    const paused = harness.store.get('runs', before.id)!;
    expect(paused.status).toBe('paused');
    expect(paused.pid).toBeNull();
    expect(paused.finished).toBeNull();
    expect(paused.progress?.phase).toBe('Paused; execution slot retained');
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1);
    await harness.runtime!.control(before.id, 'resume');
    const resumed = await running(harness);
    expect(resumed.id).toBe(before.id);
    expect(resumed.started).toBe(before.started);
    expect(resumed.revision).toBe(before.revision);
    expect(resumed.snapshot).toBe(before.snapshot);
    expect(resumed.sessionId).toBe(before.sessionId);
    expect(resumed.sessionFile).toBe(before.sessionFile);
    expect(resumed.pid).not.toBe(before.pid);
    expect(await readFile(resumed.sessionFile!, 'utf8')).toBe(session);
    const log = await events(repo);
    expect(log.filter(event => event.event === 'spawn').map(event => event.resumed)).toEqual([false, true]);
    const resumedCommands = log.filter(event => event.pid === resumed.pid && event.event === 'command');
    expect(resumedCommands.filter(event => event.command === 'goal').map(event => event.op)).toEqual(['pause', 'resume']);
    expect(resumedCommands.findIndex(event => event.command === 'prompt')).toBeLessThan(resumedCommands.findIndex(event => event.command === 'goal' && event.op === 'resume'));
    await finish(harness, resumed);
  });
}, 15_000);

test('editing active requirements cannot apply old evidence to the new revision or silently replay it', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'edited');
    const original = await ticket(harness, repo);
    await start(harness);
    const run = await running(harness);
    const updated = await writeTicket(harness.store, repo, original.markdown.replace('Write a disposable proof file.', 'Write an updated disposable proof file.'), original.revision, original.id);
    expect(updated.revision).not.toBe(run.revision);
    expect(updated.status).toBe('running');
      const completed = await finish(harness, run);
    expect(completed.revision).toBe(original.revision);
    expect(completed.evidence).toHaveLength(1);
    expect(await readFile(join(completed.snapshot, 'ticket.md'), 'utf8')).toBe(original.markdown);
    const current = harness.store.get('tickets', `${repo.id}/${original.id}`)!;
    expect(current.revision).toBe(updated.revision);
    expect(current.status).toBe('draft');
    expect(current.approvedRevision).toBeNull();
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1);
  });
}, 15_000);

test('blocked result stops an unsettled goal without completing it or rerunning; proof and feedback survive fresh attempts', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'blocked', 0, 'blocked');
    await ticket(harness, repo);
    await start(harness);
    const run = await running(harness);
    await harness.runtime!.answer(run.id, { id: 'finish', value: 'finish' });
    const blocked = await waitFor('host-owned blocked shutdown', () => {
      const value = harness.store.get('runs', run.id);
      return value?.status === 'blocked' && value.pid === null ? value : undefined;
    });
    expect(blocked.blocker).toContain('Operator supplies prerequisite');
    expect(blocked.progress?.phase).toBe('Owned child work stopped');
    const log = await events(repo);
    expect(log.some(event => event.command === 'goal' && event.op === 'pause')).toBe(true);
    expect(log.some(event => event.op === 'complete')).toBe(false);
    await harness.runtime!.reconcile();
    expect(harness.store.list('runs')).toHaveLength(1);

    // Simulate an operator-authorized next attempt; API feedback validation has separate coverage.
    const message = 'Check the alternate user entry point.';
    harness.store.save('runs', { ...blocked, reviewFeedback: { message, recorded: Date.now() } });
    await writeFile(join(repo.path, 'fixture.json'), JSON.stringify({ scenario: 'hold', expectedFeedback: message }));
    const selected = harness.store.get('tickets', `${repo.id}/T001`)!;
    harness.store.save('tickets', { ...selected, status: 'ready' });
    harness.runtime!.wake();
    const next = await running(harness);
    expect(next.id).not.toBe(blocked.id);
    const completed = await finish(harness, next);
    expect(completed.verification).toHaveLength(1);
    const artifact = completed.verification![0]!.artifact!;
    expect(await readFile(join(harness.store.dataDir, 'proof', completed.id, artifact.id), 'utf8')).toBe('verified\n');
    expect(harness.store.get('runs', blocked.id)!.reviewFeedback!.message).toBe(message);
  });
}, 15_000);

test('startup terminates an identity-matched surviving child before interrupting it, without replay', async () => {
  await withHarness(async harness => {
    const repo = await repository(harness, 'recovery');
    const selected = await ticket(harness, repo);
    const id = 'surviving-run';
    const directory = join(harness.store.dataDir, 'runtime', id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'ticket.json'), JSON.stringify(selected));
    await writeFile(join(directory, 'config.yml'), '');
    const child = spawn(harness.executable, ['--config', join(directory, 'config.yml'), '--session-dir', join(directory, 'sessions')], { cwd: repo.path, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'close');
    child.stdout.resume(); child.stderr.resume();
    try {
      await waitFor('surviving fixture startup', async () => (await events(repo)).find(event => event.event === 'spawn'));
      const pid = child.pid!;
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const startTime = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
      await writeFile(join(directory, 'identity.json'), JSON.stringify({ pid, start: startTime, boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() }));
      const run: Run = { id, repoId: repo.id, ticketId: selected.id, revision: selected.revision, status: 'running', started: Date.now(), finished: null, pid, sessionId: null, sessionFile: null, snapshot: '', transcript: '', evidence: [], blocker: null, changedFiles: '', dialog: null, error: null };
      harness.store.save('runs', run);
      harness.store.save('tickets', { ...selected, status: 'running', runId: id });
      await start(harness);
      expect((await exited)[1]).toBe('SIGTERM');
      await harness.runtime!.reconcile();
      expect(harness.store.get('runs', id)?.status).toBe('interrupted');
      expect(harness.store.get('runs', id)?.pid).toBeNull();
      expect(harness.store.get('tickets', `${repo.id}/${selected.id}`)?.status).toBe('interrupted');
      await harness.runtime!.reconcile();
      expect(harness.store.list('runs')).toHaveLength(1);
      const log = await events(repo);
      expect(log.filter(event => event.event === 'spawn')).toHaveLength(1);
      expect(log.filter(event => event.event === 'command')).toHaveLength(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
}, 15_000);

for (const limit of ['time', 'tokens'] as const) {
  test(`${limit} limit transitions through stopping to failed without releasing a live child or replaying`, async () => {
    await withHarness(async harness => {
      const repo = await repository(harness, limit, 0, limit === 'tokens' ? 'tokens' : 'hold');
      await ticket(harness, repo);
      await start(harness);
      const run = await running(harness);
      const transitions: Run[] = [];
      const unsubscribe = subscribe(harness.store, () => {
        const current = harness.store.get('runs', run.id);
        if (current) transitions.push(current);
      });
      let failed: Run;
      try {
        failed = await waitFor(`${limit} budget failure`, () => {
          const current = harness.store.get('runs', run.id);
          return current?.status === 'failed' && current.pid === null ? current : undefined;
        });
      } finally { unsubscribe(); }
      expect(transitions.some(value => value.status === 'stopping' && value.pid === run.pid)).toBe(true);
      expect(transitions.at(-1)?.status).toBe('failed');
      expect(failed.error).toContain(`Execution ${limit === 'tokens' ? 'token' : 'time'} budget exhausted`);
      expect(failed.evidence).toEqual([]);
      expect(harness.store.get('tickets', `${repo.id}/T001`)?.status).toBe('failed');
      const log = await events(repo);
      expect(log.some(event => event.event === 'exit')).toBe(true);
      if (limit === 'tokens') expect(log.some(event => event.command === 'get_session_stats')).toBe(true);
      if (limit === 'tokens') {
        expect(failed.progress?.tokens?.total).toBe(7);
        expect(failed.progress?.tokens?.basis).toContain('session total');
      }
      await harness.runtime!.reconcile();
      expect(harness.store.list('runs')).toHaveLength(1);
    }, limit === 'time' ? { timeLimitMinutes: 0.05 } : { tokenBudget: 7 });
  }, 15_000);
}
