import { expect, test } from 'bun:test';
import type { TranscriptEntry } from '../server/contracts';
import { diffRows, toolPresentation } from './transcript-presentation';

function entry(fields: Partial<TranscriptEntry>): TranscriptEntry {
  return { id: 'tool-1', kind: 'tool', text: '', toolName: 'functions.read', ...fields };
}

test('text result envelopes omit metadata while preserving separate text blocks', () => {
  const result = toolPresentation(entry({ output: JSON.stringify({
    content: [{ type: 'text', text: 'first line' }, { type: 'text', text: 'second [redacted]' }],
    details: { exitCode: 0, duration: 120 },
  }) }));
  expect(result).toEqual({ target: '', content: 'first line\nsecond [redacted]', format: 'text', source: 'output' });
});

test('recorded details diff takes precedence over output prose, top-level diff, and proposed input', () => {
  const recorded = '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new';
  const result = toolPresentation(entry({ toolName: 'functions.edit', input: JSON.stringify({ patch: 'proposed input' }),
    output: JSON.stringify({ content: [{ type: 'text', text: 'Updated file' }], diff: 'less specific', details: { diff: recorded } }) }));
  expect(result.content).toBe(recorded);
  expect(result.format).toBe('diff');
  expect(result.source).toBe('output');
});

test('top-level and nested text-envelope diffs are recorded output, not reconstructed changes', () => {
  const recorded = '@@ -1 +1 @@\n-a\n+b';
  for (const output of [{ diff: recorded }, { content: [{ type: 'text', text: JSON.stringify({ details: { diff: recorded } }) }] }]) {
    expect(toolPresentation(entry({ output: JSON.stringify(output) }))).toMatchObject({ content: recorded, format: 'diff', source: 'output' });
  }
});

test('write previews label recorded input without inventing an executed diff', () => {
  expect(toolPresentation(entry({ toolName: 'functions.write',
    input: JSON.stringify({ path: 'src/file.ts', content: 'new contents\n' }),
    output: JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }) })))
    .toEqual({ target: 'src/file.ts', content: 'new contents\n', format: 'text', source: 'input' });
});

test('edit and apply_patch instructions remain raw arguments, never the default source preview', () => {
  for (const toolName of ['functions.edit', 'functions.apply_patch']) {
    const patch = '[src/file.ts#ABCD]\nPUT 116.=116:\n+proposed';
    const result = toolPresentation(entry({ toolName, input: JSON.stringify({ patch }),
      output: JSON.stringify({ content: [{ type: 'text', text: '[src/file.ts#DCBA]\n116:unchanged' }] }) }));
    expect(result).toEqual({ target: 'src/file.ts', content: '[src/file.ts#DCBA]\n116:unchanged', format: 'text', source: 'output' });
    expect(result.content).not.toContain('PUT');
  }
});

test('free-form hashline edits list all file headers without line hashes', () => {
  const patch = '*** Begin Patch\n[src/one.ts#A123]\nPUT 1.=1:\n+one\n[src/two.ts#B456]\nPUT 2.=2:\n+two\n*** End Patch';
  const result = toolPresentation(entry({ toolName: 'functions.edit', input: patch }));
  expect(result.target).toBe('src/one.ts, src/two.ts');
  expect(result.content).toBe('');
  expect(result.source).toBe('none');
});

test('parallel calls expose readable command and path targets with a bounded label', () => {
  const result = toolPresentation(entry({ toolName: 'multi_tool_use.parallel', input: JSON.stringify({ tool_uses: [
    { recipient_name: 'functions.read', parameters: { path: 'src/one.ts' } },
    { recipient_name: 'functions.bash', parameters: { command: 'git status --short' } },
  ] }) }));
  expect(result.target).toBe('src/one.ts, git status --short');
  const long = toolPresentation(entry({ input: JSON.stringify({ path: 'x'.repeat(500) }) }));
  expect(long.target.length).toBe(240);
  expect(long.target.endsWith('…')).toBe(true);
});

test('incomplete JSON remains readable plain output including redaction and truncation notice', () => {
  const output = '{"content":[{"type":"text","text":"[redacted]\n[Truncated: transcript display limit reached.]';
  expect(toolPresentation(entry({ output }))).toMatchObject({ content: output, format: 'text', source: 'output' });
});

test('plain output and structured text remove ANSI colors, cursor commands, OSC links and control bytes', () => {
  const output = '\u001b[31merror\u001b[0m\u001b[2K\n\u001b]8;;https://example.com\u0007label\u001b]8;;\u001b\\\u0000\tend';
  for (const recorded of [output, JSON.stringify({ content: [{ type: 'text', text: output }] })]) {
    expect(toolPresentation(entry({ output: recorded })).content).toBe('error\nlabel\tend');
  }
});

