import { expect, test } from 'bun:test';
import { cleanCommitMessage, commitMessagePrompt } from './workspace-commit';

test('commit message prompt bounds diffs and passes changes as JSON data', () => {
  const prompt = commitMessagePrompt([
    { path: 'a.ts', status: ' M', diff: 'x'.repeat(39_990) },
    { path: 'b.ts', status: '??', diff: 'y'.repeat(100) },
    { path: 'c.ts', status: '??', diff: 'z'.repeat(100) },
  ], ['feat: earlier']);
  const data = JSON.parse(prompt.slice(prompt.indexOf('{'))) as { recentSubjects: string[]; changes: { path: string; diff: string }[] };
  expect(data.recentSubjects).toEqual(['feat: earlier']);
  expect(data.changes[0].diff).toHaveLength(39_990);
  expect(data.changes[1].diff).toBe(`${'y'.repeat(10)}\n[diff truncated]`);
  expect(data.changes[2].diff).toBe('\n[diff truncated]');
});

test('cleans model output into an acceptable commit message', () => {
  expect(cleanCommitMessage('```text\nfeat: add review page\n\nWhy it helps.\n```')).toBe('feat: add review page\n\nWhy it helps.');
  expect(cleanCommitMessage('  fix: trim\u0007 bell \n')).toBe('fix: trim bell');
  expect(cleanCommitMessage('a'.repeat(2500))).toHaveLength(2000);
  expect(() => cleanCommitMessage(' \n ')).toThrow('empty commit message');
});
