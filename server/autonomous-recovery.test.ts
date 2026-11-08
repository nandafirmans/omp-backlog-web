import { expect, test } from 'bun:test';
import type { HostVerification, RecoveryHistory, Run } from './contracts';
import { classifyEngineeringFailure, engineeringBlockerCategory, recoveryAllowance, recoveryCategory, recoveryDiagnostic, recoveryFingerprint, repairReserve } from './recovery';

function receipt(output: string, overrides: Partial<HostVerification> = {}): HostVerification {
  return { id: 'host-receipt', source: 'host_execution', candidateTree: 'candidate', recipeHash: 'recipe', argv: ['bun', 'verify.ts'], started: 1, finished: 2, exitCode: 1, outcome: 'failed', output, ...overrides };
}

function run(): Run {
  return {
    id: 'run', repoId: 'repo', ticketId: 'T001', revision: 'revision', status: 'running', started: Date.now(), finished: null,
    pid: null, sessionId: 'author', sessionFile: '/tmp/synthetic-session', snapshot: '', transcript: '', evidence: [], blocker: null,
    changedFiles: '', dialog: null, error: null,
    configuration: { engineeringMode: 'standard', model: 'fixture/author', thinking: 'medium', tokenBudget: 10000, timeLimitMinutes: 5 },
    progress: { phase: 'Implementing', latestAction: 'Observed failure', tokenBudget: 10000, deadline: Date.now() + 300000 },
    lifecycle: {
      policy: { mode: 'autonomous', revision: 'policy', updated: 1, verification: { argv: ['bun', 'verify.ts'], files: ['verify.ts'], timeoutSeconds: 90 }, recipeHash: 'recipe', reviewerModel: 'fixture/reviewer', maxCorrections: 2, maxRecoveries: 1 },
      phase: 'implementing', baseline: { head: 'head', ref: 'refs/heads/main', tree: 'tree', indexHash: 'index', fingerprint: 'baseline', files: [], captured: 1 },
      recipeHash: 'recipe', corrections: 0, recoveries: 0, authorTokens: 1000, reviewerTokens: 500, verification: [], reviews: [],
    },
  };
}

function history(diagnosticFingerprint: string, overrides: Partial<RecoveryHistory> = {}): RecoveryHistory {
  return { id: 'repair', runId: 'run', ticketId: 'T001', revision: 'revision', engineeringMode: 'standard', source: 'author_blocked', category: 'engineering_failure', state: 'dispatched', fingerprint: 'failure-candidate', diagnosticFingerprint, diagnostic: 'AssertionError: proof.txt expected verified', allowance: 'recoveries', ordinal: 1, strategy: 'Fix original output', instructions: 'Fix only original ticket', recorded: 1, started: 2, tokensBefore: 1500, originalEvidence: [], originalVerification: [], originalBlocker: null, ...overrides };
}

test('repair classification requires a failed real command and scoped engineering diagnostic', () => {
  const output = 'src/calculate.ts(2,5): error TS2322: Type string is not assignable to number.';
  expect(classifyEngineeringFailure(receipt(output), ['src/calculate.ts'])).toBe(true);
  expect(classifyEngineeringFailure(receipt('AssertionError: proof.txt expected verified, received broken'), ['proof.txt'])).toBe(true);
  for (const bad of [
    receipt(output, { outcome: 'passed', exitCode: 0 }), receipt(output, { outcome: 'blocked' }),
    receipt(output, { exitCode: null }), receipt(output, { exitCode: Number.POSITIVE_INFINITY }), receipt(''),
    receipt('Unidentified command failure'), receipt('AssertionError: unrelated.ts expected 2, received 1'),
  ]) expect(classifyEngineeringFailure(bad, ['src/calculate.ts'])).toBe(false);
  expect(classifyEngineeringFailure(receipt(output), [])).toBe(false);
});

test('preserve diagnostics remain eligible only with scoped engineering evidence', () => {
  const diagnostic = 'AssertionError: label.ts must preserve internal whitespace';
  expect(recoveryCategory(diagnostic)).toBe('unknown');
  expect(classifyEngineeringFailure(receipt(diagnostic), ['label.ts'])).toBe(true);
  expect(engineeringBlockerCategory({
    prerequisite: diagnostic, unblock: 'Correct label.ts to preserve internal whitespace',
    attempted: 'Ran bun verify.ts', verification: diagnostic, suggestedPrompt: '',
  }, ['label.ts'])).toBe('unknown');
  expect(recoveryCategory('Expected parseRow to preserve quoted content')).toBe('unknown');
  expect(classifyEngineeringFailure(receipt('Expected parseRow to preserve quoted content'), ['label.ts'])).toBe(false);
  expect(classifyEngineeringFailure(receipt(diagnostic), ['unrelated.ts'])).toBe(false);
  expect(classifyEngineeringFailure(receipt('label.ts: Unidentified command failure'), ['label.ts'])).toBe(false);
  expect(recoveryAllowance(run(), 'recoveries', recoveryFingerprint('recipe', diagnostic))).toBeNull();
});

