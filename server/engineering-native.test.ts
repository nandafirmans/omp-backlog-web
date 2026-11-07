import { expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertEngineeringWorkflow } from './engineering';
import { object, RpcProcess } from './rpc';

// Metadata-only installed-environment checks: no prompt, provider inference, or
// claim that command discovery establishes package identity or playbook use.
const nativeTest = process.env.OMP_BACKLOG_NATIVE_TESTS === '1' ? test : test.skip;
const requiredCommands = ['skill:poteto-mode', 'skill:pstack-pi'];
const unavailable = /Required pstack engineering workflow unavailable/;

async function skillCommands(rpc: RpcProcess): Promise<string[]> {
  const data = await rpc.command('get_available_commands');
  expect(Array.isArray(data.commands)).toBe(true);
  return (data.commands as unknown[]).map(object)
    .filter(command => command.source === 'skill')
    .map(command => String(command.name));
}

async function withInstalledOmp(
  options: { flags?: string[]; isolated?: boolean },
  run: (rpc: RpcProcess, state: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'omp-engineering-native-'));
  let rpc: RpcProcess | undefined;
  try {
    const project = join(root, 'project');
    const privateDirectory = join(root, 'private');
    const sessions = join(privateDirectory, 'sessions');
    const skill = join(project, '.omp', 'skills', 'verify-synthetic');
    await mkdir(join(project, '.git'), { recursive: true, mode: 0o700 });
    await mkdir(sessions, { recursive: true, mode: 0o700 });
    await mkdir(skill, { recursive: true, mode: 0o700 });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: verify-synthetic\ndescription: Verify this disposable synthetic project.\n---\n\n# Synthetic project verification\n\nInspect only this disposable project. Do not invoke providers or modify global configuration.\n', { mode: 0o600 });
    const overlay = join(privateDirectory, 'config.yml');
    await writeFile(overlay, "goal:\n  enabled: true\n  continuationModes:\n    - rpc\nskills:\n  manualSkills:\n    - '*'\n", { mode: 0o600 });
    const env: NodeJS.ProcessEnv = { ...process.env, PI_NO_PTY: '1', PI_NO_TITLE: '1' };
    if (options.isolated) {
      env.HOME = join(privateDirectory, 'home');
      env.XDG_CONFIG_HOME = join(privateDirectory, 'xdg-config');
      env.PI_CODING_AGENT_DIR = join(privateDirectory, 'agent');
      // Do not let an inherited explicit config/profile bypass the empty roots.
      delete env.PI_CONFIG_FILES;
      delete env.OMP_PROFILE;
      await Promise.all([env.HOME, env.XDG_CONFIG_HOME, env.PI_CODING_AGENT_DIR]
        .map(path => mkdir(path!, { recursive: true, mode: 0o700 })));
    }
    // Empty config roots have no default model. Pin catalog metadata only;
    // this control never submits a prompt or invokes a provider.
    const modelArgs = options.isolated ? ['--model', 'openai-codex/gpt-6.1-sol'] : [];
    const failures: Error[] = [];
    rpc = await RpcProcess.launch({
      executable: 'omp',
      args: ['--mode', 'rpc-ui', '--config', overlay, '--session-dir', sessions, '--no-pty', ...modelArgs, ...(options.flags ?? [])],
      cwd: project,
      env,
      onSpawn: async () => {},
      onFrame: () => {},
      // Drain without retaining or printing native startup/configuration output.
      onStderr: () => {},
      onFailure: error => { failures.push(error); },
    });
    const sent = spyOn(rpc, 'send');
    try {
      const state = await rpc.command('get_state');
      await run(rpc, state);
      expect([...new Set(sent.mock.calls.map(([frame]) => frame.type))].sort())
        .toEqual(['get_available_commands', 'get_state']);
    } finally {
      sent.mockRestore();
      await rpc.shutdown();
      expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(true);
      expect(failures.map(error => error.message)).toEqual([]);
      rpc = undefined;
    }
  } finally {
    // RpcProcess owns only the child/group it launched; never signal by name.
    await rpc?.shutdown();
    await rm(root, { recursive: true, force: true });
  }
}

nativeTest('installed OMP author discovery admits pstack alongside native task and a project verification skill', async () => {
  await withInstalledOmp({}, async (rpc, state) => {
    await expect(assertEngineeringWorkflow(rpc, state)).resolves.toBeUndefined();
    const commands = await skillCommands(rpc);
    expect(commands).toEqual(expect.arrayContaining([...requiredCommands, 'skill:verify-synthetic']));
    expect(Array.isArray(state.dumpTools)).toBe(true);
    expect((state.dumpTools as unknown[]).map(object).map(tool => tool.name)).toContain('task');
  });
}, 120_000);

nativeTest('installed OMP --no-skills rejects engineering admission before a prompt', async () => {
  await withInstalledOmp({ flags: ['--no-skills'] }, async (rpc, state) => {
    await expect(assertEngineeringWorkflow(rpc, state)).rejects.toThrow(unavailable);
    expect(await skillCommands(rpc)).toEqual([]);
  });
}, 120_000);

nativeTest('installed OMP --no-extensions rejects engineering admission before a prompt', async () => {
  await withInstalledOmp({ flags: ['--no-extensions'] }, async (rpc, state) => {
    await expect(assertEngineeringWorkflow(rpc, state)).rejects.toThrow(unavailable);
    const commands = await skillCommands(rpc);
    for (const command of requiredCommands) expect(commands).not.toContain(command);
  });
}, 120_000);

nativeTest('isolated OMP missing pstack rejects admission while retaining project skill discovery', async () => {
  await withInstalledOmp({ isolated: true }, async (rpc, state) => {
    await expect(assertEngineeringWorkflow(rpc, state)).rejects.toThrow(unavailable);
    const commands = await skillCommands(rpc);
    expect(commands).toContain('skill:verify-synthetic');
    for (const command of requiredCommands) expect(commands).not.toContain(command);
  });
}, 120_000);
