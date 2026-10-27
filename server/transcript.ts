import type { Run, TranscriptEntry } from './contracts';
import { object } from './rpc';
import type { Frame } from './rpc';

const FIELD_LIMIT = 10_000;
const TOTAL_LIMIT = 192_000;
const ENTRY_COUNT = 256;
const TRUNCATED = '\n[Truncated: transcript display limit reached.]';
const OMITTED = '[Earlier conversation entries omitted: retention limit reached.]';
const credential = /(?:apikey|accesstoken|refreshtoken|idtoken|authtoken|authorization|password|passwd|secret|privatekey|credential|cookie|session(?:id|key|token)|token$)/i;
function bounded(text: string, limit = FIELD_LIMIT) { return text.length > limit ? text.slice(0, limit - TRUNCATED.length) + TRUNCATED : text; }

/** Also handles quoted/incomplete JSON in text results, before any display truncation. */
export function redactTranscript(text: string) {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted private key]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]*|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]*|xox[baprs]-[A-Za-z0-9-]*|(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*|Bearer\s+[^\s"'\\,;}]+)/gi, '[redacted]')
    .replace(/((?:[\w.-]*(?:api[_-]?key|token|authorization|password|passwd|secret|private[_-]?key|credential|cookie|session[_-]?(?:id|key|token))|auth|session)["'\\]*\s*[=:]\s*)(?:\\?"(?:\\.|[^"\\])*(?:"|$)|'[^']*(?:'|$)|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/data:[\w/+.-]+;base64,[A-Za-z0-9+/=\s]*/gi, '[base64 bytes omitted]')
    .replace(/((?:base64|image_data|bytes)["'\\]*\s*[=:]\s*)(?:\\?"(?:\\.|[^"\\])*(?:"|$)|'[^']*(?:'|$)|[^\s,;}]+)/gi, '$1[base64 bytes omitted]');
}

/** No raw tool objects or image/evidence bytes cross the persistence boundary. */
export function transcriptValue(value: unknown): string {
  let nodes = 0;
  function clean(current: unknown, depth: number): unknown {
    if (++nodes > 2_000 || depth > 12) return '[Truncated: structured detail limit reached.]';
    if (typeof current === 'string') {
      const trimmed = current.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { return bounded(JSON.stringify(clean(JSON.parse(trimmed), depth + 1), null, 2)); } catch { /* Plain or incomplete JSON is sanitized below. */ }
      }
      if (/^[A-Za-z0-9+/]{128,}={0,2}$/.test(trimmed)) return '[base64 bytes omitted]';
      return bounded(redactTranscript(current));
    }
    if (Array.isArray(current)) {
      const items = current.slice(0, 100).map(item => clean(item, depth + 1));
      if (current.length > 100) items.push('[Truncated: additional items omitted.]');
      return items;
    }
    if (current && typeof current === 'object') {
      const record = object(current);
      if (record.type === 'image' || record.type === 'image_url') return { type: record.type, text: '[Image bytes omitted]' };
      const result: Record<string, unknown> = {};
      const keys = Object.keys(record);
      for (const key of keys.slice(0, 100)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        const safeKey = bounded(redactTranscript(key), 200);
        result[safeKey] = credential.test(normalized) || /^(token|auth|session)$/.test(normalized) ? '[redacted]'
          : /^(base64|imagedata|bytes)$/.test(normalized) || normalized === 'data' && (typeof record.mimeType === 'string' || record.encoding === 'base64') ? '[base64 bytes omitted]'
          : clean(record[key], depth + 1);
      }
      if (keys.length > 100) result['[Truncated]'] = 'Additional fields omitted.';
      return result;
    }
    return current;
  }
  const safe = clean(value, 0);
  return bounded(typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2) ?? '');
}

function visibleText(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.flatMap(part => { const item = object(part); return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []; }).join('\n');
}

export class RunConversation {
  private readonly prefix = crypto.randomUUID();
  // Only bounded assistant-visible text is held, never thinking or whole RPC messages.
  private readonly partials = new Map<string, string>();
  constructor(private readonly run: Run) {}

  private id(kind: string, id: string) { return `${this.prefix}:${kind}:${id.slice(0, 200)}`; }
  private save(entry: TranscriptEntry) {
    const entries = this.run.conversation ??= [];
    const index = entries.findIndex(item => item.id === entry.id);
    for (const field of ['text', 'input', 'output'] as const) if (typeof entry[field] === 'string') entry[field] = bounded(entry[field]);
    if (index < 0) entries.push(entry); else entries[index] = entry;
    let size = entries.reduce((sum, item) => sum + JSON.stringify(item).length + 1, 2);
    let removed = false;
    while (entries.length > ENTRY_COUNT || size > TOTAL_LIMIT) {
      const first = entries.shift()!;
      size -= JSON.stringify(first).length + 1;
      this.partials.delete(first.id);
      removed = true;
    }
    if (removed) {
      if (entries[0]?.id !== 'retention-note') entries.unshift({ id: 'retention-note', kind: 'system', text: OMITTED, state: 'complete' });
      // Reserve room for the honest retention note, including entry metadata.
      while (entries.length > ENTRY_COUNT || entries.reduce((sum, item) => sum + JSON.stringify(item).length + 1, 2) > TOTAL_LIMIT) {
        const discarded = entries.splice(1, 1)[0];
        if (!discarded) break;
        this.partials.delete(discarded.id);
      }
    }
  }

  add(kind: 'system' | 'user', text: string, state: TranscriptEntry['state'] = 'complete') {
    this.save({ id: crypto.randomUUID(), kind, text: transcriptValue(text), state });
  }

  private tool(frame: Frame, result?: unknown, state: TranscriptEntry['state'] = 'running') {
    const callId = typeof frame.toolCallId === 'string' ? frame.toolCallId : typeof frame.id === 'string' ? frame.id : null;
    if (!callId) return false; // Never invent correlations for malformed/legacy frames.
    const id = this.id('tool', callId);
    const previous = this.run.conversation?.find(entry => entry.id === id);
    const args = object(frame.args ?? frame.arguments);
    const action = frame.intent ?? args.i ?? args.command ?? args.path ?? previous?.text ?? '';
    this.save({ ...previous, id, kind: 'tool', text: transcriptValue(action), toolName: transcriptValue(frame.toolName ?? previous?.toolName ?? 'unknown').slice(0, 200),
      ...(frame.args !== undefined || frame.arguments !== undefined ? { input: transcriptValue(frame.args ?? frame.arguments) } : {}),
      ...(result !== undefined ? { output: transcriptValue(result) } : {}), state });
    return true;
  }

  hostResult(frame: Frame, result: unknown, isError = false) { return this.tool(frame, result, isError ? 'error' : 'complete'); }
  text(kind: 'agent' | 'system', id: string) {
    return this.run.conversation?.find(entry => entry.id === this.id(kind, id))?.text;
  }

  stderr(text: string) {
    const id = this.id('system', 'stderr');
    const raw = bounded((this.partials.get(id) ?? '') + text);
    this.partials.set(id, raw);
    this.save({ id, kind: 'system', text: transcriptValue(`OMP stderr: ${raw}`), state: 'error' });
  }

  frame(frame: Frame): boolean {
    if (frame.type === 'message_update' && typeof frame.messageId === 'string') {
      const event = object(frame.assistantMessageEvent);
      if (event.type !== 'text_delta' || typeof event.delta !== 'string') return false;
      const id = this.id('agent', frame.messageId);
      const raw = bounded((this.partials.get(id) ?? '') + event.delta, FIELD_LIMIT);
      this.partials.set(id, raw);
      this.save({ id, kind: 'agent', text: transcriptValue(raw), state: 'running' });
      return true;
    }
    if (frame.type === 'message_end' && typeof frame.messageId === 'string') {
      const message = object(frame.message);
      if (message.role !== 'assistant') return false; // Host objective replaces raw user/system prompts.
      const id = this.id('agent', frame.messageId);
      const partial = this.partials.get(id);
      const final = visibleText(message.content);
      const text = final || partial || '';
      this.partials.delete(id);
      const error = message.stopReason === 'error';
      if (!text && !error) return false;
      this.save({ id, kind: 'agent', text: transcriptValue(text + (error ? `\n${String(message.errorMessage ?? 'Provider turn failed')}` : '')), state: error ? 'error' : 'complete' });
      return true;
    }
    if (frame.type === 'tool_execution_start' || frame.type === 'host_tool_call') return this.tool(frame);
    // OMP partialResult is a cumulative snapshot, not a text delta.
    if (frame.type === 'tool_execution_update') return this.tool(frame, frame.partialResult);
    if (frame.type === 'tool_stream_update') return this.tool(frame, frame.update);
    if (frame.type === 'tool_execution_end') return this.tool(frame, frame.result, frame.isError === true ? 'error' : 'complete');
    if (frame.type === 'notice' || frame.type === 'extension_error' || frame.type === 'rpc_frame_error') {
      this.add('system', String(frame.message ?? frame.error ?? frame.type), frame.level === 'error' || frame.type !== 'notice' ? 'error' : 'complete');
      return true;
    }
    return false;
  }
}

export function settleConversation(run: Run) {
  for (const entry of run.conversation ?? []) if (entry.state === 'running') {
    entry.state = 'error';
    entry.text = bounded(`${entry.text}\n[Stopped before completion; no final ${entry.kind === 'tool' ? 'tool result' : 'message'} received.]`);
  }
}
