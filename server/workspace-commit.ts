import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Repo, Store, WorkspaceReview } from './contracts';
import { digest } from './store';
import { HttpError, safePath } from './tickets';

const LIMIT = 128 * 1024;
const AGE = 10 * 60 * 1000;
interface Entry { path: string; mode: string; bytes: Uint8Array | null }
interface Review { result: WorkspaceReview; entries: Entry[]; fingerprint: string; expires: number; head: string; ref: string; index: string; handoffId?: unknown }
const reviews = new WeakMap<Store, Map<string, Review>>();
const locks = new WeakMap<Store, Set<string>>();

// Shared with Recheck: clearing the gate cannot race an operator commit.
export async function workspaceOperation<T>(store: Store, repoId: string, operation: () => Promise<T>): Promise<T> {
  let owned = locks.get(store);
  if (!owned) { owned = new Set(); locks.set(store, owned); }
  if (owned.has(repoId)) throw new HttpError(409, 'Another workspace operation is in progress');
  owned.add(repoId);
  try { return await operation(); } finally { owned.delete(repoId); }
}

function guard(store: Store, repo: Repo, handoffId: unknown) {
  const current = store.get('repos', repo.id);
  if (!repo.git || !current?.handoff || current.handoff.id !== handoffId) throw new HttpError(409, 'Workspace handoff changed; review the current gate');
  if (store.list('runs').some(run => run.repoId === repo.id && ['running', 'stopping', 'paused'].includes(run.status))) throw new HttpError(409, 'Stop or finish owned work before reviewing or committing');
}

async function git(repo: Repo, args: string[], index?: string, input?: Uint8Array): Promise<{ text: string; code: number }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const child = Bun.spawn(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.untrackedCache=false', '-C', repo.path, ...args], {
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', ...(index ? { GIT_INDEX_FILE: index } : {}) },
    stdin: input ? new Blob([Buffer.from(input)]) : 'ignore', stdout: 'pipe', stderr: 'ignore',
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5000);
  const reader = child.stdout.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) { child.kill(); throw new HttpError(413, 'Git output exceeds review limit; reconcile in your terminal'); }
      chunks.push(value);
    }
    const code = await child.exited;
    if (timedOut) throw new HttpError(409, 'Git timed out; inspect the workspace before retrying');
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), code };
  } finally { clearTimeout(timer); await reader.cancel(); }
}
async function checked(repo: Repo, args: string[], index?: string, input?: Uint8Array): Promise<string> {
  const result = await git(repo, args, index, input);
  if (result.code !== 0) throw new HttpError(409, 'Git operation failed. Check repository permissions, Git identity and state in your terminal; review again before retrying.');
  return result.text;
}

