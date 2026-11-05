import { expect, test } from 'bun:test';
import type { Run } from './contracts';
import { redactTranscript, RunConversation, settleConversation, transcriptValue } from './transcript';

function run() { return { transcript: 'Old plain transcript\n', status: 'running' } as Run; }

test('large command output remains bounded work without leaking long credential fields', () => {
  const ordinary = 'x'.repeat(60000);
  expect(redactTranscript(ordinary)).toBe(ordinary);
  const field = 'project.'.repeat(8000) + 'api_token';
  expect(redactTranscript(`${field}="synthetic-value"`)).toBe(`${field}=[redacted]`);
});

test('consumer correlates tool snapshots, stream previews and final errors without appending duplicates', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const call = { toolCallId: 'call-1', toolName: 'bash', args: { command: 'printf hello', nested: { apiKey: 'nested-secret' } } };
  conversation.frame({ type: 'tool_execution_start', ...call });
  expect(value.conversation?.[0]?.state).toBe('running');
  expect(value.conversation?.[0]?.input).toContain('[redacted]');
  conversation.frame({ type: 'tool_execution_update', ...call, partialResult: { content: [{ type: 'text', text: 'hello' }] } });
  conversation.frame({ type: 'tool_execution_update', ...call, partialResult: { content: [{ type: 'text', text: 'hello world' }] } });
  expect(value.conversation?.[0]?.output?.match(/hello/g)).toHaveLength(1);
  conversation.frame({ type: 'tool_stream_update', ...call, update: { preview: 'diff preview' } });
  expect(value.conversation?.[0]?.output).toContain('diff preview');
  conversation.frame({ type: 'tool_execution_end', ...call, isError: true, result: { content: [{ type: 'text', text: 'exit 1; password="quoted secret"' }] } });
  expect(value.conversation).toHaveLength(1);
  expect(value.conversation?.[0]?.state).toBe('error');
  expect(value.conversation?.[0]?.output).toContain('exit 1');
  expect(JSON.stringify(value)).not.toContain('nested-secret');
  expect(JSON.stringify(value)).not.toContain('quoted secret');
});

test('actual edit diff survives oversized result content instead of falling back to proposed PUT instructions', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const call = { toolCallId: 'large-edit', toolName: 'edit', args: { path: 'src/main.js', patch: 'PUT 116.=116:\n+  type: "number",' } };
  const diff = ' 115|const field = {\n-116|  type: "text",\n+116|  type: "number",\n 117|};';
  conversation.frame({ type: 'tool_execution_start', ...call });
  expect(value.conversation?.[0]?.diff).toBeUndefined();
  conversation.frame({ type: 'tool_execution_end', ...call, result: {
    content: [{ type: 'text', text: 'File snapshot\n'.repeat(1_200) }],
    details: { path: 'src/main.js', diff },
  } });
  const persisted = JSON.parse(JSON.stringify(value)) as Run;
  expect(persisted.conversation?.[0]?.diff).toBe(diff);
  expect(persisted.conversation?.[0]?.output?.length).toBeLessThanOrEqual(10_000);
  expect(persisted.conversation?.[0]?.output).toContain('Truncated');
  expect(persisted.conversation?.[0]?.output).not.toContain('type: "number"');
  expect(persisted.conversation?.[0]?.state).toBe('complete');
});

test('retains filenames when combining actual per-file edit results and stream previews', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const call = { toolCallId: 'multi-edit', toolName: 'edit' };
  const files = [
    { path: 'src/first.ts', diff: '-12|const first = false;\n+12|const first = true;' },
    { path: 'src/second.ts', diff: '-42|const second = false;\n+42|const second = true;' },
  ];
  conversation.frame({ type: 'tool_stream_update', ...call, update: { files } });
  const preview = value.conversation?.[0]?.diff;
  expect(preview).toBe('--- src/first.ts\n+++ src/first.ts\n' + files[0]!.diff + '\n--- src/second.ts\n+++ src/second.ts\n' + files[1]!.diff);
  expect(value.conversation?.[0]?.state).toBe('running');
  conversation.frame({ type: 'tool_execution_end', ...call, result: { details: { perFileResults: files } } });
  expect(value.conversation?.[0]?.diff).toBe(preview);
  expect(value.conversation?.[0]?.state).toBe('complete');
  expect(value.conversation).toHaveLength(1);
});

