// Deterministic RPC peer for runtime acceptance tests, not an OMP/provider substitute.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { FrameDecoder } from '../rpc';
import type { Frame } from '../rpc';
import type { Ticket } from '../contracts';

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing fixture argument ${name}`);
  return args[index + 1]!;
}
const directory = dirname(argument('--config'));
const ticket = JSON.parse(await readFile(join(directory, 'ticket.json'), 'utf8')) as Ticket;
if (ticket.criteria.length !== 1 || ticket.criteria[0] !== 'proof.txt contains verified.') {
  throw new Error('This protocol fixture can verify only the disposable proof.txt criterion');
}
const configuration = JSON.parse(await readFile(join(process.cwd(), 'fixture.json'), 'utf8')) as { scenario: 'hold' | 'provider-failure' | 'tokens' | 'blocked' | 'clamp-thinking'; tokens?: number; expectedFeedback?: string };
const sessionFile = args.includes('--resume') ? argument('--resume') : join(argument('--session-dir'), 'fixture-session.json');
if (args.includes('--resume') && args.includes('--model')) throw new Error('Resume must preserve persisted session model and thinking');
await mkdir(dirname(sessionFile), { recursive: true });
const session = args.includes('--resume')
  ? JSON.parse(await readFile(sessionFile, 'utf8')) as { id: string; thinking?: string }
  : { id: crypto.randomUUID(), thinking: 'medium' };
await writeFile(sessionFile, JSON.stringify(session));
const log = (event: Record<string, unknown>) => appendFile(join(process.cwd(), 'fixture-events.jsonl'), JSON.stringify({ ...event, pid: process.pid, sessionId: session.id }) + '\n');
const send = (frame: Frame) => process.stdout.write(JSON.stringify(frame) + '\n');
let settled = false;
let resultId: string | null = null;
let evidenceId: string | null = null;
let negotiated = false;
let toolsRegistered = false;
const decoder = new FrameDecoder();
await log({ event: 'spawn', resumed: args.includes('--resume'), sessionFile });
send({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });

for await (const line of createInterface({ input: process.stdin })) {
  const frame = decoder.decode(Buffer.from(line));
  if (!frame) continue;
  await log({ event: 'command', command: frame.type, op: frame.op, level: frame.level });
  const respond = (data: Record<string, unknown> = {}) => send({ type: 'response', id: frame.id, success: true, data });
  if (frame.type === 'negotiate_protocol' && frame.protocolVersion === 2) {
    negotiated = true;
    respond({ protocolVersion: 2 });
  } else if (!negotiated) {
    throw new Error('Fixture requires protocol v2 negotiation');
  } else if (frame.type === 'get_state') {
    respond({ sessionId: session.id, sessionFile, isSettled: settled, hasPendingAsyncWork: false, thinkingLevel: session.thinking ?? 'medium' });
  } else if (frame.type === 'get_available_thinking_levels') {
    respond({ levels: ['off', 'medium', 'high'] });
  } else if (frame.type === 'set_thinking_level') {
    session.thinking = configuration.scenario === 'clamp-thinking' ? 'medium' : String(frame.level);
    await writeFile(sessionFile, JSON.stringify(session));
    respond();
  } else if (frame.type === 'set_host_tools') {
    if (!Array.isArray(frame.tools) || !frame.tools.some((tool) => tool.name === 'backlog_result')) throw new Error('Missing backlog_result registration');
    toolsRegistered = true;
    respond();
  } else if (frame.type === 'set_auto_retry' || frame.type === 'set_cache_warming' || frame.type === 'abort') {
    respond();
  } else if (frame.type === 'prompt') {
    if (!toolsRegistered || typeof frame.message !== 'string' || !frame.message.includes(ticket.revision)) throw new Error('Prompt lacks registered tool or immutable revision');
    if (configuration.expectedFeedback && !frame.message.includes(configuration.expectedFeedback)) throw new Error('Prompt lost human review feedback');
    await log({ event: 'prompt-admitted', revision: ticket.revision, thinking: session.thinking ?? 'medium' });
    respond();
  } else if (frame.type === 'goal') {
    respond();
    if (frame.op === 'create' || frame.op === 'resume') {
      await log({ event: 'executing' });
      if (configuration.scenario === 'provider-failure') {
        send({ type: 'prompt_result', status: 'error', error: { message: 'Deterministic provider failure after admission' } });
      } else {
        send({ type: 'extension_ui_request', id: 'finish', method: 'input', title: 'Fixture completion barrier' });
      }
    }
  } else if (frame.type === 'get_session_stats') {
    respond({ tokens: { total: configuration.scenario === 'tokens' ? configuration.tokens : 0 } });
  } else if (frame.type === 'extension_ui_response' && frame.id === 'finish') {
    if (frame.value !== 'finish' || frame.cancelled === true) continue;
    if (configuration.scenario === 'blocked') {
      resultId = crypto.randomUUID();
      send({ type: 'host_tool_call', id: resultId, toolName: 'backlog_result', arguments: {
        revision: ticket.revision, status: 'blocked', evidence: [], prerequisite: 'Disposable prerequisite is absent', unblock: 'Operator supplies prerequisite',
      } });
      continue;
    }
    await writeFile(join(process.cwd(), 'proof.txt'), 'verified\n');
    const proof = await readFile(join(process.cwd(), 'proof.txt'), 'utf8');
    if (proof !== 'verified\n') throw new Error('Fixture proof verification failed');
    resultId = crypto.randomUUID();
    evidenceId = crypto.randomUUID();
    send({ type: 'host_tool_call', id: evidenceId, toolName: 'backlog_evidence', arguments: {
      revision: ticket.revision, criterion: ticket.criteria[0], feature: 'fixture proof', entryPoint: 'protocol child',
      method: 'write/read proof.txt', outcome: 'passed', details: 'Read back verified; protocol fixture, not live provider.',
      recipe: 'server/fixtures/runtime-child.ts (protocol fixture)', artifact: { name: 'proof.txt', base64: Buffer.from(proof).toString('base64') },
    } });
  } else if (frame.type === 'host_tool_result' && frame.id === evidenceId) {
    if (frame.isError === true) throw new Error('Runtime rejected fixture evidence');
    send({ type: 'host_tool_call', id: resultId, toolName: 'backlog_result', arguments: {
      revision: ticket.revision, status: 'complete',
      evidence: ticket.criteria.map((criterion) => ({ criterion, evidence: 'Protocol fixture wrote and read proof.txt: verified; no real provider was exercised.' })),
    } });
  } else if (frame.type === 'host_tool_result' && frame.id === resultId) {
    if (frame.isError === true) throw new Error('Runtime rejected fixture result');
    if (configuration.scenario === 'blocked') continue; // Host must stop an unmet goal; fixture never settles itself.
    settled = true;
    await log({ event: 'result-accepted', revision: ticket.revision });
    send({ type: 'session_settled' });
  } else {
    throw new Error(`Unsupported fixture command ${frame.type}`);
  }
}
decoder.end();
await log({ event: 'exit' });
