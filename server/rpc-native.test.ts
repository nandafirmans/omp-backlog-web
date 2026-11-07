import { test, spyOn } from 'bun:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertEngineeringWorkflow, observeEngineeringInvocation } from './engineering';
import { object, RpcProcess, type Frame } from './rpc';

const nativeTest = process.env.OMP_BACKLOG_NATIVE_TESTS === '1' ? test : test.skip;
const provider = 'native-proof';
const model = 'synthetic-proof';
const disabledProviders = ['native', 'builtin-defaults', 'agent-plugins', 'agents-md', 'claude-md', 'custom-context-files', 'claude', 'claude-plugins', 'cline', 'agents', 'codex', 'cursor', 'gemini', 'opencode', 'github', 'mcp-json', 'omp-plugins', 'skillshare', 'ssh', 'vscode', 'windsurf', 'managed-skills'];

async function privateProfile(root: string, origin: string, engineering: boolean) {
  const cwd = join(root, 'work');
  const agent = join(root, 'agent');
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, {
    HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), PI_CODING_AGENT_DIR: agent,
    XDG_CONFIG_HOME: join(root, 'xdg-config'), XDG_DATA_HOME: join(root, 'xdg-data'),
    XDG_CACHE_HOME: join(root, 'xdg-cache'), TMPDIR: join(root, 'tmp'),
    PI_CONFIG_FILES: '', OMP_PROFILE: '', PI_PROFILE: '', PI_CONFIG_DIR: '.omp',
    PI_NO_PTY: '1', PI_NO_TITLE: '1', BUN_CONFIG_NO_ENV: '1', BUN_CONFIG_NO_CLEAR_TERMINAL: '1',
  });
  await Promise.all([cwd, agent, join(cwd, '.git'), join(cwd, '.omp'), join(root, 'sessions'),
    env.HOME!, env.XDG_CONFIG_HOME!, env.XDG_DATA_HOME!, env.XDG_CACHE_HOME!, env.TMPDIR!]
    .map(path => mkdir(path, { recursive: true, mode: 0o700 })));
  const config = join(root, 'config.yml');
  await writeFile(config, JSON.stringify({
    disabledProviders, extensions: [], autoResume: false, git: { enabled: false },
    enabledProviders: [provider], enabledModels: [`${provider}/${model}`],
    goal: { enabled: engineering, continuationModes: [] }, plan: { enabled: false, defaultOnStartup: false },
    retry: { enabled: false, maxRetries: 0, modelFallback: false, waitForUsageReset: false, usageReservePolicy: 'fail-closed' },
    providers: { cacheWarming: 'off', openaiWebsockets: 'off', openaiLiveSteering: false },
    // Hiding every catalog entry also leaves no descriptions for background compression.
    skills: { enabled: engineering, enableSkillCommands: engineering, manualSkills: ['*'],
      enableCodexUser: false, enableClaudeUser: false, enableClaudeProject: false,
      enablePiUser: false, enablePiProject: false, enableAgentsUser: false, enableAgentsProject: false },
    images: { describeForTextModels: false, autoResize: false },
    compaction: { enabled: false }, prewalk: { enabled: false, auto: 'off' },
    features: { unexpectedStopDetection: 'none' }, advisor: { enabled: false },
    memory: { backend: 'off' }, autolearn: { enabled: false },
    startup: { checkUpdate: false, setupWizard: false, showSplash: false, quiet: true },
    marketplace: { autoUpdate: 'off' }, power: { sleepPrevention: 'off' }, magicKeywords: { enabled: false },
  }), { mode: 0o600 });
  await writeFile(join(agent, 'models.yml'), `providers:
  ${provider}:
    baseUrl: ${origin}/v1
    api: openai-completions
    auth: none
    authHeader: false
    compat:
      supportsUsageInStreaming: true
    models:
      - id: ${model}
        name: Synthetic native transport proof
        reasoning: false
        supportsTools: true
        input: [text]
        contextWindow: 1048576
        maxTokens: 2048
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
`, { mode: 0o600 });
  const args = ['--mode', 'rpc', '--no-ui', '--no-extensions', '--no-rules', '--no-lsp', '--no-pty',
    '--no-title', '--no-prewalk', '--config', config, '--session-dir', join(root, 'sessions'), '--model', `${provider}/${model}`];
  if (!engineering) args.push('--no-tools', '--no-skills');
  return { cwd, env, args };
}

