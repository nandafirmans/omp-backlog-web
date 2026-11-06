import type { BlockerDetails, RecoveryContext, Run, Store, Ticket } from './contracts';
import { HttpError } from './tickets';
import { redactTranscript } from './transcript';
import { object } from './rpc';

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
