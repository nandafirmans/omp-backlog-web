import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RpcProcess } from './rpc';


// Real protocol children run outside fake timers; these tests await command responses, not guessed sleeps.
type ReadRetry = NonNullable<Parameters<typeof RpcProcess.launch>[0]['readRetry']>;
interface Fixture { failures?: number; error?: string; mode?: 'timeout' | 'protocol' | 'prompt_result' | 'malformed_response' }

async function withChild(config: Fixture, retry: ReadRetry | undefined, run: (rpc: RpcProcess, commands: () => Promise<string[]>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'omp-rpc-retry-'));
  const executable = join(root, 'protocol-child');
  const log = join(root, 'commands.jsonl');
  await writeFile(executable, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const config = ${JSON.stringify(config)};
const log = ${JSON.stringify(log)};
const counts = {};
const send = frame => process.stdout.write(JSON.stringify(frame) + '\\n');
send({type:'ready', protocolVersion:1, supportedProtocolVersions:[2], maxFrameBytes:1048576, maxReassembledFrameBytes:67108864});
createInterface({input:process.stdin}).on('line', line => {
  const command = JSON.parse(line);
  if (command.type === 'negotiate_protocol') { send({type:'response', id:command.id, success:true}); return; }
  appendFileSync(log, JSON.stringify(command.type) + '\\n');
  const count = counts[command.type] = (counts[command.type] || 0) + 1;
  if (config.mode === 'timeout') return;
  if (config.mode === 'protocol') { process.stdout.write('invalid JSON\\n'); return; }
  if (config.mode === 'prompt_result') send({type:'prompt_result', success:false, error:'temporarily unavailable'});
  if (config.mode === 'malformed_response') { send({type:'response', id:command.id, error:'temporarily unavailable'}); return; }
  send(count <= (config.failures ?? 1)
    ? {type:'response', id:command.id, success:false, error:config.error ?? 'temporarily unavailable'}
    : {type:'response', id:command.id, success:true, data:{count}});
});
`, { mode: 0o700 });
  let rpc: RpcProcess | undefined;
  try {
    rpc = await RpcProcess.launch({ executable, args: [], cwd: root, onSpawn: async () => {}, onFrame: () => {}, onStderr: () => {}, onFailure: () => {}, readRetry: retry });
    await run(rpc, async () => {
      try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    });
  } finally {
    await rpc?.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}

function readRetry(beforeRetry: ReadRetry['beforeRetry'] = () => {}): ReadRetry {
  return { signal: new AbortController().signal, beforeRetry };
}

for (const command of ['get_state', 'get_session_stats', 'get_available_commands', 'get_messages', 'get_available_thinking_levels']) {
  test(`${command} retries an explicit transient failure once`, async () => {
    const events: Parameters<ReadRetry['beforeRetry']>[0][] = [];
    await withChild({}, readRetry(event => { events.push(event); }), async (rpc, commands) => {
      expect(await rpc.command(command)).toEqual({ count: 2 });
      expect(await commands()).toEqual([command, command]);
      expect(events).toEqual([{ command, attempt: 1, error: 'temporarily unavailable', delayMs: 100 }]);
    });
  });
}

test('read retry exhausts exactly two retries with bounded backoff', async () => {
  const events: Parameters<ReadRetry['beforeRetry']>[0][] = [];
  await withChild({ failures: 99, error: 'rate limit exceeded' }, readRetry(event => { events.push(event); }), async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('rate limit exceeded');
    expect(await commands()).toEqual(['get_state', 'get_state', 'get_state']);
    expect(events.map(({ attempt, delayMs }) => [attempt, delayMs])).toEqual([[1, 100], [2, 250]]);
  });
});

test('second retry can recover without resetting its budget', async () => {
  await withChild({ failures: 2 }, readRetry(), async (rpc, commands) => {
    expect(await rpc.command('get_state')).toEqual({ count: 3 });
    expect(await commands()).toEqual(['get_state', 'get_state', 'get_state']);
  });
});

test('default reads and all mutations never replay transient failures', async () => {
  await withChild({}, undefined, async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('temporarily unavailable');
    expect(await commands()).toEqual(['get_state']);
  });
  await withChild({}, readRetry(() => { throw new Error('must not retry'); }), async (rpc, commands) => {
    const mutations = ['prompt', 'set_goal', 'get_goal', 'abort', 'set_model', 'set_thinking_level'];
    for (const command of mutations) await expect(rpc.command(command)).rejects.toThrow('temporarily unavailable');
    expect(await commands()).toEqual(mutations);
  });
});

for (const error of ['permission denied: temporarily unavailable', 'authentication failed: rate limit', 'protocol failure: service unavailable', 'shutdown: temporarily unavailable', 'shutting down: service unavailable', 'prompt_result: temporarily unavailable', 'timeout: temporarily unavailable', 'unknown command']) {
  test(`does not retry ${error}`, async () => {
    await withChild({ error }, readRetry(), async (rpc, commands) => {
      await expect(rpc.command('get_state')).rejects.toThrow(error);
      expect(await commands()).toEqual(['get_state']);
    });
  });
}

for (const mode of ['protocol', 'malformed_response', 'timeout'] as const) {
  test(`does not retry ${mode} failure`, async () => {
    await withChild({ mode }, readRetry(), async (rpc, commands) => {
      await expect(rpc.command('get_state', {}, 100)).rejects.toThrow();
      expect(await commands()).toEqual(['get_state']);
    });
  });
}

test('provider prompt_result failure is not a command retry', async () => {
  await withChild({ failures: 0, mode: 'prompt_result' }, readRetry(), async (rpc, commands) => {
    expect(await rpc.command('get_state')).toEqual({ count: 1 });
    expect(await commands()).toEqual(['get_state']);
  });
});

test('original command timeout bounds retry delay', async () => {
  await withChild({}, readRetry(), async (rpc, commands) => {
    await expect(rpc.command('get_state', {}, 50)).rejects.toThrow('OMP command timed out: get_state');
    expect(await commands()).toEqual(['get_state']);
  });
});

test('already aborted authority sends no read', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled authority'));
  await withChild({}, { signal: controller.signal, beforeRetry: () => {} }, async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('cancelled authority');
    expect(await commands()).toEqual([]);
  });
});

test('teardown accounting observes usage once after execution authority is aborted', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled authority'));
  await withChild({ failures: 0 }, { signal: controller.signal, beforeRetry: () => { throw new Error('teardown must not retry'); } }, async (rpc, commands) => {
    await expect(rpc.command('get_session_stats')).rejects.toThrow('cancelled authority');
    expect(await rpc.finalSessionStats()).toEqual({ count: 1 });
    expect(await commands()).toEqual(['get_session_stats']);
  });
  await withChild({ failures: 99 }, { signal: controller.signal, beforeRetry: () => { throw new Error('teardown must not retry'); } }, async (rpc, commands) => {
    await expect(rpc.finalSessionStats()).rejects.toThrow('temporarily unavailable');
    expect(await commands()).toEqual(['get_session_stats']);
  });
});

test('abort during backoff rejects without replay', async () => {
  const controller = new AbortController();
  await withChild({}, { signal: controller.signal, beforeRetry: () => { setTimeout(() => controller.abort(new Error('cancelled authority')), 0); } }, async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('cancelled authority');
    expect(await commands()).toEqual(['get_state']);
  });
});

test('abort interrupts an unresolved retry observation', async () => {
  const controller = new AbortController();
  const observation = Promise.withResolvers<void>();
  await withChild({}, { signal: controller.signal, beforeRetry: () => { controller.abort(new Error('cancelled observation')); return observation.promise; } }, async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('cancelled observation');
    expect(await commands()).toEqual(['get_state']);
    observation.resolve();
  });
});

test('beforeRetry rejection prevents replay', async () => {
  await withChild({}, readRetry(() => { throw new Error('budget exhausted'); }), async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('budget exhausted');
    expect(await commands()).toEqual(['get_state']);
  });
});

test('guard rechecks authority after the delay', async () => {
  let valid = true;
  await withChild({}, { ...readRetry(() => { setTimeout(() => { valid = false; }, 0); }), guard: () => { if (!valid) throw new Error('authority expired'); } }, async (rpc, commands) => {
    await expect(rpc.command('get_state')).rejects.toThrow('authority expired');
    expect(await commands()).toEqual(['get_state']);
  });
});

test('shutdown during retry observation never replays', async () => {
  let shutdown: () => Promise<unknown> = async () => {};
  await withChild({}, readRetry(async () => { await shutdown(); }), async (rpc, commands) => {
    shutdown = () => rpc.shutdown();
    await expect(rpc.command('get_state')).rejects.toThrow('OMP transport is not writable');
    expect(await commands()).toEqual(['get_state']);
  });
});
