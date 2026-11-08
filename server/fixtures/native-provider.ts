import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const provider = 'native-proof';
export const model = 'synthetic-proof';
export const disabledProviders = ['native', 'builtin-defaults', 'agent-plugins', 'agents-md', 'claude-md', 'custom-context-files', 'claude', 'claude-plugins', 'cline', 'agents', 'codex', 'cursor', 'gemini', 'opencode', 'github', 'mcp-json', 'omp-plugins', 'skillshare', 'ssh', 'vscode', 'windsurf', 'managed-skills'];

export async function privateProfile(root: string, origin: string, engineering: boolean) {
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
