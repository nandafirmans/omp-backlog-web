import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dlopen, ptr, read } from 'bun:ffi';
import type { Attachment, Mode, Repo, Store, Ticket } from './contracts';
import { digest, within } from './store';

export const MAX_MARKDOWN = 512 * 1024;
export const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL = 50 * 1024 * 1024;
export const validTicketId = (id: string) => /^T[0-9]{3,8}$/.test(id);
export const validAttachmentName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(name) && !name.includes('..') && /\.(png|jpe?g|gif|webp|json|txt|md|csv|pdf|docx?|xlsx?|odt)$/i.test(name);
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function safePath(root: string, path: string, allowMissing = false): Promise<string> {
  const canonical = await realpath(root);
  if (canonical !== resolve(root)) throw new HttpError(400, 'Root directory changed or became a symlink; register it again');
  const target = resolve(path);
  if (!within(canonical, target)) throw new HttpError(400, 'Path is outside the permitted directory');
  let current = canonical;
  for (const part of target.slice(canonical.length).split('/').filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new HttpError(400, 'Symlinks are not permitted in ticket paths'); }
    catch (error) { if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error; }
  }
  return target;
}
export async function readSafe(root: string, path: string, limit: number): Promise<Uint8Array> {
  await safePath(root, path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw new HttpError(400, `File must be regular and at most ${limit} bytes`);
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new HttpError(400, 'File grew past its size limit');
    return bytes;
  } finally { await handle.close(); }
}
export async function ticketDirectory(repo: Repo, id: string, create = false): Promise<string> {
  if (!validTicketId(id)) throw new HttpError(400, 'Ticket IDs must be T followed by 3–8 digits');
  const directory = join(repo.path, '.omp-backlog', 'tickets', id);
  await safePath(repo.path, directory, create);
  if (create) { await mkdir(directory, { recursive: true }); await safePath(repo.path, directory); }
  return directory;
}
export function parseTicket(markdown: string, expected?: string): { id: string; title: string; dependencies: string[]; criteria: string[] } {
  if (Buffer.byteLength(markdown) > MAX_MARKDOWN) throw new HttpError(400, 'Ticket exceeds 512 KiB');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new HttpError(400, 'Add frontmatter with id, title, and depends_on');
  const fields = new Map<string, string>();
  let list = '';
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list === 'depends_on') { fields.set(list, `${fields.get(list) || ''},${item[1]}`); continue; }
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!field || !['id', 'title', 'depends_on'].includes(field[1]) || fields.has(field[1])) throw new HttpError(400, 'Use unique id, title, and depends_on frontmatter fields only; status and approval belong to the application');
    list = field[1]; fields.set(list, field[2]);
  }
  const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, '$2').trim();
  const id = unquote(fields.get('id') || '');
  const title = unquote(fields.get('title') || '');
  if (!validTicketId(id) || (expected && id !== expected)) throw new HttpError(400, 'Frontmatter id must match its T001-style ticket directory');
  if (!title || title.length > 200) throw new HttpError(400, 'Add a title of 1–200 characters');
  const depText = fields.get('depends_on') || '';
  const dependencies = depText.replace(/^\[/, '').replace(/\]$/, '').split(',').map(unquote).filter(Boolean);
  if (dependencies.some(dep => !validTicketId(dep)) || new Set(dependencies).size !== dependencies.length) throw new HttpError(400, 'depends_on must contain unique T001-style IDs');
  const body = markdown.slice(match[0].length);
  const acceptance = /^(?:#{1,6}[ \t]+)?(?:Done when:|Acceptance criteria)[ \t]*\r?\n([\s\S]*?)(?=\n#{1,6}\s|(?![\s\S]))/im.exec(body);
  if (!acceptance) throw new HttpError(400, 'Add Done when: with observable results as Markdown bullets');
  if (!body.slice(0, acceptance.index).replace(/^#{1,6}[^\r\n]*/gm, '').trim()) throw new HttpError(400, 'Describe what to change before Done when:');
  const criteria = acceptance[1].split(/\r?\n/).filter(line => /^\s*(?:[-*+]\s|\d+[.)]\s)/.test(line)).map(line => line.replace(/^\s*(?:[-*+]\s|\d+[.)]\s)(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean);
  if (!criteria.length) throw new HttpError(400, 'List observable results under Done when: as Markdown bullets');
  return { id, title, dependencies, criteria };
}
function inspectAttachmentReferences(markdown: string): { name: string; purpose: string }[] {
  const references: { name: string; purpose: string }[] = [];
  for (const match of markdown.matchAll(/!?\[([^\]]*)\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+(?:"([^"]*)"|'([^']*)'))?\)/g)) {
    const href = match[2];
    if (/^(?:https?:|mailto:|#)/i.test(href)) continue;
    if (!href.startsWith('attachments/')) throw new HttpError(400, 'Local attachment links must use attachments/<filename>');
    let name: string;
    try { name = decodeURIComponent(href.slice('attachments/'.length)); } catch { throw new HttpError(400, 'Invalid attachment URL encoding'); }
    if (!validAttachmentName(name)) throw new HttpError(400, `Unsafe or unsupported attachment reference: ${name}`);
    references.push({ name, purpose: match[1].trim() || (match[3] ?? match[4] ?? '').trim() });
  }
  return references;
}
export function attachmentReferences(markdown: string): string[] {
  return [...new Set(inspectAttachmentReferences(markdown).map(reference => reference.name))].sort();
}
function validateAttachmentPurposes(markdown: string, attachments: Attachment[]): void {
  const references = inspectAttachmentReferences(markdown);
  for (const { name } of references) {
    if (!attachments.some(file => file.name === name)) throw new HttpError(400, `Missing attachment ${name}; upload it or remove the reference`);
  }
  for (const { name } of attachments) {
    if (!references.some(reference => reference.name === name)) throw new HttpError(400, `Attachment ${name} is unreferenced; add a Markdown link/image with a label or title describing its purpose`);
    if (!references.some(reference => reference.name === name && reference.purpose)) throw new HttpError(400, `Attachment ${name} needs a purpose; add a nonempty descriptive Markdown link/image label or link title`);
  }
}
async function readTicket(repo: Repo, id: string): Promise<{ markdown: string; attachments: Attachment[]; revision: string }> {
  const directory = await ticketDirectory(repo, id);
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(await readSafe(repo.path, join(directory, 'ticket.md'), MAX_MARKDOWN));
  const attachments: Attachment[] = [];
  const folder = join(directory, 'attachments');
  try {
    await safePath(repo.path, folder);
    const entries = await readdir(folder, { withFileTypes: true });
    if (entries.length > 100) throw new HttpError(400, 'At most 100 attachments are permitted per ticket');
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!validAttachmentName(entry.name) || !entry.isFile()) throw new HttpError(400, `Remove unsafe or unsupported attachment: ${entry.name}`);
      const bytes = await readSafe(repo.path, join(folder, entry.name), MAX_ATTACHMENT);
      attachments.push({ name: entry.name, size: bytes.length, hash: digest(bytes) });
    }
    if (attachments.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENTS_TOTAL) throw new HttpError(400, 'Attachments exceed the 50 MiB ticket limit');
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const revision = digest(markdown + '\0' + JSON.stringify(attachments));
  return { markdown, attachments, revision };
}
const stable = new WeakMap<Store, Map<string, { signature: string; since: number }>>();
const reconciling = new WeakMap<Store, Promise<void>>();
export async function reconcileTickets(store: Store, force = false): Promise<void> {
  const active = reconciling.get(store);
  if (active && !force) return active;
  const work = (active || Promise.resolve()).catch(() => {}).then(() => reconcile(store, force));
  reconciling.set(store, work);
  try { await work; } finally { if (reconciling.get(store) === work) reconciling.delete(store); }
}
async function reconcile(store: Store, force: boolean): Promise<void> {
  let observations = stable.get(store);
  if (!observations) { observations = new Map(); stable.set(store, observations); }
  for (const repo of store.list('repos')) {
    const base = join(repo.path, '.omp-backlog', 'tickets');
    let entries: string[] = [];
    let rootError: string | null = null;
    try { await safePath(repo.path, base); entries = await readdir(base); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) rootError = error instanceof Error ? error.message : 'Cannot read ticket directory'; }
    const found = new Set<string>();
    for (const id of entries.filter(validTicketId)) {
      found.add(id);
      const key = `${repo.id}/${id}`;
      const previous = store.get('tickets', key);
      let ticket: Ticket = previous ? { ...previous, removed: false } : { id, repoId: repo.id, title: id, markdown: '', revision: '', approvedRevision: null, status: 'draft', dependencies: [], criteria: [], attachments: [], error: null, order: Date.now(), removed: false, runId: null };
      try {
        const content = await readTicket(repo, id);
        const observed = observations.get(key);
        if (!force && (!observed || observed.signature !== content.revision)) { observations.set(key, { signature: content.revision, since: Date.now() }); continue; }
        if (!force && observed && Date.now() - observed.since < 500) continue;
        const changed = ticket.revision !== content.revision;
        ticket = { ...ticket, ...content, error: !changed && previous?.error?.startsWith('Dependency ') ? previous.error : null };
        try { const parsed = parseTicket(content.markdown, id); validateAttachmentPurposes(content.markdown, content.attachments); ticket = { ...ticket, title: parsed.title, dependencies: parsed.dependencies, criteria: parsed.criteria }; }
        catch (error) { ticket.error = error instanceof Error ? error.message : 'Invalid ticket'; }
        if (changed) { ticket.approvedRevision = null; if (!['running', 'stopping', 'paused'].includes(ticket.status)) ticket.status = 'draft'; }
      } catch (error) { ticket.error = error instanceof Error ? error.message : 'Cannot read ticket'; ticket.approvedRevision = null; }
      // Filesystem awaits must not restore an old scheduler status or approval.
      const latest = store.get('tickets', key);
      if (latest) {
        const changed = latest.revision !== ticket.revision;
        ticket = { ...latest, title: ticket.title, markdown: ticket.markdown, revision: ticket.revision, dependencies: ticket.dependencies, criteria: ticket.criteria, attachments: ticket.attachments, error: ticket.error, removed: false };
        if (changed || ticket.error) ticket.approvedRevision = null;
        if (changed && !['running', 'stopping', 'paused'].includes(latest.status)) ticket.status = 'draft';
      }
      if (JSON.stringify(ticket) !== JSON.stringify(latest)) store.save('tickets', ticket);
    }
    for (const ticket of store.list('tickets').filter(item => item.repoId === repo.id)) {
      if (!found.has(ticket.id)) { const message = rootError || 'Ticket file was removed; restore it before running'; if (!ticket.removed || ticket.error !== message) store.save('tickets', { ...ticket, removed: true, error: message, approvedRevision: null }); }
    }
    const tickets = store.list('tickets').filter(item => item.repoId === repo.id && !item.removed);
    const byId = new Map(tickets.map(ticket => [ticket.id, ticket]));
    for (const ticket of tickets) {
      if (ticket.error && !ticket.error.startsWith('Dependency ')) continue;
      let error: string | null = null;
      const visit = (id: string, stack: Set<string>): boolean => {
        if (stack.has(id)) return true;
        const next = byId.get(id); if (!next) return false;
        const branch = new Set(stack); branch.add(id);
        return next.dependencies.some(dep => visit(dep, branch));
      };
      const missing = ticket.dependencies.find(id => !byId.has(id));
      if (missing) error = `Dependency ${missing} is missing; create it or remove the reference`;
      else if (visit(ticket.id, new Set())) error = 'Dependency cycle detected; remove a circular depends_on reference';
      if (error !== ticket.error) store.save('tickets', { ...ticket, error, approvedRevision: error ? null : ticket.approvedRevision });
    }
  }
}
// One local owner; serialize website file mutations to make revision checks meaningful.
const writes = new WeakMap<Store, Promise<unknown>>();
function serializeWrite<T>(store: Store, operation: () => Promise<T>): Promise<T> {
  const pending = (writes.get(store) || Promise.resolve()).then(operation);
  writes.set(store, pending.then(() => undefined, () => undefined));
  return pending;
}
export function writeTicket(store: Store, repo: Repo, markdown: string, revision?: string, expectedId?: string): Promise<Ticket> {
  return serializeWrite(store, () => saveTicket(store, repo, markdown, revision, expectedId));
}
async function saveTicket(store: Store, repo: Repo, markdown: string, revision?: string, expectedId?: string): Promise<Ticket> {
  const parsed = parseTicket(markdown, expectedId);
  attachmentReferences(markdown);
  await reconcileTickets(store, true);
  const old = store.get('tickets', `${repo.id}/${parsed.id}`);
  if (revision === undefined ? Boolean(old && !old.removed) : !old || old.revision !== revision) throw new HttpError(409, 'Ticket changed on disk. Reload and reconcile your edits before saving.');
  const directory = await ticketDirectory(repo, parsed.id, true);
  const filename = join(directory, 'ticket.md');
  const temporary = join(directory, `.write-${randomUUID()}`);
  try {
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(markdown); } finally { await handle.close(); }
    if (revision !== undefined && (await readTicket(repo, parsed.id)).revision !== revision) throw new HttpError(409, 'Ticket changed while saving. Reload and reconcile your edits.');
    if (revision === undefined) { const target = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); try { await target.writeFile(markdown); } finally { await target.close(); } }
    else { await safePath(repo.path, filename); await rename(temporary, filename); }
  } finally { await rm(temporary, { force: true }); }
  await reconcileTickets(store, true);
  return store.get('tickets', `${repo.id}/${parsed.id}`)!;
}

