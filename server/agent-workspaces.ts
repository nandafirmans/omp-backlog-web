import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentWorkspace, AgentWorkspaceRecord, AgentWorkspaceSnapshot, AgentWorkspaceSummary, WorkspaceTurnReceipt } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import type { DraftContext, DraftSnapshot, DraftTurnOptions } from './drafting-contracts';
import { createWorkspaceDraft, handleDraftRequest, readDraftBody, workspaceDraftSnapshot } from './drafting';
import { groupMembers, identity } from './process-identity';
import { database, digest } from './store';
import { HttpError, MAX_ATTACHMENTS_TOTAL } from './tickets';
import { researchRepository } from './agent-research';
import { EXTRACTION_LIMITS, extractionInstruction, validateTaskExtraction } from './task-extraction';
import { inspectBatch, operationFor, previewBatch, publicOperation, publishBatch, recoverBatch, saveBatchReview } from './batch-publication';

export const WORKSPACE_LIMITS = { perRepo: 16, global: 64, revisions: 32, editorBytes: 256 * 1024, planBytes: 32 * 1024, historyBytes: 512 * 1024, messages: 128, turns: 64, contextBytes: 64 * 1024, contextMessages: 12 } as const;
const live = new Map<string, { store: Store; draftId: string }>();
const operations = new Set<string>();
const accepted = new Map<string, { key: string; hash: string }>();
const keyFor = (store: Store, id: string) => `${store.dataDir}/${id}`;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const bytes = (value: string) => Buffer.byteLength(value);
interface TurnReceipt { request: Request; key: string; hash: string }

