import { randomUUID } from 'node:crypto';
import type { CompletionPolicy, Repo, Store, VerificationRecipe } from './contracts';
import { captureBaseline, recipeIdentity } from './autonomy';
import { HttpError } from './tickets';
import { workspaceOperation } from './workspace-commit';
import { assertWorkspaceIdentity, claimedWorkspaceConflict } from './workspace-identity';

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new HttpError(400, `${field} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
function recipe(value: unknown): VerificationRecipe {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Commission a verification recipe');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['argv', 'files', 'timeoutSeconds'].includes(key))) throw new HttpError(400, 'Unknown verification recipe field');
  if (!Array.isArray(input.argv) || !input.argv.length || input.argv.length > 64 || input.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || /\p{Cc}/u.test(arg)) || !String(input.argv[0]).trim()) throw new HttpError(400, 'Verification argv must contain 1–64 arguments, without control characters');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 32 || input.files.some(file => typeof file !== 'string' || !file.trim() || file.length > 1024 || /\p{Cc}/u.test(file)) || new Set(input.files).size !== input.files.length) throw new HttpError(400, 'Select 1–32 unique verification recipe files');
  return { argv: input.argv as string[], files: input.files as string[], timeoutSeconds: boundedInteger(input.timeoutSeconds, 'Verification timeout', 1, 1800) };
}

/** A separate owner setting; ticket agents cannot grant themselves publication authority. */
export async function saveCompletionPolicy(store: Store, repo: Repo, input: Record<string, unknown>): Promise<Repo> {
  return workspaceOperation(store, repo.id, async identity => {
    const current = store.get('repos', repo.id);
    if (!current || input.revision !== (current.completion?.revision ?? null)) throw new HttpError(409, 'Completion policy changed; reload and review');
    if (Object.keys(input).some(key => !['revision', 'mode', 'confirm', 'verification', 'reviewerModel', 'maxCorrections', 'maxRecoveries'].includes(key))) throw new HttpError(400, 'Unknown completion policy field');
    if (input.mode !== 'human' && input.mode !== 'autonomous') throw new HttpError(400, 'Choose Human-reviewed or Agent-reviewed + local commits');
    let completion: CompletionPolicy;
    if (input.mode === 'human') {
      completion = { mode: 'human', revision: randomUUID(), updated: Date.now() };
    } else {
      if (input.confirm !== true) throw new HttpError(400, 'Explicitly confirm agent review, local commits and automatic Done authority');
      if (!current.git) throw new HttpError(409, 'Autonomous completion requires a Git repository');
      if (current.handoff) throw new HttpError(409, 'Reconcile the recorded workspace gate before enabling autonomous completion');
      if (claimedWorkspaceConflict(store, current, identity)) throw new HttpError(409, 'Stop or finish owned work before changing autonomous settings');
      const verification = recipe(input.verification);
      if (typeof input.reviewerModel !== 'string' || input.reviewerModel.length > 512 || input.reviewerModel && (!/^[^/]+\/.+$/u.test(input.reviewerModel) || /\p{Cc}/u.test(input.reviewerModel))) throw new HttpError(400, 'Reviewer model must be an exact provider/model or blank to use the attempt model');
      const maxCorrections = boundedInteger(input.maxCorrections, 'Correction rounds', 0, 2);
      const maxRecoveries = boundedInteger(input.maxRecoveries, 'Recovery attempts', 0, 1);
      await assertWorkspaceIdentity(current, identity);
      await captureBaseline(store, current);
      const recipeHash = await recipeIdentity(current, verification);
      const fresh = store.get('repos', repo.id);
      await assertWorkspaceIdentity(current, identity);
      if (!fresh || (fresh.completion?.revision ?? null) !== input.revision || fresh.handoff || claimedWorkspaceConflict(store, fresh, identity)) throw new HttpError(409, 'Workspace or completion policy changed during inspection; review again');
      completion = { mode: 'autonomous', revision: randomUUID(), updated: Date.now(), verification, recipeHash, reviewerModel: input.reviewerModel, maxCorrections, maxRecoveries };
    }
    await assertWorkspaceIdentity(current, identity);
    const updated = { ...store.get('repos', repo.id)!, completion };
    store.save('repos', updated);
    return updated;
  });
}