test('arrays, unknown wrappers, numeric text and stderr remain readable', () => {
  expect(toolPresentation(entry({ output: JSON.stringify(['one', { custom: { text: 'two' } }, { stdout: '123', stderr: 'problem' }]) })).content)
    .toBe(`one\n${JSON.stringify({ custom: { text: 'two' } }, null, 2)}\n123\nproblem`);
});

test('metadata-only and empty text envelopes have a raw fallback, absent output has no source', () => {
  for (const output of [JSON.stringify({ content: [{ type: 'text', text: '' }] }), JSON.stringify({ unfamiliar: true, status: 200 })]) {
    expect(toolPresentation(entry({ output })).content).toBe(JSON.stringify(JSON.parse(output), null, 2));
  }
  expect(toolPresentation(entry({}))).toEqual({ target: '', content: '', format: 'text', source: 'none' });
});

test('preferred diff preserves truncation notices and image placeholders stay inert text', () => {
  const result = toolPresentation(entry({ output: JSON.stringify({ details: { diff: '-old\n+new' }, note: '[Truncated: structured detail limit reached.]' }) }));
  expect(result.content).toBe('-old\n+new\n[Truncated: structured detail limit reached.]');
  expect(toolPresentation(entry({ output: JSON.stringify({ content: [{ type: 'image', text: '[Image bytes omitted]', url: 'https://example.com/image.png' }] }) })).content)
    .toBe('[Image bytes omitted]');
});

test('read text containing application JSON retains nested scalar fields without envelope noise', () => {
  const data = { amountCases: [{ value: '1,234.00', count: 3, unchanged: true }], other: 42 };
  const nested = JSON.stringify(data);
  const output = JSON.stringify({ content: [{ type: 'text', text: nested }], details: { displayContent: { text: nested } } });
  expect(toolPresentation(entry({ output })).content).toBe(JSON.stringify(data, null, 2));
});

test('eval url/text JSON keeps URL and escaped newlines while pretty-printing its structure', () => {
  const data = { url: 'https://example.com/expenses', text: 'Expenses\nTotal expenses\n[redacted]' };
  const expected = JSON.stringify(data, null, 2);
  for (const output of [JSON.stringify(data), JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(data) }] })]) {
    expect(toolPresentation(entry({ output })).content).toBe(expected);
  }
});

test('truncated outer read envelope recovers complete text tokens with honest partial notice', () => {
  const data = { amountCases: [{ value: '1,234.00', count: 2, unchanged: false }] };
  const payload = JSON.stringify(data, null, 2);
  const output = `{"content":[{"type":"text","text":${JSON.stringify(payload)}}],"details":{"displayContent":\n[Truncated: transcript display limit reached.]`;
  const result = toolPresentation(entry({ output }));
  expect(result.content).toBe(`${payload}\n[Partial preview: recovered complete text blocks from truncated recorded output.]\n[Truncated: transcript display limit reached.]`);
  expect(result.source).toBe('output');
  expect(result.format).toBe('text');
});

test('truncated string tokens are never repaired or decoded as complete text', () => {
  const output = '{"content":[{"type":"text","text":"not complete\\\\n[redacted]';
  expect(toolPresentation(entry({ output })).content).toBe(output);
});

test('duplicate tool content and text fields are shown once, without repeated displayContent', () => {
  const output = JSON.stringify({ text: 'same text', content: [{ type: 'text', text: 'same text' }], details: { displayContent: { text: 'same text' } } });
  expect(toolPresentation(entry({ output })).content).toBe('same text');
});

test('failed file tools show the error rather than prioritizing proposed content', () => {
  const result = toolPresentation(entry({ toolName: 'edit', state: 'error',
    input: JSON.stringify({ patch: '+proposed code' }),
    output: JSON.stringify({ content: [{ type: 'text', text: 'Edit rejected: stale file hash.' }] }) }));
  expect(result.content).toBe('Edit rejected: stale file hash.');
  expect(result.source).toBe('output');
});

test('independently retained diff takes precedence over old recorded diff and proposed arguments', () => {
  const retained = ' 115|const field = {\n-116|  type: "text",\n+116|  type: "number",\n 117|};';
  const result = toolPresentation(entry({ toolName: 'functions.edit', diff: retained,
    input: '[src/main.js#ABCD]\nPUT 116.=116:\n+  type: "number",',
    output: JSON.stringify({ content: [{ type: 'text', text: 'File snapshot\n'.repeat(1200) }], details: { diff: '-old\n+other' } }) }));
  expect(result).toMatchObject({ content: retained, format: 'diff', source: 'output' });
  expect(diffRows(result.content)[1]).toEqual({ text: '  type: "text",', kind: 'remove', lineNumber: 116, sign: '-' });
});

