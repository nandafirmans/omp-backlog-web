import { expect, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Repo, Run, Runtime } from './contracts';
import { recipeIdentity } from './autonomy';
import { privateProfile, provider, model } from './fixtures/native-provider';
import { object, RpcProcess } from './rpc';
import { createRuntime } from './runtime';
import { closeStore, createStore, digest, subscribe } from './store';
import { writeTicket } from './tickets';
import { workspaceInternals } from './workspace-commit';
import { redactTranscript } from './transcript';

const nativeTest = process.env.OMP_BACKLOG_NATIVE_TESTS === '1' ? test : test.skip;
const correct = 'export function normalizeLabel(value: string): string { return value.trim(); }\n';
const broken = 'export function normalizeLabel(value: string): string { return value.replace(/\\s+/g, ""); }\n';
const criterion = 'normalizeLabel trims surrounding whitespace and preserves internal whitespace.';

async function until<T>(observe: () => T | undefined | Promise<T | undefined>, label: string, timeout = 90_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await observe();
    if (result !== undefined) return result;
    // Native children and filesystem watchers require the platform clock, not fake timers.
    await Bun.sleep(20);
  }
  throw new Error(`Native recovery timed out: ${label}`);
}

interface OwnedGroup { pid: number; start: string; boot: string }
async function stopOwnedGroups(root: string) {
  const receipts = (await readFile(join(root, 'owned-groups.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const directory = join(root, 'private', 'runtime');
  for (const run of await readdir(directory).catch(() => [])) {
    const receipt = await readFile(join(directory, run, 'identity.json'), 'utf8').catch(() => '');
    if (receipt) receipts.push(receipt);
  }
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const failures: unknown[] = [];
  for (const receipt of receipts) {
    try {
      const record = JSON.parse(receipt) as OwnedGroup;
      assert(Number.isSafeInteger(record.pid) && record.pid > 1 && typeof record.start === 'string' && record.start && record.boot);
      if (record.boot !== boot) continue;
      let fields: string[];
      try {
        const value = readFileSync(`/proc/${record.pid}/stat`, 'utf8');
        fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      } catch (caught) { if (['ENOENT', 'ESRCH'].includes(String(object(caught).code))) continue; throw caught; }
      if (fields[19] !== record.start || Number(fields[2]) !== record.pid || ['Z', 'X'].includes(fields[0]!)) continue;
      // No await between identity validation and signalling this exact owned group.
      try { process.kill(-record.pid, 'SIGKILL'); }
      catch (caught) { if (object(caught).code !== 'ESRCH') throw caught; }
      await until(async () => {
        const value = await readFile(`/proc/${record.pid}/stat`, 'utf8').catch(() => '');
        if (!value) return true;
        const current = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
        return current[19] !== record.start || ['Z', 'X'].includes(current[0]!) ? true : undefined;
      }, 'owned fallback process exit', 5000);
    } catch (caught) { failures.push(caught); }
  }
  if (failures.length) throw new AggregateError(failures, 'Owned native cleanup requires assistance');
}

for (const scenario of ['host_failure', 'author_blocker', 'incomplete_verification', 'nonreproducible', 'reviewer_escalation'] as const) nativeTest(`native injected recovery: ${scenario}`, async () => {
  if (!process.env.OMP_BACKLOG_NATIVE_RECOVERY_CHILD) {
    const root = await mkdtemp(join(tmpdir(), `omp-recovery-native-${scenario}-`));
    const profile = await privateProfile(join(root, 'bootstrap'), 'http://127.0.0.1:9', false);
    const child = Bun.spawn([process.execPath, 'test', import.meta.path, '-t', `native injected recovery: ${scenario}$`], {
      cwd: import.meta.dir, env: { ...profile.env, OMP_BACKLOG_NATIVE_TESTS: '1', OMP_BACKLOG_NATIVE_RECOVERY_CHILD: scenario, OMP_BACKLOG_NATIVE_RECOVERY_ROOT: root },
      stdout: 'pipe', stderr: 'pipe', timeout: 115_000, killSignal: 'SIGKILL',
    });
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      console.log(redactTranscript(stdout));
      assert.equal(code, 0, redactTranscript(stderr));
    } catch (caught) {
      if (!await stat(join(root, 'proof.json')).catch(() => undefined)) {
        const proof = { tier: 'native_synthetic_provider', scenario, verdict: 'NATIVE_INJECTED_RECOVERY_INCONCLUSIVE', error: redactTranscript(String(caught)), dataDir: join(root, 'private'), nativeEvents: join(root, 'native-events.jsonl'), modelRequests: join(root, 'model-requests.jsonl'), ownership: join(root, 'owned-groups.jsonl') };
        await writeFile(join(root, 'proof.json'), JSON.stringify(proof, null, 2), { mode: 0o600 });
      }
      throw caught;
    } finally {
      await stopOwnedGroups(root);
      for (const profile of ['bootstrap', 'author-profile', 'review-profile']) await rm(join(root, profile, 'home', '.omp', 'natives'), { recursive: true, force: true });
    }
    return;
  }
  assert.equal(process.env.OMP_BACKLOG_NATIVE_RECOVERY_CHILD, scenario);
  const root = process.env.OMP_BACKLOG_NATIVE_RECOVERY_ROOT!;
  await chmod(root, 0o700);
  const path = join(root, 'project');
  await mkdir(path, { mode: 0o700 });
  let store = createStore(join(root, 'private'));
  const repo: Repo = { id: 'native-recovery', name: 'Disposable native recovery', path, git: true, mode: 'approved', lastStarted: 0 };
  const git = async (...args: string[]) => (await workspaceInternals.checked(repo, args)).trim();
  const events: unknown[] = [];
  const transitions: { runId: string; revision: string; sessionId: string | null; sessionFile: string | null; configuration: Run['configuration']; deadline?: number; history: unknown; phase?: string; reviews: number; publication: unknown }[] = [];
  const requests: { role: string; step: number; tools: string[]; toolResults: { bytes: number; hash: string }[]; bytes: number }[] = [];
  const failures: string[] = [];
  const sessions: { role: string; resumed: boolean; pid: number; sessionId: unknown; sessionFile: unknown; inode: number; args: string[]; tools: string[]; goal: unknown }[] = [];
  const states: { role: string; sessionId: unknown; sessionFile: unknown; tools: string[]; goal: unknown }[] = [];
  const children: RpcProcess[] = [];
  const calls: { id: string; name: string; turn: number; reviewer: boolean }[] = [];
  let admittedRequests = 0;
  let runtime: Runtime | undefined;
  let original: Run | undefined;
  let initialHead = '';
  let ompVersion = '';
  let restartProof: unknown;
  let verdict = 'NATIVE_INJECTED_RECOVERY_INCONCLUSIVE';
  let error: string | undefined;
  let publication: unknown;
  let authorTurn = 0;
  let authorStep = 0;
  let reviewStep = 0;
  let previousTransition = '';
  const started = Date.now();
  // Cancel real owned work before the parent hard deadline; retain cleanup grace.
  const shutdownDeadline = setTimeout(() => {
    failures.push('Native harness overall deadline exceeded');
    void runtime?.close().catch(caught => failures.push(String(caught)));
    for (const child of children) void child.shutdown().catch(caught => failures.push(String(caught)));
  }, 75_000);
  const unsubscribe = subscribe(store, () => {
    const run = store.list('runs')[0];
    if (!run) return;
    if (run.sessionId && !original) original = structuredClone(run);
    const transition = { runId: run.id, revision: run.revision, sessionId: run.sessionId, sessionFile: run.sessionFile, configuration: run.configuration, deadline: run.progress?.deadline, history: structuredClone(run.lifecycle?.recoveryHistory), phase: run.lifecycle?.phase, reviews: run.lifecycle?.reviews.length ?? 0, publication: run.lifecycle?.publication };
    const key = JSON.stringify(transition);
    if (key !== previousTransition) { transitions.push(transition); previousTransition = key; }
  });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, maxRequestBodySize: 2 * 1024 * 1024,
    async fetch(request): Promise<Response> {
      try {
        assert(++admittedRequests <= 40, 'Provider request bound exceeded');
        assert(Date.now() - started < 90_000, 'Provider deadline exceeded');
        assert.equal(new URL(request.url).origin, `http://127.0.0.1:${server.port}`);
        assert.equal(new URL(request.url).pathname, '/v1/chat/completions');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('authorization'), null);
        const body = object(await request.json());
        assert.equal(body.model, model);
        assert.equal(body.stream, true);
        const tools = (body.tools as unknown[]).map(value => String(object(object(value).function).name));
        const reviewer = tools.includes('candidate_diff');
        const messages = (body.messages as unknown[]).map(object);
        const resultFor = (name: string, turn: number, review: boolean) => {
          const call = calls.findLast(call => call.name === name && call.turn === turn && call.reviewer === review);
          assert(call, `Missing native ${name} call`);
          const message = messages.find(message => message.role === 'tool' && message.tool_call_id === call.id);
          assert(message, `Missing correlated native ${name} result`);
          return String(message.content);
        };
        const toolResults = messages.filter(message => message.role === 'tool').map(message => String(message.content));
        const run = store.list('runs')[0]!;
        const step = reviewer ? reviewStep++ : authorStep++;
        if (!reviewer && authorTurn === 1 && step === 1) sessions[0]!.inode = (await stat(run.sessionFile!)).ino;
        requests.push({ role: reviewer ? 'reviewer' : `author-${authorTurn}`, step, tools, toolResults: toolResults.map(text => ({ bytes: Buffer.byteLength(text), hash: digest(text) })), bytes: Buffer.byteLength(JSON.stringify(body)) });
        await appendFile(join(root, 'model-requests.jsonl'), JSON.stringify(requests.at(-1)) + '\n', { mode: 0o600 });
        let name = '', args: Record<string, unknown> = {}, text = '';
        const repaired = authorTurn === 2;
        if (reviewer) {
          assert.deepEqual([...tools].sort(), ['backlog_review', 'candidate_diff', 'candidate_source']);
          if (step === 0) { name = 'candidate_diff'; }
          else if (step === 1) { name = 'candidate_source'; args = { path: 'label.ts' }; }
          else if (step === 2) {
            assert.equal(resultFor('candidate_source', authorTurn, true), correct, 'Reviewer must receive exact corrected source');
            name = scenario === 'reviewer_escalation' ? 'bash' : 'backlog_review';
            args = scenario === 'reviewer_escalation' ? { command: `printf unauthorized > ${join(root, 'reviewer-escalation')}` } : { revision: run.revision, sessionId: sessions.at(-1)!.sessionId, candidateTree: run.lifecycle!.candidate!.tree, verdict: 'pass', findings: [], criteria: [{ criterion, evidence: 'Inspected candidate_diff and label.ts: value.trim() removes only surrounding whitespace; unchanged host recipe checks spaces, tabs, empty input and internal double spaces.' }] };
          } else if (step === 3) text = 'Review settled.';
          else throw new Error('Unexpected reviewer continuation');
        } else {
          assert(tools.includes('write') && tools.includes('bash') && tools.includes('backlog_result'));
          if (repaired && step === 0) {
            assert(messages.some(message => JSON.stringify(message.content).includes('Host-authorized')), 'Native resumed prompt must contain host authorization');
            if (scenario !== 'incomplete_verification') assert(messages.some(message => JSON.stringify(message.content).includes('AssertionError')), 'Native repair must receive host diagnostic');
            assert(resultFor('write', 1, false).includes('label.ts'), 'Resume must load original write exchange');
            assert(resultFor('bash', 1, false).includes(scenario === 'incomplete_verification' ? 'PASS label.ts' : 'AssertionError'), 'Resume must load original verification exchange');
            assert(resultFor('backlog_result', 1, false).length > 0, 'Resume must load original report exchange');
          }
          if (step === 0) {
            if (repaired && scenario === 'incomplete_verification') { name = 'bash'; args = { command: `${process.execPath} verify.ts` }; }
            else { name = 'write'; args = { path: 'label.ts', content: repaired || ['incomplete_verification', 'nonreproducible'].includes(scenario) ? correct : broken }; }
          } else if (step === 1 && !(repaired && scenario === 'incomplete_verification')) {
            name = 'bash'; args = { command: `${process.execPath} verify.ts` };
          } else {
            const offset = repaired && scenario === 'incomplete_verification' ? 1 : 2;
            const blocked = !repaired && ['author_blocker', 'incomplete_verification', 'nonreproducible'].includes(scenario);
            if (blocked && step === offset) {
              const incomplete = scenario === 'incomplete_verification';
              if (scenario === 'author_blocker') assert(toolResults.some(result => result.includes('AssertionError') && result.includes('label.ts')), 'Blocker must follow observed native verification failure');
              name = 'backlog_result'; args = { revision: run.revision, status: 'blocked', evidence: [{ criterion, evidence: incomplete ? 'Correct implementation written; original criterion receipt still missing.' : 'Ran bun verify.ts; label.ts AssertionError observed.' }], files: ['label.ts'], recoverableCause: incomplete ? 'incomplete_verification' : 'engineering_failure', failureCategory: incomplete ? 'incomplete_verification' : 'engineering_failure', prerequisite: incomplete ? 'Original verification criterion reporting is incomplete' : 'AssertionError: label.ts removes internal whitespace', unblock: incomplete ? 'Finish original verification and criterion report' : 'Correct label.ts to retain internal spacing', attempted: 'Wrote label.ts and executed bun verify.ts', verification: incomplete ? 'Run bun verify.ts and submit missing original criterion receipt' : 'bun verify.ts: AssertionError: label.ts must retain internal spacing' };
            } else if (!blocked && step === offset) {
              if (repaired) assert(resultFor('bash', authorTurn, false).includes('PASS label.ts'), 'Fresh native verification must pass before reporting evidence');
              name = 'backlog_evidence'; args = { revision: run.revision, criterion, feature: 'label normalization', entryPoint: 'normalizeLabel', method: 'bun verify.ts', outcome: 'passed', details: repaired ? 'Native bash executed unchanged verify.ts successfully after correction.' : 'Synthetic author claim; host must independently check actual candidate.', recipe: `verify.ts ${repo.completion?.mode === 'autonomous' ? repo.completion.recipeHash : ''}` };
            } else if (!blocked && step === offset + 1) {
              name = 'backlog_result'; args = { revision: run.revision, status: 'complete', files: ['label.ts'], evidence: [{ criterion, evidence: 'label.ts implementation and native bun verify.ts check recorded; host acceptance still required.' }] };
            } else if (step === offset + (blocked ? 1 : 2)) text = 'Author settled.';
            else throw new Error(`Unexpected author continuation ${authorTurn}/${step}`);
          }
        }
        if (name) calls.push({ id: `call-${requests.length}`, name, turn: authorTurn, reviewer });
        const chunks: string[] = [];
        const chunk = (choices: unknown[], usage?: unknown) => chunks.push(`data: ${JSON.stringify({ id: `native-${requests.length}`, object: 'chat.completion.chunk', created: 1767225600, model, choices, ...(usage ? { usage } : {}) })}\n\n`);
        chunk([{ index: 0, delta: name ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: text }, finish_reason: null }]);
        chunk([{ index: 0, delta: {}, finish_reason: name ? 'tool_calls' : 'stop' }]);
        chunk([], { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        const response = chunks.join('') + 'data: [DONE]\n\n';
        assert(Buffer.byteLength(response) < 16_384);
        return new Response(response, { headers: { 'content-type': 'text/event-stream' } });
      } catch (caught) {
        if (admittedRequests > 40) void runtime?.close();
        if (failures.length < 40) failures.push(String(caught));
        return new Response('Unexpected synthetic request rejected', { status: 400 });
      }
    },
  });
  const launch = RpcProcess.launch.bind(RpcProcess);
  const intercept = spyOn(RpcProcess, 'launch').mockImplementation(async options => {
    assert.equal(options.executable, 'omp');
    const reviewer = options.args.includes('--no-tools');
    const resumed = options.args.includes('--resume');
    if (!reviewer) { authorTurn++; authorStep = 0; assert(authorTurn <= 2); }
    const profile = await privateProfile(join(root, reviewer ? 'review-profile' : 'author-profile'), `http://127.0.0.1:${server.port}`, !reviewer);
    const args = [...options.args];
    const config = args.indexOf('--config');
    if (config >= 0) args.splice(config, 2);
    args.push('--config', join(root, reviewer ? 'review-profile' : 'author-profile', 'config.yml'));
    for (const flag of ['--no-extensions', '--no-rules', '--no-lsp', '--no-prewalk', '--no-skills']) if (!args.includes(flag)) args.push(flag);
    const rpc = await launch({ ...options, args, env: profile.env, async onSpawn(pid) {
      const value = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
      assert.equal(Number(fields[2]), pid);
      const identity: OwnedGroup = { pid, start: fields[19]!, boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
      await appendFile(join(root, 'owned-groups.jsonl'), JSON.stringify(identity) + '\n', { mode: 0o600 });
      await options.onSpawn(pid);
    }, onFrame(frame) {
      if (['ready', 'host_tool_call', 'tool_execution_start', 'tool_execution_end', 'prompt_result', 'goal_updated'].includes(frame.type)
        || (frame.type === 'response' && frame.command === 'negotiate_protocol')) {
        events.push({ role: reviewer ? 'reviewer' : 'author', ...frame });
        appendFileSync(join(root, 'native-events.jsonl'), JSON.stringify(events.at(-1), (_key, value: unknown) => typeof value === 'string' ? redactTranscript(value) : value) + '\n', { mode: 0o600 });
      }
      options.onFrame(frame);
    } });
    children.push(rpc);
    const state = await rpc.command('get_state');
    assert.equal(object(state.model).baseUrl, `http://127.0.0.1:${server.port}/v1`);
    sessions.push({ role: reviewer ? 'reviewer' : 'author', resumed, pid: rpc.child.pid!, sessionId: state.sessionId, sessionFile: state.sessionFile, inode: resumed ? (await stat(String(state.sessionFile))).ino : 0, args, tools: (state.dumpTools as unknown[]).map(tool => String(object(tool).name)), goal: state.goal });
    const command = rpc.command.bind(rpc);
    spyOn(rpc, 'command').mockImplementation(async (type, payload, timeout) => {
      const response = await command(type, payload, timeout);
      if (type === 'get_state') {
        assert.equal(object(response.model).baseUrl, `http://127.0.0.1:${server.port}/v1`, 'External inference endpoint selected');
        states.push({ role: reviewer ? 'reviewer' : 'author', sessionId: response.sessionId, sessionFile: response.sessionFile, tools: (response.dumpTools as unknown[]).map(tool => String(object(tool).name)), goal: response.goal });
      }
      return response;
    });
    return rpc;
  });
  try {
    const version = Bun.spawn(['omp', '--version'], { env: process.env, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    ompVersion = (await new Response(version.stdout).text()).trim();
    assert.equal(await version.exited, 0);
    assert.match(ompVersion, /^(?:omp\/)?18\.\d+\.\d+$/);
    store.setSettings({ ...store.settings(), executable: 'omp', engineeringMode: 'standard', model: `${provider}/${model}`, thinking: 'off', tokenBudget: 20000, timeLimitMinutes: 5, roots: [root], paused: false });
    await writeFile(join(path, 'label.ts'), 'export function normalizeLabel(value: string): string { return value; }\n');
    await writeFile(join(path, 'verify.ts'), `import assert from 'node:assert/strict';\nimport { normalizeLabel } from './label';\nfor (const [input, expected] of [['  alpha  beta  ', 'alpha  beta'], ['\\t alpha \\t', 'alpha'], ['', ''], ['   ', '']]) assert.equal(normalizeLabel(input!), expected, 'AssertionError: label.ts must trim surrounding whitespace and retain internal spacing');\nconsole.log('PASS label.ts surrounding and internal whitespace');\n`);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Native Recovery'); await git('config', 'user.email', 'native@example.invalid');
    await git('add', 'label.ts', 'verify.ts'); await git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Disposable baseline');
    initialHead = await git('rev-parse', 'HEAD');
    const verification = { argv: ['/usr/bin/env', 'BUN_BE_BUN=1', process.execPath, 'verify.ts'], files: ['verify.ts'], timeoutSeconds: 10 };
    repo.completion = { mode: 'autonomous', revision: 'native-policy', updated: Date.now(), verification, recipeHash: await recipeIdentity(repo, verification), reviewerModel: `${provider}/${model}`, maxCorrections: 1, maxRecoveries: 1 };
    store.save('repos', repo);
    const ticket = await writeTicket(store, repo, `---\nid: T001\ntitle: Normalize labels\ndepends_on: []\n---\n\nImplement normalizeLabel in label.ts only. Trim surrounding whitespace; preserve internal whitespace. Run unchanged bun verify.ts. No installs or other source edits.\n\nDone when:\n- ${criterion}\n`);
    store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
    runtime = await createRuntime(store); await runtime.reconcile();
    const run = await until(() => store.list('runs').find(run => ['done', 'failed', 'blocked', 'interrupted'].includes(run.status) && run.pid === null), 'terminal durable run');
    assert.deepEqual(failures, []);
    assert(original, 'Original persisted native identity must be observed');
    verdict = 'NATIVE_INJECTED_RECOVERY_FAILED';
    expect(store.list('runs')).toHaveLength(1);
    expect(run.id).toBe(original.id); expect(run.revision).toBe(ticket.revision);
    expect(run.configuration).toEqual(original.configuration);
    expect(run.progress?.deadline).toBe(original.progress?.deadline);
    expect(run.sessionId).toBe(original.sessionId); expect(run.sessionFile).toBe(original.sessionFile);
    expect(run.workspace).toEqual(original.workspace);
    expect(run.progress?.tokenBudget).toBe(original.progress?.tokenBudget);
    for (const transition of transitions.filter(transition => transition.sessionId)) {
      expect(transition.runId).toBe(original.id); expect(transition.revision).toBe(original.revision);
      expect(transition.sessionId).toBe(original.sessionId); expect(transition.sessionFile).toBe(original.sessionFile);
      expect(transition.configuration).toEqual(original.configuration); expect(transition.deadline).toBe(original.progress?.deadline);
    }
    const life = run.lifecycle!;
    if (scenario === 'nonreproducible') {
      expect(run.status).toBe('failed'); expect(life.recoveries).toBe(0);
      expect(run.error).toContain('not independently reproduced');
      expect(life.verification[0]?.outcome).toBe('passed');
      expect(life.recoveryHistory?.[0]?.state).toBe('needs_assistance');
      expect(sessions.filter(session => session.role === 'author')).toHaveLength(1);
      expect(life.reviews).toEqual([]); expect(life.publication).toBeUndefined();
      expect(await git('rev-parse', 'HEAD')).toBe(initialHead);
    } else {
      expect(life.corrections).toBe(['host_failure', 'reviewer_escalation'].includes(scenario) ? 1 : 0);
      expect(life.recoveries).toBe(['author_blocker', 'incomplete_verification'].includes(scenario) ? 1 : 0);
      const authors = sessions.filter(session => session.role === 'author');
      expect(authors).toHaveLength(2);
      expect(authors.map(session => session.resumed)).toEqual([false, true]);
      expect(authors[1]?.sessionId).toBe(authors[0]?.sessionId);
      expect(authors[1]?.sessionFile).toBe(authors[0]?.sessionFile);
      expect(authors[1]?.inode).toBe(authors[0]?.inode);
      expect(authors[1]?.args[authors[1].args.indexOf('--resume') + 1]).toBe(run.sessionFile!);
      expect((await readdir(dirname(run.sessionFile!))).filter(file => file.endsWith('.jsonl'))).toHaveLength(1);
      const sessionText = await readFile(run.sessionFile!, 'utf8');
      assert(sessionText.includes(String(run.sessionId)) && sessionText.includes('Host-authorized'), 'Native session file must retain original identity and continuation');
      const recovery = life.recoveryHistory![0]!;
      expect(recovery).toMatchObject({ runId: run.id, revision: run.revision, engineeringMode: 'standard', ordinal: 1, source: scenario === 'incomplete_verification' ? 'incomplete_verification' : scenario === 'author_blocker' ? 'author_blocked' : 'host_verification' });
      expect(life.recoveryHistory).toHaveLength(1);
      assert(transitions.filter(transition => ['correcting', 'recovering'].includes(transition.phase ?? '')).every(transition => transition.reviews === 0 && transition.publication === undefined), 'No review or publication before repaired verification');
      for (const state of ['observed', 'authorized', 'dispatched']) assert(transitions.some(transition => JSON.stringify(transition.history ?? []).includes(`"state":"${state}"`)), `Durable ${state} transition missing`);
      expect(life.verification.map(receipt => receipt.outcome)).toEqual(scenario === 'incomplete_verification' ? ['passed'] : ['failed', 'passed']);
      if (scenario !== 'incomplete_verification') {
        expect(life.verification[0]?.output).toContain('label.ts'); expect(life.verification[0]?.output).toContain('AssertionError');
        expect(life.verification[0]?.exitCode).not.toBe(0);
        expect(life.verification[0]?.candidateTree).not.toBe(life.candidate?.tree);
        expect(life.verification[0]?.id).not.toBe(life.verification.at(-1)?.id);
        expect(await git('show', `${life.verification[0]!.candidateTree}:label.ts`)).toBe(broken.trim());
      } else expect(recovery.category).toBe('incomplete_verification');
      const reviewer = sessions.find(session => session.role === 'reviewer')!;
      expect(reviewer.tools).toEqual([]); expect(reviewer.goal).toBeFalsy(); expect(reviewer.sessionId).not.toBe(run.sessionId);
      assert(states.some(state => state.role === 'reviewer' && state.sessionId === reviewer.sessionId && !state.goal && JSON.stringify([...state.tools].sort()) === JSON.stringify(['backlog_review', 'candidate_diff', 'candidate_source'])), 'Native reviewer state must expose exactly the three authorized tools');
      const reviewCalls = events.map(object).filter(event => event.role === 'reviewer' && event.type === 'tool_execution_start').map(event => event.toolName);
      expect(reviewCalls.slice(0, 2)).toEqual(['candidate_diff', 'candidate_source']);
      if (scenario === 'reviewer_escalation') {
        expect(run.status).not.toBe('done'); expect(life.publication).toBeUndefined();
        expect(await git('rev-parse', 'HEAD')).toBe(initialHead);
        expect(run.error).toContain('Restricted reviewer requested unavailable capabilities');
        assert(events.map(object).some(event => event.role === 'reviewer' && event.type === 'tool_execution_end' && event.toolName === 'bash' && event.isError === true && JSON.stringify(event.result).includes('Tool bash not found')));
        await assert.rejects(stat(join(root, 'reviewer-escalation')), { code: 'ENOENT' });
      } else {
        expect(run.status).toBe('done'); expect(recovery.state).toBe('recovered');
        expect(life.verification.at(-1)).toMatchObject({ source: 'host_execution', outcome: 'passed', exitCode: 0, candidateTree: life.candidate?.tree });
        expect(life.verification.at(-1)?.recipeHash).toBe(life.recipeHash);
        expect(await recipeIdentity(repo, life.policy.verification)).toBe(life.recipeHash);
        expect(await readFile(join(path, 'label.ts'), 'utf8')).toBe(correct);
        expect(recovery.hostVerificationId).toBe(life.verification.at(-1)?.id);
        expect(recovery.reviewSessionId).toBe(life.reviews[0]?.sessionId);
        expect(life.reviews).toHaveLength(1);
        expect(life.reviews[0]).toMatchObject({ verdict: 'pass', candidateTree: life.candidate?.tree, sessionId: reviewer.sessionId });
        expect(reviewCalls).toEqual(['candidate_diff', 'candidate_source', 'backlog_review']);
        expect(life.verification.at(-1)!.started).toBeGreaterThanOrEqual(recovery.started!);
        expect(life.reviews[0]!.recorded).toBeGreaterThanOrEqual(life.verification.at(-1)!.finished);
        expect(recovery.originalVerification.every(receipt => !run.verification?.some(fresh => fresh.id === receipt.id))).toBe(true);
        expect(store.get('tickets', `${repo.id}/T001`)?.status).toBe('done');
        publication = { commit: await git('rev-parse', 'HEAD'), parent: await git('rev-parse', 'HEAD^'), tree: await git('rev-parse', 'HEAD^{tree}'), count: await git('rev-list', '--count', `${initialHead}..HEAD`), files: await git('diff', '--name-only', initialHead, 'HEAD') };
        expect(publication).toEqual({ commit: life.publication?.commit, parent: initialHead, tree: life.candidate?.tree, count: '1', files: 'label.ts' });
        const beforeRestart = { refs: await git('show-ref'), index: await git('ls-files', '--stage'), requests: requests.length, sessions: sessions.length };
        await runtime.close(); closeStore(store); store = createStore(join(root, 'private'));
        runtime = await createRuntime(store); await runtime.reconcile();
        const afterRestart = { refs: await git('show-ref'), index: await git('ls-files', '--stage'), requests: requests.length, sessions: sessions.length };
        restartProof = { before: beforeRestart, after: afterRestart };
        expect(afterRestart).toEqual(beforeRestart);
        expect(store.get('runs', run.id)).toEqual(run);
        expect(store.get('tickets', `${repo.id}/T001`)?.status).toBe('done');
        expect(await git('rev-parse', 'HEAD')).toBe(String(object(publication).commit));
        expect(await git('diff', 'HEAD', '--name-only')).toBe('');
        expect((await git('ls-files', '--others', '--exclude-standard')).split('\n').filter(file => file && !file.startsWith('.omp-backlog/'))).toEqual([]);
        expect(store.list('runs')).toHaveLength(1);
      }
    }
    for (const child of children) assert(child.child.exitCode !== null || child.child.signalCode !== null, 'Owned native process must stop');
    verdict = ['nonreproducible', 'reviewer_escalation'].includes(scenario) ? 'NATIVE_NEGATIVE_CONTROL_PASS' : 'NATIVE_INJECTED_RECOVERY_PASS';
  } catch (caught) { error = String(caught); throw caught; }
  finally {
    clearTimeout(shutdownDeadline);
    const runtimeCleanup = await Promise.allSettled([runtime?.close()]);
    const cleanup = [...runtimeCleanup, ...await Promise.allSettled(children.map(child => child.shutdown()))];
    intercept.mockRestore(); unsubscribe();
    cleanup.push(...await Promise.allSettled([server.stop(true)]));
    const cleanupFailures = cleanup.filter(result => result.status === 'rejected').map(result => String(result.reason));
    if (cleanupFailures.length) verdict = 'NATIVE_INJECTED_RECOVERY_INCONCLUSIVE';
    try {
      const sessionFiles = original?.sessionFile ? await readdir(dirname(original.sessionFile)).catch(() => []) : [];
      const proof = { tier: 'native_synthetic_provider', scenario, verdict, error, cleanupFailures, ompVersion, initialHead, publication, restartProof, sessions, states, sessionFiles, requests, admittedRequests, failures, events, transitions, run: store.list('runs')[0], ticket: store.list('tickets')[0] };
      await writeFile(join(root, 'proof.json'), JSON.stringify(proof, (_key, value: unknown) => typeof value === 'string' ? redactTranscript(value) : value, 2), { mode: 0o600 });
      console.log(`Native recovery proof: ${join(root, 'proof.json')} (${verdict})`);
    } finally { closeStore(store); }
    assert.deepEqual(cleanupFailures, []);
  }
}, 120_000);

nativeTest('native recovery ownership fallback never signals a mismatched process identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-recovery-native-ownership-'));
  const profile = await privateProfile(root, 'http://127.0.0.1:9', false);
  let rpc: RpcProcess | undefined;
  let stderr = '';
  try {
    try {
      rpc = await RpcProcess.launch({ executable: 'omp', args: profile.args, cwd: profile.cwd, env: profile.env, onSpawn: async () => {}, onFrame: () => {}, onStderr: text => { stderr = (stderr + redactTranscript(text)).slice(-4000); }, onFailure: () => {} });
    } catch (caught) { throw new Error(`Native ownership control startup: ${String(caught)}; ${stderr}`); }
    const pid = rpc.child.pid!;
    const value = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = value.slice(value.lastIndexOf(')') + 2).trim().split(/\s+/);
    const identity: OwnedGroup = { pid, start: fields[19]!, boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
    await writeFile(join(root, 'owned-groups.jsonl'), JSON.stringify({ ...identity, start: 'not-the-owned-start' }) + '\n', { mode: 0o600 });
    await stopOwnedGroups(root);
    expect(typeof (await rpc.command('get_state')).sessionId).toBe('string');
    await writeFile(join(root, 'owned-groups.jsonl'), JSON.stringify(identity) + '\n{"incomplete":', { mode: 0o600 });
    await assert.rejects(stopOwnedGroups(root), AggregateError);
    await rpc.exited;
    assert(rpc.child.exitCode !== null || rpc.child.signalCode !== null, 'Exact owned fallback must observe exit');
  } finally {
    await rpc?.shutdown();
    await rm(join(root, 'home', '.omp', 'natives'), { recursive: true, force: true });
  }
}, 30000);