async function waitFrame(frames: Frame[], predicate: (frame: Frame) => boolean, label: string): Promise<Frame> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const frame = frames.find(predicate);
    if (frame) return frame;
    await delay(20);
  }
  throw new Error(`Native RPC did not emit ${label} within 30 seconds`);
}

function assertModel(state: Record<string, unknown>, origin: string) {
  assert.equal(object(state.model).provider, provider);
  assert.equal(object(state.model).id, model);
  assert.equal(object(state.model).baseUrl, `${origin}/v1`);
}

async function stopped(rpc: RpcProcess) {
  await rpc.shutdown();
  assert(rpc.child.exitCode !== null || rpc.child.signalCode !== null, 'Owned native process exit must be observed');
}

nativeTest('native_standard_control: private native task works without installed pstack discovery or inference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-native-standard-'));
  let rpc: RpcProcess | undefined;
  let requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++;
    return new Response('No inference authorized for Standard control', { status: 403 });
  } });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const profile = await privateProfile(root, origin, true);
    const failures: string[] = [];
    rpc = await RpcProcess.launch({ executable: 'omp', args: [...profile.args, '--no-skills'],
      cwd: profile.cwd, env: profile.env, onSpawn: async () => {}, onFrame: () => {}, onStderr: () => {},
      onFailure: error => { failures.push(error.message); },
    });
    const state = await rpc.command('get_state');
    assertModel(state, origin);
    assert(Array.isArray(state.dumpTools) && state.dumpTools.some(tool => object(tool).name === 'task'));
    const commands = await rpc.command('get_available_commands');
    assert(Array.isArray(commands.commands));
    assert(!commands.commands.some(value => ['skill:poteto-mode', 'skill:pstack-pi'].includes(String(object(value).name))));
    assert.equal(object((await rpc.finalSessionStats()).tokens).total, 0);
    await stopped(rpc);
    rpc = undefined;
    assert.equal(requests, 0);
    assert.deepEqual(failures, []);
  } finally {
    try { await rpc?.shutdown(); }
    finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
  }
}, 60_000);