function record(store: Store, repo: Repo, id: string): AgentWorkspaceRecord {
  const value = store.get('agentWorkspaces', id);
  if (!value || value.repoId !== repo.id || value.repoPath !== repo.path) throw new HttpError(404, 'Agent workspace not found for this repository');
  value.proposalSets ??= []; value.researchReferences ??= []; value.researchResults ??= []; value.extraction ??= null; value.rejectedTurns ??= [];
  value.acceptedTurns.forEach((turn, index) => {
    if (turn.status) return;
    turn.userMessageIndex = index * 2; turn.assistantMessageIndex = index * 2 + 1;
    const message = value.messages[turn.assistantMessageIndex];
    turn.status = message?.status === 'partial' ? 'accepted' : message?.status === 'complete' ? 'complete' : 'failed';
    turn.intent = 'ticket_drafting'; turn.sourceWorkspaceId = value.id; turn.legacyContextUnavailable = true;
  });
  return value;
}
function publicWorkspace(value: AgentWorkspaceRecord): AgentWorkspace {
  return {
    id: value.id, repoId: value.repoId, title: value.title, createdAt: value.createdAt,
    updatedAt: value.updatedAt, archived: value.archived, version: value.version,
    prompt: value.prompt, ticketMarkdown: value.ticketMarkdown,
    currentPlanRevisionId: value.currentPlanRevisionId, planRevisions: value.planRevisions,
    messages: value.messages, model: value.model, thinking: value.thinking,
    proposalSets: value.proposalSets, researchReferences: value.researchReferences, extraction: value.extraction,
    batchReview: value.batchReview ?? null,
  };
}
function summary(value: AgentWorkspaceRecord): AgentWorkspaceSummary {
  const { id, repoId, title, createdAt, updatedAt, archived, version } = value;
  return { id, repoId, title, createdAt, updatedAt, archived, version };
}
function native(store: Store, repo: Repo, id: string): DraftSnapshot | null {
  const binding = live.get(keyFor(store, id));
  return binding?.store === store ? workspaceDraftSnapshot(store, repo, binding.draftId) : null;
}
function snapshot(store: Store, repo: Repo, id: string): AgentWorkspaceSnapshot {
  const draft = native(store, repo, id);
  const value = record(store, repo, id);
  if (!draft && value.messages.some(message => message.status === 'partial')) {
    value.messages = value.messages.map(message => message.status === 'partial' ? { ...message, status: 'failed' } : message);
    settleTurns(value, 'Native session disconnected before completion; no inference was replayed.');
    value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
  }
  const rows = database(store).query<{ value: string }, [string, string, string, number]>("SELECT value FROM records WHERE kind='batchOperations' AND json_extract(value,'$.repoId')=? AND json_extract(value,'$.repoPath')=? AND json_extract(value,'$.workspaceId')=? ORDER BY CASE WHEN json_extract(value,'$.state') IN ('publishing','blocked') OR (json_extract(value,'$.state')='prepared' AND coalesce(json_extract(value,'$.invalidated'),0)=0 AND json_extract(value,'$.expires')>?) THEN 0 ELSE 1 END, rowid DESC LIMIT 128").all(repo.id, repo.path, id, Date.now());
  return { workspace: publicWorkspace(value), draft, batchOperations: rows.reverse().map(row => publicOperation(JSON.parse(row.value), store)) };
}
function detached(value: AgentWorkspaceRecord): DraftSnapshot {
  return { id: value.id, status: 'stopped', models: [], model: value.model, thinking: value.thinking, thinkingLevels: [], messages: value.messages, error: 'No native session is connected. Saved text is retained; Connect never replays inference.' };
}
async function payload(request: Request, fields: string[]): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(400, 'Expected JSON object');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readDraftBody(request, 2 * WORKSPACE_LIMITS.editorBytes + 4096))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Invalid workspace JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !fields.includes(field))) throw new HttpError(400, 'Unsupported workspace fields');
  return value as Record<string, unknown>;
}
function editorLimit(value: AgentWorkspaceRecord): void {
  if (bytes(value.prompt) > 32768 || value.planRevisions.some(revision => bytes(revision.markdown) > WORKSPACE_LIMITS.planBytes)
    || bytes(value.title) + bytes(value.prompt) + bytes(value.ticketMarkdown) + value.planRevisions.reduce((total, revision) => total + bytes(revision.markdown), 0) > WORKSPACE_LIMITS.editorBytes) throw new HttpError(413, 'Workspace editor text exceeds its 256 KiB total, 32 KiB prompt or 32 KiB plan limit; saved text was not changed');
}
function savedContext(value: AgentWorkspaceRecord, includeHistory: boolean, turn: DraftTurnOptions): { message: string; context: DraftContext; instruction?: string } {
  const plan = value.planRevisions.find(revision => revision.id === value.currentPlanRevisionId);
  const messages = includeHistory ? value.messages.slice(-WORKSPACE_LIMITS.contextMessages).map(message => ({ ...message })) : [];
  const data = { plan: plan ? { id: plan.id, markdown: plan.markdown, approved: plan.approvedAt !== undefined } : null, messages, research: value.researchResults };
  const encoded = () => JSON.stringify(data).replaceAll('@', '\\u0040').replaceAll('^', '\\u005e');
  while (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes && messages.length) messages.shift();
  let planTruncated = false;
  while (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes && data.plan && data.plan.markdown.length) {
    data.plan.markdown = data.plan.markdown.slice(0, Math.floor(data.plan.markdown.length / 2));
    planTruncated = true;
  }
  if (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes) throw new HttpError(413, 'Saved research exceeds the bounded encoded context; nothing was sent');
  const message = encoded();
  const instruction = turn.intent === 'task_extraction' ? extractionInstruction({ workspaceId: value.id, planRevisionId: value.currentPlanRevisionId, strategy: turn.strategy!, referenceIds: value.researchReferences.map(reference => reference.id) }) : undefined;
  const omitted = value.messages.length - messages.length;
  return { message, instruction, context: { key: 'workspace:history', label: 'Saved discussion, plan and host research', status: 'ready', detail: `${includeHistory ? `Seeds ${messages.length} latest saved messages on the next Send; ${omitted} older/oversized messages omitted` : 'Conversation already seeded in this native session; saved messages are not retransmitted'}. Supplies the current plan and explicitly retrieved research as untrusted JSON, at most 64 KiB total (plan at most 32 KiB); plan ${planTruncated ? 'truncated to fit encoded context' : 'supplied in full'}; no hidden summary. Previously transmitted image bytes and old file contents are not replayed. The native session retains its own already-sent turns until disconnected.` } };
}
function settleTurns(value: AgentWorkspaceRecord, disconnectedError?: string): void {
  for (const turn of value.acceptedTurns) {
    if (turn.status !== 'accepted') continue;
    const message = value.messages[turn.assistantMessageIndex];
    if (!disconnectedError && message?.status === 'partial') continue;
    if (message?.status !== 'complete') {
      turn.status = 'failed'; turn.error = disconnectedError || 'Native turn failed; no automatic retry was performed.';
      if (turn.intent === 'task_extraction') value.extraction = { key: turn.key, status: 'failed', error: turn.error };
      continue;
    }
    turn.status = 'complete';
    if (turn.intent !== 'task_extraction') continue;
    try {
      const payload = validateTaskExtraction(message.text, { workspaceId: value.id, planRevisionId: turn.sourcePlanRevisionId, strategy: turn.strategy!, referenceIds: turn.researchReferenceIds });
      if (value.proposalSets.length >= EXTRACTION_LIMITS.sets || bytes(JSON.stringify(value.proposalSets)) + bytes(JSON.stringify(payload)) + bytes(JSON.stringify(value.researchReferences)) > EXTRACTION_LIMITS.storedBytes) throw new Error('Proposal set storage limit reached; previous sets were retained.');
      const set = { id: crypto.randomUUID(), strategy: payload.strategy, sourceWorkspaceId: value.id, sourcePlanRevisionId: turn.sourcePlanRevisionId, createdAt: Date.now(), validationStatus: 'valid' as const, payload, researchReferences: structuredClone(value.researchReferences.filter(reference => turn.researchReferenceIds.includes(reference.id))) };
      value.proposalSets.push(set); turn.proposalSetId = set.id;
      value.extraction = { key: turn.key, status: 'valid', proposalSetId: set.id };
    } catch (error) {
      turn.status = 'failed'; turn.error = error instanceof Error ? error.message : 'Task extraction validation failed; previous sets were retained.';
      value.extraction = { key: turn.key, status: 'failed', error: turn.error };
    }
  }
}
function saveNative(store: Store, repo: Repo, id: string, draft: DraftSnapshot): void {
  const value = record(store, repo, id);
  value.messages = structuredClone(draft.messages);
  if (draft.model) {
    if (value.model && (value.model.provider !== draft.model.provider || value.model.id !== draft.model.id || value.thinking !== draft.thinking)) value.version++;
    value.model = { ...draft.model }; value.thinking = draft.thinking;
  }
  settleTurns(value);
  value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
}