test('cumulative diff snapshots replace previews and final results clear diffs they do not report', () => {
  for (const isError of [false, true]) {
    const value = run();
    const conversation = new RunConversation(value);
    const call = { toolCallId: 'cumulative-edit', toolName: 'edit', args: { diff: '+1|proposed only' } };
    conversation.frame({ type: 'tool_execution_start', ...call });
    expect(value.conversation?.[0]?.diff).toBeUndefined();
    conversation.frame({ type: 'tool_execution_update', ...call, partialResult: { details: { diff: '+1|first preview' } } });
    conversation.frame({ type: 'tool_execution_update', ...call, partialResult: { details: { diff: '+1|replacement preview' } } });
    expect(value.conversation?.[0]?.diff).toBe('+1|replacement preview');
    conversation.frame({ type: 'tool_execution_end', ...call, isError, result: { content: [{ type: 'text', text: isError ? 'Edit failed' : 'No changes' }] } });
    expect(value.conversation?.[0]?.diff).toBeUndefined();
    expect(value.conversation?.[0]?.state).toBe(isError ? 'error' : 'complete');
    expect(value.conversation).toHaveLength(1);
  }
});

test('final errors retain only partial diffs actually reported by the final result', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const call = { toolCallId: 'partial-edit', toolName: 'edit' };
  conversation.frame({ type: 'tool_stream_update', ...call, update: { files: [{ path: 'src/main.ts', diff: '+1|preview' }] } });
  conversation.frame({ type: 'tool_execution_end', ...call, isError: true, result: { diff: '+1|applied before failure', error: 'Second file failed' } });
  expect(value.conversation?.[0]?.diff).toBe('+1|applied before failure');
  expect(value.conversation?.[0]?.state).toBe('error');
});

test('diff extraction excludes proposed and unrelated nested metadata and clears absent final results', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const call = { toolCallId: 'unrelated-edit', toolName: 'edit', args: { diff: '+1|proposed only' } };
  conversation.frame({ type: 'tool_execution_end', ...call, result: { metadata: { diff: '+1|unrelated' }, details: { args: { diff: '+1|proposed only' } } } });
  expect(value.conversation?.[0]?.diff).toBeUndefined();
  conversation.frame({ type: 'tool_stream_update', ...call, update: { files: [{ path: 'src/main.ts', diff: '+1|preview' }] } });
  conversation.frame({ type: 'tool_execution_end', ...call });
  expect(value.conversation?.[0]?.diff).toBeUndefined();
  expect(value.conversation?.[0]?.state).toBe('complete');
});

test('independently retained diffs redact credentials and obey field and total retention limits', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const secret = ['synthetic', 'diff', 'credential'].join('-');
  const diff = `-1|const password = "${secret}";\n+1|const password = "replacement";\n${' 2|const visible = true;\n'.repeat(1_000)}`;
  for (let index = 0; index < 30; index++) {
    conversation.frame({ type: 'tool_execution_end', toolCallId: `bounded-edit-${index}`, toolName: 'edit',
      result: { content: [{ type: 'text', text: 'File snapshot\n'.repeat(1_200) }], details: { perFileResults: [{ path: `src/main.ts?token=${secret}`, diff }] } } });
  }
  const persisted = JSON.stringify(value.conversation);
  expect(persisted.includes(secret)).toBe(false);
  expect(persisted.length).toBeLessThanOrEqual(192_000);
  expect(value.conversation!.length).toBeLessThanOrEqual(256);
  expect(value.conversation?.[0]?.text).toContain('retention limit');
  const latest = value.conversation?.at(-1);
  expect(latest?.id.endsWith(':tool:bounded-edit-29')).toBe(true);
  expect(latest?.diff?.length).toBeLessThanOrEqual(10_000);
  expect(latest?.diff).toContain('[redacted]');
  expect(latest?.diff).toContain('Truncated');
});

test('assembled assistant deltas redact split credentials, replace with final text, and exclude private reasoning', () => {
  const value = run();
  const conversation = new RunConversation(value);
  const delta = (text: string) => conversation.frame({ type: 'message_update', messageId: 'a', assistantMessageEvent: { type: 'text_delta', delta: text } });
  delta('## Update\nAuthorization: Bear');
  delta('er split-secret');
  delta('\napi_key="another');
  delta('-secret"');
  expect(value.conversation?.[0]?.text).toContain('## Update');
  expect(JSON.stringify(value)).not.toContain('split-secret');
  expect(JSON.stringify(value)).not.toContain('another-secret');
  conversation.frame({ type: 'message_update', messageId: 'a', assistantMessageEvent: { type: 'thinking_delta', delta: 'PRIVATE REASONING' } });
  conversation.frame({ type: 'message_end', messageId: 'a', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'text', text: '## Final\nVisible text' }] } });
  expect(value.conversation).toHaveLength(1);
  expect(value.conversation?.[0]?.text).toBe('## Final\nVisible text');
  expect(value.conversation?.[0]?.state).toBe('complete');
  conversation.frame({ type: 'message_end', messageId: 'b', message: { role: 'assistant', content: [{ type: 'text', text: 'Final-only fallback' }] } });
  expect(value.conversation?.[1]?.text).toBe('Final-only fallback');
  expect(JSON.stringify(value)).not.toContain('PRIVATE REASONING');
  expect(conversation.frame({ type: 'message_end', messageId: 'user', message: { role: 'user', content: 'INTERNAL HOST PROMPT' } })).toBe(false);
  expect(JSON.stringify(value)).not.toContain('INTERNAL HOST PROMPT');
});

