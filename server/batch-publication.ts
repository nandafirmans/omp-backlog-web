import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BatchOperation, BatchReview, TaskProposal } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import { digest, token } from './store';
import { validateTaskExtraction } from './task-extraction';
import { atomicPublish, batchInactive, batchReserved, HttpError, MAX_MARKDOWN, readSafe, reconcileTickets, safePath, serializeWrite, validateCompleteTicket } from './tickets';

function workspace(store: Store, repo: Repo, id: string) {
  const value = store.get('agentWorkspaces', id);
  if (!value || value.repoId !== repo.id || value.repoPath !== repo.path) throw new HttpError(404, 'Workspace not found');
  value.proposalSets ??= [];
  return value;
}
function reviewInput(store: Store, repo: Repo, id: string, input: Record<string, unknown>) {
  const value = workspace(store, repo, id);
  if (value.archived || input.version !== value.version) throw new HttpError(409, 'Workspace changed; reload before saving');
  const set = value.proposalSets.find(item => item.id === input.proposalSetId);
  if (!set || !Array.isArray(input.proposals) || !Array.isArray(input.selectedKeys) || input.selectedKeys.some(key => typeof key !== 'string')) throw new HttpError(400, 'Choose a saved proposal set and ordered selection');
  const old = value.batchReview;
  if ((old?.version ?? null) !== input.reviewVersion) throw new HttpError(409, 'Review changed in another editor');
  const proposals = input.proposals as TaskProposal[];
  if (proposals.length > 12 || new Set(proposals.map(item => item?.key)).size !== proposals.length || proposals.some(item => typeof item?.key !== 'string' || !/^task-[a-z][a-z0-9-]{0,47}$/.test(item.key))) throw new HttpError(400, 'Use at most 12 distinct temporary task keys');
  if (old?.proposalSetId === set.id && old.proposals.some(proposal => !proposals.some(item => item.key === proposal.key))) throw new HttpError(409, 'Saved task keys cannot be changed or removed');
  if (set.payload.proposals.some(proposal => !proposals.some(item => item.key === proposal.key))) throw new HttpError(409, 'Source task keys cannot be changed or removed');
  const selected = input.selectedKeys as string[];
  if (new Set(selected).size !== selected.length || selected.some(key => !proposals.some(item => item.key === key))) throw new HttpError(400, 'Select distinct proposal keys');
  for (const proposal of proposals) {
    if (!proposal || typeof proposal !== 'object' || typeof proposal.title !== 'string' || typeof proposal.description !== 'string'
      || ![proposal.acceptanceCriteria, proposal.verification, proposal.dependsOn, proposal.sourceReferences].every(list => Array.isArray(list) && list.every(item => typeof item === 'string'))
      || Object.keys(proposal).sort().join(',') !== 'acceptanceCriteria,dependsOn,description,key,sourceReferences,title,verification') throw new HttpError(400, 'Invalid proposal review fields');
  }
  if (Buffer.byteLength(JSON.stringify(proposals)) > 64 * 1024) throw new HttpError(413, 'Review exceeds 64 KiB');
  return { value, set, proposals, selected };
}
export function saveBatchReview(store: Store, repo: Repo, id: string, input: Record<string, unknown>) {
  return store.transaction(() => {
    const { value, set, proposals, selected } = reviewInput(store, repo, id, input);
    const review: BatchReview = { id: value.batchReview?.proposalSetId === set.id ? value.batchReview.id : crypto.randomUUID(), version: (value.batchReview?.version ?? 0) + 1, proposalSetId: set.id, proposals, selectedKeys: selected, updatedAt: Date.now() };
    value.batchReview = review; value.version++; value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
    return review;
  });
}
function checkReview(store: Store, repo: Repo, id: string, input: Record<string, unknown>) {
  const value = workspace(store, repo, id); const review = value.batchReview;
  if (value.archived || value.version !== input.version || !review || review.id !== input.reviewId || review.version !== input.reviewVersion) throw new HttpError(409, 'Workspace or review changed; review again');
  const set = value.proposalSets.find(item => item.id === review.proposalSetId);
  if (!set) throw new HttpError(409, 'Source proposal set is unavailable');
  if (typeof input.acknowledgeStalePlan !== 'boolean' || set.sourcePlanRevisionId !== value.currentPlanRevisionId && !input.acknowledgeStalePlan) throw new HttpError(409, 'Acknowledge that the source plan is stale before preview');
  try {
    validateTaskExtraction(JSON.stringify({ ...set.payload, strategy: 'auto', proposals: review.selectedKeys.map(key => review.proposals.find(item => item.key === key)!) }), { workspaceId: id, planRevisionId: set.sourcePlanRevisionId, strategy: 'auto', referenceIds: set.researchReferences.map(item => item.id), existingTicketIds: review.proposals.flatMap(item => item.dependsOn.filter(dependency => /^T[0-9]{3,8}$/.test(dependency))) });
  } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid review'); }
  return { value, review, set };
}
function externalGraph(store: Store, repo: Repo, tickets: BatchOperation['tickets']): Record<string, string> {
  const generated = new Map(tickets.map(ticket => [ticket.id, ticket.dependencies]));
  const revisions: Record<string, string> = {};
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new HttpError(409, `Dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    let dependencies = generated.get(id);
    if (!dependencies) {
      const ticket = store.get('tickets', `${repo.id}/${id}`);
      if (!ticket || ticket.removed || ticket.error || batchInactive(store, repo.path, id)) throw new HttpError(409, `Existing dependency ${id} is missing or invalid`);
      revisions[id] = ticket.revision;
      dependencies = ticket.dependencies;
    }
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const ticket of tickets) visit(ticket.id);
  return Object.fromEntries(Object.entries(revisions).sort(([a], [b]) => a.localeCompare(b)));
}
function payloadHash(op: BatchOperation): string {
  return digest(JSON.stringify({ id: op.id, repoId: op.repoId, repoPath: op.repoPath, workspaceId: op.workspaceId, reviewId: op.reviewId, reviewVersion: op.reviewVersion, workspaceVersion: op.workspaceVersion, sourcePlanRevisionId: op.sourcePlanRevisionId, mode: op.mode, expires: op.expires, acknowledgeStalePlan: op.acknowledgeStalePlan, externalRevisions: op.externalRevisions, tickets: op.tickets.map(({ key, id, markdown, dependencies }) => ({ key, id, markdown, dependencies })) }));
}
export function previewBatch(store: Store, repo: Repo, id: string, input: Record<string, unknown>): Promise<BatchOperation> {
  return serializeWrite(store, async () => {
    await reconcileTickets(store, true);
    const { review, set } = checkReview(store, repo, id, input);
    const base = join(repo.path, '.omp-backlog', 'tickets');
    await safePath(repo.path, base, true);
    let entries: string[] = [];
    try { entries = await readdir(base); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    checkReview(store, repo, id, input);
    const latest = store.get('repos', repo.id);
    if (!latest || latest.path !== repo.path) throw new HttpError(409, 'Project changed');
    const used = new Set(entries);
    for (const ticket of store.list('tickets')) if (ticket.repoId === repo.id && !ticket.removed) used.add(ticket.id);
    const ids = new Map<string, string>(); let number = 1;
    for (const key of review.selectedKeys) {
      let candidate: string;
      do { if (number > 99999999) throw new HttpError(409, 'No ticket IDs available'); candidate = `T${String(number++).padStart(3, '0')}`; } while (used.has(candidate) || batchReserved(store, repo, candidate));
      used.add(candidate); ids.set(key, candidate);
    }
    for (const proposal of review.proposals.filter(item => review.selectedKeys.includes(item.key))) for (const dependency of proposal.dependsOn) {
      if (/^T[0-9]{3,8}$/.test(dependency)) {
        const existing = store.get('tickets', `${repo.id}/${dependency}`);
        if (!existing || existing.removed || existing.error || batchInactive(store, repo.path, dependency)) throw new HttpError(409, `Existing dependency ${dependency} is missing or invalid`);
      }
    }
    const tickets = review.selectedKeys.map(key => {
      const proposal = review.proposals.find(item => item.key === key)!;
      const dependencies = proposal.dependsOn.map(dependency => ids.get(dependency) ?? dependency);
      const title = proposal.title.replace(/[\r\n]/g, ' ').replace(/["']/g, '');
      const markdown = `---\nid: ${ids.get(key)}\ntitle: ${title}\ndepends_on: [${dependencies.join(', ')}]\n---\n\n${proposal.description}\n\nDone when:\n${proposal.acceptanceCriteria.map(item => `- ${item.replace(/[\r\n]+/g, ' ')}`).join('\n')}\n\n## Verification\n${proposal.verification.map(item => `- ${item.replace(/[\r\n]+/g, ' ')}`).join('\n')}\n`;
      validateCompleteTicket(markdown, []);
      return { key, id: ids.get(key)!, markdown, dependencies };
    });
    const operation: BatchOperation = { id: token(), repoId: repo.id, repoPath: repo.path, workspaceId: id, reviewId: review.id, reviewVersion: review.version, workspaceVersion: input.version as number, sourcePlanRevisionId: set.sourcePlanRevisionId, payloadHash: '', externalRevisions: externalGraph(store, repo, tickets), mode: latest.mode, expires: Date.now() + 600000, acknowledgeStalePlan: input.acknowledgeStalePlan as boolean, state: 'prepared', tickets };
    operation.payloadHash = payloadHash(operation);
    store.save('batchOperations', operation); return operation;
  });
}
export function operationFor(store: Store, repo: Repo, workspaceId: string, confirmation: string): BatchOperation {
  const operation = store.get('batchOperations', confirmation);
  if (!operation || operation.repoId !== repo.id || operation.repoPath !== repo.path || operation.workspaceId !== workspaceId) throw new HttpError(404, 'Batch operation not found');
  return operation;
}
export function publicOperation(operation: BatchOperation) {
  return { confirmation: operation.id, publicationId: operation.id, reviewId: operation.reviewId, state: operation.state, phase: operation.phase, mode: operation.mode, expires: operation.expires, error: operation.error, tickets: operation.tickets.map(({ key, id, markdown, dependencies }) => ({ key, id, markdown, dependencies })) };
}
export function publishBatch(store: Store, repo: Repo, workspaceId: string, confirmation: string, fault?: (stage: string) => void): Promise<BatchOperation> {
  return serializeWrite(store, async () => {
    const op = operationFor(store, repo, workspaceId, confirmation);
    let injecting = false;
    const checkpoint = (stage: string) => { if (fault) { injecting = true; fault(stage); injecting = false; } };
    const checkAuthority = () => {
      if (!op.payloadHash || payloadHash(op) !== op.payloadHash) throw new HttpError(409, 'Publication journal payload identity is invalid');
      if (JSON.stringify(externalGraph(store, repo, op.tickets)) !== JSON.stringify(op.externalRevisions)) throw new HttpError(409, 'An existing dependency changed since preview');
      checkReview(store, repo, workspaceId, { version: op.workspaceVersion, reviewId: op.reviewId, reviewVersion: op.reviewVersion, acknowledgeStalePlan: op.acknowledgeStalePlan });
      const latest = store.get('repos', repo.id);
      if (!latest || latest.path !== repo.path || latest.mode !== op.mode) throw new HttpError(409, 'Reviewed workspace or project mode changed');
    };
    if (op.state === 'complete') return op;
    if (op.state === 'blocked') throw new HttpError(409, 'Publication needs operator inspection; no automatic overwrite is permitted');
    await reconcileTickets(store, true);
    if (op.state === 'prepared') {
      checkAuthority();
      if (op.expires <= Date.now()) throw new HttpError(409, 'Review expired');
      op.state = 'publishing'; op.phase = 'staging'; store.save('batchOperations', op);
      checkpoint('gate');
    }
    const base = join(repo.path, '.omp-backlog'); const tickets = join(base, 'tickets');
    try {
      await safePath(repo.path, tickets, true); await mkdir(tickets, { recursive: true, mode: 0o700 }); await safePath(repo.path, tickets);
      const parent = await open(tickets, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        for (const ticket of op.tickets) {
          if (!ticket.stage) {
            ticket.stage = join(base, `.batch-stage-${token()}`);
            store.save('batchOperations', op);
          }
          if (ticket.dev === undefined) {
            await mkdir(ticket.stage, { mode: 0o700 });
            const file = await open(join(ticket.stage, 'ticket.md'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try { await file.writeFile(ticket.markdown); await file.sync(); } finally { await file.close(); }
            const dir = await open(ticket.stage, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { await dir.sync(); const info = await dir.stat(); if (!info.birthtimeMs) throw new Error('Filesystem cannot provide durable staging identity'); ticket.dev = info.dev; ticket.ino = info.ino; ticket.birthtimeMs = info.birthtimeMs; } finally { await dir.close(); }
            const stagingParent = await open(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { await stagingParent.sync(); } finally { await stagingParent.close(); }
            checkpoint('staged');
            store.save('batchOperations', op);
            checkpoint('journaled');
          }
          const dest = join(tickets, ticket.id);
          let existing = false;
          try { const info = await lstat(dest); if (ticket.birthtimeMs === undefined || info.dev !== ticket.dev || info.ino !== ticket.ino || info.birthtimeMs !== ticket.birthtimeMs || !info.isDirectory()) throw new Error('Destination identity changed'); existing = true; }
          catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
          if (!existing) {
            await safePath(repo.path, ticket.stage!);
            const info = await lstat(ticket.stage!);
            if (ticket.birthtimeMs === undefined || info.dev !== ticket.dev || info.ino !== ticket.ino || info.birthtimeMs !== ticket.birthtimeMs || !info.isDirectory()) throw new Error('Staging identity changed');
            if ((await readdir(ticket.stage!)).join() !== 'ticket.md' || new TextDecoder('utf-8', { fatal: true }).decode(await readSafe(repo.path, join(ticket.stage!, 'ticket.md'), MAX_MARKDOWN)) !== ticket.markdown) throw new Error('Staged payload changed');
            const currentParent = await lstat(tickets); const opened = await parent.stat();
            if (currentParent.dev !== opened.dev || currentParent.ino !== opened.ino) throw new Error('Ticket directory changed');
            await reconcileTickets(store, true);
            checkAuthority();
            op.phase = 'publishing'; store.save('batchOperations', op);
            atomicPublish(ticket.stage!, parent.fd, ticket.id);
            checkpoint('renamed');
            await parent.sync();
            const stagingParent = await open(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { await stagingParent.sync(); } finally { await stagingParent.close(); }
            checkpoint('synced');
          }
        }
      } finally { await parent.close(); }
      op.phase = 'reconciling'; store.save('batchOperations', op);
      await reconcileTickets(store, true);
      checkpoint('reconciled');
      await reconcileTickets(store, true);
      for (const ticket of op.tickets) {
        const current = store.get('tickets', `${repo.id}/${ticket.id}`);
        if (!current || current.error || current.revision !== validateCompleteTicket(ticket.markdown, []).revision) throw new Error('Published ticket changed or failed validation');
      }
      checkAuthority();
      op.state = 'complete'; store.save('batchOperations', op); return op;
    } catch (error) {
      if (injecting) throw error;
      op.state = 'blocked'; op.error = error instanceof Error ? error.message : 'Unknown publication failure'; store.save('batchOperations', op);
      throw new HttpError(409, `Batch publication requires operator inspection: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
  });
}
