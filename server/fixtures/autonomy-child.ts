// Deterministic protocol peer. Never represents a real OMP/provider or semantic reviewer.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { FrameDecoder, type Frame } from '../rpc';
import type { Ticket } from '../contracts';
const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1]!;
if (args.includes('--version')) { console.log('18.13.3'); process.exit(0); }
const configPath = argument('--fixture-config');
const config = JSON.parse(await readFile(configPath, 'utf8')) as { scenario?: string; tokens?: number; holdAuthor?: boolean; holdReview?: boolean };
const reviewer = args.includes('--no-tools');
if (reviewer && args.includes('--append-system-prompt')) throw new Error('Restricted reviewer must not receive author engineering system instructions');
const directory = reviewer ? dirname(argument('--session-dir')) : dirname(argument('--config'));
const ticket = reviewer ? null : JSON.parse(await readFile(join(directory, 'ticket.json'), 'utf8')) as Ticket;
const sessionFile = args.includes('--resume') ? argument('--resume') : join(argument('--session-dir'), 'fixture-session.json');
await mkdir(dirname(sessionFile), { recursive: true });
const session: { id: string; model: string; turns: number; authorFiles: string[]; messages?: Record<string, unknown>[] } = args.includes('--resume') ? JSON.parse(await readFile(sessionFile, 'utf8')) : { id: crypto.randomUUID(), model: args.includes('--model') ? argument('--model') : 'fixture/author', turns: 0, authorFiles: [] };
if (!reviewer && !args.includes('--resume')) session.authorFiles = await readFile(join(process.cwd(), 'proof.txt'), 'utf8') === 'verified\n' ? [] : ['proof.txt'];
await writeFile(sessionFile, JSON.stringify(session));
const log = (event: Record<string, unknown>) => appendFile(`${configPath}.events`, JSON.stringify({ ...event, pid: process.pid, sessionId: session.id, reviewer }) + '\n');
await log({ event: 'spawn', resumed: args.includes('--resume'), args });
const send = (value: Frame) => process.stdout.write(JSON.stringify(value) + '\n');
const decoder = new FrameDecoder();
let settled = false; let compaction = false; let thinking = 'medium'; let prompt = ''; let reviewNumber = 0;
let engineeringDiscovered = false;
let authorToolsRegistered = false;
let invocationReads = 0;
const host = (id: string, toolName: string, value: unknown) => send({ type: 'host_tool_call', id, toolName, arguments: value });
const finishAuthor = async () => {
  session.turns++; await writeFile(sessionFile, JSON.stringify(session));
  if (config.scenario === 'author-bypass') {
    host('bypass-done', 'backlog_result', { revision: ticket!.revision, status: 'done', files: ['proof.txt'], evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Author claims Done; skip host verification.' })) });
    return;
  }
  if (config.holdAuthor) { await writeFile(join(process.cwd(), 'proof.txt'), 'partial'); return; }
  if (config.scenario !== 'noop') await writeFile(join(process.cwd(), 'proof.txt'), 'verified\n');
  if (config.scenario === 'blocked' || config.scenario === 'recovery' && session.turns === 1) {
    host('result', 'backlog_result', { revision: ticket!.revision, status: 'blocked', files: session.authorFiles, evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Source implemented; verification remains incomplete.' })), prerequisite: 'Original verification is unfinished', unblock: 'Finish the original checks', ...(config.scenario === 'recovery' ? { recoverableCause: 'incomplete_verification' } : { permission: 'Owner must provide unavailable permission' }) });
  } else host('evidence', 'backlog_evidence', { revision: ticket!.revision, criterion: ticket!.criteria[0], feature: 'disposable proof', entryPoint: 'proof.txt', method: 'fixture read-back', outcome: 'passed', details: 'Synthetic author report: verified, not independent host proof.', recipe: 'verify.ts (host executes independently)' });
};
send({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
for await (const line of createInterface({ input: process.stdin })) {
  const frame = decoder.decode(Buffer.from(line)); if (!frame) continue;
  await log({ event: 'command', command: frame.type, op: frame.op, ...(frame.type === 'set_host_tools' && Array.isArray(frame.tools) ? { tools: frame.tools.map(tool => tool.name) } : {}), ...(frame.type === 'goal' && frame.op === 'create' ? { objective: frame.objective } : {}) });
  const respond = (data: Record<string, unknown> = {}) => send({ type: 'response', id: frame.id, success: true, data });
  if (frame.type === 'negotiate_protocol') respond({ protocolVersion: 2 });
  else if (frame.type === 'get_state') respond({ sessionId: session.id, sessionFile, isSettled: settled, hasPendingAsyncWork: false, dumpTools: reviewer || config.scenario === 'disabled-plugin' ? [] : [{ name: 'task' }], model: { provider: session.model.split('/')[0], id: session.model.split('/').slice(1).join('/') }, thinkingLevel: thinking, autoCompactionEnabled: compaction });
  else if (frame.type === 'get_available_commands') {
    if (reviewer) throw new Error('Restricted reviewer must not discover engineering commands');
    engineeringDiscovered = true;
    respond({ commands: config.scenario === 'disabled-plugin' ? [] : ['poteto-mode', 'pstack-pi'].filter(name => !(config.scenario === 'missing-router' && name === 'poteto-mode') && !(config.scenario === 'missing-adapter' && name === 'pstack-pi')).map(name => ({ name: `skill:${name}`, source: 'skill' })) });
  }
  else if (frame.type === 'get_messages') {
    if (reviewer) throw new Error('Restricted reviewer must not inspect native engineering invocation history');
    invocationReads++;
    if (config.scenario === 'missing-invocation' && invocationReads > 1) {
      send({ type: 'response', id: frame.id, success: false, error: 'Fixture history unavailable after missing native poteto-mode skill-prompt record' });
    } else respond({ messages: invocationReads === 1 && config.scenario !== 'missing-invocation' ? [] : session.messages ?? [] });
  }
  else if (frame.type === 'get_session_stats') respond({ tokens: { total: config.tokens ?? (reviewer ? 7 : 11 * session.turns) } });
  else if (frame.type === 'set_auto_compaction') { compaction = frame.enabled === true; respond(); }
  else if (frame.type === 'get_available_thinking_levels') respond({ levels: ['off', 'medium', 'high'] });
  else if (frame.type === 'set_thinking_level') { thinking = String(frame.level); respond(); }
  else if (frame.type === 'set_host_tools') {
    if (!reviewer && !engineeringDiscovered) throw new Error('Author tool registration must follow engineering preflight');
    const names = Array.isArray(frame.tools) ? frame.tools.map(tool => tool.name) : [];
    if (reviewer && JSON.stringify(names) !== JSON.stringify(['candidate_diff', 'candidate_source', 'backlog_review'])) throw new Error('Restricted reviewer received non-review capabilities');
    authorToolsRegistered = !reviewer;
    respond();
  }
  else if (['set_auto_retry', 'set_cache_warming', 'abort'].includes(frame.type)) respond();
  else if (frame.type === 'prompt') {
    prompt = String(frame.message); settled = false;
    const routed = prompt.startsWith('/skill:poteto-mode\n');
    if (reviewer && routed) throw new Error('Restricted reviewer must never initialize the engineering router');
    if (!reviewer && (!authorToolsRegistered || routed === args.includes('--resume'))) throw new Error('Only fresh admitted authors initialize the engineering router');
    if (routed) {
      session.messages = [{ role: 'custom', customType: 'skill-prompt', details: { name: 'poteto-mode', path: join(directory, 'fixture-skills/poteto-mode/SKILL.md'), prompt: config.scenario === 'missing-invocation' ? 'Stale prior prompt, not the submitted invocation' : prompt.trim(), lineCount: 1 }, content: 'Deterministic fixture native router expansion, not an installed playbook.' }];
      await writeFile(sessionFile, JSON.stringify(session));
      await log({ event: 'native-skill-record' });
    }
    respond();
    await log({ event: 'prompt', message: prompt });
    if (reviewer) {
      if (config.holdReview) continue;
      try { reviewNumber = Number(await readFile(`${configPath}.reviews`, 'utf8')); } catch { reviewNumber = 0; }
      reviewNumber++; await writeFile(`${configPath}.reviews`, String(reviewNumber));
      host('diff', 'candidate_diff', {});
    }
  } else if (frame.type === 'goal') {
    if (reviewer || frame.op === 'create' && String(frame.objective).startsWith('/skill:')) throw new Error('Native goals must not initialize the engineering router');
    respond(); if (frame.op === 'create' || frame.op === 'resume') await finishAuthor();
  }
  else if (frame.type === 'host_tool_result') {
    if (frame.id === 'bypass-done' || frame.id === 'bypass-review') {
      await log({ event: 'bypass-result', id: frame.id, rejected: frame.isError === true });
      if (frame.isError !== true) throw new Error('Host accepted an author-only Done/review bypass');
      if (frame.id === 'bypass-done') host('bypass-review', 'backlog_review', { revision: ticket!.revision, sessionId: session.id, verdict: 'pass', findings: [], criteria: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Self review claims pass.' })) });
      else send({ type: 'extension_ui_request', id: 'bypass-held', method: 'input', title: 'Rejected bypass; wait for operator' });
      continue;
    }
    if (frame.isError === true) { await log({ event: 'host-rejected', id: frame.id }); settled = true; send({ type: 'session_settled' }); continue; }
    if (frame.id === 'evidence') host('result', 'backlog_result', { revision: ticket!.revision, status: 'complete', files: session.authorFiles, evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Synthetic author wrote/read proof.txt: verified.' })) });
    else if (frame.id === 'result') { if (config.scenario === 'blocked' || config.scenario === 'recovery' && session.turns === 1) continue; settled = true; send({ type: 'session_settled' }); }
    else if (frame.id === 'diff') host('source', 'candidate_source', { path: 'proof.txt' });
    else if (frame.id === 'source') {
      const revision = /revision ([a-f0-9]+)\./.exec(prompt)![1];
      const tree = /Candidate tree: ([a-f0-9]+)/.exec(prompt)![1];
      const criteria = JSON.parse(/Criteria: (\[[^\n]+\])/.exec(prompt)![1]) as string[];
      const changes = config.scenario === 'always-findings' || config.scenario === 'findings' && reviewNumber === 1;
      const verdict = config.scenario === 'inconclusive' ? 'inconclusive' : changes ? 'changes_required' : 'pass';
      host('review', 'backlog_review', { revision, sessionId: session.id, candidateTree: config.scenario === 'wrong-tree' ? '0'.repeat(40) : tree, verdict, findings: changes ? ['Improve proof implementation and repeat the original checks.'] : verdict === 'inconclusive' ? ['Product intent needs owner clarification.'] : [], criteria: criteria.map(criterion => ({ criterion, evidence: 'Independently read immutable proof.txt candidate blob and actual host command result (synthetic reviewer).' })) });
    } else if (frame.id === 'review') { settled = true; send({ type: 'session_settled' }); }
  } else throw new Error(`Unsupported autonomous fixture command ${frame.type}`);
}
decoder.end();
await log({ event: 'exit' });
