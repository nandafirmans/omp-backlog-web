import { expect, test } from 'bun:test';
import type { TaskExtraction } from './agent-workspace-contracts';
import { EXTRACTION_LIMITS, extractionInstruction, validateTaskExtraction, type ExtractionSource } from './task-extraction';

const source: ExtractionSource = { workspaceId: 'workspace-one', planRevisionId: 'plan-one', strategy: 'auto', referenceIds: ['repo-reference'] };
function valid(count = 1): TaskExtraction {
  return { strategy: 'auto', sourceWorkspaceId: source.workspaceId, sourcePlanRevisionId: source.planRevisionId, rationale: 'One coherent change, or independent bounded slices.', proposals: Array.from({ length: count }, (_, index) => ({ key: `task-${String.fromCharCode(97 + index)}`, title: `Change ${index}`, description: 'Why: Meet the need.\nScope: The behavior.\nOut-of-scope: Unrelated work.', acceptanceCriteria: ['Observable requirement'], verification: ['Run focused checks'], dependsOn: index ? ['task-a'] : [], sourceReferences: ['repo-reference'] })), openQuestions: ['Which deployment owns the final rollout?'] };
}

test('auto supports either decomposition and single/multiple enforce their explicit cardinality', () => {
  for (const count of [1, 2, 12]) expect(validateTaskExtraction(JSON.stringify(valid(count)), source).proposals).toHaveLength(count);
  for (const [strategy, count] of [['single', 1], ['multiple', 2]] as const) {
    const payload = { ...valid(count), strategy };
    expect(validateTaskExtraction(JSON.stringify(payload), { ...source, strategy })).toEqual(payload);
  }
  expect(() => validateTaskExtraction(JSON.stringify({ ...valid(2), strategy: 'single' }), { ...source, strategy: 'single' })).toThrow('count');
  expect(() => validateTaskExtraction(JSON.stringify({ ...valid(), strategy: 'multiple' }), { ...source, strategy: 'multiple' })).toThrow('count');
  expect(() => validateTaskExtraction(JSON.stringify(valid(13)), source)).toThrow('count');
  const withoutPlan = { ...valid(), sourcePlanRevisionId: null };
  expect(validateTaskExtraction(JSON.stringify(withoutPlan), { ...source, planRevisionId: null })).toEqual(withoutPlan);
});

const invalidMutations: [string, (value: TaskExtraction) => unknown][] = [
  ['unexpected root field', value => ({ ...value, tickets: [] })],
  ['missing rationale', value => { const rest: Partial<TaskExtraction> = { ...value }; delete rest.rationale; return rest; }],
  ['wrong strategy', value => ({ ...value, strategy: 'multiple' })],
  ['wrong workspace', value => ({ ...value, sourceWorkspaceId: 'other' })],
  ['wrong plan', value => ({ ...value, sourcePlanRevisionId: null })],
  ['empty proposals', value => ({ ...value, proposals: [] })],
  ['extra proposal property', value => ({ ...value, proposals: [{ ...value.proposals[0], id: 'T001' }] })],
  ['missing proposal property', value => { const rest: Partial<TaskExtraction['proposals'][number]> = { ...value.proposals[0]! }; delete rest.verification; return { ...value, proposals: [rest] }; }],
  ['authoritative key', value => ({ ...value, proposals: [{ ...value.proposals[0], key: 'T001' }] })],
  ['uppercase temporary key', value => ({ ...value, proposals: [{ ...value.proposals[0], key: 'task-A' }] })],
  ['duplicate keys', value => ({ ...value, proposals: [value.proposals[0], value.proposals[0]] })],
  ['missing dependency', value => ({ ...value, proposals: [{ ...value.proposals[0], dependsOn: ['task-missing'] }] })],
  ['self dependency', value => ({ ...value, proposals: [{ ...value.proposals[0], dependsOn: ['task-a'] }] })],
  ['unknown source', value => ({ ...value, proposals: [{ ...value.proposals[0], sourceReferences: ['model-claimed'] }] })],
  ['empty title', value => ({ ...value, proposals: [{ ...value.proposals[0], title: ' ' }] })],
  ['long title', value => ({ ...value, proposals: [{ ...value.proposals[0], title: 'x'.repeat(201) }] })],
  ['missing scope boundaries', value => ({ ...value, proposals: [{ ...value.proposals[0], description: 'Implement it' }] })],
  ['empty scope sections', value => ({ ...value, proposals: [{ ...value.proposals[0], description: 'Why: Need.\nScope:\nOut-of-scope:' }] })],
  ['generic criterion', value => ({ ...value, proposals: [{ ...value.proposals[0], acceptanceCriteria: ['Works as expected.'] }] })],
  ['empty criteria', value => ({ ...value, proposals: [{ ...value.proposals[0], acceptanceCriteria: [] }] })],
  ['empty verification string', value => ({ ...value, proposals: [{ ...value.proposals[0], verification: [''] }] })],
  ['wrong list type', value => ({ ...value, proposals: [{ ...value.proposals[0], dependsOn: 'task-b' }] })],
  ['too many questions', value => ({ ...value, openQuestions: Array.from({ length: 25 }, (_, index) => `Question ${index}`) })],
  ['empty question', value => ({ ...value, openQuestions: [' '] })],
  ['non-string question', value => ({ ...value, openQuestions: [12] })],
  ['oversized rationale', value => ({ ...value, rationale: 'x'.repeat(EXTRACTION_LIMITS.stringBytes + 1) })],
];
for (const [label, mutate] of invalidMutations) test(`strict extraction rejects ${label}`, () => {
  expect(() => validateTaskExtraction(JSON.stringify(mutate(valid())), source)).toThrow('Previous proposal sets were retained');
});

test('strict extraction rejects malformed, truncated, fenced and oversized complete output without repair', () => {
  for (const output of ['{', JSON.stringify(valid()).slice(0, -3), `\`\`\`json\n${JSON.stringify(valid())}\n\`\`\``, '[]', 'null', 'x'.repeat(EXTRACTION_LIMITS.payloadBytes + 1)]) expect(() => validateTaskExtraction(output, source)).toThrow('Task extraction invalid');
  const cycle = valid(3); cycle.proposals[0]!.dependsOn = ['task-c'];
  expect(() => validateTaskExtraction(JSON.stringify(cycle), source)).toThrow('cycle');
});

test('extraction contract pins sources and preserves human-only authority', () => {
  const instruction = extractionInstruction(source);
  expect(instruction).toContain('strict JSON'); expect(instruction).toContain('No tools, implementation, publication');
  expect(instruction).toContain('workspace-one'); expect(instruction).toContain('plan-one'); expect(instruction).toContain('repo-reference');
  expect(instruction).toContain('Out-of-scope:'); expect(instruction).toContain('openQuestions');
});