nativeTest('native_rpc_synthetic_provider: installed router, host bridge, controls, chunks and exact restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-rpc-native-'));
  const frames: Frame[] = [];
  const failures: string[] = [];
  const requests: Record<string, unknown>[] = [];
  const httpFailures: string[] = [];
  const nonce = crypto.randomUUID();
  const receipt = `native-host-receipt-${nonce}`;
  const toolCallId = `synthetic-call-${nonce}`;
  const largeText = Array.from({ length: 17_000 }, (_, index) => `${index.toString().padStart(5, '0')}: synthetic native chunk transport payload, not model inference.\n`).join('');
  assert(Buffer.byteLength(largeText) > 1024 * 1024);
  let rpc: RpcProcess | undefined;
  const invocationAbort = new AbortController();
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, maxRequestBodySize: 2 * 1024 * 1024,
    async fetch(request) {
      try {
        assert.equal(new URL(request.url).pathname, '/v1/chat/completions');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('authorization'), null, 'auth:none must not send credentials');
        const body = object(await request.json());
        assert.equal(body.model, model);
        assert.equal(body.stream, true);
        requests.push(body);
        assert(requests.length <= 2, 'Unexpected background, continuation or recovery model request');
        const second = requests.length === 2;
        const messages = Array.isArray(body.messages) ? body.messages.map(object) : [];
        if (second) {
          assert(messages.some(message => message.role === 'tool' && message.tool_call_id === toolCallId
            && typeof message.content === 'string' && message.content.includes(receipt)), 'Correlated host result must reach the next native provider request');
        } else {
          assert(messages.some(message => JSON.stringify(message).includes(nonce)));
          const tools = Array.isArray(body.tools) ? body.tools.map(object) : [];
          assert(tools.some(tool => object(tool.function).name === 'native_proof_echo'));
        }
        const chunks: string[] = [];
        const chunk = (choices: unknown[], usage?: Record<string, unknown>) => chunks.push(`data: ${JSON.stringify({
          id: `synthetic-${requests.length}`, object: 'chat.completion.chunk', created: 1767225600,
          model, choices, ...(usage ? { usage } : {}),
        })}\n\n`);
        if (second) {
          for (let offset = 0; offset < largeText.length; offset += 16_384) {
            chunk([{ index: 0, delta: { content: largeText.slice(offset, offset + 16_384) }, finish_reason: null }]);
          }
        } else {
          chunk([{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: toolCallId, type: 'function',
            function: { name: 'native_proof_echo', arguments: JSON.stringify({ nonce }) } }] }, finish_reason: null }]);
        }
        chunk([{ index: 0, delta: {}, finish_reason: second ? 'stop' : 'tool_calls' }]);
        chunk([], second
          ? { prompt_tokens: 59, completion_tokens: 11, total_tokens: 70, prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 3 } }
          : { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118, prompt_tokens_details: { cached_tokens: 23, cache_write_tokens: 5 } });
        return new Response(chunks.join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      } catch (error) {
        httpFailures.push(error instanceof Error ? error.message : String(error));
        return new Response('Synthetic native proof rejected unexpected request', { status: 400 });
      }
    },
  });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const profile = await privateProfile(root, origin, true);
    const plugin = join(homedir(), '.omp', 'plugins', 'node_modules', 'pstack-pi');
    const manifest = object(JSON.parse(await readFile(join(plugin, 'package.json'), 'utf8')));
    assert.equal(manifest.name, 'pstack-pi', 'Require the actual installed pstack package; never synthesize router skills');
    const skillDirectories = ['poteto-mode', 'pstack-pi'].map(name => join(plugin, 'skills', name));
    await Promise.all(skillDirectories.map(path => access(join(path, 'SKILL.md'))));
    const configPath = join(root, 'config.yml');
    const config = object(JSON.parse(await readFile(configPath, 'utf8')));
    await writeFile(configPath, JSON.stringify({ ...config, skills: { ...object(config.skills), customDirectories: [join(plugin, 'skills')] } }), { mode: 0o600 });
    const launch = async (resume?: string) => RpcProcess.launch({
      executable: 'omp', args: [...profile.args, '--skills', 'poteto-mode,pstack-pi', ...(resume ? ['--resume', resume] : [])],
      cwd: profile.cwd, env: profile.env, onSpawn: async () => {}, onFrame: frame => {
        if (['response', 'host_tool_call', 'prompt_result', 'goal_updated'].includes(frame.type)) frames.push(frame);
      },
      onStderr: () => {}, onFailure: error => { failures.push(error.message); },
    });
    rpc = await launch();
    const state = await rpc.command('get_state');
    assertModel(state, origin);
    await assertEngineeringWorkflow(rpc, state);
    assert(!String(state.systemPrompt).includes('<skills>'), 'manualSkills must hide the catalog while native commands remain discoverable');
    assert.deepEqual((await rpc.command('get_messages')).messages, []);
    assert.equal(object((await rpc.command('get_session_stats')).tokens).total, 0);
    const models = await rpc.command('get_available_models');
    assert(Array.isArray(models.models));
    assert(models.models.some(value => object(value).provider === provider && object(value).id === model));
    const thinking = await rpc.command('get_available_thinking_levels');
    assert(Array.isArray(thinking.levels) && thinking.levels.includes('off'));
    await rpc.command('set_thinking_level', { level: 'off' });
    assert.equal((await rpc.command('get_state')).thinkingLevel, 'off');
    for (const enabled of [true, false]) {
      await rpc.command('set_auto_compaction', { enabled });
      assert.equal((await rpc.command('get_state')).autoCompactionEnabled, enabled);
    }
    const goal = await rpc.command('goal', { op: 'create', objective: `Synthetic transport only ${nonce}`, token_budget: 4096 });
    const goalId = object(goal.goal).id;
    assert.equal(typeof goalId, 'string');
    assert.equal(object(goal.state).enabled, true);
    assert.equal(object(goal.goal).status, 'active');
    assert.equal(object(goal.goal).tokensUsed, 0);
    for (const op of ['pause', 'resume']) {
      const result = await rpc.command('goal', { op });
      assert.equal(object(result.goal).id, goalId);
      assert.equal(object(result.goal).status, op === 'pause' ? 'paused' : 'active');
      assert.equal(object(result.state).enabled, op === 'resume');
    }
    assert.equal(requests.length, 0, 'continuationModes:[] must not cause model requests');
    await rpc.command('set_host_tools', { tools: [{ name: 'native_proof_echo', description: 'Return a synthetic host receipt.', loadMode: 'essential',
      parameters: { type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false } }] });
    assert(((await rpc.command('get_state')).dumpTools as unknown[]).some(tool => object(tool).name === 'native_proof_echo'));
    assertModel(await rpc.command('get_state'), origin);
    const prompt = `/skill:poteto-mode Synthetic transport proof only. Do not execute tasks, inspect files, or claim playbook compliance. Echo nonce ${nonce}.`;
    const promptId = crypto.randomUUID();
    rpc.send({ type: 'prompt', id: promptId, message: prompt });
    const ack = await waitFrame(frames, frame => frame.type === 'response' && frame.id === promptId, 'prompt acknowledgement');
    assert.equal(ack.success, true);
    const invocation = observeEngineeringInvocation(rpc, prompt, invocationAbort.signal);
    void invocation.catch(() => {});
    const call = await waitFrame(frames, frame => frame.type === 'host_tool_call', 'host tool call');
    assert.equal(call.toolName, 'native_proof_echo');
    assert.equal(call.toolCallId, toolCallId);
    assert.equal(typeof call.id, 'string');
    assert.notEqual(call.id, call.toolCallId);
    assert.deepEqual(call.arguments, { nonce });
    rpc.send({ type: 'host_tool_result', id: call.id, result: { content: [{ type: 'text', text: receipt }] } });
    const terminal = await waitFrame(frames, frame => frame.type === 'prompt_result' && frame.id === promptId, 'correlated prompt result');
    assert.equal(terminal.status, 'completed');
    assert.equal(terminal.agentInvoked, true);
    assert.equal(await realpath(await invocation), await realpath(join(skillDirectories[0]!, 'SKILL.md')));
    const decode = spyOn(rpc.decoder, 'decode');
    let messages: Record<string, unknown>;
    try {
      messages = await rpc.command('get_messages');
      assert(Buffer.byteLength(JSON.stringify(messages)) > 1024 * 1024);
      assert(decode.mock.calls.some(([line]) => object(JSON.parse(line.toString('utf8'))).type === 'rpc_chunk'), 'Large native get_messages must exercise strict protocol-2 chunk decoding');
    } finally { decode.mockRestore(); }
    assert(Array.isArray(messages.messages));
    assert(messages.messages.some(value => object(value).role === 'toolResult' && object(value).toolCallId === toolCallId
      && JSON.stringify(value).includes(receipt)));
    assert(messages.messages.some(value => {
      const message = object(value);
      return message.role === 'assistant' && Array.isArray(message.content)
        && message.content.some(part => object(part).type === 'text' && object(part).text === largeText);
    }));
    const stats = await rpc.command('get_session_stats');
    const expectedTokens = { input: 122, output: 28, reasoning: 0, cacheRead: 30, cacheWrite: 8, total: 188 };
    assert.deepEqual(stats.tokens, expectedTokens);
    const paused = await rpc.command('goal', { op: 'pause' });
    assert.equal(object(paused.goal).id, goalId);
    assert.equal(object(paused.goal).status, 'paused');
    assert.equal(object(paused.goal).tokensUsed, 158);
    assert(frames.some(frame => frame.type === 'goal_updated'));
    const saved = await rpc.command('get_state');
    assert.equal(typeof saved.sessionFile, 'string');
    assert.equal(stats.sessionId, saved.sessionId);
    assert.equal(stats.sessionFile, saved.sessionFile);
    const sessionFile = String(saved.sessionFile);
    const finalStats = await rpc.finalSessionStats();
    assert.deepEqual(finalStats.tokens, expectedTokens);
    await stopped(rpc);
    rpc = undefined;
    await access(sessionFile);
    rpc = await launch(sessionFile);
    const restored = await rpc.command('get_state');
    assertModel(restored, origin);
    assert.equal(restored.sessionId, saved.sessionId);
    assert.equal(restored.sessionFile, sessionFile);
    assert.deepEqual(object(restored.goal).goal, paused.goal);
    assert.equal(object(restored.goal).enabled, false);
    assert.deepEqual((await rpc.command('get_session_stats')).tokens, finalStats.tokens);
    assert.equal(await realpath(await observeEngineeringInvocation(rpc, prompt, invocationAbort.signal)), await realpath(join(skillDirectories[0]!, 'SKILL.md')));
    assert(JSON.stringify((await rpc.command('get_messages')).messages).includes(receipt));
    for (const op of ['resume', 'pause']) {
      const result: Record<string, unknown> = await rpc.command('goal', { op });
      assert.equal(object(result.goal).id, goalId);
      assert.equal(object(result.goal).status, op === 'pause' ? 'paused' : 'active');
    }
    assert.equal(requests.length, 2);
    assert.deepEqual((await rpc.finalSessionStats()).tokens, finalStats.tokens);
    await stopped(rpc);
    rpc = undefined;
    assert.deepEqual(httpFailures, []);
    assert.deepEqual(failures, []);
  } finally {
    invocationAbort.abort();
    try { await rpc?.shutdown(); }
    finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
  }
}, 120_000);