export async function assertWorkspaceOwners(store: Store): Promise<void> {
  const directory = join(store.dataDir, 'agent-workspace-owners');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(directory)) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -5);
    const binding = live.get(keyFor(store, id));
    if (binding?.store === store) continue;
    const path = join(directory, entry);
    try {
      const owner = JSON.parse(await readFile(path, 'utf8')) as { pid?: number; start?: string; boot?: string };
      if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) < 1 || !owner.start || !owner.boot) throw new Error('Uncertain launch identity');
      const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      if (owner.boot === boot && (await groupMembers(owner.pid!)).length) throw new Error('Surviving process group');
      await rm(path);
    } catch { throw new HttpError(503, 'A prior native workspace child may still exist. Reconnect is blocked until its process-group exit is confirmed; no work was attached, replayed or signalled. Inspect the backend private owner records if launch identity is uncertain.'); }
  }
}
async function connect(store: Store, repo: Repo, id: string): Promise<AgentWorkspaceSnapshot> {
  const existing = native(store, repo, id);
  if (existing) return snapshot(store, repo, id);
  snapshot(store, repo, id);
  const value = record(store, repo, id);
  if (value.archived) throw new HttpError(409, 'Unarchive this workspace before connecting');
  await assertWorkspaceOwners(store);
  const lease = join(store.dataDir, 'agent-workspace-owners', `${id}.json`);
  const reservation = await open(lease, 'wx', 0o600).catch(() => { throw new HttpError(409, 'Workspace native ownership is already reserved'); });
  try { await reservation.writeFile(JSON.stringify({ pending: true })); } finally { await reservation.close(); }
  let spawnedPid: number | undefined;
  let seeded = false;
  try {
    const draft = await createWorkspaceDraft(store, repo, {
      messages: value.messages, model: value.model, thinking: value.thinking,
      context: turn => savedContext(record(store, repo, id), !seeded, turn),
      validateTurn: (prompt, turn) => {
        const current = record(store, repo, id);
        if (current.archived) throw new HttpError(409, 'Archived workspace cannot send');
        if (turn.contextVersion !== undefined && turn.contextVersion !== current.version) throw new HttpError(409, 'Saved workspace context changed; nothing was accepted. Discard this unaccepted request and prepare a new explicit action.');
        if (turn.intent === 'task_extraction' && (current.proposalSets.length >= EXTRACTION_LIMITS.sets || bytes(JSON.stringify(current.proposalSets)) + EXTRACTION_LIMITS.payloadBytes > EXTRACTION_LIMITS.storedBytes)) throw new HttpError(413, 'Proposal set storage limit reached; saved sets were retained');
        if (current.acceptedTurns.length >= WORKSPACE_LIMITS.turns || current.messages.length + 2 > WORKSPACE_LIMITS.messages
          || current.messages.reduce((total, message) => total + bytes(message.text), 0) + bytes(prompt) + 256 * 1024 > WORKSPACE_LIMITS.historyBytes) throw new HttpError(413, 'Workspace history limit reached; saved history is retained. Create another workspace to continue.');
      },
      acceptTurn: (draft, turn) => {
        const receipt = accepted.get(keyFor(store, id));
        if (!receipt) throw new HttpError(409, 'Turn has no idempotency reservation');
        store.transaction(() => {
          const current = record(store, repo, id);
          const acceptedTurn: WorkspaceTurnReceipt = { ...receipt, contextHash: turn.contextHash, contextVersion: current.version, acceptedAt: Date.now(), intent: turn.intent, ...(turn.strategy ? { strategy: turn.strategy } : {}), sourceWorkspaceId: id, sourcePlanRevisionId: current.currentPlanRevisionId, model: structuredClone(draft.model), thinking: draft.thinking, researchReferenceIds: current.researchReferences.map(reference => reference.id), userMessageIndex: draft.messages.length - 2, assistantMessageIndex: draft.messages.length - 1, status: 'accepted' };
          current.acceptedTurns.push(acceptedTurn);
          if (turn.intent === 'task_extraction') current.extraction = { key: receipt.key, status: 'pending' };
          store.save('agentWorkspaces', current);
          saveNative(store, repo, id, draft);
        });
        seeded = true;
      },
      changed: draft => saveNative(store, repo, id, draft),
      spawned: async pid => {
        spawnedPid = pid;
        const owner = await identity(pid);
        await writeFile(`${lease}.tmp`, JSON.stringify(owner), { mode: 0o600 }); await rename(`${lease}.tmp`, lease);
      },
      stopped: async () => {
        if (spawnedPid && (await groupMembers(spawnedPid)).length) throw new Error('Native process-group exit is not confirmed');
        await rm(lease, { force: true });
      },
    });
    live.set(keyFor(store, id), { store, draftId: draft.id });
    if (draft.status === 'failed') return { workspace: publicWorkspace(record(store, repo, id)), draft };
    return snapshot(store, repo, id);
  } finally { if (!spawnedPid) await rm(lease, { force: true }); }
}