function safeName(path: string) {
  return path.length <= 1024 && !/[\p{Cc}\\]/u.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..' && !/^(?:\.git|\.omp-backlog|node_modules|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc|\.pypirc|\.env.*|.*(?:credentials|secrets?|auth|tokens?).*|(?:.*[._-])?keys?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(part));
}
function text(bytes: Uint8Array) {
  if (bytes.includes(0)) throw new Error('Binary file');
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})|(?:api[_-]?key|password|secret|token)["']?\s*[:=]\s*["']?[^\s"']{8,}/i.test(value)) throw new Error('Potential credential content');
  return value;
}
async function worktreeBytes(repo: Repo, path: string): Promise<Uint8Array> {
  await safePath(repo.path, join(repo.path, path));
  const handle = await open(join(repo.path, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1 || info.size > LIMIT) throw new Error('Unsupported file');
    const buffer = Buffer.alloc(LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > LIMIT || bytesRead !== info.size) throw new Error('File changed or exceeds review limit');
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
async function indexBytes(index: string): Promise<Uint8Array> {
  try {
    const handle = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new HttpError(413, 'Git index too large for in-app commits');
      return await handle.readFile();
    } finally { await handle.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Uint8Array(); throw error; }
}

async function diffPreview(repo: Repo, privateDir: string, before: string, after: string): Promise<string> {
  const scratch = await mkdtemp(join(privateDir, 'workspace-diff-'));
  try {
    await chmod(scratch, 0o700);
    await writeFile(join(scratch, 'before'), before, { mode: 0o600 });
    await writeFile(join(scratch, 'after'), after, { mode: 0o600 });
    const result = await git(repo, ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--no-color', '--text', '--', join(scratch, 'before'), join(scratch, 'after')]);
    if (result.code > 1) throw new Error('Cannot produce diff');
    const lines = result.text.split('\n');
    const start = lines.findIndex(line => line.startsWith('@@ '));
    return start < 0 ? 'No text changes (check status and executable mode).' : lines.slice(start).join('\n');
  } finally { await rm(scratch, { recursive: true, force: true }); } // Only the two private preview files created above.
}

async function capture(repo: Repo, privateDir: string, preview = false): Promise<Review> {
  await safePath(repo.path, repo.path);
  const root = (await checked(repo, ['rev-parse', '--show-toplevel'])).trim();
  if (root !== repo.path) throw new HttpError(409, 'Repository root changed; register it again');
  const refResult = await git(repo, ['symbolic-ref', '-q', 'HEAD']);
  if (refResult.code !== 0 || !refResult.text.startsWith('refs/heads/')) throw new HttpError(409, 'Detached HEAD requires terminal reconciliation');
  const ref = refResult.text.trim();
  const headResult = await git(repo, ['rev-parse', '--verify', 'HEAD']);
  const head = headResult.code === 0 ? headResult.text.trim() : '';
  const index = (await checked(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
  if ((await checked(repo, ['rev-parse', '--shared-index-path'])).trim()) throw new HttpError(409, 'Split Git indexes require terminal reconciliation');
  for (const state of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
    const path = (await checked(repo, ['rev-parse', '--path-format=absolute', '--git-path', state])).trim();
    if (await lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw new HttpError(409, 'Finish the current merge/rebase/sequencer operation in your terminal');
  }
  const status = await checked(repo, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all']);
  const records = status.split('\0').filter(record => record && record.slice(3) !== '.omp-backlog' && !record.slice(3).startsWith('.omp-backlog/'));
  if (records.length > 100) throw new HttpError(413, 'More than 100 changed paths; reconcile in your terminal');
  const entries: Entry[] = [];
  const files: WorkspaceReview['files'] = [];
  let total = 0;
  for (const record of records) {
    const path = record.slice(3); const status = record.slice(0, 2);
    if (!safeName(path)) { files.push({ path, status, blocked: 'Sensitive or unsupported path; review in terminal' }); continue; }
    try {
      if (status.includes('U') || status === 'AA' || status === 'DD') throw new Error('Conflict');
      const stagedMode = await checked(repo, ['ls-files', '--stage', '--', path]);
      if (/^(120000|160000) /.test(stagedMode)) throw new Error('Link or submodule');
      const baseMode = head ? (await checked(repo, ['ls-tree', head, '--', path])).split(' ')[0] : '';
      if (['120000', '160000', '040000'].includes(baseMode)) throw new Error('Link, submodule or directory');
      await safePath(repo.path, join(repo.path, path), true);
      const info = await lstat(join(repo.path, path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)) throw new Error('Not an independent regular file');
      const attrs = await checked(repo, ['check-attr', '-z', 'filter', 'working-tree-encoding', '--', path]);
      const values = attrs.split('\0');
      for (let i = 2; i < values.length; i += 3) if (!['unspecified', 'unset', ''].includes(values[i])) throw new Error('Custom conversion requires terminal');
      const bytes = info ? await worktreeBytes(repo, path) : null;
      const current = bytes ? text(bytes) : '';
      let before = '';
      if (head) {
        const base = await git(repo, ['show', `${head}:${path}`]);
        if (base.code === 0) { if (Buffer.byteLength(base.text) > LIMIT) throw new Error('Too large'); before = text(Buffer.from(base.text)); }
      }
      total += Buffer.byteLength(before) + (bytes?.length ?? 0);
      if (total > 512 * 1024) throw new HttpError(413, 'Review exceeds 512 KiB; reconcile in your terminal');
      // Git compares only private, sanitized text copies: no project diff drivers.
      const mode = info && (info.mode & 0o111) ? '100755' : '100644';
      files.push({ path, status, before, after: current, mode: `${baseMode || 'absent'} → ${info ? mode : 'deleted'}`, ...(preview ? { diff: await diffPreview(repo, privateDir, before, current) } : {}) });
      entries.push({ path, bytes, mode });
    } catch (error) {
      if (error instanceof HttpError && error.status === 413 && total > 512 * 1024) throw error;
      files.push({ path, status, blocked: 'Sensitive content, binary/oversized file, conflict, link or custom conversion; review in terminal' });
    }
  }
  const fingerprint = digest(JSON.stringify({ head, ref, status, indexPath: index, index: digest(await indexBytes(index)), files: files.map(file => [file.path, file.status, file.before, file.after, file.blocked]), entries: entries.map(entry => [entry.path, entry.mode, entry.bytes && digest(entry.bytes)]) }));
  return { result: { id: randomUUID(), head: head || null, files }, entries, fingerprint, expires: Date.now() + AGE, head, ref, index };
}

export async function reviewWorkspace(store: Store, repo: Repo, handoffId: unknown): Promise<WorkspaceReview> {
  guard(store, repo, handoffId);
  let saved = reviews.get(store);
  if (!saved) { saved = new Map(); reviews.set(store, saved); }
  saved.delete(repo.id);
  for (const [id, review] of saved) if (review.expires < Date.now()) saved.delete(id);
  if (saved.size >= 20) throw new HttpError(409, 'Too many open workspace reviews; wait for a review to expire');
  const review = await capture(repo, store.dataDir, true);
  guard(store, repo, handoffId);
  review.handoffId = handoffId;
  saved.set(repo.id, review);
  return review.result;
}

export async function commitWorkspace(store: Store, repo: Repo, input: Record<string, unknown>): Promise<{ commit: string }> {
  guard(store, repo, input.handoffId);
  const saved = reviews.get(store)?.get(repo.id);
  if (!saved || input.reviewId !== saved.result.id || saved.handoffId !== input.handoffId || saved.expires < Date.now()) throw new HttpError(409, 'Review expired or changed; reload changes before committing');
  if (input.confirm !== true || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000 || Array.from(input.message).some(char => { const code = char.charCodeAt(0); return (code < 32 && code !== 9 && code !== 10) || code === 127; })) throw new HttpError(400, 'Confirm the commit and enter a message (1–2000 characters)');
  try { text(Buffer.from(input.message)); } catch { throw new HttpError(400, 'Commit message may contain credentials; remove them'); }
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 100 || input.files.some(path => typeof path !== 'string') || new Set(input.files).size !== input.files.length) throw new HttpError(400, 'Select unique reviewed files');
  const selected = input.files.map(path => saved.entries.find(entry => entry.path === path));
  if (selected.some(entry => !entry)) throw new HttpError(400, 'Only selectable reviewed files may be committed');
  reviews.get(store)!.delete(repo.id); // No automatic replay after an uncertain outcome.
  let lock;
  try { lock = await open(`${saved.index}.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch { throw new HttpError(409, 'Git index is locked or unavailable; inspect it in your terminal and review again'); }
  let scratch = '';
  let published = '';
  let synchronized = false;
  try {
    scratch = await mkdtemp(join(store.dataDir, 'workspace-commit-'));
    await chmod(scratch, 0o700);
    if ((await capture(repo, store.dataDir)).fingerprint !== saved.fingerprint) throw new HttpError(409, 'Workspace changed since review; reload changes before committing');
    const commitIndex = join(scratch, 'commit-index');
    const finalIndex = join(scratch, 'final-index');
    const original = await indexBytes(saved.index);
    if (original.length) await writeFile(finalIndex, original, { mode: 0o600 });
    else await checked(repo, ['read-tree', '--empty'], finalIndex);
    await checked(repo, saved.head ? ['read-tree', saved.head] : ['read-tree', '--empty'], commitIndex);
    for (const entry of selected as Entry[]) {
      if (entry.bytes !== null) {
        const blob = (await checked(repo, ['hash-object', '-w', '--no-filters', '--stdin'], undefined, entry.bytes)).trim();
        for (const index of [commitIndex, finalIndex]) await checked(repo, ['update-index', '--add', '--cacheinfo', entry.mode, blob, entry.path], index);
      } else {
        for (const index of [commitIndex, finalIndex]) await checked(repo, ['update-index', '--force-remove', '--', entry.path], index);
      }
    }
    const tree = (await checked(repo, ['write-tree'], commitIndex)).trim();
    if (saved.head && tree === (await checked(repo, ['rev-parse', `${saved.head}^{tree}`])).trim()) throw new HttpError(409, 'Selected files have no changes relative to HEAD');
    const commit = (await checked(repo, ['commit-tree', tree, ...(saved.head ? ['-p', saved.head] : []), '-F', '-'], undefined, Buffer.from(input.message.trim() + '\n'))).trim();
    await lock.writeFile(await readFile(finalIndex)); await lock.sync();
    if ((await capture(repo, store.dataDir)).fingerprint !== saved.fingerprint) throw new HttpError(409, 'Workspace changed during commit preparation; review again');
    guard(store, repo, input.handoffId);
    await checked(repo, ['update-ref', '-m', 'operator workspace commit', saved.ref, commit, saved.head || '0'.repeat(commit.length)]);
    published = commit;
    await rename(`${saved.index}.lock`, saved.index);
    synchronized = true;
    return { commit }; // Deliberately do not clear handoff or wake the scheduler.
  } catch (error) {
    if (published) throw new HttpError(409, `Commit ${published} was created, but index synchronization failed. Inspect Git in your terminal; do not retry blindly.`);
    throw error;
  } finally {
    await lock.close();
    if (!synchronized) await rm(`${saved.index}.lock`, { force: true });
    if (scratch) await rm(scratch, { recursive: true, force: true }); // Only this operation's private temporary indexes.
  }
}