test('sanitizes serialized nested credentials, known token formats and evidence/image bytes', () => {
  const safe = transcriptValue({
    args: JSON.stringify({ request: JSON.stringify({ refresh_token: 'refresh-secret', clientSecret: 'client-secret' }), password: 'password with spaces' }),
    content: [{ type: 'text', text: 'api_key="text secret" Bearer bearer-secret ghp_synthetictoken sk-synthetic-key' }, { type: 'image', data: 'IMAGE_BYTES' }],
    artifact: { name: 'proof.png', base64: 'ARTIFACT_BYTES' },
    other: { mimeType: 'image/png', data: 'OTHER_IMAGE_BYTES' },
  });
  for (const secret of ['refresh-secret', 'client-secret', 'password with spaces', 'text secret', 'bearer-secret', 'ghp_synthetictoken', 'sk-synthetic-key', 'IMAGE_BYTES', 'ARTIFACT_BYTES', 'OTHER_IMAGE_BYTES']) expect(safe).not.toContain(secret);
  expect(safe).toContain('proof.png');
  expect(safe).toContain('omitted');
  expect(redactTranscript('failure {"password": "secret phrase", "base64": "payload"}')).not.toContain('secret phrase');
  expect(redactTranscript('failure {"password": "secret phrase", "base64": "payload"}')).not.toContain('payload');
});

test('bounded persistence includes truncation and retention notes', () => {
  const value = run();
  const conversation = new RunConversation(value);
  conversation.add('system', 'visible output\n'.repeat(5_000));
  expect(value.conversation?.[0]?.text.length).toBeLessThanOrEqual(10_000);
  expect(value.conversation?.[0]?.text).toContain('Truncated');
  for (let index = 0; index < 300; index++) conversation.add('system', `${index}: ${'visible output\n'.repeat(1_000)}`);
  expect(value.conversation!.length).toBeLessThanOrEqual(256);
  expect(JSON.stringify(value.conversation).length).toBeLessThanOrEqual(192_002);
  expect(value.conversation?.[0]?.text).toContain('retention limit');
  expect(value.conversation?.at(-1)?.text).toContain('299:');
  expect(transcriptValue({ output: ['visible'.repeat(5), ...Array.from({ length: 150 }, () => 'item')] })).toContain('Truncated');
});

test('legacy runs remain unchanged until new activity, and reload/resume preserves entries and partial work', () => {
  const value = run();
  const conversation = new RunConversation(value);
  expect(value.conversation).toBeUndefined();
  expect(value.transcript).toBe('Old plain transcript\n');
  conversation.frame({ type: 'message_update', messageId: 'reused', assistantMessageEvent: { type: 'text_delta', delta: 'Partial work' } });
  conversation.frame({ type: 'tool_execution_start', toolCallId: 'reused', toolName: 'read', args: { path: 'file.txt' } });
  settleConversation(value);
  expect(value.conversation?.every(entry => entry.state === 'error')).toBe(true);
  expect(value.conversation?.every(entry => entry.text.includes('Stopped before completion'))).toBe(true);
  const reloaded = JSON.parse(JSON.stringify(value)) as Run;
  const previous = structuredClone(reloaded.conversation);
  const resumed = new RunConversation(reloaded);
  resumed.frame({ type: 'message_update', messageId: 'reused', assistantMessageEvent: { type: 'text_delta', delta: 'Resumed work' } });
  expect(reloaded.conversation?.slice(0, 2)).toEqual(previous);
  expect(reloaded.conversation?.at(-1)?.text).toBe('Resumed work');
  expect(reloaded.transcript).toBe('Old plain transcript\n');
});

test('stderr chunks sanitize assembled content instead of persisting split secrets', () => {
  const value = run();
  const conversation = new RunConversation(value);
  conversation.stderr('password="split');
  conversation.stderr('-secret"\n');
  expect(value.conversation).toHaveLength(1);
  expect(JSON.stringify(value)).not.toContain('split-secret');
  expect(JSON.stringify(value)).not.toContain('split');
});
