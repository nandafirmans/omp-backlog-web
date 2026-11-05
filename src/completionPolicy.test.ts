import { expect, test } from 'bun:test';
import type { CompletionPolicy } from '../server/contracts';
import { commissionedRecipe, completionDraft } from './completionPolicy.ts';

const policy: Extract<CompletionPolicy, { mode: 'autonomous' }> = {
  mode: 'autonomous', revision: 'policy-r1', updated: 1, recipeHash: 'commissioned-bytes',
  verification: { argv: ['bun', 'run', 'verify', '--name', 'two words'], files: ['package.json', 'scripts/verify.ts'], timeoutSeconds: 300 },
  reviewerModel: 'provider/reviewer', maxCorrections: 2, maxRecoveries: 1,
};

test('missing completion authority defaults to human without discovering or inventing a recipe', () => {
  const draft = completionDraft();
  expect(draft.mode).toBe('human');
  expect(draft.argv).toBe('');
  expect(draft.files).toBe('');
  expect(draft.reviewerModel).toBe('');
  expect(() => commissionedRecipe({ ...draft, mode: 'autonomous' })).toThrow('JSON array');
});

test('commissioned argv stays an exact argument array and listed files round-trip', () => {
  expect(commissionedRecipe(completionDraft(policy))).toEqual(policy.verification);
  expect(commissionedRecipe({ ...completionDraft(policy), argv: '["tool", "", "two words", "literal;argument"]' }).argv).toEqual(['tool', '', 'two words', 'literal;argument']);
});

test('rejects shell strings, malformed argv and bounded control-character arguments', () => {
  for (const argv of ['bun run verify', '"bun run verify"', '[]', '["", "verify"]', '["bun", 1]', '["bun", "a\\nb"]', JSON.stringify(['bun', 'x'.repeat(4097)]), JSON.stringify(Array(65).fill('arg'))]) {
    expect(() => commissionedRecipe({ ...completionDraft(policy), argv })).toThrow();
  }
});

test('recipe commissioning requires unique safe relative file paths', () => {
  for (const files of ['', '/etc/passwd', '../recipe', 'a/../recipe', './recipe', 'a//recipe', 'a\\recipe', 'recipe\nrecipe', 'a\tfile', 'x'.repeat(1025), Array.from({ length: 33 }, (_, i) => `file-${i}`).join('\n')]) {
    expect(() => commissionedRecipe({ ...completionDraft(policy), files })).toThrow();
  }
});

test('timeouts, explicit reviewer IDs and correction/recovery limits respect API bounds', () => {
  for (const timeoutSeconds of [null, 0, 1801, 1.5]) expect(() => commissionedRecipe({ ...completionDraft(policy), timeoutSeconds })).toThrow();
  for (const maxCorrections of [null, -1, 3, 0.5]) expect(() => commissionedRecipe({ ...completionDraft(policy), maxCorrections })).toThrow();
  for (const maxRecoveries of [null, -1, 2, 0.5]) expect(() => commissionedRecipe({ ...completionDraft(policy), maxRecoveries })).toThrow();
  for (const reviewerModel of ['reviewer-without-provider', '/model', 'provider/', 'provider/model\n', 'provider/\u0085model', 'x'.repeat(513)]) expect(() => commissionedRecipe({ ...completionDraft(policy), reviewerModel })).toThrow();
  expect(commissionedRecipe({ ...completionDraft(policy), maxCorrections: 0, maxRecoveries: 0, timeoutSeconds: 1800 }).timeoutSeconds).toBe(1800);
});

test('blank reviewer selection inherits the attempt model without requiring an explicit alternative', () => {
  for (const reviewerModel of ['', '   ']) expect(commissionedRecipe({ ...completionDraft(policy), reviewerModel })).toEqual(policy.verification);
});
