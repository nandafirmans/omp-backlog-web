import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { within } from './store';
import { HttpError } from './tickets';

interface Completion { label: string; value: string; description?: string }
interface Result { items: Completion[]; truncated: boolean }
const MAX_RESULTS = 80;
const MAX_ENTRIES = 20000;
const MAX_PATH = 1024;
const MAX_SKILLS = 256;
const MAX_METADATA = 32768;

function unavailable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(String(error.code));
}
function safeName(path: string): boolean {
  if (!path || path.length > MAX_PATH || isAbsolute(path) || /[\p{Cc}\\"]/u.test(path)) return false;
  return path.split('/').every(part => part && part !== '.' && part !== '..' && !/^(?:\.git|node_modules|\.omp-backlog|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc|\.pypirc|\.env.*|.*(?:credentials|secrets?).*|(?:.*[._-])?keys?(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore))$/i.test(part));
}
async function safeFile(root: string, path: string, privateDir: string): Promise<boolean> {
  let current = root;
  try {
    for (const part of path.split('/')) {
      current = join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink()) return false;
      if (current !== join(root, path) && !info.isDirectory()) return false;
    }
    const canonical = await realpath(current);
    return within(root, canonical) && !within(privateDir, canonical) && (await lstat(canonical)).isFile();
  } catch (error) { if (unavailable(error)) return false; throw error; }
}
async function fileCompletions(root: string, git: boolean, query: string, privateDir: string): Promise<Result> {
  const items: Completion[] = [];
  const seen = new Set<string>();
  let truncated = false;
  let visited = 0;
  const add = async (path: string) => {
    if (!safeName(path) || seen.has(path) || !path.toLowerCase().includes(query)) return;
    seen.add(path);
    if (!await safeFile(root, path, privateDir)) return;
    if (items.length >= MAX_RESULTS) { truncated = true; return; }
    items.push({ label: path, value: /[^a-zA-Z0-9_./-]|\.$/.test(path) ? `@"${path}"` : `@${path}` });
  };
  if (git) {
    // No shell, hooks, pager, or optional index writes; only filenames leave git.
    const child = Bun.spawn(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'], { stdout: 'pipe', stderr: 'ignore', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    const timer = setTimeout(() => { truncated = true; child.kill(); }, 3000);
    const reader = child.stdout.getReader();
    let pending = Buffer.alloc(0);
    let bytes = 0;
    try {
      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 2 * 1024 * 1024) { truncated = true; break; }
        pending = Buffer.concat([pending, value]);
        let end: number;
        let start = 0;
        while ((end = pending.indexOf(0, start)) !== -1) {
          if (++visited > MAX_ENTRIES) { truncated = true; break outer; }
          await add(pending.subarray(start, end).toString('utf8'));
          start = end + 1;
          if (truncated) break outer;
        }
        pending = pending.subarray(start);
        if (pending.length > MAX_PATH * 4) { truncated = true; break; }
      }
    } catch (error) { child.kill(); clearTimeout(timer); throw error; }
    finally { if (truncated) child.kill(); await reader.cancel(); }
    let code: number;
    try { code = await child.exited; } finally { clearTimeout(timer); }
    if (code !== 0 && !truncated) throw new HttpError(400, 'Cannot enumerate repository files with git');
  } else {
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > 32) { truncated = true; return; }
      try {
        const canonical = await realpath(directory);
        if (!within(root, canonical) || within(privateDir, canonical)) return;
        const entries = await opendir(directory);
        for await (const entry of entries) {
          if (++visited > MAX_ENTRIES) { truncated = true; break; }
          const path = join(directory, entry.name);
          const name = relative(root, path);
          if (!safeName(name) || entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await walk(path, depth + 1);
          else if (entry.isFile()) await add(name);
          if (truncated) break;
        }
      } catch (error) { if (!unavailable(error)) throw error; }
    };
    await walk(root, 0);
  }
  return { items: items.sort((a, b) => a.label.localeCompare(b.label)), truncated };
}

