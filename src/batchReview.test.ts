import { describe, expect, test } from 'bun:test';
import type { TaskProposal } from '../server/agent-workspace-contracts';
import { dependencyIssues, moveProposal } from './batchReview';

const task = (key: string, dependsOn: string[] = []): TaskProposal => ({ key, title: key, description: '', acceptanceCriteria: [], verification: [], dependsOn, sourceReferences: [] });

describe('task review', () => {
  test('reports missing, self and cyclic dependencies', () => {
    expect(dependencyIssues([task('a', ['missing'])])).toContain('a depends on missing or unselected task missing.');
    expect(dependencyIssues([task('a', ['a'])])).toContain('a cannot depend on itself.');
    expect(dependencyIssues([task('a', ['b']), task('b', ['a'])])).toContain('Dependencies contain a cycle.');
    expect(dependencyIssues([task('a'), task('b', ['a'])])).toEqual([]);
    expect(dependencyIssues([task('a', ['T001'])])).toEqual([]);
    expect(dependencyIssues([task('a', ['T01'])])).toContain('a depends on missing or unselected task T01.');
  });
  test('moves tasks without mutating the draft', () => {
    const draft = [task('a'), task('b')];
    expect(moveProposal(draft, 1, -1).map(item => item.key)).toEqual(['b', 'a']);
    expect(draft.map(item => item.key)).toEqual(['a', 'b']);
    expect(moveProposal(draft, 0, -1)).toBe(draft);
  });
});
