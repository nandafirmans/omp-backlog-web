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
const directory = reviewer ? dirname(argument('--session-dir')) : dirname(argument('--config'));
const ticket = reviewer ? null : JSON.parse(await readFile(join(directory, 'ticket.json'), 'utf8')) as Ticket;
const sessionFile = args.includes('--resume') ? argument('--resume') : join(argument('--session-dir'), 'fixture-session.json');
await mkdir(dirname(sessionFile), { recursive: true });
const session = args.includes('--resume') ? JSON.parse(await readFile(sessionFile, 'utf8')) as { id: string; model: string; turns: number } : { id: crypto.randomUUID(), model: args.includes('--model') ? argument('--model') : 'fixture/author', turns: 0 };
await writeFile(sessionFile, JSON.stringify(session));
const log = (event: Record<string, unknown>) => appendFile(`${configPath}.events`, JSON.stringify({ ...event, pid: process.pid, sessionId: session.id, reviewer }) + '\n');
await log({ event: 'spawn', resumed: args.includes('--resume'), args });
const send = (value: Frame) => process.stdout.write(JSON.stringify(value) + '\n');
const decoder = new FrameDecoder();
let settled = false; let compaction = false; let thinking = 'medium'; let prompt = ''; let reviewNumber = 0;
const host = (id: string, toolName: string, value: unknown) => send({ type: 'host_tool_call', id, toolName, arguments: value });
const finishAuthor = async () => {
  session.turns++; await writeFile(sessionFile, JSON.stringify(session));
  if (config.holdAuthor) { await writeFile(join(process.cwd(), 'proof.txt'), 'partial'); return; }
  if (config.scenario !== 'noop') await writeFile(join(process.cwd(), 'proof.txt'), 'verified\n');
  if (config.scenario === 'blocked' || config.scenario === 'recovery' && session.turns === 1) {
    host('result', 'backlog_result', { revision: ticket!.revision, status: 'blocked', files: ['proof.txt'], evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Source implemented; verification remains incomplete.' })), prerequisite: 'Original verification is unfinished', unblock: 'Finish the original checks', ...(config.scenario === 'recovery' ? { recoverableCause: 'incomplete_verification' } : { permission: 'Owner must provide unavailable permission' }) });
  } else host('evidence', 'backlog_evidence', { revision: ticket!.revision, criterion: ticket!.criteria[0], feature: 'disposable proof', entryPoint: 'proof.txt', method: 'fixture read-back', outcome: 'passed', details: 'Synthetic author report: verified, not independent host proof.', recipe: 'verify.ts (host executes independently)' });
};
send({ type: 'ready', protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1024 * 1024, maxReassembledFrameBytes: 64 * 1024 * 1024 });
for await (const line of createInterface({ input: process.stdin })) {
  const frame = decoder.decode(Buffer.from(line)); if (!frame) continue;
  const respond = (data: Record<string, unknown> = {}) => send({ type: 'response', id: frame.id, success: true, data });
  if (frame.type === 'negotiate_protocol') respond({ protocolVersion: 2 });
  else if (frame.type === 'get_state') respond({ sessionId: session.id, sessionFile, isSettled: settled, hasPendingAsyncWork: false, model: { provider: session.model.split('/')[0], id: session.model.split('/').slice(1).join('/') }, thinkingLevel: thinking, autoCompactionEnabled: compaction });
  else if (frame.type === 'get_session_stats') respond({ tokens: { total: config.tokens ?? (reviewer ? 7 : 11 * session.turns) } });
  else if (frame.type === 'set_auto_compaction') { compaction = frame.enabled === true; respond(); }
  else if (frame.type === 'get_available_thinking_levels') respond({ levels: ['off', 'medium', 'high'] });
  else if (frame.type === 'set_thinking_level') { thinking = String(frame.level); respond(); }
  else if (['set_host_tools', 'set_auto_retry', 'set_cache_warming', 'abort'].includes(frame.type)) respond();
  else if (frame.type === 'prompt') {
    prompt = String(frame.message); settled = false; respond();
    await log({ event: 'prompt', message: prompt });
    if (reviewer) {
      if (config.holdReview) continue;
      try { reviewNumber = Number(await readFile(`${configPath}.reviews`, 'utf8')); } catch { reviewNumber = 0; }
      reviewNumber++; await writeFile(`${configPath}.reviews`, String(reviewNumber));
      host('diff', 'candidate_diff', {});
    }
  } else if (frame.type === 'goal') { respond(); if (frame.op === 'create' || frame.op === 'resume') await finishAuthor(); }
  else if (frame.type === 'host_tool_result') {
    if (frame.isError === true) { await log({ event: 'host-rejected', id: frame.id }); settled = true; send({ type: 'session_settled' }); continue; }
    if (frame.id === 'evidence') host('result', 'backlog_result', { revision: ticket!.revision, status: 'complete', files: config.scenario === 'noop' ? [] : ['proof.txt'], evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Synthetic author wrote/read proof.txt: verified.' })) });
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