export interface CompleteTicketFile { name: string; bytes: Uint8Array }
export interface CompleteTicketPublication {
  mode: Mode;
  expires: number;
  revision?: string;
  directory?: { dev: number; ino: number };
}
export function validateCompleteTicket(markdown: string, files: CompleteTicketFile[]) {
  const parsed = parseTicket(markdown);
  if (files.length > 100) throw new HttpError(400, 'At most 100 attachments are permitted per ticket');
  const names = new Set<string>();
  const attachments = files.map(file => {
    if (!validAttachmentName(file.name) || basename(file.name) !== file.name) throw new HttpError(400, 'Unsupported or unsafe attachment filename');
    if (names.has(file.name)) throw new HttpError(400, `Duplicate attachment filename: ${file.name}`);
    names.add(file.name);
    if (!file.bytes.length || file.bytes.length > MAX_ATTACHMENT) throw new HttpError(400, 'Attachment must be 1 byte–10 MiB');
    return { name: file.name, size: file.bytes.length, hash: digest(file.bytes) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (attachments.reduce((size, file) => size + file.size, 0) > MAX_ATTACHMENTS_TOTAL) throw new HttpError(400, 'Attachments exceed the 50 MiB ticket limit');
  validateAttachmentPurposes(markdown, attachments);
  return { ...parsed, attachments, revision: digest(markdown + '\0' + JSON.stringify(attachments)) };
}

let publishDirectory: ((source: string, destinationFd: number, id: string) => void) | undefined;
function atomicPublish(source: string, destinationFd: number, id: string): void {
  if (!publishDirectory) {
    if (process.platform !== 'linux') throw new HttpError(503, 'Assisted creation requires atomic no-overwrite directory publication on Linux; manual creation remains available');
    try {
      const library = dlopen('libc.so.6', {
        renameat2: { args: ['i32', 'ptr', 'i32', 'ptr', 'u32'], returns: 'i32' },
        __errno_location: { args: [], returns: 'ptr' },
      });
      publishDirectory = (from, directory, name) => {
        const oldPath = Buffer.from(from + '\0');
        const newPath = Buffer.from(name + '\0');
        // Node's rename may replace an external empty directory. Never fall back to it.
        if (library.symbols.renameat2(-100, ptr(oldPath), directory, ptr(newPath), 1) === 0) return;
        const location = library.symbols.__errno_location();
        const errno = location ? read.i32(location) : 0;
        if (errno === 17 || errno === 39) throw new HttpError(409, 'Ticket ID already exists on disk; choose another ID and review again');
        if ([22, 38, 95].includes(errno)) throw new HttpError(503, 'The filesystem does not support atomic no-overwrite ticket publication; nothing was published');
        throw new HttpError(500, `Atomic ticket publication failed (filesystem error ${errno}); retain the draft and retry`);
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'Atomic no-overwrite publication is unavailable; manual creation remains available');
    }
  }
  publishDirectory(source, destinationFd, id);
}

/** The mutable receipt belongs to one reviewed confirmation, never to browser input. */
export function createCompleteTicket(store: Store, repo: Repo, markdown: string, files: CompleteTicketFile[], publication: CompleteTicketPublication): Promise<Ticket> {
  return serializeWrite(store, async () => {
    const payload = validateCompleteTicket(markdown, files);
    const checkMode = () => {
      const latest = store.get('repos', repo.id);
      if (!latest || latest.path !== repo.path || latest.mode !== publication.mode || Date.now() >= publication.expires) throw new HttpError(409, 'Creation review expired or the project mode changed; review the complete ticket again');
    };
    checkMode();
    if (publication.revision) {
      try {
        const directory = await ticketDirectory(repo, payload.id);
        const info = await lstat(directory);
        const current = await readTicket(repo, payload.id);
        if (current.revision !== publication.revision || current.revision !== payload.revision || !publication.directory || info.dev !== publication.directory.dev || info.ino !== publication.directory.ino) throw new Error('Changed publication');
      } catch {
        throw new HttpError(409, 'Previously created ticket changed or was removed; this confirmation cannot create or overwrite it again');
      }
      checkMode();
      await reconcileTickets(store, true);
      const ticket = store.get('tickets', `${repo.id}/${payload.id}`);
      if (!ticket || ticket.removed || ticket.revision !== payload.revision) throw new HttpError(409, 'Created ticket changed while reconciling; retain the draft and inspect the existing ticket');
      return ticket;
    }
    await reconcileTickets(store, true);
    const previous = store.get('tickets', `${repo.id}/${payload.id}`);
    if (previous && !previous.removed) throw new HttpError(409, 'Ticket ID already exists; choose another ID and review again');
    const base = join(repo.path, '.omp-backlog');
    const tickets = join(base, 'tickets');
    await safePath(repo.path, tickets, true);
    await mkdir(tickets, { recursive: true, mode: 0o700 });
    await safePath(repo.path, tickets);
    const parent = await open(tickets, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let staging: string | undefined;
    let identity: { dev: number; ino: number } | undefined;
    try {
      // Same filesystem, private, and outside the scheduler's valid ticket-ID namespace.
      staging = await mkdtemp(join(base, '.assisted-stage-'));
      const info = await lstat(staging);
      identity = { dev: info.dev, ino: info.ino };
      const write = async (path: string, bytes: string | Uint8Array) => {
        const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      };
      await write(join(staging, 'ticket.md'), markdown);
      if (files.length) {
        await mkdir(join(staging, 'attachments'), { mode: 0o700 });
        for (const file of files) await write(join(staging, 'attachments', file.name), file.bytes);
      }
      const staged = await open(staging, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await staged.sync(); } finally { await staged.close(); }
      await safePath(repo.path, tickets);
      const destination = await lstat(tickets);
      const opened = await parent.stat();
      if (destination.dev !== opened.dev || destination.ino !== opened.ino) throw new HttpError(409, 'Ticket directory changed during creation; review and retry');
      const ready = await lstat(staging);
      if (ready.dev !== identity.dev || ready.ino !== identity.ino || !ready.isDirectory()) throw new HttpError(409, 'Ticket staging directory changed during creation');
      // No await between the final current-mode check, atomic publication, and receipt.
      checkMode();
      atomicPublish(staging, parent.fd, payload.id);
      publication.revision = payload.revision;
      publication.directory = identity;
      staging = undefined;
      await parent.sync();
      await reconcileTickets(store, true);
      const ticket = store.get('tickets', `${repo.id}/${payload.id}`);
      if (!ticket || ticket.removed || ticket.revision !== payload.revision) throw new HttpError(409, 'Created ticket changed while reconciling; retain the draft and inspect the existing ticket');
      return ticket;
    } finally {
      await parent.close();
      if (staging) {
        const owned = await lstat(staging).catch(() => null);
        if (owned && owned.dev === identity?.dev && owned.ino === identity?.ino) await rm(staging, { recursive: true, force: true });
      }
    }
  });
}
export async function snapshotTicket(store: Store, ticket: Ticket, runId: string): Promise<string> {
  const repo = store.get('repos', ticket.repoId);
  if (!repo || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new HttpError(400, 'Invalid run snapshot');
  const current = await readTicket(repo, ticket.id);
  if (current.revision !== ticket.revision || ticket.error) throw new HttpError(409, 'Requirements changed before execution; reconcile and approve the new revision');
  const parent = join(store.dataDir, 'snapshots');
  await safePath(store.dataDir, parent, true);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const destination = join(parent, runId);
  await mkdir(destination, { mode: 0o700 });
  const writePrivate = async (path: string, bytes: string | Uint8Array) => { const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400); try { await file.writeFile(bytes); } finally { await file.close(); } };
  try {
    await writePrivate(join(destination, 'ticket.md'), ticket.markdown);
    const attachments = join(destination, 'attachments');
    await mkdir(attachments, { mode: 0o700 });
    const source = await ticketDirectory(repo, ticket.id);
    for (const name of attachmentReferences(ticket.markdown)) {
      const bytes = await readSafe(repo.path, join(source, 'attachments', name), MAX_ATTACHMENT);
      if (digest(bytes) !== ticket.attachments.find(file => file.name === name)?.hash) throw new HttpError(409, `Attachment ${name} changed while snapshotting`);
      await writePrivate(join(attachments, name), bytes);
    }
    if ((await readTicket(repo, ticket.id)).revision !== ticket.revision) throw new HttpError(409, 'Ticket changed while snapshotting');
    await chmod(attachments, 0o500); await chmod(destination, 0o500);
    return destination;
  } catch (error) { await chmod(destination, 0o700); const folder = join(destination, 'attachments'); try { await chmod(folder, 0o700); } catch { /* May not have been created yet. */ } await rm(destination, { recursive: true, force: true }); throw error; }
}
export function uploadAttachment(store: Store, repo: Repo, id: string, name: string, bytes: Uint8Array, revision: string): Promise<Ticket> {
  return serializeWrite(store, () => saveAttachment(store, repo, id, name, bytes, revision));
}
async function saveAttachment(store: Store, repo: Repo, id: string, name: string, bytes: Uint8Array, revision: string): Promise<Ticket> {
  if (!validAttachmentName(name) || basename(name) !== name) throw new HttpError(400, 'Unsupported or unsafe attachment filename');
  if (bytes.length > MAX_ATTACHMENT || !bytes.length) throw new HttpError(400, 'Attachment must be 1 byte–10 MiB');
  await reconcileTickets(store, true);
  const ticket = store.get('tickets', `${repo.id}/${id}`);
  if (!ticket || ticket.removed) throw new HttpError(404, 'Ticket not found');
  if (ticket.revision !== revision) throw new HttpError(409, 'Ticket changed; reload before uploading');
  if (ticket.attachments.filter(file => file.name !== name).reduce((total, file) => total + file.size, bytes.length) > MAX_ATTACHMENTS_TOTAL) throw new HttpError(400, 'Ticket attachments exceed 50 MiB');
  const folder = join(await ticketDirectory(repo, id), 'attachments');
  await safePath(repo.path, folder, true); await mkdir(folder, { recursive: true, mode: 0o700 }); await safePath(repo.path, folder);
  const path = join(folder, name);
  await safePath(repo.path, path, true);
  if (ticket.attachments.some(file => file.name === name)) throw new HttpError(409, 'An attachment with this name already exists; choose a new name to preserve references');
  if ((await readTicket(repo, id)).revision !== revision) throw new HttpError(409, 'Ticket changed while uploading; reload before trying again');
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  await reconcileTickets(store, true);
  return store.get('tickets', `${repo.id}/${id}`)!;
}