test('truncated outer envelopes recover only complete recorded diff JSON string tokens', () => {
  const recorded = '-116|  old();\n+116|  updated();';
  const notice = '[Truncated: transcript display limit reached.]';
  const output = `{"content":[{"type":"text","text":"Updated"}],"details":{"diff":${JSON.stringify(recorded)},"other":\n${notice}`;
  expect(toolPresentation(entry({ output }))).toMatchObject({ content: `${recorded}\n${notice}`, format: 'diff', source: 'output' });
  const incomplete = '{"details":{"diff":"-116|old\\n+116|unfinished';
  expect(toolPresentation(entry({ output: incomplete }))).toMatchObject({ content: incomplete, format: 'text', source: 'output' });
});

test('per-file recorded diffs remain output and empty retained fields fall back to old records', () => {
  const recorded = '-42|old\n+42|new';
  const output = JSON.stringify({ details: { perFileResults: [{ path: 'src/one.ts', diff: recorded }] } });
  expect(toolPresentation(entry({ diff: '  ', output }))).toMatchObject({ content: recorded, format: 'diff', source: 'output' });
});

test('OMP marker-first rows preserve source numbers, shared replacement positions and code indentation', () => {
  expect(diffRows(' 115|const field = {\n-116|  type: "text",\n+116|  type: "number",\n 117|};')).toEqual([
    { text: 'const field = {', kind: 'context', lineNumber: 115, sign: ' ' },
    { text: '  type: "text",', kind: 'remove', lineNumber: 116, sign: '-' },
    { text: '  type: "number",', kind: 'add', lineNumber: 116, sign: '+' },
    { text: '};', kind: 'context', lineNumber: 117, sign: ' ' },
  ]);
  expect(diffRows('+  42|\t  indented();')).toEqual([
    { text: '\t  indented();', kind: 'add', lineNumber: 42, sign: '+' },
  ]);
});

test('unified rows track old removals and new additions/context across inserts, deletes and multiple hunks', () => {
  expect(diffRows('--- a/file.ts\n+++ b/file.ts\n@@ -115,3 +115,4 @@\n start\n+  inserted\n-old\n+  replacement\n end\n@@ -200,3 +201,2 @@\n-deleted\n kept\n ')).toEqual([
    { text: '--- a/file.ts', kind: 'meta', sign: '' },
    { text: '+++ b/file.ts', kind: 'meta', sign: '' },
    { text: '@@ -115,3 +115,4 @@', kind: 'meta', sign: '' },
    { text: 'start', kind: 'context', lineNumber: 115, sign: ' ' },
    { text: '  inserted', kind: 'add', lineNumber: 116, sign: '+' },
    { text: 'old', kind: 'remove', lineNumber: 116, sign: '-' },
    { text: '  replacement', kind: 'add', lineNumber: 117, sign: '+' },
    { text: 'end', kind: 'context', lineNumber: 118, sign: ' ' },
    { text: '@@ -200,3 +201,2 @@', kind: 'meta', sign: '' },
    { text: 'deleted', kind: 'remove', lineNumber: 200, sign: '-' },
    { text: 'kept', kind: 'context', lineNumber: 201, sign: ' ' },
    { text: '', kind: 'context', lineNumber: 202, sign: ' ' },
  ]);
});

test('diff rows preserve meta notices, no-newline markers, zero-length hunks and hunkless changes without invented numbers', () => {
  expect(diffRows('diff --git a/file.ts b/file.ts\n@@ -0,0 +1 @@\n+new\n\\ No newline at end of file\n[Truncated: display limit reached.]\n')).toEqual([
    { text: 'diff --git a/file.ts b/file.ts', kind: 'meta', sign: '' },
    { text: '@@ -0,0 +1 @@', kind: 'meta', sign: '' },
    { text: 'new', kind: 'add', lineNumber: 1, sign: '+' },
    { text: '\\ No newline at end of file', kind: 'meta', sign: '' },
    { text: '[Truncated: display limit reached.]', kind: 'meta', sign: '' },
    { text: '', kind: 'meta', sign: '' },
  ]);
  expect(diffRows('-old\n+new\n same')).toEqual([
    { text: 'old', kind: 'remove', sign: '-' },
    { text: 'new', kind: 'add', sign: '+' },
    { text: 'same', kind: 'context', sign: ' ' },
  ]);
});

test('truncated outer envelopes can recover a diff nested in a complete text token', () => {
  const recorded = '-116|before\n+116|after';
  const token = JSON.stringify(JSON.stringify({ details: { diff: recorded } }));
  const output = `{"content":[{"type":"text","text":${token}}],"details":`;
  expect(toolPresentation(entry({ output }))).toMatchObject({ content: recorded, format: 'diff', source: 'output' });
});

test('a complete independently retained diff is not marked truncated just because the raw result was truncated', () => {
  const retained = '-116|  type: "text",\n+116|  type: "number",';
  const result = toolPresentation(entry({ diff: retained, output: '[Truncated: transcript display limit reached.]' }));
  expect(result.content).toBe(retained);
  expect(result.format).toBe('diff');
});
