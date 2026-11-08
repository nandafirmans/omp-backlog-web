import type { BlockerDetails, HostVerification, RecoveryContext, RecoveryHistory, Run, Store, Ticket } from './contracts';
import { HttpError } from './tickets';
import { redactTranscript } from './transcript';
import { object } from './rpc';
import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { posix } from 'node:path';

export function recoveryDiagnostic(output: string): string {
  return stripVTControlCharacters(redactTranscript(output)).replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gu, '<duration>').replace(/\s+/gu, ' ').trim().slice(0, 8000);
}

export function recoveryFingerprint(recipeHash: string, diagnostic: string, candidateTree?: string): string {
  return createHash('sha256').update(JSON.stringify([recipeHash, recoveryDiagnostic(diagnostic), candidateTree ?? null])).digest('hex');
}

export function recoveryCategory(diagnostic: string): RecoveryHistory['category'] {
  if (/(credential|api.?key|token expired|login|sign.?in|unauthori[sz]ed)/iu.test(diagnostic)) return 'credentials';
  if (/(permission|forbidden|access denied)/iu.test(diagnostic)) return 'permissions';
  if (/(install|dependency|cannot find (?:module|package)|module not found|command not found|enoent|no such file)/iu.test(diagnostic)) return 'installation';
  if (/(product decision|requirements?|acceptance.*unclear)/iu.test(diagnostic)) return 'requirements';
  if (/(unsafe|destructive|delete.*data|reset|outside.*scope)/iu.test(diagnostic)) return 'unsafe_operation';
  if (/(network|econn|enotfound|timed? ?out|infrastructure|out of memory|disk full|service unavailable)/iu.test(diagnostic)) return 'infrastructure';
  if (/no progress|repeated diagnostic/iu.test(diagnostic)) return 'no_progress';
  if (/bound reached|already claimed|retry.*exhaust/iu.test(diagnostic)) return 'retry_exhausted';
  if (/\b(?:budget|deadline|reserve)\b/iu.test(diagnostic)) return 'budget_exhausted';
  return 'unknown';
}

function safeRecoveryPath(path: string): boolean {
  return Boolean(path) && !posix.isAbsolute(path) && !path.split('/').some(part => !part || part === '..' || part === '.' || part === 'node_modules' || part.startsWith('.'));
}

function artifactPattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\bENOENT:\\s*(?:no such file(?: or directory)?,\\s*)?(?:open|read(?:File)?)\\s+['"]${escaped}['"]`, 'giu');
}

export function missingAuthoredArtifact(diagnostic: string, files: string[]): string | undefined {
  return files.find(path => safeRecoveryPath(path) && artifactPattern(path).test(diagnostic));
}

