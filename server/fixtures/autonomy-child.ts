// Deterministic protocol peer. Never represents a real OMP/provider or semantic reviewer.
import { appendFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { FrameDecoder, type Frame } from '../rpc';
import type { Ticket } from '../contracts';
const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1]!;
const configPath = argument('--fixture-config');
const config = JSON.parse(await readFile(configPath, 'utf8')) as { scenario?: string; tokens?: number; repairTokens?: number; holdAuthor?: boolean; holdReview?: boolean; authorBarrier?: boolean; recoveryBarrier?: boolean };
if (args.includes('--version')) { console.log(config.scenario === 'unsupported-major' ? 'omp/19.0.0' : 'omp/18.18.1'); process.exit(0); }
const reviewer = args.includes('--no-tools');
const standard = !reviewer && argument('--append-system-prompt').includes('Engineering mode: standard.');
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
let reviewerTools: { name: string }[] = [];
const host = (id: string, toolName: string, value: unknown) => send({ type: 'host_tool_call', id, toolName, arguments: value });
let authorReleased = false;
let recoveryReleased = false;
const engineering = config.scenario?.startsWith('engineering-') === true;
const hostFailure = config.scenario?.startsWith('engineering-host-') === true;
const finishAuthor = async () => {
  if (config.authorBarrier && session.turns === 0 && !authorReleased) {
    send({ type: 'extension_ui_request', id: 'author-barrier', method: 'input', title: 'Release disposable author' });
    return;
  }
  if (config.recoveryBarrier && session.turns > 0 && !recoveryReleased) {
    await log({ event: 'recovery-barrier', turn: session.turns + 1 });
    send({ type: 'extension_ui_request', id: 'recovery-barrier', method: 'input', title: 'Release disposable repair' });
    return;
  }
  session.turns++; await writeFile(sessionFile, JSON.stringify(session));
  if (config.scenario === 'author-bypass') {
    host('bypass-done', 'backlog_result', { revision: ticket!.revision, status: 'done', files: ['proof.txt'], evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Author claims Done; skip host verification.' })) });
    return;
  }
  if (config.holdAuthor) { await writeFile(join(process.cwd(), 'proof.txt'), 'partial'); return; }
  const broken = engineering && (session.turns === 1 || config.scenario === 'engineering-repeated' || config.scenario === 'engineering-cosmetic');
  if (config.scenario !== 'noop') {
    const proof = broken ? config.scenario === 'engineering-cosmetic' && session.turns > 1 ? 'broken \n' : 'broken\n' : 'verified\n';
    await writeFile(join(process.cwd(), 'proof.txt'), proof);
    if (config.scenario?.startsWith('engineering-artifact-') && session.turns === 1) await unlink(join(process.cwd(), 'proof.txt'));
    await log({ event: 'proof-written', turn: session.turns, proof });
  }
  if (engineering && !hostFailure && session.turns === 1) {
    const denial = config.scenario?.endsWith('credentials') ? { prerequisite: 'Registry credentials are unavailable', unblock: 'Owner must provide registry credentials' }
      : config.scenario?.endsWith('installation') ? { prerequisite: 'Required dependency is not installed', unblock: 'Install the missing dependency' }
      : config.scenario?.endsWith('requirements') ? { prerequisite: 'Product requirements are ambiguous', unblock: 'Owner must decide expected product behavior' }
      : config.scenario?.endsWith('unsafe') ? { prerequisite: 'Destructive Git reset is required', unblock: 'Owner must authorize destructive Git operations' }
      : { prerequisite: 'proof.txt implementation fails the original host assertion', unblock: 'Correct proof.txt and repeat the original recipe' };
    await log({ event: 'blocked-report', turn: session.turns });
    const report: Record<string, unknown> = { revision: ticket!.revision, status: 'blocked', files: session.authorFiles, evidence: [], ...denial, attempted: 'Wrote proof.txt, then read it back: broken. The expected verified value was not implemented.', verification: 'verify.ts: AssertionError: proof.txt expected verified but received broken', recoverableCause: 'engineering_failure', failureCategory: 'engineering_failure', ...(config.scenario === 'engineering-spoofed' ? { permission: 'Owner must grant package installation permission' } : {}) };
    if (config.scenario?.startsWith('engineering-artifact-')) report.verification = "Error: ENOENT: no such file or directory, open 'proof.txt'";
    if (config.scenario === 'engineering-no-work') delete report.attempted;
    if (config.scenario === 'engineering-no-verification') delete report.verification;
    host('result', 'backlog_result', report);
    if (config.scenario === 'engineering-duplicate') host('duplicate-result', 'backlog_result', report);
    return;
  }
  if (config.scenario === 'engineering-chain' && session.turns === 2) {
    host('result', 'backlog_result', { revision: ticket!.revision, status: 'blocked', files: session.authorFiles, evidence: ticket!.criteria.map(criterion => ({ criterion, evidence: 'Implementation repaired; original verification remains incomplete.' })), prerequisite: 'Original verification is unfinished', unblock: 'Finish the original checks', recoverableCause: 'incomplete_verification' });
    return;
  }
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
  else if (frame.type === 'get_state') respond({ sessionId: session.id, sessionFile, isSettled: settled, hasPendingAsyncWork: false, dumpTools: reviewer ? config.scenario === 'reviewer-startup-tools' ? [{ name: 'bash' }] : reviewerTools : config.scenario === 'disabled-plugin' ? [] : [{ name: 'task' }], goal: reviewer && config.scenario === 'reviewer-startup-goal' ? { enabled: true } : null, model: { provider: session.model.split('/')[0], id: session.model.split('/').slice(1).join('/') }, thinkingLevel: thinking, autoCompactionEnabled: compaction });
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
  else if (frame.type === 'get_session_stats') {
    if (config.scenario?.endsWith('stop-accounting')) {
      const latest = await readFile(`${configPath}.usage`, 'utf8').catch(() => '');
      if (latest) {
        await log({ event: 'usage', tokens: Number(latest), turn: session.turns });
        respond({ tokens: { total: Number(latest) } });
        continue;
      }
    }
    const tokens = config.tokens ?? (reviewer ? 7 : session.turns > 1 && config.repairTokens !== undefined ? config.repairTokens : 11 * session.turns);
    await log({ event: 'usage', tokens, turn: session.turns });
    respond({ tokens: { total: tokens } });
  }
  else if (frame.type === 'set_auto_compaction') { compaction = frame.enabled === true; respond(); }
  else if (frame.type === 'get_available_thinking_levels') respond({ levels: ['off', 'medium', 'high'] });
  else if (frame.type === 'set_thinking_level') { thinking = String(frame.level); respond(); }
  else if (frame.type === 'set_host_tools') {
    if (!reviewer && !standard && !engineeringDiscovered) throw new Error('Pstack author tool registration must follow engineering preflight');
    const names = Array.isArray(frame.tools) ? frame.tools.map(tool => tool.name) : [];
    if (reviewer && JSON.stringify(names) !== JSON.stringify(['candidate_diff', 'candidate_source', 'backlog_review'])) throw new Error('Restricted reviewer received non-review capabilities');
    if (reviewer) reviewerTools = config.scenario === 'reviewer-missing-tools' ? [] : [...names.map(name => ({ name })), ...(config.scenario === 'reviewer-extra-tools' ? [{ name: 'bash' }] : [])];
    authorToolsRegistered = !reviewer;
    respond();
  }
  else if (['set_auto_retry', 'set_cache_warming', 'abort'].includes(frame.type)) respond();
  else if (frame.type === 'prompt') {
    prompt = String(frame.message); settled = false;
    const routed = prompt.startsWith('/skill:poteto-mode\n');
    if (reviewer && routed) throw new Error('Restricted reviewer must never initialize the engineering router');
    if (!reviewer && (!authorToolsRegistered || routed !== (!standard && !args.includes('--resume')))) throw new Error('Author prompt violated selected engineering mode');
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
  else if (frame.type === 'extension_ui_response' && frame.id === 'author-barrier') {
    authorReleased = true;
    await finishAuthor();
  }
  else if (frame.type === 'extension_ui_response' && frame.id === 'recovery-barrier') {
    recoveryReleased = true;
    await finishAuthor();
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
    else if (frame.id === 'result') { if (config.scenario === 'blocked' || config.scenario === 'recovery' && session.turns === 1 || engineering && !hostFailure && session.turns === 1 || config.scenario === 'engineering-chain' && session.turns === 2) continue; settled = true; send({ type: 'session_settled' }); }
    else if (frame.id === 'diff') host('source', 'candidate_source', { path: 'proof.txt' });
    else if (frame.id === 'source') {
      const revision = /revision ([a-f0-9]+)\./.exec(prompt)![1];
      const tree = /Candidate tree: ([a-f0-9]+)/.exec(prompt)![1];
      const criteria = JSON.parse(/Criteria: (\[[^\n]+\])/.exec(prompt)![1]) as string[];
      const changes = config.scenario === 'always-findings' || config.scenario === 'engineering-host-review-bound' || config.scenario === 'findings' && reviewNumber === 1;
      const verdict = config.scenario === 'inconclusive' ? 'inconclusive' : changes ? 'changes_required' : 'pass';
      host('review', 'backlog_review', { revision, sessionId: session.id, candidateTree: config.scenario === 'wrong-tree' ? '0'.repeat(40) : tree, verdict, findings: changes ? ['Improve proof implementation and repeat the original checks.'] : verdict === 'inconclusive' ? ['Product intent needs owner clarification.'] : [], criteria: criteria.map(criterion => ({ criterion, evidence: 'Independently read immutable proof.txt candidate blob and actual host command result (synthetic reviewer).' })) });
    } else if (frame.id === 'review') { settled = true; send({ type: 'session_settled' }); }
  } else throw new Error(`Unsupported autonomous fixture command ${frame.type}`);
}
decoder.end();
await log({ event: 'exit' });