async function turnReceipt(request: Request): Promise<TurnReceipt> {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new HttpError(400, 'Send requires an Idempotency-Key of 16–128 letters, digits, underscores or hyphens; reuse it only when retrying that same Send');
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(400, 'Expected multipart draft context');
  const body = await readDraftBody(request, MAX_ATTACHMENTS_TOTAL + 1024 * 1024);
  let form: FormData;
  try { form = await new Response(body, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new HttpError(400, 'Invalid multipart draft context'); }
  const fields: unknown[] = [];
  for (const [name, value] of form) fields.push(typeof value === 'string' ? [name, value] : [name, value.name, value.type, value.size, digest(new Uint8Array(await value.arrayBuffer()))]);
  return { request: new Request(request.url, { method: 'POST', headers: request.headers, body }), key, hash: digest(JSON.stringify(fields)) };
}

export async function handleAgentWorkspaceRequest(store: Store, repo: Repo, request: Request, segments: string[]): Promise<Response> {
  const id = segments[4]; const action = segments[5];
  if (segments.length === 4 && request.method === 'GET') return json(store.list('agentWorkspaces').filter(value => value.repoId === repo.id && value.repoPath === repo.path).sort((a, b) => b.updatedAt - a.updatedAt).map(summary));
  if (segments.length === 4 && request.method === 'POST') {
    const input = await payload(request, ['title']);
    if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || bytes(input.title) > 200)) throw new HttpError(400, 'Workspace title must be nonempty text no larger than 200 bytes');
    const workspace = store.transaction(() => {
      const all = store.list('agentWorkspaces');
      if (all.length >= WORKSPACE_LIMITS.global || all.filter(value => value.repoId === repo.id).length >= WORKSPACE_LIMITS.perRepo) throw new HttpError(429, 'Workspace count limit reached (16 per repository, 64 global, including archived); existing workspaces were retained');
      const now = Date.now();
      const value: AgentWorkspaceRecord = { id: crypto.randomUUID(), repoId: repo.id, repoPath: repo.path, title: typeof input.title === 'string' ? input.title.trim() : 'Untitled workspace', createdAt: now, updatedAt: now, archived: false, version: 1, prompt: '', ticketMarkdown: '', currentPlanRevisionId: null, planRevisions: [], messages: [], model: null, thinking: '', acceptedTurns: [], rejectedTurns: [], researchReferences: [], researchResults: [], proposalSets: [], extraction: null };
      store.save('agentWorkspaces', value); return value;
    });
    return json({ workspace: publicWorkspace(workspace), draft: null }, 201);
  }
  record(store, repo, id || '');
  if (segments.length === 6 && action === 'batch-review' && request.method === 'PUT') {
    const input = await payload(request, ['version', 'reviewVersion', 'proposalSetId', 'proposals', 'selectedKeys']);
    const review = saveBatchReview(store, repo, id!, input);
    return json({ ...snapshot(store, repo, id!), review });
  }
  if (segments.length === 7 && action === 'batch-operations' && request.method === 'GET') return json(publicOperation(operationFor(store, repo, id!, segments[6]!), store));
  if (segments.length === 8 && action === 'batch-operations' && segments[7] === 'inspect' && request.method === 'GET') return json(await inspectBatch(store, repo, id!, segments[6]!));
  if (segments.length === 8 && action === 'batch-operations' && segments[7] === 'recover' && request.method === 'POST') {
    const input = await payload(request, ['confirm']);
    if (input.confirm !== true) throw new HttpError(400, 'Explicit recovery confirmation is required');
    return json(publicOperation(await recoverBatch(store, repo, id!, segments[6]!), store));
  }
  if (segments.length === 6 && action === 'batch-preview' && request.method === 'POST') {
    const input = await payload(request, ['version', 'reviewId', 'reviewVersion', 'acknowledgeStalePlan']);
    return json(publicOperation(await previewBatch(store, repo, id!, input), store));
  }
  if (segments.length === 6 && action === 'batch-publish' && request.method === 'POST') {
    const input = await payload(request, ['confirmation']);
    if (typeof input.confirmation !== 'string') throw new HttpError(400, 'Confirmation is required');
    return json(publicOperation(await publishBatch(store, repo, id!, input.confirmation), store));
  }
  if (segments.length === 5 && request.method === 'GET') return json(snapshot(store, repo, id!));
  if (segments.length === 7 && action === 'turns' && request.method === 'GET') {
    snapshot(store, repo, id!);
    const value = record(store, repo, id!);
    const turn = value.acceptedTurns.find(turn => turn.key === segments[6]);
    if (!turn) return json(value.rejectedTurns.includes(segments[6]!) ? { accepted: false, resolved: true, status: 'rejected' } : { accepted: false });
    const receipt: Omit<WorkspaceTurnReceipt, 'hash'> & { hash?: string } = { ...turn };
    delete receipt.hash;
    return json({ accepted: true, receipt });
  }
  if (segments.length === 5 && request.method === 'PATCH') {
    const input = await payload(request, ['version', 'title', 'archived', 'prompt', 'ticketMarkdown', 'planMarkdown', 'approvePlanRevisionId']);
    if (!Number.isSafeInteger(input.version)) throw new HttpError(400, 'A workspace editor version is required');
    for (const field of ['title', 'prompt', 'ticketMarkdown', 'planMarkdown', 'approvePlanRevisionId']) if (input[field] !== undefined && typeof input[field] !== 'string') throw new HttpError(400, `${field} must be text`);
    if (input.archived !== undefined && typeof input.archived !== 'boolean') throw new HttpError(400, 'archived must be boolean');
    if (typeof input.title === 'string' && (!input.title.trim() || bytes(input.title) > 200)) throw new HttpError(400, 'Workspace title must be nonempty text no larger than 200 bytes');
    const operationKey = keyFor(store, id!);
    if (operations.has(operationKey)) throw new HttpError(409, 'Wait for the active workspace operation');
    store.transaction(() => {
      const value = record(store, repo, id!);
      if (value.version !== input.version) throw new HttpError(409, 'Workspace changed in another editor; reload before saving');
      if (input.archived === true && native(store, repo, id!)?.status === 'busy') throw new HttpError(409, 'Stop the native turn explicitly before archiving');
      if (typeof input.title === 'string') value.title = input.title.trim();
      if (typeof input.archived === 'boolean') value.archived = input.archived;
      if (typeof input.prompt === 'string') value.prompt = input.prompt;
      if (typeof input.ticketMarkdown === 'string') value.ticketMarkdown = input.ticketMarkdown;
      if (typeof input.planMarkdown === 'string') {
        const current = value.planRevisions.find(revision => revision.id === value.currentPlanRevisionId);
        if (current?.markdown !== input.planMarkdown) {
          if (value.planRevisions.length >= WORKSPACE_LIMITS.revisions) throw new HttpError(413, 'Plan revision limit reached; prior revisions were retained');
          const revision = { id: crypto.randomUUID(), revisionHash: digest(input.planMarkdown), markdown: input.planMarkdown, createdAt: Date.now() };
          value.planRevisions.push(revision); value.currentPlanRevisionId = revision.id;
        }
      }
      if (typeof input.approvePlanRevisionId === 'string') {
        const current = value.planRevisions.find(revision => revision.id === value.currentPlanRevisionId);
        if (!current || input.approvePlanRevisionId !== current.id) throw new HttpError(409, 'Approval must name the exact current plan revision');
        current.approvedAt ??= Date.now();
      }
      editorLimit(value); value.version++; value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
    });
    return json(snapshot(store, repo, id!));
  }
  if (!id || request.method !== 'POST' && !(action === 'session' && ['GET', 'DELETE'].includes(request.method))) throw new HttpError(404, 'Unknown agent workspace route');
  const operationKey = keyFor(store, id);
  if (operations.has(operationKey)) throw new HttpError(409, 'Wait for the active workspace operation');
  operations.add(operationKey);
  try {
    if (segments.length === 6 && action === 'connect' && request.method === 'POST') { await payload(request, []); return json(await connect(store, repo, id)); }
    if (segments.length === 8 && action === 'turns' && segments[7] === 'abandon' && request.method === 'POST') {
      await payload(request, []);
      const key = segments[6]!;
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new HttpError(400, 'Invalid turn key');
      const value = record(store, repo, id);
      const turn = value.acceptedTurns.find(turn => turn.key === key);
      if (turn) {
        const receipt: Omit<WorkspaceTurnReceipt, 'hash'> & { hash?: string } = { ...turn };
        delete receipt.hash;
        return json({ accepted: true, receipt });
      }
      if (!value.rejectedTurns.includes(key)) {
        if (value.rejectedTurns.length >= WORKSPACE_LIMITS.turns) throw new HttpError(413, 'Rejected turn key limit reached; previous reservations were retained');
        value.rejectedTurns.push(key); store.save('agentWorkspaces', value);
      }
      return json({ accepted: false, resolved: true, status: 'rejected' });
    }
    if (segments.length === 6 && action === 'research' && request.method === 'POST') {
      const input = await payload(request, ['paths', 'version']);
      let value = record(store, repo, id);
      if (value.archived) throw new HttpError(409, 'Unarchive this workspace before research');
      if (!Number.isSafeInteger(input.version) || input.version !== value.version) throw new HttpError(409, 'Research requires the current saved workspace version');
      if (!Array.isArray(input.paths) || input.paths.some(path => typeof path !== 'string')) throw new HttpError(400, 'Research paths must be a string array');
      const results = await researchRepository(store, repo, input.paths as string[]);
      value = record(store, repo, id);
      if (value.version !== input.version) throw new HttpError(409, 'Workspace context changed while retrieving research; no sources were saved');
      const existingIds = new Set(value.researchReferences.map(reference => reference.id));
      const added = results.filter(result => !existingIds.has(result.reference.id));
      if (value.researchResults.length + added.length > 32 || bytes(JSON.stringify([...value.researchResults, ...added]).replaceAll('@', '\\u0040').replaceAll('^', '\\u005e')) > 48 * 1024) throw new HttpError(413, 'Workspace research limit reached (32 references, 48 KiB encoded including content); existing references were retained');
      value.researchResults.push(...added); value.researchReferences.push(...added.map(result => result.reference));
      value.version++; value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
      return json(snapshot(store, repo, id));
    }
    if (action !== 'session' || segments.length < 6 || segments.length > 7) throw new HttpError(404, 'Unknown agent workspace route');
    let receipt: TurnReceipt | undefined;
    if (segments.length === 7 && segments[6] === 'turn' && request.method === 'POST') {
      receipt = await turnReceipt(request);
      if (record(store, repo, id).rejectedTurns.includes(receipt.key)) throw new HttpError(409, 'This unaccepted turn key was explicitly discarded; it cannot be sent or replayed');
      const prior = record(store, repo, id).acceptedTurns.find(turn => turn.key === receipt!.key);
      if (prior) {
        if (prior.hash !== receipt.hash) throw new HttpError(409, 'Idempotency-Key already belongs to a different Send');
        return json(native(store, repo, id) || detached(record(store, repo, id)));
      }
      request = receipt.request; accepted.set(operationKey, { key: receipt.key, hash: receipt.hash });
    }
    const draft = native(store, repo, id);
    if (!draft) {
      if (segments.length === 6 && ['GET', 'DELETE'].includes(request.method)) {
        if (request.method === 'DELETE') await assertWorkspaceOwners(store);
        snapshot(store, repo, id);
        return json(detached(record(store, repo, id)));
      }
      throw new HttpError(409, 'Connect a fresh native session before sending or changing its model; nothing was replayed');
    }
    if (record(store, repo, id).archived && request.method === 'POST' && segments[6] !== 'cancel') throw new HttpError(409, 'Unarchive this workspace before changing its native session');
    const draftSegments = ['api', 'repos', repo.id, 'drafts', draft.id, ...segments.slice(6)];
    return await handleDraftRequest(store, repo, request, draftSegments, true);
  } finally { accepted.delete(operationKey); operations.delete(operationKey); }
}
