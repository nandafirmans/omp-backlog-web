import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

export type Frame = Record<string, unknown> & { type: string };
const PHYSICAL_LIMIT = 1024 * 1024;
const LOGICAL_LIMIT = 64 * 1024 * 1024;

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** OMP v2 chunks are contiguous base64 segments, never inbound command chunks. */
export class FrameDecoder {
  maxFrameBytes = PHYSICAL_LIMIT;
  maxReassembledFrameBytes = LOGICAL_LIMIT;
  private chunk: { id: string; count: number; bytes: number; parts: Buffer[]; size: number } | null = null;

  decode(line: Buffer): Frame | null {
    if (line.length + 1 > this.maxFrameBytes) throw new Error('OMP physical frame limit exceeded');
    const frame = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)));
    if (typeof frame.type !== 'string') throw new Error('OMP frame has no type');
    if (frame.type !== 'rpc_chunk') {
      if (this.chunk) throw new Error('OMP chunk sequence interrupted');
      return frame as Frame;
    }
    const { chunkId, index, count, byteLength, data } = frame;
    if (typeof chunkId !== 'string' || !chunkId || !Number.isSafeInteger(index) || !Number.isSafeInteger(count)
      || !Number.isSafeInteger(byteLength) || Number(count) < 1 || Number(count) > 4096 || Number(index) < 0 || Number(index) >= Number(count)
      || Number(byteLength) < 1 || Number(byteLength) > this.maxReassembledFrameBytes || Number(count) > Number(byteLength)
      || typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      throw new Error('Invalid OMP chunk metadata');
    }
    if (!this.chunk) {
      if (index !== 0) throw new Error('OMP chunk sequence does not begin at zero');
      this.chunk = { id: chunkId, count: Number(count), bytes: Number(byteLength), parts: [], size: 0 };
    }
    const chunk = this.chunk;
    if (chunk.id !== chunkId || chunk.count !== count || chunk.bytes !== byteLength || index !== chunk.parts.length) {
      throw new Error('Interleaved or out-of-order OMP chunks');
    }
    const part = Buffer.from(data, 'base64');
    if (!part.length) throw new Error('OMP chunk must contain data');
    chunk.size += part.length;
    if (chunk.size > chunk.bytes) throw new Error('OMP reassembly length exceeded');
    chunk.parts.push(part);
    if (chunk.parts.length !== chunk.count) return null;
    this.chunk = null;
    if (chunk.size !== chunk.bytes) throw new Error('OMP reassembly length mismatch');
    const result = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunk.parts, chunk.size))));
    if (typeof result.type !== 'string' || result.type === 'rpc_chunk') throw new Error('Invalid reassembled OMP frame');
    return result as Frame;
  }

  end(): void {
    if (this.chunk) throw new Error('OMP exited during a chunk sequence');
  }
}

interface Options {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onSpawn(pid: number): Promise<void>;
  onFrame(frame: Frame): void;
  onStderr(text: string): void;
  onFailure(error: Error): void;
}