test('protected blockers retain precise categories and cannot authorize an assertion repair', () => {
  for (const [diagnostic, category] of [
    ['Insufficient token reserve for independent review', 'budget_exhausted'],
    ['Execution deadline exceeded', 'budget_exhausted'],
    ['Original token budget exhausted', 'budget_exhausted'],
    ['Missing API credentials', 'credentials'],
    ['Permission denied', 'permissions'],
    ['Dependency installation required', 'installation'],
    ['Network ECONNREFUSED', 'infrastructure'],
    ['Unsafe operation outside approved scope', 'unsafe_operation'],
  ] as const) {
    expect(recoveryCategory(diagnostic)).toBe(category);
    expect(classifyEngineeringFailure(receipt(`AssertionError: label.ts: ${diagnostic}`), ['label.ts'])).toBe(false);
    expect(engineeringBlockerCategory({
      prerequisite: diagnostic, unblock: 'Assistance needed', verification: 'Ran bun verify.ts', suggestedPrompt: '',
    }, ['label.ts'])).toBe(category);
  }
});

test('broken relative imports are engineering failures, not permission to install packages', () => {
  const local = "src/entry.ts(1,20): error TS2307: Cannot find module './math' or its corresponding type declarations.";
  expect(classifyEngineeringFailure(receipt(local), ['src/entry.ts'])).toBe(true);
  expect(classifyEngineeringFailure(receipt(local.replace("'./math'", "'unapproved-package'")), ['src/entry.ts'])).toBe(false);
});

test('missing authored artifacts can be restored without authorizing missing tools or external files', () => {
  expect(classifyEngineeringFailure(receipt("Error: ENOENT: no such file or directory, open 'proof.txt'"), ['proof.txt'])).toBe(true);
  expect(classifyEngineeringFailure(receipt("Error: ENOENT: no such file or directory, open '/etc/private/proof.txt'"), ['proof.txt'])).toBe(false);
  expect(classifyEngineeringFailure(receipt('Error: spawn unavailable-tool ENOENT'), ['proof.txt'])).toBe(false);
  expect(classifyEngineeringFailure(receipt("Error: ENOENT: no such file or directory, open 'node_modules/package/index.js'"), ['proof.txt'])).toBe(false);
});

test('one local artifact cannot mask a separate missing file or executable', () => {
  const local = "Error: ENOENT: no such file or directory, open 'proof.txt'";
  for (const external of [
    "Error: ENOENT: no such file or directory, open '/outside-project/config.json'",
    'Error: spawn unavailable-tool ENOENT',
  ]) {
    const diagnostic = `${local}\n${external}`;
    expect(classifyEngineeringFailure(receipt(diagnostic), ['proof.txt'])).toBe(false);
    expect(engineeringBlockerCategory({ prerequisite: 'Restore proof.txt', unblock: 'Restore the original artifact', attempted: 'Ran commissioned checks', suggestedPrompt: '', verification: diagnostic }, ['proof.txt'])).toBe('installation');
  }
  expect(classifyEngineeringFailure(receipt("Read 'proof.txt' successfully\nError: spawn unavailable-tool ENOENT"), ['proof.txt'])).toBe(false);
});

test('relative import exemptions require an in-project importer and target', () => {
  for (const specifier of ['../../../external-config', '../node_modules/package', '../.git/config', '../.omp/settings']) {
    const diagnostic = `src/entry.ts(1,20): error TS2307: Cannot find module '${specifier}' or its corresponding type declarations.`;
    expect(classifyEngineeringFailure(receipt(diagnostic), ['src/entry.ts'])).toBe(false);
    expect(engineeringBlockerCategory({ prerequisite: 'Repair source', unblock: 'Repair the original code', attempted: diagnostic, suggestedPrompt: '' }, ['src/entry.ts'])).toBe('installation');
  }
  expect(classifyEngineeringFailure(receipt("src/entry.ts error TS2307: Cannot find module './math'"), ['src/entry.ts'])).toBe(false);
  expect(classifyEngineeringFailure(receipt("src/entry.ts(1,20): error TS2307: Cannot find module '../math'"), ['src/entry.ts'])).toBe(true);
});

test('credential, installation, product and infrastructure failures cannot hide behind an assertion', () => {
  for (const diagnostic of [
    'AssertionError: proof.txt requires credentials', 'AssertionError: proof.txt permission denied',
    'AssertionError: proof.txt needs dependency installation', 'AssertionError: proof.txt product decision required',
    'AssertionError: proof.txt network ECONNREFUSED', 'AssertionError: proof.txt command not found',
  ]) expect(classifyEngineeringFailure(receipt(diagnostic), ['proof.txt'])).toBe(false);
  expect(recoveryCategory('Missing API key')).toBe('credentials');
  expect(recoveryCategory('Permission denied')).toBe('permissions');
  expect(recoveryCategory('Dependency installation required')).toBe('installation');
  expect(recoveryCategory('Product decision required')).toBe('requirements');
  expect(recoveryCategory('Network unavailable')).toBe('infrastructure');
});

