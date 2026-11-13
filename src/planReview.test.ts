import { expect, test } from 'bun:test';
import type { AgentWorkspace } from '../server/agent-workspace-contracts';
import { planDiff, reviewIsCurrent } from './planReview';

const workspace: AgentWorkspace = {
  id: 'one', repoId: 'repo', title: 'Workspace', createdAt: 1, updatedAt: 2, archived: false, version: 3,
  prompt: '', ticketMarkdown: '', currentPlanRevisionId: 'revision',
  planRevisions: [{ id: 'revision', revisionHash: 'hash', markdown: 'saved', createdAt: 1 }],
  messages: [], model: null, thinking: '', proposalSets: [], researchReferences: [], extraction: null,
};
const review = { workspaceId: 'one', version: 3, revisionId: 'revision', baseline: 'local edit', candidate: 'candidate' };

test('line diff shows unchanged lines alongside removals and additions', () => {
  expect(planDiff('# Plan\nold\nkeep', '# Plan\nnew\nkeep')).toEqual([
    { kind: 'same', text: '# Plan' }, { kind: 'remove', text: 'old' },
    { kind: 'add', text: 'new' }, { kind: 'same', text: 'keep' },
  ]);
  expect(planDiff('', '# Plan\nnew')).toEqual([{ kind: 'add', text: '# Plan' }, { kind: 'add', text: 'new' }]);
  expect(planDiff('same', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  expect(planDiff('', '')).toEqual([]);
  expect(planDiff('one\n', 'one')).toEqual([{ kind: 'same', text: 'one' }, { kind: 'remove', text: '' }]);
});

test('review requires the original local baseline and fresh matching workspace version and revision', () => {
  expect(reviewIsCurrent(review, workspace, 'local edit', workspace)).toBe(true);
  expect(reviewIsCurrent(review, workspace, 'new local edit', workspace)).toBe(false);
  expect(reviewIsCurrent(review, { ...workspace, id: 'other' }, 'local edit', workspace)).toBe(false);
  expect(reviewIsCurrent(review, workspace, 'local edit', { ...workspace, version: 4 })).toBe(false);
  expect(reviewIsCurrent(review, workspace, 'local edit', { ...workspace, currentPlanRevisionId: 'other' })).toBe(false);
  expect(reviewIsCurrent(review, { ...workspace, version: 4 }, 'local edit', workspace)).toBe(false);
  expect(reviewIsCurrent(review, workspace, 'local edit', { ...workspace, archived: true })).toBe(false);
});