export class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<number | null>;
  readonly decoder = new FrameDecoder();
  private pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private readyResolve!: (frame: Frame) => void;
  private readyReject!: (error: Error) => void;
  private readonly ready: Promise<Frame>;
  private readySeen = false;
  private failed = false;
  private ended = false;
  private closedInput = false;

  private constructor(private readonly options: Options) {
    const ready = Promise.withResolvers<Frame>();
    this.ready = ready.promise;
    this.readyResolve = ready.resolve;
    this.readyReject = ready.reject;
    this.child = spawn(options.executable, options.args, {
      cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      env: options.env ?? { ...process.env, PI_NO_PTY: '1', PI_NO_TITLE: '1' },
    });
    const exited = Promise.withResolvers<number | null>();
    this.exited = exited.promise;
    this.child.once('close', (code) => {
      this.ended = true;
      this.rejectPending(new Error(`OMP process exited (${code ?? 'signal'})`));
      if (!this.readySeen) this.readyReject(new Error('OMP exited before ready'));
      exited.resolve(code);
    });
    this.child.once('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => { if (!this.closedInput) this.fail(error); });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (text: string) => options.onStderr(text));
    this.child.stderr.on('error', (error) => this.fail(error));
    let buffer = Buffer.alloc(0);
    this.child.stdout.on('data', (part: Buffer) => {
      // Continue draining after a protocol failure; do not leave the child blocked on a pipe.
      if (this.failed) return;
      try {
        let offset = 0;
        while (offset < part.length) {
          const newline = part.indexOf(10, offset);
          const end = newline < 0 ? part.length : newline;
          const piece = part.subarray(offset, end);
          if (buffer.length + piece.length + 1 > this.decoder.maxFrameBytes) throw new Error('OMP stdout frame exceeds limit');
          buffer = buffer.length ? Buffer.concat([buffer, piece]) : Buffer.from(piece);
          if (newline < 0) break;
          if (buffer.length) {
            const frame = this.decoder.decode(buffer);
            if (frame) this.receive(frame);
          }
          buffer = Buffer.alloc(0);
          offset = newline + 1;
        }
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    this.child.stdout.on('end', () => {
      try {
        if (buffer.length) throw new Error('OMP stdout ended with an incomplete JSONL frame');
        this.decoder.end();
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    this.child.stdout.on('error', (error) => this.fail(error));
  }

  static async launch(options: Options): Promise<RpcProcess> {
    const rpc = new RpcProcess(options);
    const timer = setTimeout(() => rpc.fail(new Error('OMP ready frame timed out')), 30_000);
    try {
      // Attach the rejection observer before any asynchronous identity persistence.
      const ready = rpc.ready;
      void ready.catch(() => {});
      if (!rpc.child.pid) throw new Error('OMP failed to spawn');
      await options.onSpawn(rpc.child.pid);
      const frame = await ready;
      if (Array.isArray(frame.supportedProtocolVersions) && frame.supportedProtocolVersions.includes(2)) {
        await rpc.command('negotiate_protocol', { protocolVersion: 2 });
      } else {
        throw new Error('OMP must support lossless RPC protocol version 2');
      }
      return rpc;
    } catch (error) {
      await rpc.shutdown().catch(() => {});
      throw error;
    } finally { clearTimeout(timer); }
  }

  private receive(frame: Frame): void {
    if (frame.type === 'ready') {
      if (this.readySeen || frame.protocolVersion !== 1) throw new Error('Invalid duplicate OMP ready frame');
      this.readySeen = true;
      if (!Number.isSafeInteger(frame.maxFrameBytes) || Number(frame.maxFrameBytes) < 1024
        || !Number.isSafeInteger(frame.maxReassembledFrameBytes) || Number(frame.maxReassembledFrameBytes) < 1024) {
        throw new Error('OMP did not advertise valid transport limits');
      }
      this.decoder.maxFrameBytes = Math.min(PHYSICAL_LIMIT, Number(frame.maxFrameBytes));
      this.decoder.maxReassembledFrameBytes = Math.min(LOGICAL_LIMIT, Number(frame.maxReassembledFrameBytes));
      this.readyResolve(frame);
    } else if (!this.readySeen) {
      throw new Error('OMP emitted a frame before ready');
    }
    if (frame.type === 'response' && typeof frame.id === 'string') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(frame.id);
        if (frame.success === true) pending.resolve(object(frame.data));
        else pending.reject(new Error(typeof frame.error === 'string' ? frame.error : 'OMP command failed'));
      } else if (frame.success === false) {
        this.options.onFailure(new Error(typeof frame.error === 'string' ? frame.error : 'OMP late command failure'));
      }
    }
    this.options.onFrame(frame);
  }

  send(frame: Record<string, unknown>): void {
    if (this.ended || this.closedInput || this.failed) throw new Error('OMP transport is not writable');
    const line = JSON.stringify(frame) + '\n';
    if (Buffer.byteLength(line) > this.decoder.maxFrameBytes) throw new Error('OMP command exceeds advertised frame limit');
    this.child.stdin.write(line);
  }

  command(type: string, payload: Record<string, unknown> = {}, timeout = 30_000): Promise<Record<string, unknown>> {
    const id = crypto.randomUUID();
    const gate = Promise.withResolvers<Record<string, unknown>>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      gate.reject(new Error(`OMP command timed out: ${type}`));
    }, timeout);
    this.pending.set(id, { resolve: gate.resolve, reject: gate.reject, timer });
    try { this.send({ ...payload, id, type }); }
    catch (error) {
      clearTimeout(timer);
      this.pending.delete(id);
      gate.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return gate.promise;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private fail(error: Error): void {
    if (this.failed) return;
    this.failed = true;
    this.readyReject(error);
    this.rejectPending(error);
    this.options.onFailure(error);
  }

  async shutdown(): Promise<number | null> {
    this.closedInput = true;
    this.child.stdin.end();
    const signal = (name: NodeJS.Signals) => {
      // While this handle is alive the detached group identity is owned by this child.
      if (!this.ended && this.child.pid) {
        try { process.kill(-this.child.pid, name); } catch (error) { if (object(error).code !== 'ESRCH') this.options.onFailure(new Error(String(error))); }
      }
    };
    const term = setTimeout(() => signal('SIGTERM'), 5_000);
    const kill = setTimeout(() => signal('SIGKILL'), 10_000);
    const timeout = Promise.withResolvers<never>();
    const deadline = setTimeout(() => timeout.reject(new Error('OMP exit was not observed; scheduling remains blocked')), 15_000);
    try {
      return await Promise.race([this.exited, timeout.promise]);
    } finally { clearTimeout(term); clearTimeout(kill); clearTimeout(deadline); }
  }
}