nativeTest('native_imported_journal: cumulative stats retain discarded-turn 146 with active sensitivity control', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-native-accounting-'));
  let rpc: RpcProcess | undefined;
  let requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() {
    requests++;
    return new Response('No inference authorized for imported-journal accounting', { status: 403 });
  } });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    for (const offBranch of [false, true]) {
      const directory = join(root, offBranch ? 'discarded' : 'active-control');
      const profile = await privateProfile(directory, origin, false);
      const timestamp = '2026-01-01T00:00:00.000Z';
      const sessionId = crypto.randomUUID();
      const usage = { input: 101, output: 17, cacheRead: 23, cacheWrite: 5, totalTokens: 146,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
      const entries = [
        { type: 'session', version: 3, id: sessionId, timestamp, cwd: profile.cwd },
        { type: 'model_change', id: 'model', parentId: null, timestamp, model: `${provider}/${model}` },
        { type: 'message', id: 'user', parentId: 'model', timestamp, message: { role: 'user',
          content: [{ type: 'text', text: 'Imported synthetic accounting fixture. No model execution represented by this test.' }], timestamp: 1767225600000 } },
        { type: 'model_usage', id: 'usage', parentId: 'user', timestamp, ...(offBranch ? { activeLeafId: 'user' } : {}),
          purpose: 'discarded-turn', api: 'openai-completions', provider, model, usage, stopReason: 'length' },
        { type: 'branch_summary', id: 'branch', parentId: offBranch ? 'user' : 'usage', timestamp, fromId: 'user',
          summary: '', details: { kind: 'discarded-entry-branch', discardedEntryId: 'removed-assistant' } },
      ];
      const sessionFile = join(directory, 'synthetic.jsonl');
      await writeFile(sessionFile, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n', { mode: 0o600 });
      const failures: string[] = [];
      const activity: Frame[] = [];
      rpc = await RpcProcess.launch({ executable: 'omp', args: [...profile.args, '--resume', sessionFile],
        cwd: profile.cwd, env: profile.env, onSpawn: async () => {}, onStderr: () => {},
        onFailure: error => { failures.push(error.message); },
        onFrame: frame => { if (['host_tool_call', 'prompt_result', 'message_start', 'agent_start'].includes(frame.type)) activity.push(frame); },
      });
      const state = await rpc.command('get_state');
      assertModel(state, origin);
      assert.equal(state.sessionId, sessionId);
      assert.equal(state.isStreaming, false);
      assert.deepEqual(state.dumpTools, []);
      const journal = await rpc.command('get_entries');
      assert(Array.isArray(journal.entries));
      const retained = journal.entries.map(object).find(entry => entry.id === 'usage');
      assert(retained, 'Native loader must retain the usage entry, not silently drop malformed fixture data');
      assert.equal(retained.purpose, 'discarded-turn');
      assert.deepEqual(retained.usage, usage);
      if (offBranch) assert.equal(retained.activeLeafId, 'user');
      const messages = await rpc.command('get_messages');
      assert(Array.isArray(messages.messages));
      assert(!messages.messages.some(value => object(value).role === 'assistant'));
      const stats = await rpc.command('get_session_stats');
      const finalStats = await rpc.finalSessionStats();
      await stopped(rpc);
      rpc = undefined;
      assert.equal(requests, 0);
      assert.deepEqual(activity, []);
      assert.deepEqual(failures, []);
      assert.deepEqual(finalStats.tokens, stats.tokens);
      assert.deepEqual(stats.tokens, { input: 101, output: 17, reasoning: 0, cacheRead: 23, cacheWrite: 5, total: 146 },
        offBranch ? 'Compatibility blocker: cumulative native RPC stats must include off-branch discarded-turn usage (146); zero is not acceptable'
          : 'Active sensitivity control must prove the same 146-token model_usage payload is parsed and counted');
    }
  } finally {
    try { await rpc?.shutdown(); }
    finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
  }
}, 120_000);
