import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckSuggestion, CheckTrial, CompletionPolicy, Repo, Store, VerificationRecipe } from './contracts';
import { captureBaseline, recipeIdentity } from './autonomy';
import { HttpError, readSafe } from './tickets';
import { workspaceOperation } from './workspace-commit';
import { assertWorkspaceIdentity, claimedWorkspaceConflict } from './workspace-identity';

function boundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new HttpError(400, `${field} must be an integer from ${minimum} to ${maximum}`);
  return value;
}
function recipe(value: unknown): VerificationRecipe {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Commission a verification recipe');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['argv', 'files', 'timeoutSeconds'].includes(key))) throw new HttpError(400, 'Unknown verification recipe field');
  if (!Array.isArray(input.argv) || !input.argv.length || input.argv.length > 64 || input.argv.some(arg => typeof arg !== 'string' || arg.length > 4096 || /\p{Cc}/u.test(arg)) || !String(input.argv[0]).trim()) throw new HttpError(400, 'Verification argv must contain 1–64 arguments, without control characters');
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 32 || input.files.some(file => typeof file !== 'string' || !file.trim() || file.length > 1024 || /\p{Cc}/u.test(file)) || new Set(input.files).size !== input.files.length) throw new HttpError(400, 'Select 1–32 unique verification recipe files');
  return { argv: input.argv as string[], files: input.files as string[], timeoutSeconds: boundedInteger(input.timeoutSeconds, 'Verification timeout', 1, 1800) };
}

/** A separate owner setting; ticket agents cannot grant themselves publication authority. */
export async function saveCompletionPolicy(store: Store, repo: Repo, input: Record<string, unknown>): Promise<Repo> {
  return workspaceOperation(store, repo.id, async identity => {
    const current = store.get('repos', repo.id);
    if (!current || input.revision !== (current.completion?.revision ?? null)) throw new HttpError(409, 'Completion policy changed; reload and review');
    if (Object.keys(input).some(key => !['revision', 'mode', 'confirm', 'verification', 'reviewerModel', 'maxCorrections', 'maxRecoveries'].includes(key))) throw new HttpError(400, 'Unknown completion policy field');
    if (input.mode !== 'human' && input.mode !== 'autonomous') throw new HttpError(400, 'Choose Human-reviewed or Agent-reviewed + local commits');
    let completion: CompletionPolicy;
    if (input.mode === 'human') {
      completion = { mode: 'human', revision: randomUUID(), updated: Date.now() };
    } else {
      if (input.confirm !== true) throw new HttpError(400, 'Explicitly confirm agent review, local commits and automatic Done authority');
      if (!current.git) throw new HttpError(409, 'Autonomous completion requires a Git repository');
      if (current.handoff) throw new HttpError(409, 'Reconcile the recorded workspace gate before enabling autonomous completion');
      if (claimedWorkspaceConflict(store, current, identity)) throw new HttpError(409, 'Stop or finish owned work before changing autonomous settings');
      const verification = recipe(input.verification);
      if (typeof input.reviewerModel !== 'string' || input.reviewerModel.length > 512 || input.reviewerModel && (!/^[^/]+\/.+$/u.test(input.reviewerModel) || /\p{Cc}/u.test(input.reviewerModel))) throw new HttpError(400, 'Reviewer model must be an exact provider/model or blank to use the attempt model');
      const maxCorrections = boundedInteger(input.maxCorrections, 'Correction rounds', 0, 2);
      const maxRecoveries = boundedInteger(input.maxRecoveries, 'Recovery attempts', 0, 1);
      await assertWorkspaceIdentity(current, identity);
      await captureBaseline(store, current);
      const recipeHash = await recipeIdentity(current, verification);
      const fresh = store.get('repos', repo.id);
      await assertWorkspaceIdentity(current, identity);
      if (!fresh || (fresh.completion?.revision ?? null) !== input.revision || fresh.handoff || claimedWorkspaceConflict(store, fresh, identity)) throw new HttpError(409, 'Workspace or completion policy changed during inspection; review again');
      completion = { mode: 'autonomous', revision: randomUUID(), updated: Date.now(), verification, recipeHash, reviewerModel: input.reviewerModel, maxCorrections, maxRecoveries };
    }
    await assertWorkspaceIdentity(current, identity);
    const updated = { ...store.get('repos', repo.id)!, completion };
    store.save('repos', updated);
    return updated;
  });
}

const LONG_RUNNING = /^(?:dev|start|serve|preview|watch)(?::|$)|(?:^|:)watch$/;
const RANKED = ['verify', 'check', 'test', 'typecheck', 'lint'];

