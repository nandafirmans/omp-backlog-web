import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BatchOperation, BatchReview, TaskProposal } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import { database, digest, token } from './store';
import { validateTaskExtraction } from './task-extraction';
import { atomicPublish, batchInactive, batchReserved, HttpError, MAX_MARKDOWN, readSafe, readTicket, reconcileTickets, safePath, serializeWrite, validTicketId, validateCompleteTicket } from './tickets';

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
  return digest(JSON.stringify({ id: op.id, repoId: op.repoId, repoPath: op.repoPath, rootIdentity: op.rootIdentity, workspaceId: op.workspaceId, reviewId: op.reviewId, reviewVersion: op.reviewVersion, workspaceVersion: op.workspaceVersion, sourcePlanRevisionId: op.sourcePlanRevisionId, mode: op.mode, expires: op.expires, acknowledgeStalePlan: op.acknowledgeStalePlan, externalRevisions: op.externalRevisions, tickets: op.tickets.map(({ key, id, markdown, dependencies }) => ({ key, id, markdown, dependencies })) }));
}
function validateJournal(op: BatchOperation): void {
  if (!op.rootIdentity || ![op.rootIdentity.dev, op.rootIdentity.ino, op.rootIdentity.birthtimeMs].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new HttpError(409, 'Repository root identity was not recorded; inspect the legacy publication and request a new review');
  if (!Array.isArray(op.tickets) || op.tickets.length < 1 || op.tickets.length > 12 || op.tickets.some(ticket => !ticket || typeof ticket.key !== 'string' || typeof ticket.id !== 'string' || typeof ticket.markdown !== 'string' || !Array.isArray(ticket.dependencies) || ticket.dependencies.some(dependency => typeof dependency !== 'string') || (ticket.stage !== undefined && typeof ticket.stage !== 'string')) || new Set(op.tickets.map(ticket => ticket.id)).size !== op.tickets.length || !op.externalRevisions || typeof op.externalRevisions !== 'object' || Array.isArray(op.externalRevisions) || Object.values(op.externalRevisions).some(value => typeof value !== 'string')) throw new HttpError(409, 'Publication journal ticket manifest is invalid');
  if (!op.payloadHash || payloadHash(op) !== op.payloadHash) throw new HttpError(409, 'Publication journal payload identity is invalid');
  const base = join(op.repoPath, '.omp-backlog');
  for (const ticket of op.tickets) {
    if (!validTicketId(ticket.id) || validateCompleteTicket(ticket.markdown, []).id !== ticket.id) throw new HttpError(409, 'Publication journal ticket identity is invalid');
    if (ticket.stage && (dirname(ticket.stage) !== base || !/^\.batch-stage-[a-f0-9]{64}$/.test(basename(ticket.stage)))) throw new HttpError(409, 'Publication journal staging location is invalid');
    const identity = [ticket.dev, ticket.ino, ticket.birthtimeMs];
    if (identity.some(value => value !== undefined) && (!ticket.stage || identity.some(value => typeof value !== 'number' || !Number.isFinite(value)))) throw new HttpError(409, 'Publication journal staging identity is incomplete');
  }
}
async function checkRootIdentity(repo: Repo, expected: NonNullable<BatchOperation['rootIdentity']>): Promise<void> {
  await safePath(repo.path, repo.path);
  const info = await lstat(repo.path);
  if (!info.isDirectory() || info.dev !== expected.dev || info.ino !== expected.ino || info.birthtimeMs !== expected.birthtimeMs) throw new HttpError(409, 'Repository root identity changed; restore the reviewed repository before recovery');
}
export function previewBatch(store: Store, repo: Repo, id: string, input: Record<string, unknown>): Promise<BatchOperation> {
  return serializeWrite(store, async () => {
    await reconcileTickets(store, true);
    const { review, set } = checkReview(store, repo, id, input);
    const base = join(repo.path, '.omp-backlog', 'tickets');
    const root = await lstat(repo.path);
    if (!root.isDirectory() || !root.birthtimeMs || !root.dev || !root.ino) throw new HttpError(409, 'Repository root identity cannot be recorded safely');
    const rootIdentity = { dev: root.dev, ino: root.ino, birthtimeMs: root.birthtimeMs };
    await safePath(repo.path, base, true);
    let entries: string[] = [];
    try { entries = await readdir(base); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    checkReview(store, repo, id, input);
    const latest = store.get('repos', repo.id);
    database(store).query("UPDATE records SET value=json_set(value,'$.invalidated',json('true'),'$.compacted',json('true'),'$.tickets',json('[]')) WHERE kind='batchOperations' AND id IN (SELECT DISTINCT operation_id FROM batch_reservations WHERE state='prepared' AND expires<=? LIMIT 128)").run(Date.now());
    const activePreviews = database(store).query<{ count: number }, [string, string, number]>("SELECT count(DISTINCT r.operation_id) AS count FROM batch_reservations r JOIN records x ON x.kind='batchOperations' AND x.id=r.operation_id WHERE r.repo_path=? AND json_extract(x.value,'$.workspaceId')=? AND (r.state IN ('publishing','blocked') OR (r.state='prepared' AND r.expires>?))").get(repo.path, id, Date.now());
    if ((activePreviews?.count ?? 0) >= 64) throw new HttpError(429, 'Too many outstanding publication operations; recover or inspect them, or wait for previews to expire');
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
    const operation: BatchOperation = { id: token(), repoId: repo.id, repoPath: repo.path, rootIdentity, workspaceId: id, reviewId: review.id, reviewVersion: review.version, proposalSetId: set.id, workspaceVersion: input.version as number, sourcePlanRevisionId: set.sourcePlanRevisionId, payloadHash: '', externalRevisions: externalGraph(store, repo, tickets), mode: latest.mode, expires: Date.now() + 600000, acknowledgeStalePlan: input.acknowledgeStalePlan as boolean, state: 'prepared', tickets };
    await checkRootIdentity(repo, rootIdentity);
    operation.payloadHash = payloadHash(operation);
    store.save('batchOperations', operation); return operation;
  });
}
export function operationFor(store: Store, repo: Repo, workspaceId: string, confirmation: string): BatchOperation {
  const operation = store.get('batchOperations', confirmation);
  if (!operation || operation.repoId !== repo.id || operation.repoPath !== repo.path || operation.workspaceId !== workspaceId) throw new HttpError(404, 'Batch operation not found');
  return operation;
}
export function publicOperation(operation: BatchOperation, store: Store) {
  const source = store.get('agentWorkspaces', operation.workspaceId);
  const review = source?.repoId === operation.repoId && source.repoPath === operation.repoPath ? source.batchReview : null;
  const proposalSetId = operation.proposalSetId ?? (review?.id === operation.reviewId ? review.proposalSetId : null);
  return { confirmation: operation.id, publicationId: operation.id, workspaceId: operation.workspaceId, reviewId: operation.reviewId, reviewVersion: operation.reviewVersion, proposalSetId, sourcePlanRevisionId: operation.sourcePlanRevisionId, state: operation.state, phase: operation.phase, mode: operation.mode, expires: operation.expires, error: operation.error, compacted: operation.compacted ?? false, tickets: operation.tickets.map(({ key, id, markdown, dependencies, revision }) => ({ key, id, markdown, dependencies, ...(revision ? { revision } : {}) })) };
}

export function ticketPublications(store: Store, repo: Repo, ticketId: string) {
  const rows = database(store).query<{ value: string }, [string, string, string]>("SELECT value FROM records WHERE kind='batchOperations' AND json_extract(value,'$.state')='complete' AND json_extract(value,'$.repoId')=? AND json_extract(value,'$.repoPath')=? AND EXISTS (SELECT 1 FROM json_each(records.value,'$.tickets') item WHERE json_extract(item.value,'$.id')=?) ORDER BY rowid DESC").all(repo.id, repo.path, ticketId);
  return rows.map(row => {
    const operation = publicOperation(JSON.parse(row.value) as BatchOperation, store);
    const ticket = operation.tickets.find(item => item.id === ticketId)!;
    return { publicationId: operation.publicationId, workspaceId: operation.workspaceId, reviewId: operation.reviewId, reviewVersion: operation.reviewVersion, proposalSetId: operation.proposalSetId, sourcePlanRevisionId: operation.sourcePlanRevisionId, taskKey: ticket.key, dependencies: ticket.dependencies, originalRevision: ticket.revision ?? null };
  });
}
type DirectoryInspection = {
  status: 'missing' | 'match' | 'mismatch' | 'unproven';
  identity: { dev: number; ino: number; birthtimeMs: number } | null;
  expectedIdentity: { dev: number; ino: number; birthtimeMs: number } | null;
  files: { status: 'match' | 'missing' | 'mismatch' | 'unexpected'; details: string[] };
};

async function inspectDirectory(repo: Repo, path: string | undefined, ticket: BatchOperation['tickets'][number]): Promise<DirectoryInspection> {
  const expectedIdentity = ticket.dev !== undefined && ticket.ino !== undefined && ticket.birthtimeMs !== undefined
    ? { dev: ticket.dev, ino: ticket.ino, birthtimeMs: ticket.birthtimeMs } : null;
  const result: DirectoryInspection = { status: 'missing', identity: null, expectedIdentity, files: { status: 'missing', details: ['Directory is missing'] } };
  if (!path) return result;
  try {
    await safePath(repo.path, path);
    const info = await lstat(path);
    result.identity = { dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs };
    result.status = !expectedIdentity ? 'unproven' : info.isDirectory() && info.dev === expectedIdentity.dev && info.ino === expectedIdentity.ino && info.birthtimeMs === expectedIdentity.birthtimeMs ? 'match' : 'mismatch';
    if (!info.isDirectory()) { result.files = { status: 'mismatch', details: ['Not a directory'] }; return result; }
    const entries = await readdir(path);
    const unexpected = entries.filter(entry => entry !== 'ticket.md');
    const details = unexpected.map(name => `Unexpected entry: ${name}`);
    if (!entries.includes('ticket.md')) {
      details.push('ticket.md is missing');
      result.files = { status: unexpected.length ? 'unexpected' : 'missing', details };
      return result;
    }
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readSafe(repo.path, join(path, 'ticket.md'), MAX_MARKDOWN));
    if (markdown !== ticket.markdown) details.push('ticket.md differs from the confirmed Markdown');
    result.files = { status: unexpected.length ? 'unexpected' : markdown === ticket.markdown ? 'match' : 'mismatch', details };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT' && !result.identity) return result;
    result.status = 'mismatch';
    result.files = { status: 'mismatch', details: ['Directory or ticket.md cannot be inspected safely'] };
  }
  return result;
}

async function inspectOperation(store: Store, repo: Repo, op: BatchOperation) {
  const reasons: string[] = [];
  if (op.state !== 'publishing' && op.state !== 'blocked') reasons.push('Only an interrupted or blocked publication can be recovered');
  try { validateJournal(op); } catch (error) { return { confirmation: op.id, state: op.state, safeToResume: false, reasons: [error instanceof Error ? error.message : 'Publication journal is invalid'], tickets: [] }; }
  const latest = store.get('repos', repo.id);
  if (!latest || latest.path !== op.repoPath || latest.mode !== op.mode) reasons.push('Project path or execution mode changed');
  try { await checkRootIdentity(repo, op.rootIdentity!); }
  catch { reasons.push('Repository root identity changed or cannot be inspected; restore the reviewed repository'); }
  try {
    if (JSON.stringify(externalGraph(store, repo, op.tickets)) !== JSON.stringify(op.externalRevisions)) reasons.push('An existing dependency changed since preview');
  } catch (error) { reasons.push(error instanceof Error ? error.message : 'Dependency inspection failed'); }
  for (const [id, revision] of Object.entries(op.externalRevisions)) {
    try { if ((await readTicket(repo, id)).revision !== revision) reasons.push(`Existing dependency ${id} changed on disk`); }
    catch { reasons.push(`Existing dependency ${id} cannot be read safely`); }
  }
  const base = join(repo.path, '.omp-backlog');
  const tickets = [];
  for (const ticket of op.tickets) {
    const validStage = !ticket.stage || dirname(ticket.stage) === base && /^\.batch-stage-[a-f0-9]{64}$/.test(basename(ticket.stage));
    const stage = await inspectDirectory(repo, validStage ? ticket.stage : undefined, ticket);
    if (!validStage) { stage.status = 'mismatch'; stage.files = { status: 'mismatch', details: ['Journaled staging location is invalid'] }; }
    const published = await inspectDirectory(repo, join(base, 'tickets', ticket.id), ticket);
    const clean = (item: DirectoryInspection) => item.status === 'match' && item.files.status === 'match';
    let status: 'not_started' | 'staged' | 'published' | 'ambiguous' = 'ambiguous';
    if (stage.status === 'missing' && published.status === 'missing' && !stage.expectedIdentity && validStage) status = 'not_started';
    else if (clean(stage) && published.status === 'missing') status = 'staged';
    else if (stage.status === 'missing' && clean(published)) status = 'published';
    if (status === 'ambiguous') reasons.push(`${ticket.id}: directory identity or payload cannot be proven; inspect without overwriting or deleting files`);
    tickets.push({ id: ticket.id, key: ticket.key, status, expectedRevision: validateCompleteTicket(ticket.markdown, []).revision, stage, published });
  }
  return { confirmation: op.id, state: op.state, safeToResume: reasons.length === 0, reasons, tickets };
}

export function inspectBatch(store: Store, repo: Repo, workspaceId: string, confirmation: string) {
  return serializeWrite(store, () => inspectOperation(store, repo, operationFor(store, repo, workspaceId, confirmation)));
}

export function recoverBatch(store: Store, repo: Repo, workspaceId: string, confirmation: string, fault?: (stage: string) => void) {
  return publishBatch(store, repo, workspaceId, confirmation, fault, true);
}
export function publishBatch(store: Store, repo: Repo, workspaceId: string, confirmation: string, fault?: (stage: string) => void, recovery = false): Promise<BatchOperation> {
  return serializeWrite(store, async () => {
    const op = operationFor(store, repo, workspaceId, confirmation);
    let injecting = false;
    const checkpoint = (stage: string) => { if (fault) { injecting = true; fault(stage); injecting = false; } };
    const checkAuthority = () => {
      validateJournal(op);
      if (JSON.stringify(externalGraph(store, repo, op.tickets)) !== JSON.stringify(op.externalRevisions)) throw new HttpError(409, 'An existing dependency changed since preview');
      if (op.state === 'prepared') checkReview(store, repo, workspaceId, { version: op.workspaceVersion, reviewId: op.reviewId, reviewVersion: op.reviewVersion, acknowledgeStalePlan: op.acknowledgeStalePlan });
      const latest = store.get('repos', repo.id);
      if (!latest || latest.path !== repo.path || latest.mode !== op.mode) throw new HttpError(409, 'Reviewed workspace or project mode changed');
    };
    if (op.state === 'complete') return op;
    if (op.state === 'prepared' && (op.invalidated || op.expires <= Date.now())) {
      if (!op.invalidated) { op.invalidated = true; op.compacted = true; op.tickets = []; store.save('batchOperations', op); }
      throw new HttpError(409, 'Review expired');
    }
    validateJournal(op);
    await checkRootIdentity(repo, op.rootIdentity!);
    if (op.state !== 'prepared' && !recovery) throw new HttpError(409, 'Publication needs operator inspection and explicit recovery');
    await reconcileTickets(store, true);
    if (recovery) {
      const inspection = await inspectOperation(store, repo, op);
      if (!inspection.safeToResume) throw new HttpError(409, `Publication cannot safely resume: ${inspection.reasons.join('; ')}`);
      op.state = 'publishing'; delete op.error; store.save('batchOperations', op);
    }
    if (op.state === 'prepared') {
      await checkRootIdentity(repo, op.rootIdentity!);
      checkAuthority();
      op.state = 'publishing'; op.phase = 'staging'; store.save('batchOperations', op);
      checkpoint('gate');
    }
    const base = join(repo.path, '.omp-backlog'); const tickets = join(base, 'tickets');
    try {
      await checkRootIdentity(repo, op.rootIdentity!);
      await safePath(repo.path, tickets, true); await mkdir(tickets, { recursive: true, mode: 0o700 }); await safePath(repo.path, tickets);
      const parent = await open(tickets, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try {
        for (const ticket of op.tickets) {
          await checkRootIdentity(repo, op.rootIdentity!);
          if (!ticket.stage) {
            ticket.stage = join(base, `.batch-stage-${token()}`);
            store.save('batchOperations', op);
            checkpoint('reserved');
          }
          if (ticket.dev === undefined) {
            await mkdir(ticket.stage, { mode: 0o700 });
            const file = await open(join(ticket.stage, 'ticket.md'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try {
              if (fault) {
                const bytes = Buffer.from(ticket.markdown);
                const split = Math.ceil(bytes.length / 2);
                await file.writeFile(bytes.subarray(0, split));
                checkpoint('mid-write');
                await file.writeFile(bytes.subarray(split));
              } else await file.writeFile(ticket.markdown);
              await file.sync();
            } finally { await file.close(); }
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
            await checkRootIdentity(repo, op.rootIdentity!);
            checkAuthority();
            op.phase = 'publishing'; store.save('batchOperations', op);
            atomicPublish(ticket.stage!, parent.fd, ticket.id);
            checkpoint('renamed');
          }
          const inspected = await inspectDirectory(repo, dest, ticket);
          if (inspected.status !== 'match' || inspected.files.status !== 'match') throw new Error('Published directory identity or payload changed');
          await parent.sync();
          const stagingParent = await open(base, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { await stagingParent.sync(); } finally { await stagingParent.close(); }
          checkpoint('synced');
        }
      } finally { await parent.close(); }
      op.phase = 'reconciling'; store.save('batchOperations', op);
      await reconcileTickets(store, true);
      checkpoint('reconciled');
      checkpoint('before-activation');
      await reconcileTickets(store, true);
      for (const ticket of op.tickets) {
        const current = store.get('tickets', `${repo.id}/${ticket.id}`);
        if (!current || current.error || current.revision !== validateCompleteTicket(ticket.markdown, []).revision) throw new Error('Published ticket changed or failed validation');
        const inspected = await inspectDirectory(repo, join(tickets, ticket.id), ticket);
        if (inspected.status !== 'match' || inspected.files.status !== 'match') throw new Error('Published ticket directory identity or payload changed before activation');
      }
      await checkRootIdentity(repo, op.rootIdentity!);
      checkAuthority();
      op.state = 'complete';
      const completed = { ...op, compacted: true, tickets: op.tickets.map(({ key, id, dependencies, markdown }) => ({ key, id, dependencies, revision: digest(markdown + '\0[]'), markdown: '' })) };
      store.save('batchOperations', completed);
      checkpoint('after-activation');
      return completed;
    } catch (error) {
      if (injecting) throw error;
      op.state = 'blocked'; op.error = error instanceof Error ? error.message : 'Unknown publication failure'; store.save('batchOperations', op);
      throw new HttpError(409, `Batch publication requires operator inspection: ${error instanceof Error ? error.message : 'unknown failure'}`);
    }
  });
}
