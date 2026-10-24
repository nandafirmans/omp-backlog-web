import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Run, Store, Ticket, VerificationReceipt } from './contracts';
import { digest } from './store';
import { object } from './rpc';
import { HttpError, readSafe, safePath } from './tickets';

const MAX_ARTIFACT = 512 * 1024;
const MAX_TOTAL = 10 * 1024 * 1024;
function text(value: unknown, name: string, maximum = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`Invalid evidence ${name}`);
  return value.trim();
}

// Content is explicitly submitted, never copied from arbitrary agent-supplied paths.
export async function recordEvidence(store: Store, run: Run, ticket: Ticket, input: unknown): Promise<VerificationReceipt> {
  const value = object(input);
  if (value.revision !== run.revision || run.revision !== ticket.revision) throw new Error('Evidence must match this run revision');
  const criterion = text(value.criterion, 'criterion');
  if (!ticket.criteria.includes(criterion)) throw new Error('Evidence must name one exact criterion');
  if (!['passed', 'failed', 'blocked', 'not_run'].includes(String(value.outcome))) throw new Error('Invalid evidence outcome');
  if ((run.verification?.length ?? 0) >= 100) throw new Error('Run evidence limit reached (100 receipts)');
  const receipt: VerificationReceipt = {
    id: randomUUID(), runId: run.id, revision: run.revision, criterion,
    feature: text(value.feature, 'feature'), entryPoint: text(value.entryPoint, 'entry point'),
    method: text(value.method, 'method'), details: text(value.details, 'details'),
    recipe: text(value.recipe, 'recipe identity'), outcome: value.outcome as VerificationReceipt['outcome'],
    source: 'agent_report', recorded: Date.now(),
  };
  if (value.artifact !== undefined) {
    const artifact = object(value.artifact);
    const name = text(artifact.name, 'artifact name', 100);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.(png|jpg|txt|json)$/.test(name)) throw new Error('Artifact must have a simple png, jpg, txt or json filename');
    if (typeof artifact.base64 !== 'string' || artifact.base64.length > Math.ceil(MAX_ARTIFACT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.base64)) throw new Error('Invalid artifact encoding or size (512 KiB maximum)');
    const bytes = Buffer.from(artifact.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_ARTIFACT) throw new Error('Empty or oversized artifact');
    const total = (run.verification ?? []).reduce((sum, entry) => sum + (entry.artifact?.size ?? 0), 0);
    if (total + bytes.length > MAX_TOTAL) throw new Error('Run artifact limit reached (10 MiB)');
    const directory = join(store.dataDir, 'proof', run.id);
    await safePath(store.dataDir, directory, true);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await safePath(store.dataDir, directory);
    const id = randomUUID();
    await writeFile(join(directory, id), bytes, { mode: 0o600, flag: 'wx' });
    receipt.artifact = { id, name, size: bytes.length, sha256: digest(bytes) };
  }
  return receipt;
}

export function assertVerifiedCriteria(ticket: Ticket, receipts: VerificationReceipt[]) {
  // A fresh result for the same journey/method supersedes its earlier failure.
  const latest = new Map<string, VerificationReceipt>();
  for (const receipt of receipts) {
    if (receipt.revision !== ticket.revision) throw new Error('Verification receipt belongs to another revision');
    latest.set(JSON.stringify([receipt.criterion, receipt.feature, receipt.entryPoint, receipt.method]), receipt);
  }
  for (const criterion of ticket.criteria) {
    const checks = [...latest.values()].filter(check => check.criterion === criterion);
    if (!checks.length || checks.some(check => check.outcome !== 'passed')) throw new Error('Completion requires passing reported checks for every criterion; failed, blocked or unperformed checks must be resolved');
  }
}

export async function proofDownload(store: Store, run: Run, artifactId: string): Promise<Response> {
  const artifact = run.verification?.find(entry => entry.artifact?.id === artifactId)?.artifact;
  if (!artifact || !/^[a-f0-9-]{36}$/.test(artifact.id)) throw new HttpError(404, 'Proof artifact not found');
  const bytes = await readSafe(store.dataDir, join(store.dataDir, 'proof', run.id, artifact.id), MAX_ARTIFACT);
  if (bytes.length !== artifact.size || digest(bytes) !== artifact.sha256) throw new HttpError(409, 'Proof artifact changed since capture');
  return new Response(Buffer.from(bytes), { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