/** Lists likely check commands from project files (package.json, Makefile, Cargo, Go, pytest); the owner still reviews and saves one. */
export async function checkSuggestions(root: string): Promise<CheckSuggestion[]> {
  const exists = (file: string) => access(join(root, file)).then(() => true, () => false);
  const read = async (file: string) => new TextDecoder().decode(await readSafe(root, join(root, file), 256 * 1024));
  const rank = (name: string) => { const index = RANKED.findIndex(prefix => name === prefix || name.startsWith(`${prefix}:`)); return index === -1 ? RANKED.length : index; };
  const found: CheckSuggestion[] = [];

  if (await exists('package.json')) {
    let scripts: unknown;
    try { scripts = (JSON.parse(await read('package.json')) as { scripts?: unknown }).scripts; }
    catch (error) { if (error instanceof SyntaxError) throw new HttpError(400, 'package.json is not valid JSON'); throw error; }
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      const runner = await exists('bun.lock') || await exists('bun.lockb') ? 'bun' : await exists('pnpm-lock.yaml') ? 'pnpm' : await exists('yarn.lock') ? 'yarn' : 'npm';
      for (const [name, script] of Object.entries(scripts)) {
        if (typeof script === 'string' && /^[\w:.-]{1,100}$/.test(name) && !LONG_RUNNING.test(name)) found.push({ name, script: script.slice(0, 200), argv: [runner, 'run', name], files: ['package.json'] });
      }
    }
  }
  for (const makefile of ['GNUmakefile', 'makefile', 'Makefile']) {
    if (!await exists(makefile)) continue;
    const targets = new Set([...(await read(makefile)).matchAll(/^([\w.-]+)\s*:(?!=)/gm)].map(match => match[1]));
    for (const name of RANKED) if (targets.has(name)) found.push({ name, script: `make ${name}`, argv: ['make', name], files: [makefile] });
    break; // make uses the first of these names that exists.
  }
  if (await exists('Cargo.toml')) found.push({ name: 'test', script: 'cargo test', argv: ['cargo', 'test'], files: ['Cargo.toml'] });
  if (await exists('go.mod')) found.push({ name: 'test', script: 'go test ./...', argv: ['go', 'test', './...'], files: ['go.mod'] });
  const pytestConfig = await exists('pytest.ini') ? 'pytest.ini' : await exists('pyproject.toml') && /pytest/.test(await read('pyproject.toml')) ? 'pyproject.toml' : null;
  if (pytestConfig) {
    const argv = await exists('uv.lock') ? ['uv', 'run', 'pytest'] : ['python3', '-m', 'pytest'];
    found.push({ name: 'test', script: argv.join(' '), argv, files: [pytestConfig] });
  }
  // Stable sort keeps detection order (package.json, Makefile, Cargo, Go, pytest) within the same rank.
  return found.sort((a, b) => rank(a.name) - rank(b.name)).slice(0, 12);
}

const TRIAL_OUTPUT_LIMIT = 64 * 1024;

/** Runs a candidate check command once in the project so the owner can see it works before saving. */
export async function trialCheck(store: Store, repo: Repo, input: Record<string, unknown>): Promise<CheckTrial> {
  if (Object.keys(input).some(key => !['argv', 'timeoutSeconds'].includes(key))) throw new HttpError(400, 'Unknown check trial field');
  const { argv, timeoutSeconds } = recipe({ argv: input.argv, files: ['unused'], timeoutSeconds: input.timeoutSeconds });
  return workspaceOperation(store, repo.id, async identity => {
    const current = store.get('repos', repo.id);
    if (!current || claimedWorkspaceConflict(store, current, identity)) throw new HttpError(409, 'A run is using this project; try the check when it finishes');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    const started = Date.now();
    let output = '', truncated = false, timedOut = false;
    return await new Promise<CheckTrial>(resolve => {
      const child = spawn(argv[0], argv.slice(1), { cwd: current.path, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const append = (part: Buffer) => {
        output += part.toString('utf8');
        // Keep the tail: failures are usually reported last.
        if (output.length > TRIAL_OUTPUT_LIMIT) { output = output.slice(-TRIAL_OUTPUT_LIMIT); truncated = true; }
      };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('Could not stop timed-out check trial', error); }
      }, timeoutSeconds * 1000);
      child.once('error', error => {
        clearTimeout(timer);
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        resolve({ exitCode: null, timedOut: false, error: missing ? `Command not found: ${argv[0]}. Is it installed and on the backend's PATH?` : error.message, output, truncated, durationMs: Date.now() - started });
      });
      child.once('close', code => { clearTimeout(timer); resolve({ exitCode: code, timedOut, output, truncated, durationMs: Date.now() - started }); });
    });
  });
}