test('a missing authored artifact never overrides another assistance prerequisite', () => {
  const details = { prerequisite: 'proof.txt is missing', unblock: 'Restore the original artifact', attempted: 'Read original artifact', verification: "Error: ENOENT: no such file or directory, open 'proof.txt'", suggestedPrompt: 'Do not install dependencies or expand scope.' };
  expect(engineeringBlockerCategory(details, ['proof.txt'])).toBe('unknown');
  for (const [prerequisite, category] of [
    ['Registry credentials unavailable', 'credentials'], ['Dependency installation required', 'installation'],
    ['Product decision required', 'requirements'], ['Destructive Git reset required', 'unsafe_operation'],
  ] as const) {
    expect(engineeringBlockerCategory({ ...details, prerequisite }, ['proof.txt'])).toBe(category);
    expect(engineeringBlockerCategory({ ...details, verification: `${details.verification}\n${prerequisite}` }, ['proof.txt'])).toBe(category);
  }
});

test('failure fingerprints ignore presentation noise but retain actual diagnostic and recipe identity', () => {
  const output = '\u001b[31mAssertionError: proof.txt expected 2, received 1\u001b[0m (12ms)';
  const diagnostic = recoveryDiagnostic(output);
  expect(recoveryFingerprint('recipe', output)).toBe(recoveryFingerprint('recipe', 'AssertionError: proof.txt expected 2, received 1 (99ms)'));
  expect(recoveryFingerprint('recipe', diagnostic)).not.toBe(recoveryFingerprint('recipe', diagnostic.replace('received 1', 'received 0')));
  expect(recoveryFingerprint('recipe', diagnostic)).not.toBe(recoveryFingerprint('changed-recipe', diagnostic));
  expect(recoveryFingerprint('recipe', diagnostic, 'tree-a')).not.toBe(recoveryFingerprint('recipe', diagnostic, 'tree-b'));
});

test('recovery shares original allowance and counts reviewers against admission reserve', () => {
  const candidate = run();
  expect(recoveryAllowance(candidate, 'recoveries', 'new-failure')).toBeNull();
  candidate.lifecycle!.recoveries = 1;
  expect(recoveryAllowance(candidate, 'recoveries', 'different-failure')).not.toBeNull();
  candidate.lifecycle!.recoveries = 0;
  candidate.lifecycle!.policy.maxRecoveries = 0;
  expect(recoveryAllowance(candidate, 'recoveries', 'new-failure')).not.toBeNull();
  candidate.lifecycle!.policy.maxRecoveries = 1;
  candidate.lifecycle!.authorTokens = 1000;
  candidate.lifecycle!.reviewerTokens = 3000;
  expect(recoveryAllowance(candidate, 'recoveries', 'new-failure')).not.toBeNull();
  candidate.progress!.tokenBudget = null;
  expect(recoveryAllowance(candidate, 'recoveries', 'new-failure')).toBeNull();
  candidate.progress!.deadline = Date.now() + 30000;
  expect(recoveryAllowance(candidate, 'recoveries', 'new-failure')).not.toBeNull();
  expect(recoveryAllowance({ ...candidate, lifecycle: undefined }, 'recoveries', 'new-failure')).not.toBeNull();
});

test('ineffective repair cannot obtain another allowance by changing candidate or failure source', () => {
  const candidate = run();
  candidate.lifecycle!.recoveryHistory = [history('same-diagnostic')];
  expect(recoveryAllowance(candidate, 'corrections', 'same-diagnostic')).not.toBeNull();
  candidate.lifecycle!.recoveryHistory[0]!.candidateTree = 'cosmetic-change';
  expect(recoveryAllowance(candidate, 'corrections', 'same-diagnostic')).not.toBeNull();
  expect(recoveryAllowance(candidate, 'corrections', 'different-diagnostic')).toBeNull();
  candidate.lifecycle!.corrections = 2;
  expect(recoveryAllowance(candidate, 'corrections', 'different-diagnostic')).not.toBeNull();
});

test('an active or paused repair retains final-check time and reviewer tokens', () => {
  const candidate = run();
  candidate.lifecycle!.recoveryHistory = [history('diagnostic')];
  expect(repairReserve(candidate)).toBeNull();
  candidate.progress!.deadline = Date.now() + 120000;
  expect(repairReserve(candidate)).not.toBeNull();
  candidate.lifecycle!.recoveryHistory[0]!.state = 'paused';
  expect(repairReserve(candidate)).not.toBeNull();
  candidate.progress!.deadline = Date.now() + 300000;
  candidate.lifecycle!.reviewerTokens = 6000;
  expect(repairReserve(candidate)).not.toBeNull();
  candidate.lifecycle!.recoveryHistory[0]!.state = 'recovered';
  expect(repairReserve(candidate)).toBeNull();
});
