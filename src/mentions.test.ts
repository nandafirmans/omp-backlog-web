import { expect, test } from 'bun:test';
import { mentionAt } from './mentions';

test('mention boundaries exclude emails and ordinary slashes', () => {
  for (const text of ['person@example.com', 'https://example.com/skill:build', 'word/skill:build', 'word@src']) {
    expect(mentionAt(text, text.length)).toBeNull();
  }
  expect(mentionAt('Use /skill:bu', 13)).toEqual({ kind: 'skill', query: 'bu', from: 4, to: 13 });
  expect(mentionAt('(@src/main.ts)', 5)).toEqual({ kind: 'file', query: 'src', from: 1, to: 13 });
  expect(mentionAt('@', 1)).toEqual({ kind: 'file', query: '', from: 0, to: 1 });
});

test('quoted paths replace the prefix and complete token without eating adjacent prose', () => {
  const line = 'Read @"docs/my file.md" next';
  const token = mentionAt(line, 15);
  expect(token).toEqual({ kind: 'file', query: 'docs/my ', from: 5, to: 23 });
  expect(line.slice(0, token!.from) + '@"docs/my guide.md"' + line.slice(token!.to)).toBe('Read @"docs/my guide.md" next');
  expect(mentionAt(line, 23)).toBeNull();
  const escaped = '@"docs/a\\"b';
  expect(mentionAt(escaped, escaped.length)?.query).toBe('docs/a"b');
});

test('a mention in the middle of a word replaces its suffix exactly once', () => {
  const line = 'Use /skill:building next';
  const token = mentionAt(line, 13)!;
  expect(line.slice(0, token.from) + '/skill:build' + line.slice(token.to)).toBe('Use /skill:build next');
});

