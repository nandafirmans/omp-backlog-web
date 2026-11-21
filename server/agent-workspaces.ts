import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentWorkspace, AgentWorkspaceRecord, AgentWorkspaceSnapshot, AgentWorkspaceSummary, ResponseOperation, WorkspaceTurnReceipt } from './agent-workspace-contracts';
import type { Repo, Store } from './contracts';
import type { DraftContext, DraftSnapshot } from './drafting-contracts';
import { createWorkspaceDraft, discoverExecutionModels, handleDraftRequest, readDraftBody, workspaceDraftSnapshot } from './drafting';
import { groupMembers, identity } from './process-identity';
import { database, digest } from './store';
import { HttpError, MAX_ATTACHMENTS_TOTAL } from './tickets';
import { researchRepository } from './agent-research';
import { inspectBatch, operationFor, publicOperation, recoverBatch } from './batch-publication';
import { acceptResponseOperation, activeResponseOwner, responseOperations } from './response-operations';

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
  // Older records used "Untitled workspace" as the unnamed placeholder.
  if (value.title === 'Untitled workspace' && value.titleSource !== 'manual') value.title = 'New chat';
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
function nameConversation(value: AgentWorkspaceRecord): void {
  if (value.title !== 'New chat' || value.titleSource === 'manual') return;
  const turn = value.acceptedTurns.find(turn => turn.intent !== 'task_extraction');
  const message = turn && value.messages[turn.userMessageIndex];
  if (message?.role !== 'user') return;
  const line = message.text.split(/\r?\n/).map(line => line.trim().replace(/^#{1,6}\s+/, '')).find(line => line && !line.startsWith('/skill:'));
  if (!line) return;
  const text = line.replace(/!\[([^\]]*)\]\([^)]*\)|\[([^\]]*)\]\([^)]*\)/g, '$1$2').replace(/[*`_]/g, '').replace(/\s+/g, ' ').trim();
  let title = '';
  let characters = 0;
  for (const character of text) {
    if (bytes(title + character) > 180 || characters >= 72) { title = title.trimEnd() + '…'; break; }
    title += character; characters++;
  }
  if (!title || title === value.title) return;
  value.title = title; value.titleSource = 'automatic'; value.version++;
}
function publicWorkspace(value: AgentWorkspaceRecord): AgentWorkspace {
  return {
    id: value.id, repoId: value.repoId, title: value.title, createdAt: value.createdAt,
    titleSource: value.titleSource,
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
  const version = value.version;
  nameConversation(value);
  if (value.version !== version) store.save('agentWorkspaces', value);
  if (!draft && value.messages.some(message => message.status === 'partial')) {
    value.messages = value.messages.map(message => message.status === 'partial' ? { ...message, status: 'failed' } : message);
    settleTurns(value, 'Native session disconnected before completion; no inference was replayed.');
    value.updatedAt = Date.now(); store.save('agentWorkspaces', value);
  }
  const rows = database(store).query<{ value: string }, [string, string, string, number]>("SELECT value FROM records WHERE kind='batchOperations' AND json_extract(value,'$.repoId')=? AND json_extract(value,'$.repoPath')=? AND json_extract(value,'$.workspaceId')=? ORDER BY CASE WHEN json_extract(value,'$.state') IN ('publishing','blocked') OR (json_extract(value,'$.state')='prepared' AND coalesce(json_extract(value,'$.invalidated'),0)=0 AND json_extract(value,'$.expires')>?) THEN 0 ELSE 1 END, rowid DESC LIMIT 128").all(repo.id, repo.path, id, Date.now());
  const eligibleResponseIndices = value.acceptedTurns.filter(turn => turn.status === 'complete' && turn.intent !== 'task_extraction' && (turn.model || value.model) && value.messages[turn.assistantMessageIndex]?.role === 'assistant' && value.messages[turn.assistantMessageIndex]?.status === 'complete' && value.messages[turn.assistantMessageIndex]?.text.trim()).map(turn => turn.assistantMessageIndex);
  return { workspace: publicWorkspace(value), draft, eligibleResponseIndices, responseOperations: responseOperations(store, repo, id), batchOperations: rows.reverse().map(row => publicOperation(JSON.parse(row.value), store)) };
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
function savedContext(value: AgentWorkspaceRecord, includeHistory: boolean): { message: string; context: DraftContext } {
  const plan = value.planRevisions.find(revision => revision.id === value.currentPlanRevisionId);
  const messages = includeHistory ? value.messages.slice(-WORKSPACE_LIMITS.contextMessages).map(message => ({ ...message })) : [];
  const data = { plan: plan ? { id: plan.id, markdown: plan.markdown, approved: plan.approvedAt !== undefined } : null, messages, research: value.researchResults, ticketQuestions: (value.responseOperations ?? []).filter(op => op.state === 'clarification').map(({ responseIndex, questions }) => ({ responseIndex, questions })) };
  const encoded = () => JSON.stringify(data).replaceAll('@', '\\u0040').replaceAll('^', '\\u005e');
  while (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes && messages.length) messages.shift();
  let planTruncated = false;
  while (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes && data.plan && data.plan.markdown.length) {
    data.plan.markdown = data.plan.markdown.slice(0, Math.floor(data.plan.markdown.length / 2));
    planTruncated = true;
  }
  if (bytes(encoded()) > WORKSPACE_LIMITS.contextBytes) throw new HttpError(413, 'Saved research exceeds the bounded encoded context; nothing was sent');
  const message = encoded();
  const omitted = value.messages.length - messages.length;
  return { message, context: { key: 'workspace:history', label: 'Saved conversation and host research', status: 'ready', detail: `${includeHistory ? `Seeds ${messages.length} latest saved messages on the next Send; ${omitted} older/oversized messages omitted` : 'Conversation already seeded in this native session; saved messages are not retransmitted'}. Supplies retained historical plan and retrieved research as untrusted JSON, at most 64 KiB total; plan ${planTruncated ? 'truncated to fit encoded context' : 'supplied in full'}. Previously transmitted image bytes and old file contents are not replayed.` } };
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
    if (turn.intent === 'task_extraction') {
      turn.status = 'failed'; turn.error = 'Legacy proposal extraction was retired. Create tickets from a completed chat response.';
      value.extraction = { key: turn.key, status: 'failed', error: turn.error };
    }
  }
}
function saveNative(store: Store, repo: Repo, id: string, draft: DraftSnapshot): void {
  const value = record(store, repo, id);
  const before = JSON.stringify(value);
  value.messages = structuredClone(draft.messages);
  nameConversation(value);
  if (draft.model) {
    if (value.model && (value.model.provider !== draft.model.provider || value.model.id !== draft.model.id || value.thinking !== draft.thinking)) value.version++;
    value.model = { ...draft.model }; value.thinking = draft.thinking;
  }
  settleTurns(value);
  // Only real changes reorder the conversation list; connecting or polling must not.
  if (JSON.stringify(value) !== before) value.updatedAt = Date.now();
  store.save('agentWorkspaces', value);
}

export async function assertWorkspaceOwners(store: Store): Promise<void> {
  const directory = join(store.dataDir, 'agent-workspace-owners');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(directory)) {
    if (!entry.endsWith('.json')) continue;
    if (activeResponseOwner(store, entry)) continue;
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
      context: () => savedContext(record(store, repo, id), !seeded),
      validateTurn: (prompt, turn) => {
        const current = record(store, repo, id);
        if (current.archived) throw new HttpError(409, 'Archived workspace cannot send');
        if (turn.contextVersion !== undefined && turn.contextVersion !== current.version) throw new HttpError(409, 'Saved workspace context changed; nothing was accepted. Discard this unaccepted request and prepare a new explicit action.');
        if (turn.intent === 'task_extraction' || turn.intent === 'ticket_drafting') throw new HttpError(410, 'Legacy proposal extraction and ticket drafting were removed. Discuss the outcome, then use Create tickets beneath a completed response.');
        if (current.acceptedTurns.length >= WORKSPACE_LIMITS.turns || current.messages.length + 2 > WORKSPACE_LIMITS.messages
          || current.messages.reduce((total, message) => total + bytes(message.text), 0) + bytes(prompt) + 256 * 1024 > WORKSPACE_LIMITS.historyBytes) throw new HttpError(413, 'Workspace history limit reached; saved history is retained. Create another workspace to continue.');
      },
      acceptTurn: (draft, turn) => {
        const receipt = accepted.get(keyFor(store, id));
        if (!receipt) throw new HttpError(409, 'Turn has no idempotency reservation');
        store.transaction(() => {
          const current = record(store, repo, id);
          const acceptedTurn: WorkspaceTurnReceipt = { ...receipt, contextHash: turn.contextHash, contextVersion: current.version, acceptedAt: Date.now(), intent: turn.intent, ...(turn.strategy ? { strategy: turn.strategy } : {}), sourceWorkspaceId: id, sourcePlanRevisionId: current.currentPlanRevisionId, model: structuredClone(draft.model), thinking: draft.thinking, researchReferenceIds: current.researchReferences.map(reference => reference.id), userMessageIndex: draft.messages.length - 2, assistantMessageIndex: draft.messages.length - 1, status: 'accepted', sourceContext: { plan: structuredClone(current.planRevisions.find(plan => plan.id === current.currentPlanRevisionId) ?? null), research: structuredClone(current.researchResults), preparedMessage: turn.preparedMessage, preparedImages: turn.preparedImages, uploads: turn.uploads } };
          current.acceptedTurns.push(acceptedTurn);
          // An accepted chat turn is already durable in messages. Clear the saved
          // composer so reconnect/reload starts with a blank draft, just like OMP CLI.
          // Never clear a newer human edit or the synthetic task-extraction prompt.
          const submitted = draft.messages[acceptedTurn.userMessageIndex]?.text;
          if (turn.intent !== 'task_extraction' && submitted?.trim() && current.prompt.replace(/\r\n?/g, '\n') === submitted.replace(/\r\n?/g, '\n')) {
            current.prompt = '';
            current.version++;
          }
          if (turn.intent === 'task_extraction') current.extraction = { key: receipt.key, status: 'pending' };
          store.save('agentWorkspaces', current);
          saveNative(store, repo, id, draft);
        });
        seeded = true;
      },
      changed: draft => saveNative(store, repo, id, draft),
      research: result => {
        const current = record(store, repo, id);
        const active = current.acceptedTurns.findLast(turn => turn.status === 'accepted');
        if (!active?.sourceContext) throw new Error('Research has no accepted conversation turn');
        const retained = current.acceptedTurns.reduce((total, turn) => total + bytes(JSON.stringify(turn.sourceContext?.exploration ?? [])), 0);
        if (retained + bytes(result) > 256 * 1024) throw new Error('Retained exploration context limit reached');
        (active.sourceContext.exploration ??= []).push(result);
        store.save('agentWorkspaces', current);
      },
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
  if (segments.length === 4 && request.method === 'GET') return json(store.list('agentWorkspaces').filter(value => value.repoId === repo.id && value.repoPath === repo.path).sort((a, b) => b.updatedAt - a.updatedAt).map(value => {
    const normalized = record(store, repo, value.id);
    const version = normalized.version;
    nameConversation(normalized);
    if (normalized.version !== version) store.save('agentWorkspaces', normalized);
    return summary(normalized);
  }));
  if (segments.length === 4 && request.method === 'POST') {
    const input = await payload(request, ['title']);
    if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim() || bytes(input.title) > 200)) throw new HttpError(400, 'Workspace title must be nonempty text no larger than 200 bytes');
    const workspace = store.transaction(() => {
      const all = store.list('agentWorkspaces');
      if (all.length >= WORKSPACE_LIMITS.global || all.filter(value => value.repoId === repo.id).length >= WORKSPACE_LIMITS.perRepo) throw new HttpError(429, 'Workspace count limit reached (16 per repository, 64 global, including archived); existing workspaces were retained');
      const now = Date.now();
      const value: AgentWorkspaceRecord = { id: crypto.randomUUID(), repoId: repo.id, repoPath: repo.path, title: typeof input.title === 'string' ? input.title.trim() : 'New chat', createdAt: now, updatedAt: now, archived: false, version: 1, prompt: '', ticketMarkdown: '', currentPlanRevisionId: null, planRevisions: [], messages: [], model: null, thinking: '', acceptedTurns: [], rejectedTurns: [], researchReferences: [], researchResults: [], proposalSets: [], extraction: null };
      if (typeof input.title === 'string') value.titleSource = 'manual';
      store.save('agentWorkspaces', value); return value;
    });
    return json({ workspace: publicWorkspace(workspace), draft: null }, 201);
  }
  record(store, repo, id || '');
  if (segments.length === 8 && action === 'attachments' && request.method === 'GET') {
    const index = Number(segments[6]);
    if (!Number.isSafeInteger(index) || index < 0) throw new HttpError(400, 'Invalid attachment message');
    const value = record(store, repo, id!);
    const upload = value.acceptedTurns.filter(turn => turn.userMessageIndex <= index).reverse().flatMap(turn => turn.sourceContext?.uploads ?? []).find(file => file.name === segments[7]);
    if (!upload) throw new HttpError(404, 'Attachment bytes were not retained with this conversation');
    return new Response(Buffer.from(upload.data, 'base64'), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(upload.name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-store' } });
  }
  if (segments.length === 8 && action === 'responses' && segments[7] === 'models' && request.method === 'POST') {
    const input = await payload(request, ['model']);
    if (input.model !== undefined && (typeof input.model !== 'string' || input.model.length > 385 || /\p{Cc}/u.test(input.model))) throw new HttpError(400, 'Invalid generation model');
    if (!/^(0|[1-9]\d*)$/.test(segments[6]!)) throw new HttpError(400, 'Invalid response index');
    const value = record(store, repo, id!);
    const index = Number(segments[6]);
    const turn = value.acceptedTurns.find(turn => turn.assistantMessageIndex === index);
    if (!turn || turn.status !== 'complete' || value.messages[index]?.role !== 'assistant' || value.messages[index]?.status !== 'complete') throw new HttpError(409, 'Choose a completed assistant response');
    const discovery = await discoverExecutionModels(store.settings().executable, typeof input.model === 'string' ? input.model : '');
    const saved = value.responseOperations?.find(op => op.responseIndex === index)?.generation ?? { model: turn.model ?? value.model, thinking: turn.thinking };
    return json({ ...discovery, saved, requiresImages: value.acceptedTurns.some(turn => turn.assistantMessageIndex <= index && !!turn.sourceContext?.preparedImages.length) });
  }
  if ((segments.length === 8 || segments.length === 9 && segments[8] === 'retry') && action === 'responses' && segments[7] === 'tickets' && request.method === 'POST') {
    const input = await payload(request, ['model', 'thinking']);
    let selection: ResponseOperation['generation'];
    if (input.model !== undefined || input.thinking !== undefined) {
      if (typeof input.model !== 'string' || !input.model.includes('/') || input.model.length > 385 || /\p{Cc}/u.test(input.model)
        || typeof input.thinking !== 'string' || !input.thinking || input.thinking.length > 32 || /\p{Cc}/u.test(input.thinking)) throw new HttpError(400, 'Choose an explicit generation model and thinking level');
      const separator = input.model.indexOf('/');
      const model = { provider: input.model.slice(0, separator), id: input.model.slice(separator + 1) };
      if (!model.provider || model.provider.length > 128 || !model.id || model.id.length > 256) throw new HttpError(400, 'Invalid generation model');
      selection = { model, thinking: input.thinking };
    }
    if (!/^(0|[1-9]\d*)$/.test(segments[6]!)) throw new HttpError(400, 'Invalid response index');
    const retry = segments.length === 9;
    if (retry) {
      responseOperations(store, repo, id!);
      await assertWorkspaceOwners(store);
    }
    acceptResponseOperation(store, repo, id!, Number(segments[6]), retry, selection);
    return json(snapshot(store, repo, id!), 202);
  }
  if (['batch-review', 'batch-preview', 'batch-publish'].includes(action) && request.method !== 'GET') throw new HttpError(410, 'Legacy proposal review and publication were removed. Use Create tickets beneath a completed chat response.');
  if (segments.length === 7 && action === 'batch-operations' && request.method === 'GET') return json(publicOperation(operationFor(store, repo, id!, segments[6]!), store));
  if (segments.length === 8 && action === 'batch-operations' && segments[7] === 'inspect' && request.method === 'GET') return json(await inspectBatch(store, repo, id!, segments[6]!));
  if (segments.length === 8 && action === 'batch-operations' && segments[7] === 'recover' && request.method === 'POST') {
    const input = await payload(request, ['confirm']);
    if (input.confirm !== true) throw new HttpError(400, 'Explicit recovery confirmation is required');
    return json(publicOperation(await recoverBatch(store, repo, id!, segments[6]!), store));
  }
  if (segments.length === 5 && request.method === 'GET') return json(snapshot(store, repo, id!));
  if (segments.length === 7 && action === 'turns' && request.method === 'GET') {
    snapshot(store, repo, id!);
    const value = record(store, repo, id!);
    const turn = value.acceptedTurns.find(turn => turn.key === segments[6]);
    if (!turn) return json(value.rejectedTurns.includes(segments[6]!) ? { accepted: false, resolved: true, status: 'rejected' } : { accepted: false });
    const receipt: Omit<WorkspaceTurnReceipt, 'hash'> & { hash?: string } = { ...turn };
    delete receipt.hash; delete receipt.sourceContext;
    return json({ accepted: true, receipt });
  }
  if (segments.length === 5 && request.method === 'DELETE') {
    const input = await payload(request, ['version']);
    if (!Number.isSafeInteger(input.version)) throw new HttpError(400, 'A workspace editor version is required');
    const operationKey = keyFor(store, id!);
    if (operations.has(operationKey)) throw new HttpError(409, 'Wait for the active workspace operation');
    operations.add(operationKey);
    try {
      await assertWorkspaceOwners(store);
      const value = record(store, repo, id!);
      if (value.version !== input.version) throw new HttpError(409, 'Workspace changed in another editor; reload before deleting');
      if (responseOperations(store, repo, id!).some(op => op.state === 'generating' || op.state === 'publishing')) throw new HttpError(409, 'Wait for ticket creation from this chat to finish before deleting it');
      const batches = store.list('batchOperations').filter(op => op.workspaceId === id);
      if (batches.some(op => op.state !== 'complete')) throw new HttpError(409, 'Resolve or recover the unfinished ticket publication before deleting this chat');
      const draft = native(store, repo, id!);
      if (draft?.status === 'busy') throw new HttpError(409, 'Stop the native turn explicitly before deleting');
      if (draft) {
        await handleDraftRequest(store, repo, new Request('http://local/', { method: 'DELETE' }), ['api', 'repos', repo.id, 'drafts', draft.id], true);
        live.delete(operationKey);
      }
      store.transaction(() => {
        for (const op of batches) database(store).query("DELETE FROM records WHERE kind='batchOperations' AND id=?").run(op.id);
        database(store).query("DELETE FROM records WHERE kind='agentWorkspaces' AND id=?").run(id!);
      });
      store.notify();
      return json({ deleted: id });
    } finally { operations.delete(operationKey); }
  }
  if (segments.length === 5 && request.method === 'PATCH') {
    const input = await payload(request, ['version', 'title', 'archived', 'prompt', 'ticketMarkdown', 'planMarkdown', 'approvePlanRevisionId']);
    if (['ticketMarkdown', 'planMarkdown', 'approvePlanRevisionId'].some(field => field in input)) throw new HttpError(410, 'Legacy plan and ticket editors were removed. Plans belong in chat; edit saved tickets in their ticket editor.');
    if (!Number.isSafeInteger(input.version)) throw new HttpError(400, 'A workspace editor version is required');
    for (const field of ['title', 'prompt']) if (input[field] !== undefined && typeof input[field] !== 'string') throw new HttpError(400, `${field} must be text`);
    if (input.archived !== undefined && typeof input.archived !== 'boolean') throw new HttpError(400, 'archived must be boolean');
    if (typeof input.title === 'string' && (!input.title.trim() || bytes(input.title) > 200)) throw new HttpError(400, 'Workspace title must be nonempty text no larger than 200 bytes');
    const operationKey = keyFor(store, id!);
    if (operations.has(operationKey)) throw new HttpError(409, 'Wait for the active workspace operation');
    store.transaction(() => {
      const value = record(store, repo, id!);
      if (value.version !== input.version) throw new HttpError(409, 'Workspace changed in another editor; reload before saving');
      if (input.archived === true && native(store, repo, id!)?.status === 'busy') throw new HttpError(409, 'Stop the native turn explicitly before archiving');
      if (typeof input.title === 'string') { value.title = input.title.trim(); value.titleSource = 'manual'; }
      if (typeof input.archived === 'boolean') value.archived = input.archived;
      if (typeof input.prompt === 'string') value.prompt = input.prompt;
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
        delete receipt.hash; delete receipt.sourceContext;
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
        return json({ ...(native(store, repo, id) || detached(record(store, repo, id))), acceptedTurnKey: prior.key });
      }
      request = receipt.request; accepted.set(operationKey, { key: receipt.key, hash: receipt.hash });
    }
    let draft = native(store, repo, id);
    if (!draft && receipt) { await connect(store, repo, id); draft = native(store, repo, id); }
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
    const response = await handleDraftRequest(store, repo, request, draftSegments, true);
    const acknowledged = receipt && record(store, repo, id).acceptedTurns.find(turn => turn.key === receipt.key);
    return acknowledged ? json({ ...await response.json() as DraftSnapshot, acceptedTurnKey: acknowledged.key }, response.status) : response;
  } finally { accepted.delete(operationKey); operations.delete(operationKey); }
}
