import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Run, Runtime } from './contracts';
import { recipeIdentity } from './autonomy';
import { discoverExecutionModels } from './drafting';
import { recoveryFingerprint } from './recovery';
import { createRuntime } from './runtime';
import { closeStore, createStore, subscribe } from './store';
import { writeTicket } from './tickets';
import { redactTranscript } from './transcript';
import { workspaceInternals } from './workspace-commit';

const liveTest = process.env.OMP_BACKLOG_LIVE_TESTS === '1' ? test : test.skip;
const model = 'openai-codex/gpt-6.1-sol';
const budget = 500000;
const minutes = 10;

liveTest('real Standard author repairs an observed failure through host-managed recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-recovery-live-'));
  const path = join(root, 'project');
  await mkdir(path, { mode: 0o700 });
  const store = createStore(join(root, 'private'));
  const repo: Repo = { id: 'recovery-live', name: 'Disposable CSV recovery validation', path, git: true, mode: 'approved', lastStarted: 0 };
  const git = async (...args: string[]) => (await workspaceInternals.checked(repo, args)).trim();
  const settings = { ...store.settings(), executable: 'omp', engineeringMode: 'standard' as const, model, thinking: 'low', tokenBudget: budget, timeLimitMinutes: minutes, maxConcurrentTickets: 1, roots: [root], paused: false };
  store.setSettings(settings);
  const events: { time: number; runId: string; revision: string; sessionId: string | null; pid: number | null; phase?: string; deadline?: number; budget?: number | null; authorTokens?: number; reviewerTokens?: number; repairs: unknown }[] = [];
  let previous = '';
  const unsubscribe = subscribe(store, () => {
    const run = store.list('runs')[0];
    if (!run) return;
    const repairs = run.lifecycle?.recoveryHistory?.map(record => ({ id: record.id, state: record.state, started: record.started, source: record.source, ordinal: record.ordinal }));
    const key = JSON.stringify([run.id, run.sessionId, run.pid, run.lifecycle?.phase, repairs]);
    if (key === previous) return;
    previous = key;
    events.push({ time: Date.now(), runId: run.id, revision: run.revision, sessionId: run.sessionId, pid: run.pid, phase: run.lifecycle?.phase, deadline: run.progress?.deadline, budget: run.progress?.tokenBudget, authorTokens: run.lifecycle?.authorTokens, reviewerTokens: run.lifecycle?.reviewerTokens, repairs });
  });
  let runtime: Runtime | undefined;
  let result = 'INCONCLUSIVE';
  let error: string | undefined;
  let initialHead: string | undefined;
  let baselineCheck: unknown;
  let independentCheck: unknown;
  let publicationCheck: unknown;
  let source: string | undefined;
  let original: Pick<Run, 'id' | 'revision' | 'sessionId' | 'sessionFile' | 'configuration' | 'workspace' | 'progress'> | undefined;
  const started = Date.now();
  const check = async () => {
    const child = Bun.spawn([process.execPath, 'verify.ts'], { cwd: path, env: { ...process.env, BUN_BE_BUN: '1' }, stdout: 'pipe', stderr: 'pipe', timeout: 5000, killSignal: 'SIGKILL' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  };
  try {
    await writeFile(join(path, 'csv.ts'), 'export function encodeRow(fields: string[]): string { return fields.join(","); }\nexport function parseRow(row: string): string[] { return row.split(","); }\n');
    await writeFile(join(path, 'verify.ts'), `import assert from 'node:assert/strict';
import { encodeRow, parseRow } from './csv';
const cases: [string[], string][] = [
  [['Ada', '42'], 'Ada,42'],
  [['a,b', 'say "yes"', 'line\\nbreak', ''], '"a,b","say ""yes""","line\\nbreak",'],
  [['', '', ''], ',,'],
  [['"', 'x\\ry', ' tail '], '"""","x\\ry", tail '],
];
for (const [fields, row] of cases) assert.equal(encodeRow(fields), row, 'csv.ts encodeRow assertion failed');
console.log('PASS encodeRow: plain, comma, quote, LF, CR, empty and whitespace fields');
for (const [fields, row] of cases) assert.deepEqual(parseRow(row), fields, 'csv.ts parseRow assertion failed');
console.log('PASS parseRow: independently specified rows decode exactly');
`);
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Disposable Recovery Validation');
    await git('config', 'user.email', 'recovery@example.invalid');
    await git('add', 'csv.ts', 'verify.ts');
    await git('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Disposable CSV baseline');
    initialHead = await git('rev-parse', 'HEAD');
    expect(await git('status', '--porcelain')).toBe('');
    baselineCheck = await check();
    expect(baselineCheck).toMatchObject({ exitCode: 1 });
    const verification = { argv: ['/usr/bin/env', 'BUN_BE_BUN=1', process.execPath, 'verify.ts'], files: ['verify.ts'], timeoutSeconds: 30 };
    repo.completion = { mode: 'autonomous', revision: crypto.randomUUID(), updated: Date.now(), verification, recipeHash: await recipeIdentity(repo, verification), reviewerModel: model, maxCorrections: 1, maxRecoveries: 1 };
    store.save('repos', repo);
    const ticket = await writeTicket(store, repo, '---\nid: T001\ntitle: Repair CSV quoting and parsing\ndepends_on: []\n---\n\nFix csv.ts encodeRow and parseRow for one CSV record. Encode fields with comma, double quote, LF or CR using enclosing double quotes and doubled embedded quotes. Parse quoted fields, doubled quotes, embedded LF/CR and trailing empty fields; preserve whitespace. Inputs are valid records without a record-terminating newline. Edit only csv.ts. Use existing Bun; no installs, external actions, commits, docs or other file edits. Run bun verify.ts unchanged and independently inspect both behaviors. Do not intentionally leave defects, skip checks or report fabricated evidence to trigger recovery.\n\nDone when:\n- encodeRow produces exact CSV for plain, comma, double quote, LF, CR, empty and whitespace fields; verify all encodeRow cases in bun verify.ts.\n- parseRow returns exact original fields for independently specified CSV rows including escaped quotes and trailing empties; verify all parseRow cases in bun verify.ts.\n');
    store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });

    // Reject incompatible restricted startup before any paid author turn.
    const discovery = await discoverExecutionModels(settings.executable, model);
    expect(discovery.models.some(entry => `${entry.provider}/${entry.id}` === model)).toBe(true);
    expect(discovery.thinkingLevels).toContain('low');
    runtime = await createRuntime(store);
    await runtime.reconcile();
    const deadline = Date.now() + (minutes * 60 + 20) * 1000;
    let final: Run | undefined;
    while (Date.now() < deadline) {
      final = store.list('runs')[0];
      if (final?.sessionId && !original) original = structuredClone({ id: final.id, revision: final.revision, sessionId: final.sessionId, sessionFile: final.sessionFile, configuration: final.configuration, workspace: final.workspace, progress: final.progress });
      if (final && !['running', 'stopping', 'paused'].includes(final.status)) break;
      // Real provider processes and fs.watch require the platform clock.
      await Bun.sleep(100);
    }
    if (!original) throw new Error('No original author identity was observed');
    if (!final || final.status !== 'done') throw new Error(`Incomplete validation: ${final?.status ?? 'no run'}: ${final?.error ?? final?.blocker ?? 'no terminal outcome'}`);
    const life = final.lifecycle!;
    independentCheck = await check();
    expect(independentCheck).toMatchObject({ exitCode: 0, stderr: '' });
    source = await readFile(join(path, 'csv.ts'), 'utf8');
    const commit = await git('rev-parse', 'HEAD');
    // Ticket metadata is host-owned and excluded by normal workspace admission too.
    publicationCheck = { commit, parent: await git('rev-parse', 'HEAD^'), tree: await git('rev-parse', 'HEAD^{tree}'), count: await git('rev-list', '--count', `${initialHead}..HEAD`), files: await git('diff', '--name-only', initialHead!, 'HEAD'), status: await git('status', '--porcelain', '--', '.', ':(exclude).omp-backlog') };
    expect(publicationCheck).toEqual({ commit: life.publication?.commit, parent: initialHead, tree: life.candidate?.tree, count: '1', files: 'csv.ts', status: '' });
    expect(life.publication).toMatchObject({ state: 'complete', noChanges: false, parent: initialHead });
    expect(life.verification.at(-1)).toMatchObject({ source: 'host_execution', outcome: 'passed', exitCode: 0, candidateTree: life.candidate?.tree });
    expect(life.reviews.at(-1)).toMatchObject({ verdict: 'pass', candidateTree: life.candidate?.tree, findings: [] });
    expect(life.reviews.at(-1)?.sessionId).not.toBe(final.sessionId);
    expect(final.pid).toBeNull();
    expect(final.configuration).toEqual(original?.configuration);
    expect(final.configuration).toMatchObject({ engineeringMode: 'standard', model, thinking: 'low', tokenBudget: budget, timeLimitMinutes: minutes });
    expect(final.progress?.deadline).toBe(final.started + minutes * 60000);
    expect(final.progress?.deadline).toBe(original?.progress?.deadline);
    expect(final.workspace).toEqual(original?.workspace);
    expect(final.sessionId).toBe(original.sessionId);
    expect(final.sessionFile).toBe(original.sessionFile);
    expect(final.revision).toBe(ticket.revision);
    expect(final.id).toBe(original.id);
    expect(final.progress?.tokens?.total).toBe(life.authorTokens + (life.reviewerTokens ?? 0));
    expect(final.progress!.tokens!.total).toBeLessThanOrEqual(budget);
    expect(store.list('runs')).toHaveLength(1);
    expect(store.list('repos')).toHaveLength(1);
    expect(store.list('tickets')).toHaveLength(1);
    expect(store.get('tickets', `${repo.id}/${ticket.id}`)?.status).toBe('done');
    const repairs = life.recoveryHistory?.filter(record => record.category === 'engineering_failure' && record.started !== undefined) ?? [];
    if (!repairs.length) {
      result = 'PARTIAL VALIDATION';
      throw new Error('First-attempt completion only: no host-managed engineering recovery observed; do not repeat automatically');
    }
    for (const repair of repairs) {
      expect(repair).toMatchObject({ runId: final.id, revision: ticket.revision, engineeringMode: 'standard', state: 'recovered' });
      expect(['host_verification', 'author_blocked']).toContain(repair.source);
      const failure = life.verification.find(receipt => receipt.outcome === 'failed' && receipt.output.includes('csv.ts') && receipt.finished <= repair.started!);
      expect(failure).toBeDefined();
      const diagnostic = repair.source === 'author_blocked'
        ? `${JSON.stringify(failure!.argv)}:${failure!.exitCode}:${repair.diagnostic}`
        : repair.diagnostic;
      expect(repair.diagnosticFingerprint).toBe(recoveryFingerprint(life.recipeHash, diagnostic));
      expect(life.verification.at(-1)!.started).toBeGreaterThanOrEqual(repair.started!);
      expect(life.reviews.at(-1)!.recorded).toBeGreaterThanOrEqual(life.verification.at(-1)!.finished);
      expect(events.some(event => event.phase === (repair.allowance === 'corrections' ? 'correcting' : 'recovering') && event.sessionId === original?.sessionId && event.pid !== null)).toBe(true);
    }
    result = 'PASSED';
  } catch (caught) {
    error = redactTranscript(caught instanceof Error ? caught.message : String(caught));
    throw caught;
  } finally {
    await runtime?.close();
    unsubscribe();
    const run = store.list('runs')[0];
    const life = run?.lifecycle;
    const repair = life?.recoveryHistory?.find(record => record.category === 'engineering_failure' && record.started !== undefined);
    const total = life ? life.authorTokens + (life.reviewerTokens ?? 0) : 0;
    await writeFile(join(root, 'proof.json'), JSON.stringify({ tier: 'live_provider', result, error, model, engineeringMode: 'standard', thinking: 'low', budget, remaining: budget - total, elapsedMs: Date.now() - started, accounting: { initialAuthor: repair?.tokensBefore ?? life?.authorTokens ?? 0, correctionAuthor: repair ? life!.authorTokens - repair.tokensBefore : 0, reviewer: life?.reviewerTokens ?? 0, total, attempts: life ? life.corrections + life.recoveries : 0 }, dataDir: store.dataDir, initialHead, baselineCheck, independentCheck, publicationCheck, source, original, events, run }, null, 2), { mode: 0o600 });
    closeStore(store);
    console.log(`Real-provider recovery proof: ${join(root, 'proof.json')}`);
  }
}, (minutes * 60 + 60) * 1000);
