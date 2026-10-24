// Protocol fixture only: no provider, filesystem tools, credentials or network.
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.argv.includes('--version')) { console.log('omp/18.12.6'); process.exit(0); }
const startupUnsafe = process.argv.includes('unsafe');
const send = (value: unknown) => console.log(JSON.stringify(value));
const required = ['--mode', '--no-ui', '--no-tools', '--no-extensions', '--no-skills', '--no-rules', '--no-lsp', '--no-pty', '--no-title', '--no-prewalk', '--session-dir'];
if (required.some(flag => !process.argv.includes(flag)) || process.env.NODE_OPTIONS || process.env.BUN_OPTIONS || process.env.PI_CONFIG_FILES) process.exit(12);
const config = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR!, 'config.yml'), 'utf8'));
if (config.retry.enabled !== false || config.providers.cacheWarming !== 'off' || config.providers.openaiWebsockets !== 'off' || config.goal.enabled !== false || config.magicKeywords.enabled !== false || config.marketplace.autoUpdate !== 'off') process.exit(13);
if (!process.cwd().startsWith(join(process.env.HOME!, '..')) || process.env.HOME === process.env.FIXTURE_REAL_HOME) process.exit(14);
const models = [
  { provider: 'fixture', id: 'vision', name: 'Fixture vision', input: ['text', 'image'] },
  { provider: 'fixture', id: 'text', name: 'Fixture text', input: ['text'] },
];
let model = process.argv.includes('unselected') ? { ...models[0], id: 'unavailable-default' } : models[0]; let thinking = 'medium'; let streaming = false; let turns = 0; let tokenTotal = 10;
send({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 1024 * 1024 });
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const frame = JSON.parse(line);
  const response = (data: unknown = {}) => send({ type: 'response', id: frame.id, command: frame.type, success: true, data });
  switch (frame.type) {
    case 'negotiate_protocol': response({ protocolVersion: 2 }); break;
    case 'get_available_models': response({ models }); break;
    case 'get_available_thinking_levels': response({ levels: model.id === 'vision' ? ['off', 'medium'] : ['off'] }); break;
    case 'get_state': response({ model, thinkingLevel: thinking, dumpTools: startupUnsafe ? [{ name: 'write' }] : [], goal: null, isSettled: !streaming, hasPendingAsyncWork: false }); break;
    case 'get_session_stats': response({ tokens: { total: tokenTotal } }); break;
    case 'set_model': model = models.find(item => item.id === frame.modelId && item.provider === frame.provider)!; thinking = model.id === 'text' ? 'off' : 'medium'; response(model); break;
    case 'set_thinking_level': thinking = model.id === 'text' ? 'off' : frame.level; response(); break;
    case 'set_auto_retry': case 'set_cache_warming': case 'set_host_tools': case 'set_event_filter': response(); break;
    case 'abort': streaming = false; response(); break;
    case 'prompt': {
      turns++; streaming = true; response();
      const prompt = String(frame.message);
      const messageId = `msg-${turns}`;
      const delta = (text: string) => send({ type: 'message_update', messageId, assistantMessageEvent: { type: 'text_delta', delta: text } });
      delta(`Partial turn ${turns}. `);
      if (prompt.includes('FIXTURE:OVERSIZE')) { console.log('x'.repeat(1024 * 1024)); break; }
      if (prompt.includes('FIXTURE:TOOL')) { send({ type: 'tool_execution_start', toolName: 'write' }); break; }
      if (prompt.includes('FIXTURE:URI')) { send({ type: 'host_uri_request', id: 'unexpected', uri: 'file:///etc/passwd' }); break; }
      if (prompt.includes('FIXTURE:UI')) { send({ type: 'extension_ui_request', id: 'unexpected', method: 'confirm' }); break; }
      if (prompt.includes('FIXTURE:PROVIDER')) { send({ type: 'prompt_result', id: frame.id, status: 'error', error: { message: 'sk-DO-NOT-EXPOSE-SECRET' } }); break; }
      if (prompt.includes('FIXTURE:TOKENS')) { tokenTotal = 32001; break; }
      if (prompt.includes('FIXTURE:HOLD')) break;
      delta(`wireSafe=${!prompt.startsWith('/') && !prompt.includes('@') && !prompt.includes('^')}; context=${prompt.includes('repository fixture body')}; skill=${prompt.includes('skill fixture body')}; images=${frame.images?.length ?? 0}`);
      streaming = false;
      send({ type: 'prompt_result', id: frame.id, status: 'completed', sessionSettled: true });
      send({ type: 'session_settled' });
      break;
    }
    default: send({ type: 'response', id: frame.id, command: frame.type, success: false, error: 'Fixture rejected unexpected RPC' });
  }
});
input.on('close', () => process.exit(0));
