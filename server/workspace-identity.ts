import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Repo, Store, WorkspaceIdentity } from './contracts';
import { within } from './store';
import { HttpError } from './tickets';

const CLAIMED = ['running', 'stopping', 'paused'];
const unavailable = () => new HttpError(409, 'Workspace identity is unavailable or changed; restore repository access and inspect before retrying');

function valid(identity: WorkspaceIdentity | undefined): identity is WorkspaceIdentity {
  if (!identity || typeof identity.root !== 'string' || !isAbsolute(identity.root) || typeof identity.rootDev !== 'string' || typeof identity.rootIno !== 'string' || !/^\d+$/.test(identity.rootDev) || !/^\d+$/.test(identity.rootIno)) return false;
  return identity.commonDir === undefined
    ? identity.commonDev === undefined && identity.commonIno === undefined
    : typeof identity.commonDir === 'string' && isAbsolute(identity.commonDir) && typeof identity.commonDev === 'string' && typeof identity.commonIno === 'string' && /^\d+$/.test(identity.commonDev) && /^\d+$/.test(identity.commonIno);
}

async function gitMarker(root: string): Promise<boolean> {
  for (let directory = root;; directory = dirname(directory)) {
    try { await lstat(join(directory, '.git')); return true; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    if (dirname(directory) === directory) break;
  }
  // Bare repositories have no .git entry, but failed Git inspection must not hide them.
  try { await lstat(join(root, 'HEAD')); await lstat(join(root, 'objects')); return true; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  return false;
}

export async function inspectWorkspaceIdentity(repo: Repo): Promise<WorkspaceIdentity> {
  try {
    const root = await realpath(repo.path);
    const before = await stat(root, { bigint: true });
    if (!before.isDirectory()) throw unavailable();
    const identity: WorkspaceIdentity = { root, rootDev: String(before.dev), rootIno: String(before.ino) };
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const child = Bun.spawn(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' },
      stdin: 'ignore', stdout: 'pipe', stderr: 'ignore',
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 5000);
    const reader = child.stdout.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 64 * 1024) { child.kill(); throw unavailable(); }
        chunks.push(value);
      }
      const code = await child.exited;
      if (timedOut) throw unavailable();
      if (code === 0) {
        const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        if (!output.endsWith('\n') || !output.slice(0, -1) || /[\r\n\0]/.test(output.slice(0, -1))) throw unavailable();
        const commonDir = await realpath(resolve(root, output.slice(0, -1)));
        const common = await stat(commonDir, { bigint: true });
        if (!common.isDirectory()) throw unavailable();
        Object.assign(identity, { commonDir, commonDev: String(common.dev), commonIno: String(common.ino) });
      } else if (code !== 128 || repo.git || await gitMarker(root)) throw unavailable();
    } finally { clearTimeout(timer); await reader.cancel(); }
    const after = await stat(root, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || await realpath(repo.path) !== root) throw unavailable();
    return identity;
  } catch { throw unavailable(); }
}

export function workspaceConflict(a: WorkspaceIdentity, b: WorkspaceIdentity): boolean {
  if (!valid(a) || !valid(b)) return true;
  const left = [{ path: a.root, dev: a.rootDev, ino: a.rootIno }, ...(a.commonDir ? [{ path: a.commonDir, dev: a.commonDev!, ino: a.commonIno! }] : [])];
  const right = [{ path: b.root, dev: b.rootDev, ino: b.rootIno }, ...(b.commonDir ? [{ path: b.commonDir, dev: b.commonDev!, ino: b.commonIno! }] : [])];
  return left.some(x => right.some(y => x.dev === y.dev && x.ino === y.ino || within(x.path, y.path) || within(y.path, x.path)));
}

export function claimedWorkspaceConflict(store: Store, repo: Repo, identity: WorkspaceIdentity, excludeRunId?: string): boolean {
  if (!valid(identity)) return true;
  return store.list('runs').some(run => run.id !== excludeRunId && CLAIMED.includes(run.status)
    && (run.repoId === repo.id || !valid(run.workspace) || workspaceConflict(identity, run.workspace)));
}

export async function assertWorkspaceIdentity(repo: Repo, expected: WorkspaceIdentity): Promise<void> {
  if (!valid(expected)) throw unavailable();
  const actual = await inspectWorkspaceIdentity(repo);
  if (actual.root !== expected.root || actual.rootDev !== expected.rootDev || actual.rootIno !== expected.rootIno
    || actual.commonDir !== expected.commonDir || actual.commonDev !== expected.commonDev || actual.commonIno !== expected.commonIno) throw unavailable();
}