// These are native OMP and Agent Dirs provider defaults from the installed CLI.
// Only SKILL.md frontmatter is returned, never the skill body or arbitrary config.
async function skillCompletions(root: string, query: string, privateDir: string, home: string, resolved?: Map<string, Uint8Array>): Promise<Result> {
  const agent = process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR.replace(/^~\//, `${home}/`)) : join(home, '.omp', 'agent');
  const roots = [
    { path: join(root, '.omp', 'skills'), boundary: root, required: true },
    ...['.agent', '.agents'].map(name => ({ path: join(root, name, 'skills'), boundary: root, required: false })),
    { path: join(agent, 'skills'), boundary: agent, required: true },
    { path: join(agent, 'managed-skills'), boundary: agent, required: true },
    ...['.agent', '.agents'].map(name => ({ path: join(home, name, 'skills'), boundary: home, required: false })),
  ];
  const items = new Map<string, Completion>();
  let visited = 0;
  let metadata = 0;
  let truncated = false;
  for (const source of roots) {
    try {
      const boundary = await realpath(source.boundary);
      const directory = await realpath(source.path);
      if (!within(boundary, directory) || within(privateDir, directory)) continue;
      const entries = await opendir(directory);
      for await (const entry of entries) {
        if (++visited > MAX_ENTRIES || metadata >= MAX_SKILLS) { truncated = true; break; }
        if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
        try {
          const original = join(source.path, entry.name, 'SKILL.md');
          if (resolved && !await safeFile(boundary, relative(boundary, original), privateDir)) continue;
          const skill = await realpath(join(directory, entry.name, 'SKILL.md'));
          if (!within(boundary, skill) || within(privateDir, skill) || !safeName(relative(boundary, skill))) continue;
          let text: string;
          let prepared: Uint8Array | undefined;
          if (resolved) {
            try {
              prepared = await readDraftFile(boundary, relative(boundary, original), privateDir, MAX_METADATA);
              text = new TextDecoder('utf-8', { fatal: true }).decode(prepared);
              metadata++;
            } catch (error) {
              if (error instanceof HttpError || error instanceof TypeError) { truncated = true; continue; }
              throw error;
            }
          } else {
            const file = await open(skill, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
            try {
              const info = await file.stat();
              if (!info.isFile() || info.size > MAX_METADATA) { truncated = true; continue; }
              metadata++;
              const bytes = Buffer.alloc(MAX_METADATA + 1);
              const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
              if (bytesRead > MAX_METADATA) { truncated = true; continue; }
              text = bytes.subarray(0, bytesRead).toString('utf8');
            } finally { await file.close(); }
          }
          const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
          let fields: Record<string, unknown>;
          try { fields = match ? Bun.YAML.parse(match[1]) as Record<string, unknown> : {}; } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
          if (!fields || typeof fields !== 'object' || fields.enabled === false) continue;
          const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : basename(entry.name);
          const description = typeof fields.description === 'string' ? fields.description.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || (source.required && !description) || !`${name} ${description}`.toLowerCase().includes(query) || items.has(name)) continue;
          items.set(name, { label: name, value: `/skill:${name}`, ...(description ? { description } : {}) });
          if (resolved && prepared) resolved.set(name, prepared);
        } catch (error) { if (!unavailable(error)) throw error; }
      }
    } catch (error) { if (!unavailable(error)) throw error; }
    if (visited > MAX_ENTRIES || metadata >= MAX_SKILLS) break;
  }
  const sorted = [...items.values()].sort((a, b) => a.label.localeCompare(b.label));
  return { items: sorted.slice(0, MAX_RESULTS), truncated: truncated || sorted.length > MAX_RESULTS };
}

export async function completions(root: string, git: boolean, privateDir: string, kind: string | null, query: string, home = homedir()): Promise<Result> {
  if (kind !== 'skill' && kind !== 'file') throw new HttpError(400, 'Completion kind must be skill or file');
  if (query.length > 200 || /\p{Cc}/u.test(query)) throw new HttpError(400, 'Invalid completion query');
  return kind === 'skill' ? skillCompletions(root, query.toLowerCase(), privateDir, home) : fileCompletions(root, git, query.toLowerCase(), privateDir);
}

/** Completion discovery is not authorization: every actual context read is checked again. */
async function readDraftFile(root: string, name: string, privateDir: string, limit: number): Promise<Uint8Array> {
  const canonical = await realpath(root);
  if (canonical !== resolve(root) || !safeName(name) || !await safeFile(canonical, name, privateDir)) throw new HttpError(400, 'Reference is unavailable, private, sensitive, or a symlink');
  const path = join(canonical, name);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new HttpError(400, `Reference must be a regular file no larger than ${limit} bytes; no partial extraction is sent`);
    const currentBeforeRead = await lstat(path);
    if (currentBeforeRead.dev !== info.dev || currentBeforeRead.ino !== info.ino || !await safeFile(canonical, name, privateDir)
      || process.platform === 'linux' && await realpath(`/proc/self/fd/${file.fd}`) !== path) throw new HttpError(400, 'Reference changed or traversed a symlink before reading');
    const bytes = Buffer.alloc(limit + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const next = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!next.bytesRead) break;
      bytesRead += next.bytesRead;
    }
    const current = await lstat(path);
    if (bytesRead > limit || bytesRead !== info.size || current.size !== info.size || current.mtimeMs !== info.mtimeMs || current.dev !== info.dev || current.ino !== info.ino || !await safeFile(canonical, name, privateDir)) throw new HttpError(400, 'Reference changed while preparing; select it again');
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}

export async function resolveDraftReference(root: string, privateDir: string, kind: 'file' | 'skill', name: string, home = homedir()): Promise<Uint8Array> {
  if (kind === 'file') {
    if (name.split('/').some(part => /^(?:\.omp|\.agents?|\.claude|\.codex|\.config|\.cache|\.local|\.kube|\.docker|agent\.db)$/i.test(part)
      || /(?:^|[._-])(?:auth|cookies?|sessions?|tokens?|kubeconfig)(?:$|[._-](?:json|ya?ml|db|sqlite|txt|log|bak)$)/i.test(part))) throw new HttpError(400, 'Private authentication, cookie, session, token or configuration paths cannot be included as repository context');
    return readDraftFile(root, name, privateDir, 128 * 1024);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new HttpError(400, 'Invalid skill reference');
  const bodies = new Map<string, Uint8Array>();
  await skillCompletions(root, name.toLowerCase(), privateDir, home, bodies);
  const body = bodies.get(name);
  if (!body) throw new HttpError(400, 'Installed skill text is unavailable, oversized, disabled, private, or a symlink; skill scripts are never executed');
  return body;
}
