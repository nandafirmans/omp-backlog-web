import { constants, readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';
import type { Candidate, HostVerification, Publication, Repo, Run, Store, VerificationRecipe } from './contracts';
import { digest, within } from './store';
import { HttpError, reconcileTickets, safePath } from './tickets';
import { redactTranscript } from './transcript';
import { workspaceInternals as w, workspaceOperation } from './workspace-commit';
import type { WorkspaceCapture } from './workspace-commit';
import { assertWorkspaceIdentity } from './workspace-identity';

function reject(message: string): never { throw new HttpError(409, message); }
function policy(store: Store, repo: Repo, run: Run) {
  const life = run.lifecycle;
  const current = store.get('repos', repo.id)?.completion;
  if (!life || current?.mode !== 'autonomous' || current.revision !== life.policy.revision || current.recipeHash !== life.recipeHash) reject('Autonomous policy changed or was revoked');
  return life;
}
async function inspect(store: Store, repo: Repo) {
  if (!repo.git || store.get('repos', repo.id)?.path !== repo.path) reject('Repository registration changed');
  const root = store.settings().roots.find(root => within(root, repo.path));
  if (!root) reject('Repository root is no longer admitted');
  await safePath(root, repo.path);
  const flags = await w.checked(repo, ['ls-files', '-v', '-z']);
  if (flags.split('\0').some(line => line && !line.startsWith('H '))) reject('Unsupported Git index flags');
  const staged = await w.checked(repo, ['ls-files', '--stage', '-z']);
  if (staged.split('\0').some(record => record && !/^(?:100644|100755) [a-f0-9]+ 0\t.+$/s.test(record))) reject('Unsupported tracked mode or conflict');
  const paths = await w.checked(repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const attributes = (await w.checked(repo, ['check-attr', '-z', '--stdin', 'filter', 'working-tree-encoding'], undefined, Buffer.from(paths))).split('\0');
  for (let offset = 2; offset < attributes.length; offset += 3) if (!['unspecified', 'unset', ''].includes(attributes[offset])) reject('Custom conversions are not permitted for autonomous work');
  const review = await w.capture(repo, store.dataDir);
  if (!review.head) reject('Autonomous work requires a committed attached branch');
  if (review.result.files.some(file => file.blocked)) reject('Sensitive or unsupported workspace change');
  // Git status may hide raw changes through attributes or stat-cache shortcuts.
  const changed = new Set(review.entries.map(entry => entry.path));
  let size = 0;
  for (const record of staged.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) ([a-f0-9]+) 0\t(.+)$/s.exec(record);
    if (!match) reject('Unsupported tracked mode or conflict');
    const [, mode, oid, path] = match;
    if (changed.has(path)) continue;
    await safePath(repo.path, join(repo.path, path));
    const handle = await open(join(repo.path, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      size += info.size;
      if (!info.isFile() || info.nlink > 1 || info.size > 8 * 1024 * 1024 || size > 64 * 1024 * 1024) reject('Tracked snapshot exceeds safe capture limits');
      const bytes = await handle.readFile();
      if (bytes.length !== info.size || (info.mode & 0o111 ? '100755' : '100644') !== mode || (await w.checked(repo, ['hash-object', '--no-filters', '--stdin'], undefined, bytes)).trim() !== oid) reject('Unreported raw worktree change or conversion');
    } finally { await handle.close(); }
  }
  return review;
}
async function tree(store: Store, repo: Repo, review: WorkspaceCapture) {
  const scratch = await mkdtemp(join(store.dataDir, 'autonomy-tree-'));
  try {
    await chmod(scratch, 0o700);
    const index = join(scratch, 'index');
    await w.checked(repo, ['read-tree', review.head], index);
    for (const entry of review.entries) {
      if (entry.bytes === null) await w.checked(repo, ['update-index', '--force-remove', '--', entry.path], index);
      else {
        const blob = (await w.checked(repo, ['hash-object', '-w', '--no-filters', '--stdin'], undefined, entry.bytes)).trim();
        await w.checked(repo, ['update-index', '--add', '--cacheinfo', entry.mode, blob, entry.path], index);
      }
    }
    return (await w.checked(repo, ['write-tree'], index)).trim();
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
async function candidate(store: Store, repo: Repo): Promise<Candidate> {
  const review = await inspect(store, repo);
  const value = { head: review.head, ref: review.ref, tree: await tree(store, repo, review), indexHash: digest(await w.indexBytes(review.index)), fingerprint: review.fingerprint, files: review.entries.map(entry => entry.path).sort(), captured: Date.now() };
  if ((await inspect(store, repo)).fingerprint !== value.fingerprint) reject('Workspace changed during capture');
  return value;
}
export async function captureBaseline(store: Store, repo: Repo): Promise<Candidate> {
  const value = await candidate(store, repo);
  if (value.files.length || value.tree !== (await w.checked(repo, ['rev-parse', `${value.head}^{tree}`])).trim()) reject('Autonomous work requires a clean baseline');
  return value;
}
export async function captureCandidate(store: Store, repo: Repo, baseline: Candidate, ownedFiles?: string[]): Promise<Candidate> {
  const value = await candidate(store, repo);
  if (value.head !== baseline.head || value.ref !== baseline.ref || value.indexHash !== baseline.indexHash) reject('Baseline branch or index changed');
  if (!ownedFiles || new Set(ownedFiles).size !== ownedFiles.length || ownedFiles.some(path => !w.safeName(path)) || JSON.stringify([...ownedFiles].sort()) !== JSON.stringify(value.files)) reject('Changed paths do not exactly match the author manifest');
  return value;
}
export async function assertCandidate(store: Store, repo: Repo, expected: Candidate): Promise<void> {
  const current = await candidate(store, repo);
  if (current.fingerprint !== expected.fingerprint || current.tree !== expected.tree || current.indexHash !== expected.indexHash) reject('Candidate drifted after capture');
}
export async function recipeIdentity(repo: Repo, recipe: VerificationRecipe): Promise<string> {
  if (!Array.isArray(recipe.argv) || !recipe.argv.length || recipe.argv.length > 64 || recipe.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || /\p{Cc}/u.test(arg)) || !recipe.argv[0]?.trim() || !Array.isArray(recipe.files) || !recipe.files.length || recipe.files.length > 32 || new Set(recipe.files).size !== recipe.files.length || !Number.isInteger(recipe.timeoutSeconds) || recipe.timeoutSeconds < 1 || recipe.timeoutSeconds > 1800) reject('Invalid explicit verification recipe');
  const files = [];
  for (const path of [...recipe.files].sort()) {
    if (!w.safeName(path) || path.startsWith('/')) reject('Unsafe recipe path');
    const bytes = await w.worktreeBytes(repo, path);
    w.text(bytes);
    files.push([path, digest(bytes)]);
  }
  return digest(JSON.stringify({ argv: recipe.argv, timeoutSeconds: recipe.timeoutSeconds, files }));
}
async function assertRunWorkspace(repo: Repo, run: Run) {
  if (!run.workspace) reject('Workspace identity is unavailable; inspect the repository before retrying');
  await assertWorkspaceIdentity(repo, run.workspace);
}
async function exact(store: Store, repo: Repo, run: Run, guard: () => void) {
  await assertRunWorkspace(repo, run);
  const life = policy(store, repo, run);
  if (!life.candidate) reject('No captured candidate');
  await assertCandidate(store, repo, life.candidate);
  if (await recipeIdentity(repo, life.policy.verification) !== life.recipeHash) reject('Verification recipe changed');
  await reconcileTickets(store, true);
  await assertRunWorkspace(repo, run);
  guard(); policy(store, repo, run);
  return life;
}
function processFields(pid: number) {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/); }
  catch (error) { if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code!)) return null; throw error; }
}
async function members(pid: number) {
  const found: number[] = [];
  for (const name of await readdir('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const fields = processFields(Number(name));
    if (fields && Number(fields[2]) === pid && !['Z', 'X'].includes(fields[0])) found.push(Number(name));
  }
  return found;
}
export async function verifyCandidate(store: Store, repo: Repo, run: Run, signal: AbortSignal, guard: () => void): Promise<HostVerification> {
  const life = run.lifecycle!;
  const receipt: HostVerification = { id: randomUUID(), source: 'host_execution', candidateTree: life.candidate?.tree ?? '', recipeHash: life.recipeHash, argv: [...life.policy.verification.argv], started: Date.now(), finished: Date.now(), exitCode: null, outcome: 'blocked', output: '' };
  let output = '', truncated = false, timedOut = false, pid: number | undefined, ownedStart: string | undefined, signalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kill = () => {
    if (!pid || !ownedStart || signalled) return;
    const current = processFields(pid);
    if (!current || current[19] !== ownedStart || Number(current[2]) !== pid) return;
    signalled = true;
    try { process.kill(-pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  try {
    await exact(store, repo, run, guard);
    if (signal.aborted) reject('Verification cancelled');
    const directory = join(store.dataDir, 'runtime', run.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    guard(); policy(store, repo, run);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    // The selected command cannot start until its group identity is durable.
    // A backend crash before admission leaves only this short-lived inert gate.
    const launcher = `const {spawn}=require('node:child_process');const {writeSync}=require('node:fs');const gate=setTimeout(()=>process.exit(125),5000);process.stdin.once('data',()=>{setInterval(()=>{},1000);clearTimeout(gate);const argv=${JSON.stringify(receipt.argv)};const env={...process.env};${env.BUN_BE_BUN === undefined ? 'delete env.BUN_BE_BUN;' : `env.BUN_BE_BUN=${JSON.stringify(env.BUN_BE_BUN)};`}const child=spawn(argv[0],argv.slice(1),{cwd:${JSON.stringify(repo.path)},env,stdio:['ignore','inherit','inherit']});child.once('error',()=>writeSync(3,'blocked\\n'));child.once('exit',code=>writeSync(3,(code===null?'signal':String(code))+'\\n'));});`;
    const child = spawn(process.execPath, ['-e', launcher], { cwd: directory, env: { ...env, BUN_BE_BUN: '1' }, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    const commandResult = Promise.withResolvers<string>();
    void commandResult.promise.catch(() => {});
    let commandExit = '';
    child.stdio[3]?.on('data', (part: Buffer) => {
      if (commandExit.length > 16) return;
      commandExit += part.toString('utf8');
      if (commandExit.length > 16) { commandResult.reject(new Error('Invalid command exit receipt')); kill(); }
      else if (commandExit.endsWith('\n')) commandResult.resolve(commandExit.slice(0, -1));
    });
    child.stdio[3]?.once('end', () => commandResult.reject(new Error('Verifier gate closed without a command exit receipt')));
    child.stdin.on('error', () => {}); // Gate may have been killed by cancellation.
    const completion = Promise.withResolvers<number | null>();
    child.once('error', error => { completion.reject(error); commandResult.reject(error); });
    child.once('close', code => { completion.resolve(code); commandResult.reject(new Error('Verifier gate exited before reporting command completion')); });
    const exited = completion.promise;
    // Attach rejection handling before any identity persistence can fail.
    void exited.catch(() => {});
    pid = child.pid;
    if (pid) ownedStart = processFields(pid)?.[19];
    const collect = (part: Buffer) => {
      const remaining = Math.max(0, 60 * 1024 - output.length);
      const value = part.toString('utf8');
      if (value.length > remaining) truncated = true;
      if (remaining) output += value.slice(0, remaining);
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    signal.addEventListener('abort', kill, { once: true });
    timer = setTimeout(() => { timedOut = true; kill(); }, life.policy.verification.timeoutSeconds * 1000);
    if (pid) {
      const fields = processFields(pid);
      if (fields) {
        if (fields[19] !== ownedStart || Number(fields[2]) !== pid) reject('Verifier group identity changed');
        const identity = { pid, start: ownedStart, boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
        const identityFile = await open(join(directory, 'identity.json'), 'w', 0o600);
        try { await identityFile.writeFile(JSON.stringify(identity)); await identityFile.sync(); }
        finally { await identityFile.close(); }
        run.pid = pid; store.save('runs', run);
      } else reject('Cannot establish verifier process identity');
    } else reject('Verifier process failed to start');
    if (signal.aborted) kill();
    else { guard(); policy(store, repo, run); child.stdin.end('start'); }
    const actualExit = await commandResult.promise;
    clearTimeout(timer);
    kill(); // Gate leader is still alive: identity is checked synchronously before signalling.
    if (!signalled) reject('Cannot prove verifier gate ownership for shutdown');
    await exited;
    if (pid) for (let attempt = 0; (await members(pid)).length && attempt < 100; attempt++) await Bun.sleep(20);
    if (pid && (await members(pid)).length) reject('Verifier descendants have not stopped');
    if (!/^\d{1,3}$/.test(actualExit) || Number(actualExit) > 255) reject(signal.aborted || timedOut ? 'Verification cancelled or timed out' : 'Selected command did not produce an exit receipt');
    receipt.exitCode = Number(actualExit);
    await exact(store, repo, run, guard);
    receipt.outcome = signal.aborted || timedOut ? 'blocked' : receipt.exitCode === 0 ? 'passed' : 'failed';
    if (signal.aborted || timedOut) output += '\nVerification cancelled or timed out.';
  } catch (error) {
    kill();
    if (pid) for (let attempt = 0; (await members(pid)).length && attempt < 100; attempt++) await Bun.sleep(20);
    output += `\n${error instanceof Error ? error.message : 'Verification blocked'}`;
  }
  finally {
    clearTimeout(timer); signal.removeEventListener('abort', kill);
    if (!pid || !(await members(pid)).length) { run.pid = null; store.save('runs', run); }
  }
  receipt.finished = Date.now();
  receipt.output = stripVTControlCharacters(redactTranscript(output)).replace(/\p{Cc}/gu, character => character === '\n' || character === '\t' ? character : '').slice(0, 60 * 1024) + (truncated ? '\n[Host output truncated at 60 KiB; this is not the complete command output.]' : '');
  receipt.outputHash = digest(receipt.output); receipt.outputTruncated = truncated;
  receipt.environment = { platform: process.platform, arch: process.arch, runtime: `Bun ${Bun.version}` };
  return receipt;
}

function approved(store: Store, repo: Repo, run: Run) {
  const life = policy(store, repo, run), value = life.candidate;
  if (!value || life.verification.at(-1)?.outcome !== 'passed' || life.verification.at(-1)?.candidateTree !== value.tree || life.verification.at(-1)?.recipeHash !== life.recipeHash || life.reviews.at(-1)?.verdict !== 'pass' || life.reviews.at(-1)?.candidateTree !== value.tree || !life.reviews.at(-1)?.sessionId || life.reviews.at(-1)?.sessionId === life.authorSessionId) reject('Exact candidate requires host verification and independent review');
  if (value.head !== life.baseline.head || value.ref !== life.baseline.ref || value.indexHash !== life.baseline.indexHash || JSON.stringify([...(life.authorFiles ?? [])].sort()) !== JSON.stringify(value.files)) reject('Candidate no longer matches admitted baseline or author manifest');
  return life;
}
async function indexPath(repo: Repo) { return (await w.checked(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim(); }

async function ownsLock(path: string, identity: { dev: number; ino: number }) {
  const current = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  return !!current && current.dev === identity.dev && current.ino === identity.ino && !current.isSymbolicLink();
}

export async function publishCandidate(store: Store, repo: Repo, run: Run, guard: () => void): Promise<Publication> {
  return workspaceOperation(store, repo.id, async () => {
    await assertRunWorkspace(repo, run);
    const life = approved(store, repo, run);
    if (life.publication) reject('Publication already has durable intent; reconcile instead');
    await exact(store, repo, run, guard);
    const value = life.candidate!, index = await indexPath(repo);
    const lockPath = `${index}.lock`;
    await assertRunWorkspace(repo, run);
    guard(); policy(store, repo, run);
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const lockIdentity = await lock.stat();
    let renamed = false, scratch = '';
    try {
      scratch = await mkdtemp(join(store.dataDir, 'autonomy-publish-'));
      await chmod(scratch, 0o700);
      await exact(store, repo, run, guard);
      const noChanges = value.tree === life.baseline.tree;
      const commit = noChanges ? null : (await w.checked(repo, ['commit-tree', value.tree, '-p', value.head, '-F', '-'], undefined, Buffer.from(`Complete autonomous ticket ${run.ticketId}\n`))).trim();
      const finalIndex = join(scratch, 'index');
      await w.checked(repo, ['read-tree', value.tree], finalIndex);
      const finalBytes = await readFile(finalIndex);
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      await lock.writeFile(finalBytes); await lock.sync();
      await exact(store, repo, run, guard);
      approved(store, repo, run);
      const publication: Publication = { operationId: randomUUID(), state: 'prepared', commit, parent: value.head, tree: value.tree, ref: value.ref, recorded: Date.now(), noChanges };
      const directory = join(store.dataDir, 'runtime', run.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const intent = await open(join(directory, 'publication-lock.json'), 'w', 0o600);
      try { await intent.writeFile(JSON.stringify({ operationId: publication.operationId, dev: lockIdentity.dev, ino: lockIdentity.ino, hash: digest(await readFile(finalIndex)) })); await intent.sync(); }
      finally { await intent.close(); }
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      life.publication = publication; store.save('runs', run);
      await exact(store, repo, run, guard);
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      if (commit) await w.checked(repo, ['update-ref', '-m', 'autonomous ticket completion', value.ref, commit, value.head]);
      await assertRunWorkspace(repo, run);
      publication.state = 'published'; store.save('runs', run);
      // The real index is untouched until the ref CAS has succeeded.
      const publishedView = await candidate(store, repo);
      if (publishedView.head !== (commit ?? value.head) || publishedView.ref !== value.ref || publishedView.tree !== value.tree) reject('Workspace or branch changed during publication');
      if (digest(await w.indexBytes(index)) !== value.indexHash) reject('Index changed during publication; preserving external edits');
      if (!await ownsLock(lockPath, lockIdentity)) reject('Publication index lock was replaced');
      await reconcileTickets(store, true);
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      await rename(lockPath, index); renamed = true;
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      publication.state = 'complete'; store.save('runs', run);
      return publication;
    } finally {
      await lock.close();
      if (!renamed && await ownsLock(lockPath, lockIdentity)) await rm(lockPath, { force: true });
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  });
}
export async function reconcilePublication(store: Store, repo: Repo, run: Run, guard: () => void): Promise<boolean> {
  return workspaceOperation(store, repo.id, async () => {
    await assertRunWorkspace(repo, run);
    const life = approved(store, repo, run), publication = life.publication, value = life.candidate!;
    if (!publication) return false;
    if (publication.parent !== value.head || publication.tree !== value.tree || publication.ref !== value.ref || publication.noChanges !== (value.tree === life.baseline.tree)) reject('Publication intent does not match admitted candidate');
    const head = (await w.checked(repo, ['rev-parse', 'HEAD'])).trim();
    const ref = (await w.checked(repo, ['symbolic-ref', 'HEAD'])).trim();
    if (head === publication.parent && !publication.noChanges) {
      const lockPath = `${await indexPath(repo)}.lock`;
      const exists = await lstat(lockPath).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (exists) {
        const saved = JSON.parse(await readFile(join(store.dataDir, 'runtime', run.id, 'publication-lock.json'), 'utf8'));
        if (saved.operationId !== publication.operationId || !await ownsLock(lockPath, saved) || digest(await w.indexBytes(lockPath)) !== saved.hash) reject('Unpublished index lock belongs to another operation');
        await assertRunWorkspace(repo, run);
        guard(); policy(store, repo, run);
        await rm(lockPath);
      }
      return false; // Intent alone never authorizes replaying a ref mutation.
    }
    if (ref !== publication.ref || head !== (publication.commit ?? publication.parent)) reject('Published branch moved; manual reconciliation required');
    if ((await w.checked(repo, ['rev-parse', `${head}^{tree}`])).trim() !== publication.tree) reject('Published tree does not match intent');
    if (publication.commit && (await w.checked(repo, ['rev-list', '--parents', '-n', '1', head])).trim() !== `${head} ${publication.parent}`) reject('Published commit parent does not match intent');
    if (await recipeIdentity(repo, life.policy.verification) !== life.recipeHash) reject('Recipe changed after publication');
    const index = await indexPath(repo), lockPath = `${index}.lock`;
    let lock;
    await assertRunWorkspace(repo, run);
    guard(); policy(store, repo, run);
    try { lock = await open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const saved = JSON.parse(await readFile(join(store.dataDir, 'runtime', run.id, 'publication-lock.json'), 'utf8'));
      if (saved.operationId !== publication.operationId || !await ownsLock(lockPath, saved) || digest(await w.indexBytes(lockPath)) !== saved.hash) reject('Index lock belongs to another operation');
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      lock = await open(lockPath, constants.O_RDWR | constants.O_NOFOLLOW);
      const actual = await lock.stat();
      if (actual.dev !== saved.dev || actual.ino !== saved.ino) { await lock.close(); reject('Index lock changed during recovery'); }
    }
    const lockIdentity = await lock.stat();
    let scratch = '';
    let renamed = false;
    try {
      scratch = await mkdtemp(join(store.dataDir, 'autonomy-reconcile-'));
      await chmod(scratch, 0o700);
      const currentHash = digest(await w.indexBytes(index));
      const finalIndex = join(scratch, 'index');
      await w.checked(repo, ['read-tree', publication.tree], finalIndex);
      const actualIndex = join(scratch, 'actual-index');
      await writeFile(actualIndex, await w.indexBytes(index), { mode: 0o600 });
      const finalTree = await w.git(repo, ['write-tree'], actualIndex);
      if (currentHash !== value.indexHash && (finalTree.code !== 0 || finalTree.text.trim() !== publication.tree)) reject('External index changes prevent publication reconciliation');
      const current = await candidate(store, repo);
      if (current.head !== head || current.ref !== ref || current.tree !== publication.tree) reject('Worktree changed after publication');
      guard(); policy(store, repo, run);
      if ((await w.checked(repo, ['rev-parse', 'HEAD'])).trim() !== head) reject('Branch moved during reconciliation');
      if (digest(await w.indexBytes(index)) !== currentHash) reject('Index moved during reconciliation');
      const finalBytes = await readFile(finalIndex);
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      await lock.truncate(0); await lock.writeFile(finalBytes); await lock.sync();
      if (!await ownsLock(lockPath, lockIdentity)) reject('Recovery index lock was replaced');
      await reconcileTickets(store, true);
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      await rename(lockPath, index); renamed = true;
      await assertRunWorkspace(repo, run);
      guard(); policy(store, repo, run);
      publication.state = 'complete'; store.save('runs', run);
      return true;
    } finally { await lock.close(); if (!renamed && await ownsLock(lockPath, lockIdentity)) await rm(lockPath, { force: true }); if (scratch) await rm(scratch, { recursive: true, force: true }); }
  });
}
