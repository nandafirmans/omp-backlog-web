import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repo, Store } from './contracts';
import type { AssistedConfirmation } from './drafting-contracts';
import { token } from './store';
import { createCompleteTicket, HttpError, MAX_ATTACHMENT, MAX_ATTACHMENTS_TOTAL, MAX_MARKDOWN, safePath, validAttachmentName, validateCompleteTicket } from './tickets';
import type { CompleteTicketFile, CompleteTicketPublication } from './tickets';

const REVIEW_LIFETIME = 10 * 60 * 1000;
const MAX_REVIEWS = 256;
const MAX_MULTIPART = MAX_MARKDOWN + MAX_ATTACHMENTS_TOTAL + 256 * 1024;
interface Review extends CompleteTicketPublication { repoId: string; path: string; payload: string }
const reviews = new WeakMap<Store, Map<string, Review>>();

async function readPayload(request: Request, create: boolean): Promise<{ markdown: string; files: CompleteTicketFile[]; confirmation: string }> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.startsWith('multipart/form-data;')) throw new HttpError(415, 'Use multipart form data with reviewed Markdown and all selected files');
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_MULTIPART) throw new HttpError(413, 'Reviewed ticket payload is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Provide the complete reviewed ticket payload');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MULTIPART) { await reader.cancel(); throw new HttpError(413, 'Reviewed ticket payload is too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new HttpError(400, 'Malformed multipart ticket payload'); }
  for (const key of form.keys()) {
    if (!['markdown', 'files', ...(create ? ['confirmation'] : [])].includes(key)) throw new HttpError(400, `Unexpected assisted-creation field: ${key}`);
  }
  const markdown = form.get('markdown');
  if (typeof markdown !== 'string' || form.getAll('markdown').length !== 1 || Buffer.byteLength(markdown) > MAX_MARKDOWN) throw new HttpError(400, 'Provide one Markdown ticket of at most 512 KiB');
  const confirmation = form.get('confirmation');
  if (create && (typeof confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(confirmation) || form.getAll('confirmation').length !== 1)) throw new HttpError(409, 'Review the complete ticket again before creating it');
  const uploads = form.getAll('files');
  if (uploads.length > 100) throw new HttpError(400, 'At most 100 attachments are permitted per ticket');
  const names = new Set<string>();
  let total = 0;
  for (const file of uploads) {
    if (!(file instanceof File)) throw new HttpError(400, 'Each attachment must be an uploaded file');
    if (!validAttachmentName(file.name)) throw new HttpError(400, 'Use the exact safe final attachment filename; unsupported or unsafe names are not accepted');
    if (names.has(file.name)) throw new HttpError(400, `Duplicate attachment filename: ${file.name}`);
    names.add(file.name);
    if (!file.size || file.size > MAX_ATTACHMENT) throw new HttpError(400, 'Attachment must be 1 byte–10 MiB');
    total += file.size;
    if (total > MAX_ATTACHMENTS_TOTAL) throw new HttpError(400, 'Attachments exceed the 50 MiB ticket limit');
  }
  const files: CompleteTicketFile[] = [];
  for (const file of uploads as File[]) files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  return { markdown, files, confirmation: typeof confirmation === 'string' ? confirmation : '' };
}

/** Auth, CSRF and permitted-root checks remain at the API boundary. No draft RPC calls enter here. */
export async function handleAssistedCreation(store: Store, repo: Repo, request: Request, action: 'assisted-prepare' | 'assisted-create'): Promise<Response> {
  if (request.method !== 'POST') throw new HttpError(405, 'Assisted creation requires POST');
  if (action !== 'assisted-prepare' && action !== 'assisted-create') throw new HttpError(404, 'Assisted creation action not found');
  const input = await readPayload(request, action === 'assisted-create');
  const payload = validateCompleteTicket(input.markdown, input.files);
  const latest = store.get('repos', repo.id);
  if (!latest || latest.path !== repo.path) throw new HttpError(409, 'Project registration changed; review the ticket again');
  let pending = reviews.get(store);
  if (!pending) { pending = new Map(); reviews.set(store, pending); }
  for (const [key, review] of pending) if (review.expires <= Date.now()) pending.delete(key);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (action === 'assisted-prepare') {
    const target = join(repo.path, '.omp-backlog', 'tickets', payload.id);
    await safePath(repo.path, target, true);
    try {
      await lstat(target);
      throw new HttpError(409, 'Ticket ID already exists on disk; choose another ID and review again');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (pending.size >= MAX_REVIEWS) throw new HttpError(429, 'Too many pending ticket reviews; wait for an earlier review to expire');
    const confirmation = token();
    const review: Review = { repoId: repo.id, path: repo.path, payload: payload.revision, mode: latest.mode, expires: Date.now() + REVIEW_LIFETIME };
    pending.set(confirmation, review);
    const result: AssistedConfirmation = { confirmation, mode: review.mode, expires: review.expires };
    return Response.json(result, { headers });
  }
  const review = pending.get(input.confirmation);
  if (!review || review.repoId !== repo.id || review.path !== repo.path || review.payload !== payload.revision || review.mode !== latest.mode) throw new HttpError(409, 'Reviewed Markdown, attachments or project mode changed, or confirmation expired; review the complete ticket again');
  const retried = Boolean(review.revision);
  const ticket = await createCompleteTicket(store, repo, input.markdown, input.files, review);
  return Response.json(ticket, { status: retried ? 200 : 201, headers });
}
