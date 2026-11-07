import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installProfile, privateArgs } from './drafting';
import { object, RpcProcess } from './rpc';

const nativeTest = process.env.OMP_BACKLOG_NATIVE_TESTS === '1' ? test : test.skip;

nativeTest('restricted startup rejects ancestor plugin imports; removing only the namespace anchor proves sentinel sensitivity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-restricted-ancestor-'));
  const plugins = join(root, '.omp', 'plugins');
  const pkg = join(plugins, 'node_modules', 'audit-sentinel');
  await mkdir(pkg, { recursive: true });
  await writeFile(join(plugins, 'package.json'), JSON.stringify({ private: true, dependencies: { 'audit-sentinel': '0.0.0' } }));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'audit-sentinel', version: '0.0.0', omp: { tools: ['tool.ts'] } }));
  try {
    for (const positive of [true, false]) {
      const marker = join(root, `${positive ? 'positive' : 'restricted'}.marker`);
      await writeFile(join(pkg, 'tool.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'imported'); export default function () { return []; }\n`);
      const directory = join(root, 'private', positive ? 'positive' : 'restricted');
      await mkdir(directory, { recursive: true });
      const env = await installProfile(directory);
      if (positive) {
        try { await rename(join(directory, 'work', '.omp'), join(directory, 'disabled-anchor')); }
        catch (error) { if (object(error).code !== 'ENOENT') throw error; }
      }
      const forbidden: string[] = [];
      const rpc = await RpcProcess.launch({ executable: 'omp', args: [...privateArgs(directory), '--model', 'openai-codex/gpt-6.1-sol'], cwd: join(directory, 'work'), env,
        onSpawn: async () => {}, onStderr: () => {}, onFailure: error => { forbidden.push(error.message); },
        onFrame: frame => { if (['tool_execution_start', 'host_tool_call', 'host_uri_request', 'prompt_result', 'message_start'].includes(frame.type)) forbidden.push(frame.type); },
      });
      try {
        const state = await rpc.command('get_state');
        expect(state.dumpTools).toEqual([]);
        expect(state.goal).toBeFalsy();
        expect(await stat(marker).then(() => true, () => false)).toBe(positive);
        expect(forbidden).toEqual([]);
        if (!positive) {
          expect(state.model).toMatchObject({ provider: 'openai-codex', id: 'gpt-6.1-sol' });
          const thinking = await rpc.command('get_available_thinking_levels');
          expect(thinking.levels).toContain('low');
          await rpc.command('set_thinking_level', { level: 'low' });
          const selected = await rpc.command('get_state');
          expect(selected.model).toMatchObject({ provider: 'openai-codex', id: 'gpt-6.1-sol' });
          expect(selected.thinkingLevel).toBe('low');
          const names = ['candidate_diff', 'candidate_source', 'backlog_review'];
          await rpc.command('set_host_tools', { tools: names.map(name => ({ name, label: name, description: 'Synthetic restricted host tool.', loadMode: 'essential', parameters: { type: 'object', properties: {}, additionalProperties: false } })) });
          const active = await rpc.command('get_state');
          expect((active.dumpTools as unknown[]).map(object).map(tool => tool.name).sort()).toEqual([...names].sort());
        }
      } finally { await rpc.shutdown(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}, 120000);