function scopedEngineeringDiagnostic(diagnostic: string, files: string[]): string {
  let scoped = diagnostic;
  for (const path of files.filter(safeRecoveryPath)) scoped = scoped.replace(artifactPattern(path), 'Missing authored artifact');
  return scoped.split('\n').map(line => {
    const importer = files.find(path => safeRecoveryPath(path) && new RegExp(`(?:^|[^a-zA-Z0-9_./-])${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:\\(\\d+(?:,\\d+)?\\)|:\\d+(?::\\d+)?)`, 'u').test(line));
    if (!importer) return line;
    return line.replace(/cannot find module\s+(['"])(\.{1,2}\/[^'"]+)\1/giu, (match: string, _quote: string, specifier: string) =>
      !specifier.includes('\\') && safeRecoveryPath(posix.normalize(posix.join(posix.dirname(importer), specifier))) ? 'Unresolved local import' : match);
  }).join('\n');
}

export function engineeringBlockerCategory(details: BlockerDetails, files: string[]): RecoveryHistory['category'] {
  const diagnostic = [details.prerequisite, details.unblock, details.attempted, details.permission, details.verification].filter(Boolean).join('\n');
  return recoveryCategory(scopedEngineeringDiagnostic(diagnostic, files));
}

export function classifyEngineeringFailure(receipt: HostVerification, files: string[]): boolean {
  const diagnostic = recoveryDiagnostic(receipt.output);
  if (receipt.outcome !== 'failed' || !Number.isInteger(receipt.exitCode) || receipt.exitCode === null || receipt.exitCode <= 0 || receipt.exitCode > 255 || receipt.outputTruncated || !files.length || !diagnostic) return false;
  if (!files.some(path => new RegExp(`(?:^|[^a-zA-Z0-9_.-])${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?=$|[^a-zA-Z0-9_.-])`, 'u').test(diagnostic))) return false;
  const missingArtifact = missingAuthoredArtifact(receipt.output, files);
  if (recoveryCategory(scopedEngineeringDiagnostic(receipt.output, files)) !== 'unknown') return false;
  return missingArtifact !== undefined || /(?:AssertionError|assertion failed|\bTS\d+|SyntaxError|TypeError|ReferenceError|FAIL\s+\S+\.(?:test|spec)\.|expected .+ (?:received|got)|test(?:s)? failed)/iu.test(diagnostic);
}

export function recoveryAllowance(run: Run, allowance: 'recoveries' | 'corrections', diagnosticFingerprint: string): string | null {
  const lifecycle = run.lifecycle;
  if (!lifecycle) return 'No autonomous recovery authority';
  const bound = allowance === 'recoveries' ? Math.min(1, lifecycle.policy.maxRecoveries) : Math.min(2, lifecycle.policy.maxCorrections);
  if (lifecycle[allowance] >= bound) return 'Autonomous recovery/correction bound reached; assistance required';
  if (lifecycle.recoveryHistory?.some(record => record.allowance !== 'read_retry' && record.diagnosticFingerprint === diagnosticFingerprint && record.started !== undefined)) return 'Repeated diagnostic after repair: no progress; assistance required';
  const total = lifecycle.authorTokens + (lifecycle.reviewerTokens ?? 0);
  if (run.progress?.tokenBudget != null && run.progress.tokenBudget - total < 6144) return 'Insufficient original token budget for repair and independent review reserve';
  if (!run.progress || run.progress.deadline - Date.now() < (lifecycle.policy.verification.timeoutSeconds + 105) * 1000) return 'Insufficient original deadline for repair, verification and independent review';
  return null;
}

export function repairReserve(run: Run): string | null {
  const lifecycle = run.lifecycle;
  if (!lifecycle?.recoveryHistory?.some(record => record.allowance !== 'read_retry' && ['authorized', 'dispatched', 'paused'].includes(record.state))) return null;
  if (run.progress?.tokenBudget != null && run.progress.tokenBudget - lifecycle.authorTokens - (lifecycle.reviewerTokens ?? 0) < 4096) return 'Repair exhausted protected independent reviewer token reserve';
  if (!run.progress || run.progress.deadline - Date.now() < (lifecycle.policy.verification.timeoutSeconds + 45) * 1000) return 'Repair reached protected final verification and reviewer time reserve';
  return null;
}

function text(value: unknown, field: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new HttpError(400, `Provide ${field} (1–${limit} characters)`);
  return redactTranscript(value.trim());
}

export function blockerDetails(result: Record<string, unknown>): BlockerDetails {
  const prerequisite = text(result.prerequisite, 'unavailable prerequisite', 2000);
  const unblock = text(result.unblock, 'required unblock action', 2000);
  const optional = (field: string) => result[field] === undefined ? undefined : text(result[field], field, 2000);
  return {
    prerequisite, unblock, attempted: optional('attempted'), permission: optional('permission'), verification: optional('verification'),
    suggestedPrompt: result.recoveryPrompt === undefined
      ? `Recheck this prerequisite first: ${prerequisite}\nRecommended unblock action (not permission): ${unblock}\nReview prior evidence and partial work. Apply only fixes permitted by the approved ticket and repository policy. Do not install dependencies or bypass workspace gates. Verify the original acceptance criteria with fresh checks; stop with an updated blocker if still unavailable.`
      : text(result.recoveryPrompt, 'suggested recovery prompt', 8000),
  };
}

function blockedSource(store: Store, ticket: Ticket, runId: unknown): Run {
  const run = ticket.runId ? store.get('runs', ticket.runId) : undefined;
  if (!run || run.id !== runId || run.repoId !== ticket.repoId || run.ticketId !== ticket.id || run.status !== 'blocked' || run.pid !== null || !['blocked', 'draft'].includes(ticket.status)) {
    throw new HttpError(409, 'Blocker changed or work has not stopped; review the current ticket');
  }
  return run;
}

export function saveRecoveryNote(store: Store, ticket: Ticket, runId: string, input: Record<string, unknown>): Run {
  const run = blockedSource(store, ticket, runId);
  if (input.revision !== ticket.revision) throw new HttpError(409, 'Requirements changed; review the current revision');
  if (input.noteId !== (run.recoveryNote?.id ?? null)) throw new HttpError(409, 'Recovery note changed; reload and reconcile your instructions');
  run.recoveryNote = { id: crypto.randomUUID(), revision: ticket.revision, instructions: text(input.instructions, 'recovery instructions', 8000), recorded: Date.now() };
  store.save('runs', run);
  return run;
}

export function reviewRecovery(store: Store, ticket: Ticket, input: Record<string, unknown>): Run {
  const run = blockedSource(store, ticket, input.runId);
  if (!run.recoveryNote || run.recoveryNote.id !== input.noteId || run.recoveryNote.revision !== ticket.revision) throw new HttpError(409, 'Recovery instructions or revision changed; save and review again');
  run.recoveryNote.reviewed = Date.now();
  return run;
}

/** Snapshot only the explicitly reviewed handoff; later edits never enter a running objective. */
export function recoveryContext(store: Store, ticket: Ticket): RecoveryContext | undefined {
  const source = ticket.runId ? store.get('runs', ticket.runId) : undefined;
  const note = source?.recoveryNote;
  if (!source || source.repoId !== ticket.repoId || source.ticketId !== ticket.id || source.status !== 'blocked' || !note?.reviewed || note.revision !== ticket.revision) return;
  const playbookReads = new Set(source.recoveryContext?.playbookReads ?? []);
  for (const entry of source.conversation ?? []) {
    if (entry.toolName !== 'read' || entry.state !== 'complete') continue;
    let path: unknown;
    try { path = object(JSON.parse(entry.input ?? '{}')).path; } catch { continue; }
    if (typeof path === 'string' && /^skill:\/\/poteto-mode\/playbooks\/[a-z0-9-]+\.md$/u.test(path)) playbookReads.add(path);
  }
  return { sourceRunId: source.id, sourceRevision: source.revision, note: { ...note }, blocker: source.blocker === null ? null : redactTranscript(source.blocker), details: source.blockerDetails, evidence: source.evidence.map(redactTranscript), changedFiles: redactTranscript(source.changedFiles), ...(playbookReads.size ? { playbookReads: [...playbookReads] } : {}) };
}

export function recoveryObjective(run: Run): string[] {
  const context = run.recoveryContext;
  if (!context || context.note.revision !== run.revision || !context.note.reviewed) return [];
  return [
    `Reviewed recovery context from blocked run ${context.sourceRunId}, revision ${context.sourceRevision}${context.sourceRevision !== run.revision ? ' (older requirements; reconcile against current ticket)' : ''}. Context is not expanded execution permission; repository policy and all original restrictions still apply. Recheck the prerequisite before repair. Prior evidence is context, not a passing check for this attempt. Never blindly replay uncertain side effects.`,
    ...(run.configuration?.engineeringMode !== 'standard' && context.playbookReads?.length ? [`Retain the prior pstack playbook and completed investigation. Previously observed playbook reads (tool observations, not proof of adherence): ${context.playbookReads.join(', ')}. The fresh router must retain this methodology context, not choose another workflow to bypass a blocker.`] : []),
    JSON.stringify({ blocker: context.blocker, agentReportedDetails: context.details, partialEvidence: context.evidence, changedFiles: context.changedFiles, operatorRecoveryInstructions: context.note.instructions }),
  ];
}
