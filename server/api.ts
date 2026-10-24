import { access, readdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { Repo, Runtime, Settings, Store } from './contracts';
import { database, digest, subscribe, token, within } from './store';
import { HttpError, MAX_ATTACHMENT, MAX_MARKDOWN, readSafe, reconcileTickets, ticketDirectory, uploadAttachment, validAttachmentName, writeTicket } from './tickets';
import { completions } from './completions';
import { requestOrigin, parseRemoteOrigin } from './access';
import { proofDownload } from './evidence';
import { inspectWorkspaceHandoff } from './runtime';
import { handleDraftRequest } from './drafting';
import { handleAssistedCreation } from './assisted-creation';

interface Session { id: string; csrf: string; authenticated: number; expires: number }
interface Owner { username: string; hash: string }
const SESSION_AGE = 12 * 60 * 60 * 1000;
function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
function equal(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  const raw = await limitedBody(request, MAX_MARKDOWN + 8192);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new HttpError(400, 'Malformed JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object');
  return value as Record<string, unknown>;
}
async function limitedBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(declared) || declared > maximum) throw new HttpError(413, 'Request is too large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new HttpError(413, 'Request is too large'); } chunks.push(value); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
function string(value: unknown, field: string, max = 10000): string { if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `Invalid ${field}`); return value; }
export async function permittedPath(store: Store, requested: string): Promise<string> {
  const path = await realpath(resolve(requested)).catch(() => { throw new HttpError(400, 'Directory does not exist or cannot be accessed'); });
  const roots = await Promise.all(store.settings().roots.map(root => realpath(root).catch(() => null)));
  if (!roots.some(root => root && within(root, path))) throw new HttpError(403, 'Choose a directory inside a permitted root');
  if (within(path, store.dataDir) || within(store.dataDir, path)) throw new HttpError(400, 'Application data must remain outside registered repositories');
  if (!(await stat(path)).isDirectory()) throw new HttpError(400, 'Choose a directory');
  await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
  return path;
}
export function createApi(store: Store, runtime: Runtime, remoteOrigin?: string): (request: Request) => Promise<Response> {
  const db = database(store);
  const allowedRemoteOrigin = parseRemoteOrigin(remoteOrigin);
  return async request => {
    try {
      const url = new URL(request.url);
      const host = request.headers.get('host') || url.host;
      if (host !== url.host || url.origin !== requestOrigin(host, allowedRemoteOrigin)) throw new HttpError(403, 'Invalid Host');
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== url.origin) throw new HttpError(403, 'Cross-origin requests are not permitted');
      if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site requests are not permitted');
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      if (mutation && !origin) throw new HttpError(403, 'Mutations require the same-origin Origin header');
      const secureCookie = url.protocol === 'https:' ? '; Secure' : '';
      if (url.pathname === '/api/health' && ['GET', 'HEAD'].includes(request.method)) return json({ status: 'ok', runtime: 'bun', executionEnabled: Boolean(db.query('SELECT id FROM owner WHERE id=1').get()) });
      db.query('DELETE FROM sessions WHERE expires < ?').run(Date.now());
      const rawCookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('omp_session='))?.slice(12);
      let session = rawCookie && /^[a-f0-9]{64}$/.test(rawCookie) ? db.query('SELECT * FROM sessions WHERE id=? AND expires>?').get(digest(rawCookie), Date.now()) as Session | null : null;
      if (url.pathname === '/api/session' && request.method === 'GET') {
        let cookie: string | undefined;
        if (!session) { const raw = token(); session = { id: digest(raw), csrf: token(), authenticated: 0, expires: Date.now() + SESSION_AGE }; db.query('INSERT INTO sessions VALUES(?,?,?,?)').run(session.id, session.csrf, 0, session.expires); cookie = `omp_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE / 1000}${secureCookie}`; }
        return json({ authenticated: Boolean(session.authenticated), configured: Boolean(db.query('SELECT id FROM owner WHERE id=1').get()), csrf: session.csrf }, 200, cookie ? { 'Set-Cookie': cookie } : undefined);
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        const input = await body(request);
        const username = string(input.username, 'username', 100);
        const password = string(input.password, 'password', 1024);
        const throttle = db.query('SELECT failures,until_at FROM throttle WHERE id=1').get() as { failures: number; until_at: number } | null;
        if (throttle && throttle.until_at > Date.now()) return json({ error: 'Too many attempts. Wait before trying again.' }, 429, { 'Retry-After': String(Math.ceil((throttle.until_at - Date.now()) / 1000)) });
        const owner = db.query('SELECT username,hash FROM owner WHERE id=1').get() as Owner | null;
        if (!owner) throw new HttpError(503, 'Owner is not configured. Run bun server/setup.ts in a terminal.');
        const valid = await Bun.password.verify(password, owner.hash);
        if (!equal(username, owner.username) || !valid) {
          const failures = (throttle?.failures || 0) + 1;
          const delay = failures < 5 ? 0 : Math.min(15 * 60 * 1000, 1000 * 2 ** Math.min(failures - 5, 10));
          db.query('INSERT INTO throttle VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET failures=excluded.failures,until_at=excluded.until_at').run(failures, Date.now() + delay);
          throw new HttpError(401, 'Incorrect username or password');
        }
        db.query('DELETE FROM throttle').run();
        if (session) db.query('DELETE FROM sessions WHERE id=?').run(session.id);
        const raw = token(); const csrf = token();
        db.query('INSERT INTO sessions VALUES(?,?,1,?)').run(digest(raw), csrf, Date.now() + SESSION_AGE);
        return json({ csrf }, 200, { 'Set-Cookie': `omp_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_AGE / 1000}${secureCookie}` });
      }
      if (!session?.authenticated) throw new HttpError(401, 'Authentication required');
      if (mutation && !equal(request.headers.get('x-csrf-token') || '', session.csrf)) throw new HttpError(403, 'Invalid CSRF token; reload the session');
      if (url.pathname === '/api/logout' && request.method === 'POST') { db.query('DELETE FROM sessions WHERE id=?').run(session.id); return json({ ok: true }, 200, { 'Set-Cookie': `omp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}` }); }
      if (url.pathname === '/api/state' && request.method === 'GET') return json({ repos: store.list('repos'), tickets: store.list('tickets'), runs: store.list('runs'), settings: store.settings() });
      if (url.pathname === '/api/events' && request.method === 'GET') {
        const currentSession = session;
        let cleanup = () => {};
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const send = () => controller.enqueue(encoder.encode('event: change\ndata: {}\n\n'));
            const unsubscribe = subscribe(store, send);
            const timer = setInterval(() => {
              if (!db.query('SELECT id FROM sessions WHERE id=? AND expires>?').get(currentSession.id, Date.now())) { cleanup(); controller.close(); return; }
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
            }, 15000);
            cleanup = () => { clearInterval(timer); unsubscribe(); };
            request.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* Already closed. */ } }, { once: true });
            send();
          },
          cancel() { cleanup(); },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
      }
      if (url.pathname === '/api/folders' && request.method === 'GET') {
        const requested = url.searchParams.get('path');
        if (!requested) return json({ path: '', parent: null, directories: store.settings().roots });
        const path = await permittedPath(store, requested);
        const entries = await readdir(path, { withFileTypes: true });
        const directories: string[] = [];
        for (const entry of entries) { if (!entry.isDirectory() && !entry.isSymbolicLink()) continue; try { const child = await permittedPath(store, join(path, entry.name)); directories.push(child); } catch { /* Outside roots or private data. */ } }
        let parent: string | null = null;
        if (dirname(path) !== path) { try { parent = await permittedPath(store, dirname(path)); } catch { /* At permitted root. */ } }
        return json({ path, parent, directories: [...new Set(directories)].sort() });
      }
      if (url.pathname === '/api/repos' && request.method === 'POST') {
        const input = await body(request);
        let path = await permittedPath(store, string(input.path, 'path'));
        const gitResult = Bun.spawn(['git', '-C', path, 'rev-parse', '--show-toplevel'], { stdout: 'pipe', stderr: 'ignore' });
        const output = (await new Response(gitResult.stdout).text()).trim();
        const git = await gitResult.exited === 0;
        if (git) path = await permittedPath(store, output);
        if (store.list('repos').some(repo => repo.path === path)) throw new HttpError(409, 'This canonical repository is already registered');
        const repo: Repo = { id: randomUUID(), name: basename(path), path, git, mode: 'paused', lastStarted: 0 };
        store.save('repos', repo); await reconcileTickets(store, true); runtime.wake(); return json(repo, 201);
      }
      if (url.pathname === '/api/settings' && request.method === 'PATCH') {
        const input = await body(request); const settings = store.settings();
        if (Object.keys(input).some(key => !['executable', 'model', 'roots', 'timeLimitMinutes', 'tokenBudget', 'paused'].includes(key))) throw new HttpError(400, 'Unknown setting');
        if (input.executable !== undefined) { settings.executable = string(input.executable, 'executable', 4096).trim(); if (!settings.executable || settings.executable.includes('\0')) throw new HttpError(400, 'Set an OMP executable path or command'); }
        if (input.model !== undefined) settings.model = string(input.model, 'model', 200);
        for (const key of ['timeLimitMinutes', 'tokenBudget'] as const) { if (input[key] !== undefined) { const value = input[key]; const max = key === 'timeLimitMinutes' ? 1440 : 10000000; if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) throw new HttpError(400, `Invalid ${key}`); settings[key] = value; } }
        if (input.paused !== undefined) { if (typeof input.paused !== 'boolean') throw new HttpError(400, 'paused must be boolean'); settings.paused = input.paused; }
        if (input.roots !== undefined) {
          if (!Array.isArray(input.roots) || !input.roots.length || input.roots.length > 20) throw new HttpError(400, 'Provide 1–20 permitted roots');
          const roots: string[] = [];
          for (const value of input.roots) { const root = await realpath(string(value, 'root', 4096)); if (!(await stat(root)).isDirectory() || within(root, store.dataDir) || within(store.dataDir, root)) throw new HttpError(400, 'Roots must be directories and cannot contain private application data'); roots.push(root); }
          settings.roots = [...new Set(roots)];
        }
        store.setSettings(settings satisfies Settings); runtime.wake(); return json(settings);
      }
      let segments: string[];
      try { segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { throw new HttpError(400, 'Invalid route encoding'); }
      if (segments.some(part => part.includes('/') || part.includes('\\') || part === '..' || part.includes('\0'))) throw new HttpError(400, 'Unsafe route path');
      if (segments[1] === 'repos' && segments[2]) {
        const repo = store.get('repos', segments[2]); if (!repo) throw new HttpError(404, 'Repository not found');
        if (segments[3] === 'drafts') {
          await permittedPath(store, repo.path);
          return await handleDraftRequest(store, repo, request, segments);
        }
        if (segments.length === 4 && (segments[3] === 'assisted-prepare' || segments[3] === 'assisted-create') && request.method === 'POST') {
          await permittedPath(store, repo.path);
          const response = await handleAssistedCreation(store, repo, request, segments[3]);
          if (segments[3] === 'assisted-create' && response.ok) runtime.wake();
          return response;
        }
        if (segments[3] === 'completions' && segments.length === 4 && request.method === 'GET') {
          const path = await permittedPath(store, repo.path);
          return json(await completions(path, repo.git, store.dataDir, url.searchParams.get('kind'), url.searchParams.get('q') || ''));
        }
        if (segments.length === 3 && request.method === 'PATCH') { const input = await body(request); if (!['paused', 'approved', 'automatic'].includes(String(input.mode))) throw new HttpError(400, 'Invalid execution mode'); const mode = input.mode as Repo['mode']; const updated = { ...(store.get('repos', repo.id) ?? repo), mode }; store.save('repos', updated); runtime.wake(); return json(updated); }
        if (segments.length === 4 && segments[3] === 'reconcile-workspace' && request.method === 'POST') {
          const input = await body(request);
          if (!repo.handoff || input.handoffId !== repo.handoff.id) throw new HttpError(409, 'Workspace handoff changed; review the current gate');
          const claimed = () => store.list('runs').some(run => run.repoId === repo.id && ['running', 'stopping', 'paused'].includes(run.status));
          if (claimed()) throw new HttpError(409, 'Stop or finish owned work before reconciling the workspace');
          await permittedPath(store, repo.path);
          const handoff = await inspectWorkspaceHandoff(repo, repo.handoff.runId);
          const current = store.get('repos', repo.id);
          if (!current?.handoff || current.handoff.id !== input.handoffId || claimed()) throw new HttpError(409, 'Workspace state changed during inspection; review again');
          if (handoff) {
            store.save('repos', { ...current, handoff: { ...handoff, id: current.handoff.id } });
            throw new HttpError(409, 'Workspace still needs operator reconciliation. No files changed by this check.');
          }
          const updated: Repo = { ...current, handoff: undefined };
          store.save('repos', updated); runtime.wake(); return json(updated);
        }
        if (segments[3] === 'tickets' && segments.length === 4 && request.method === 'POST') { const input = await body(request); const ticket = await writeTicket(store, repo, string(input.markdown, 'markdown', MAX_MARKDOWN)); runtime.wake(); return json(ticket, 201); }
        if (segments[3] === 'tickets' && segments[4]) {
          const id = segments[4];
          if (segments.length === 5 && request.method === 'PUT') { const input = await body(request); const ticket = await writeTicket(store, repo, string(input.markdown, 'markdown', MAX_MARKDOWN), string(input.revision, 'revision', 64), id); runtime.wake(); return json(ticket); }
          if (segments[5] === 'attachments' && segments.length === 6 && request.method === 'POST') {
            if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new HttpError(415, 'Use multipart form data');
            const bytes = await limitedBody(request, MAX_ATTACHMENT + 65536);
            const form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
            const file = form.get('file');
            if (!(file instanceof File)) throw new HttpError(400, 'Select a file');
            const ticket = await uploadAttachment(store, repo, id, file.name, new Uint8Array(await file.arrayBuffer()), string(form.get('revision'), 'revision', 64)); runtime.wake(); return json(ticket, 201);
          }
          if (segments[5] === 'attachments' && segments[6] && segments.length === 7 && request.method === 'GET') {
            const name = segments[6]; if (!validAttachmentName(name)) throw new HttpError(400, 'Invalid attachment');
            const path = join(await ticketDirectory(repo, id), 'attachments', name);
            const bytes = await readSafe(repo.path, path, MAX_ATTACHMENT);
            const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
            const imageType = images[extname(name).toLowerCase()];
            return new Response(Buffer.from(bytes), { headers: { 'Content-Type': imageType || 'application/octet-stream', 'Content-Disposition': `${imageType ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'no-store' } });
          }
        }
      }
      if (segments[1] === 'tickets' && segments.length === 5 && segments[4] === 'action' && request.method === 'POST') {
        const input = await body(request); await reconcileTickets(store, true);
        const ticket = store.get('tickets', `${segments[2]}/${segments[3]}`);
        if (!ticket || ticket.removed) throw new HttpError(404, 'Ticket not found');
        if (input.revision !== ticket.revision) throw new HttpError(409, 'Requirements changed; review the current revision first');
        const action = string(input.action, 'action', 20);
        if (action === 'reorder') { if (typeof input.order !== 'number' || !Number.isFinite(input.order)) throw new HttpError(400, 'Invalid order'); ticket.order = input.order; }
        else if (action === 'approve') { if (ticket.error) throw new HttpError(400, ticket.error); if (['running', 'stopping', 'paused', 'needs_review', 'done', 'interrupted', 'failed', 'blocked'].includes(ticket.status)) throw new HttpError(409, 'Use the appropriate review, retry, or run control action'); ticket.approvedRevision = ticket.revision; ticket.status = 'ready'; }
        else if (action === 'retry') { if (!['failed', 'blocked', 'interrupted', 'draft'].includes(ticket.status)) throw new HttpError(409, 'This ticket cannot be retried'); if (ticket.error) throw new HttpError(400, ticket.error); ticket.approvedRevision = ticket.revision; ticket.status = 'ready'; }
        else if (action === 'done' || action === 'changes') {
          const run = ticket.runId ? store.get('runs', ticket.runId) : undefined;
          if (ticket.status !== 'needs_review' || !run || run.revision !== ticket.revision) throw new HttpError(409, 'Only evidence for this revision may be reviewed');
          if (action === 'done') { if (!run.evidence.length) throw new HttpError(409, 'Review requires recorded acceptance evidence'); ticket.status = 'done'; run.status = 'done'; }
          else {
            const feedback = string(input.feedback, 'review feedback', 4000).trim();
            if (!feedback) throw new HttpError(400, 'Describe the required changes before queuing another attempt');
            run.reviewFeedback = { message: feedback, recorded: Date.now() };
            ticket.status = 'ready'; ticket.approvedRevision = ticket.revision;
          }
          store.save('runs', run);
        } else throw new HttpError(400, 'Unknown ticket action');
        store.save('tickets', ticket); runtime.wake(); return json(ticket);
      }
      if (segments[1] === 'runs' && segments[2]) {
        const run = store.get('runs', segments[2]); if (!run) throw new HttpError(404, 'Run not found');
        if (segments.length === 3 && request.method === 'GET') return json(run);
        if (segments.length === 5 && segments[3] === 'proof' && request.method === 'GET') return await proofDownload(store, run, segments[4]!);
        if (segments.length === 4 && request.method === 'POST') {
          const input = await body(request);
          if (segments[3] === 'control') { if (input.action !== 'pause' && input.action !== 'resume') throw new HttpError(400, 'Invalid run control'); await runtime.control(run.id, input.action); return json(store.get('runs', run.id)); }
          if (segments[3] === 'answer') { await runtime.answer(run.id, input); return json({ ok: true }); }
        }
      }
      throw new HttpError(404, 'API route not found');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      if (error instanceof Error && 'code' in error) { if (error.code === 'ENOENT') return json({ error: 'File or directory not found' }, 404); if (error.code === 'EACCES' || error.code === 'EPERM') return json({ error: 'Filesystem permission denied' }, 403); if (error.code === 'EEXIST') return json({ error: 'File already exists; reload before saving' }, 409); }
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400);
    }
  };
}
