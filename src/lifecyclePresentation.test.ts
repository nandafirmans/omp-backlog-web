import { expect, test } from 'bun:test';
import type { Lifecycle } from '../server/contracts';
import { lifecycleLabels, lifecycleOwnsCompletion } from './lifecyclePresentation.ts';

const lifecycle: Lifecycle = {
  policy: { mode: 'autonomous', revision: 'policy', updated: 1, verification: { argv: ['verify'], files: ['verify'], timeoutSeconds: 300 }, recipeHash: 'recipe', reviewerModel: 'provider/reviewer', maxCorrections: 2, maxRecoveries: 1 },
  phase: 'implementing', baseline: { head: 'head', ref: 'refs/heads/main', tree: 'tree', indexHash: 'index', fingerprint: 'fingerprint', files: [], captured: 1 },
  recipeHash: 'recipe', corrections: 0, recoveries: 0, authorTokens: 0, verification: [], reviews: [],
};

test('all active autonomous phases retain completion authority instead of routine human Done', () => {
  for (const phase of ['implementing', 'verifying', 'reviewing', 'correcting', 'recovering', 'publishing'] as const) {
    expect(lifecycleOwnsCompletion({ lifecycle: { ...lifecycle, phase } })).toBe(true);
    expect(lifecycleLabels[phase].length).toBeGreaterThan(0);
  }
});

test('human defaults and settled assistance preserve existing operator controls', () => {
  expect(lifecycleOwnsCompletion()).toBe(false);
  expect(lifecycleOwnsCompletion({})).toBe(false);
  expect(lifecycleOwnsCompletion({ lifecycle: { ...lifecycle, phase: 'assistance' } })).toBe(false);
  expect(lifecycleOwnsCompletion({ lifecycle: { ...lifecycle, phase: 'complete' } })).toBe(false);
  expect(lifecycleLabels.assistance).toBe('Needs assistance');
});
