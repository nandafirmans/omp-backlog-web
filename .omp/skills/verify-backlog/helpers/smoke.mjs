/* global process, console, setTimeout, clearTimeout, fetch, AbortSignal, localStorage, document, innerWidth */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rename, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// No downloads or dependency resolution on behalf of the operator.
assert(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to an existing Playwright index.mjs');
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href);
const commitFixture = process.argv.includes('--commit-fixture');
const handoffFixture = process.argv.includes('--handoff-fixture') || commitFixture;
const reviewFixture = process.argv.includes('--review-fixture') || (handoffFixture && !commitFixture);
assert(process.argv.slice(2).every(argument => ['--review-fixture', '--handoff-fixture', '--commit-fixture'].includes(argument)), 'Supported arguments: --review-fixture, --handoff-fixture, --commit-fixture');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scratch = await mkdtemp('/tmp/opencode/backlog-verify-');
const proof = join(scratch, 'proof');
const repository = join(scratch, 'workspace', 'repository');
await mkdir(proof, { mode: 0o700 });
await mkdir(repository, { recursive: true, mode: 0o700 });
if (handoffFixture) {
  execFileSync('git', ['init', '--quiet', repository], { stdio: 'ignore' });
  await writeFile(join(repository, '.git/info/exclude'), '.omp-backlog/\nfixture.json\nfixture-events.jsonl\n', { mode: 0o600 });
  if (commitFixture) {
    execFileSync('git', ['-C', repository, 'config', 'user.name', 'Browser fixture'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repository, 'config', 'user.email', 'fixture@example.invalid'], { stdio: 'ignore' });
    await writeFile(join(repository, 'starter.txt'), 'initial starter\n', { mode: 0o600 });
    await writeFile(join(repository, 'keep.txt'), 'preserve this file\n', { mode: 0o600 });
  }
}
const env = { ...process.env, OMP_BACKLOG_DATA: join(scratch, 'data') };
delete env.OMP_BACKLOG_ORIGIN;
const password = randomBytes(32).toString('hex');
const username = 'verification-owner';
const hash = value => createHash('sha256').update(value).digest('hex');
const receipt = {
  tier: commitFixture ? 'real-browser-operator-commit-no-provider' : handoffFixture ? 'real-browser-git-handoff-protocol-fixture-not-provider' : reviewFixture ? 'real-browser-protocol-fixture-not-provider' : 'real-browser-no-provider', status: 'failed', stage: 'setup', checks: [],
  recipeHash: hash(await readFile(resolve(root, '.omp/skills/verify-backlog/SKILL.md'))),
  helperHash: hash(await readFile(fileURLToPath(import.meta.url))),
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  trackedPatchHash: hash(execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: root })),
  viewport: { width: 1440, height: 1000 },
  unverified: ['live OMP/provider', ...reviewFixture ? [] : ['board Actions/drag review paths'], 'rich editor', 'full feature map'],
  cleanup: false,
};
let setup, server, browser, page;
let authenticated = false;
let browserErrors = 0;
const check = (feature, action, outcome) => receipt.checks.push({ feature, action, outcome });
const alive = child => child && child.exitCode === null && child.signalCode === null;
async function stop(child) {
  if (!alive(child)) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}
// Entire attempt bounded even when setup/browser startup fails. Finally still runs.
const deadline = setTimeout(() => { void stop(server); void stop(setup); void browser?.close(); }, 120000);
try {
  setup = spawn('script', ['-q', '-e', '-c', 'bun server/setup.ts', '/dev/null'], { cwd: root, env, stdio: ['pipe', 'pipe', 'ignore'] });
  let prompt = '';
  let step = 0;
  setup.stdout.on('data', chunk => {
    prompt += chunk.toString();
    const prompts = ['Owner username:', 'Password (minimum 12 characters):', 'Confirm password:'];
    if (step < prompts.length && prompt.includes(prompts[step])) {
      setup.stdin.write(`${step === 0 ? username : password}\n`);
      prompt = ''; step++;
    }
  });
  const [code] = await once(setup, 'exit');
  assert.equal(code, 0, 'Terminal owner setup failed');
  check('access', 'Existing terminal setup with private input', 'Owner configured in fresh isolated data');
  const portProbe = createServer();
  portProbe.listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((done, reject) => portProbe.close(error => error ? reject(error) : done()));
  const origin = `http://127.0.0.1:${port}`;
  server = spawn('bun', ['run', 'dev'], { cwd: root, env: { ...env, OMP_BACKLOG_PORT: String(port) }, stdio: 'ignore' });
  server.on('error', () => {});
  receipt.stage = 'doctor';
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(alive(server), 'Owned server exited before health check');
    try {
      const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.status === 'ok' && health.runtime === 'bun' && health.executionEnabled === true) { healthy = true; break; }
    } catch { /* Startup may not yet have bound the owned port. */ }
    await delay(100);
  }
  assert(healthy, 'Owned server failed health check');
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  check('access', 'Read-only Doctor', 'Owned server healthy; unauthenticated state rejected (401)');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: receipt.viewport });
  page.on('pageerror', () => { browserErrors++; });
  page.setDefaultTimeout(15000);
  receipt.stage = 'browser login';
  await page.goto(origin);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'No projects yet' }).waitFor();
  authenticated = true;
  const state = () => page.evaluate(async () => {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error('Authenticated state read failed');
    return response.json();
  });
  assert.equal((await state()).runs.length, 0);
  check('access', 'Browser Sign in', 'Authenticated empty Home');
  receipt.stage = 'project registration';
  await page.getByRole('button', { name: 'Pause all new starts', exact: true }).click();
  await page.getByRole('button', { name: 'Allow new starts', exact: true }).waitFor();
  receipt.stage = 'settings root';
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Permitted folder roots').fill(join(scratch, 'workspace'));
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved. Existing runs are not restarted.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'OMP Backlog projects', exact: true }).click();
  receipt.stage = 'folder picker';
  await page.getByRole('link', { name: 'Add project +', exact: true }).click();
  await page.getByRole('button', { name: 'workspace', exact: true }).click();
  await page.getByRole('button', { name: 'repository', exact: true }).click();
  receipt.stage = 'register isolated directory';
  await page.getByRole('button', { name: 'Register this directory', exact: true }).click();
  await page.getByRole('heading', { name: 'repository', exact: true }).waitFor();
  const registered = await state();
  assert.equal(registered.repos.length, 1);
  assert.equal(registered.repos[0].path, repository);
  assert.equal(registered.repos[0].mode, 'paused');
  assert.equal(registered.settings.paused, true);
  check('projects', 'Settings root → Home folder picker → register', 'Only disposable repository registered; both start gates paused');
  receipt.stage = 'ticket create and approve';
  const markdown = '---\nid: T001\ntitle: Verification smoke\ndepends_on: []\n---\n\nSynthetic commissioning ticket.\n\nDone when:\n- Observe approval invalidation.\n';
  await page.getByRole('link', { name: 'New ticket', exact: true }).click();
  receipt.stage = 'fill ticket Markdown';
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.fill(markdown);
  receipt.stage = 'save new ticket';
  await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
  receipt.stage = 'approve saved ticket';
  await page.getByRole('button', { name: 'Approve this revision', exact: true }).click();
  await page.locator('.ticket-facts').getByText('Current revision approved').waitFor();
  const approved = (await state()).tickets[0];
  assert.equal(approved.approvedRevision, approved.revision);
  assert.equal(approved.status, 'ready');
  await page.screenshot({ path: join(proof, 'approved.png'), fullPage: true });
  check('tickets', 'New ticket → Markdown create → panel Approve', 'Ready at exact approved revision; no execution enabled');
  receipt.stage = 'revision invalidation';
  const changed = markdown.replace('Observe approval invalidation.', 'Observe approval invalidation after an edit.');
  await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
  await editor.fill(changed);
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await page.locator('.ticket-facts').getByText('Current revision not approved').waitFor();
  await page.reload();
  await page.locator('.ticket-facts').getByText('Current revision not approved').waitFor();
  const final = await state();
  const ticket = final.tickets[0];
  assert.notEqual(ticket.revision, approved.revision);
  assert.equal(ticket.approvedRevision, null);
  assert.equal(ticket.markdown, changed);
  assert.equal(await readFile(join(repository, '.omp-backlog/tickets/T001/ticket.md'), 'utf8'), changed);
  assert.equal(final.runs.length, 0);
  assert.equal(final.settings.paused, true);
  assert.equal(final.repos[0].mode, 'paused');
  receipt.revision = ticket.revision;
  await page.screenshot({ path: join(proof, 'invalidated.png'), fullPage: true });
  check('tickets', 'Edit → save → reload → read persisted state/file', 'Revision changed, approval cleared, exact Markdown persisted, zero runs');
  if (commitFixture) {
    receipt.stage = 'create dirty admission gate without implementation';
    await page.getByRole('button', { name: 'Approve this revision', exact: true }).click();
    const projectUrl = `${origin}/projects/${registered.repos[0].id}`;
    await page.goto(projectUrl);
    await page.getByRole('combobox', { name: 'Execution permission', exact: true }).click();
    await page.locator('.ant-select-dropdown').getByText('Approved tickets only', { exact: true }).click();
    await page.goto(origin);
    await page.getByRole('button', { name: 'Allow new starts', exact: true }).click();
    await page.goto(projectUrl);
    await page.getByRole('heading', { name: 'Operator reconciliation required', exact: true }).waitFor();
    assert.equal((await state()).runs.length, 0);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Pause all new starts', exact: true }).click();
    await page.goto(projectUrl);
    const gateId = (await state()).repos[0].handoff.id;
    const dialog = () => page.getByRole('dialog', { name: 'Review workspace changes', exact: true });
    const openReview = async () => {
      await page.getByRole('button', { name: 'Review & commit', exact: true }).click();
      await dialog().getByRole('checkbox').first().waitFor();
    };
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => localStorage.setItem('omp-color-mode', theme), theme);
      await page.reload();
      for (const width of [1440, 390]) {
        receipt.stage = `operator commit review ${theme} ${width}`;
        await page.setViewportSize({ width, height: 1000 });
        await openReview();
        assert.equal(await dialog().getByRole('button', { name: 'Review commit', exact: true }).isDisabled(), true);
        await dialog().getByRole('checkbox', { name: /starter\.txt/ }).focus();
        await page.keyboard.press('Space');
        await dialog().getByLabel('Commit message', { exact: true }).fill('chore: browser starter');
        await dialog().getByRole('button', { name: 'Review commit', exact: true }).click();
        await dialog().getByRole('button', { name: 'Back to review', exact: true }).click();
        assert.equal(await dialog().getByRole('checkbox', { name: /starter\.txt/ }).isChecked(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await dialog().locator('.ant-modal-body').evaluate(body => body.scrollWidth <= body.clientWidth), true);
        await page.screenshot({ path: join(proof, `commit-${theme}-${width}.png`), fullPage: true });
        await dialog().getByRole('button', { name: 'Close', exact: true }).click();
        const discard = page.getByRole('dialog', { name: 'Discard commit draft?', exact: true });
        await discard.getByRole('button', { name: 'Keep reviewing', exact: true }).click();
        await discard.waitFor({ state: 'hidden' });
        await dialog().getByRole('button', { name: 'Close', exact: true }).click();
        await discard.getByRole('button', { name: 'Discard draft', exact: true }).click();
        await dialog().waitFor({ state: 'hidden' });
      }
    }
    assert.equal(execFileSync('git', ['-C', repository, 'ls-files'], { encoding: 'utf8' }), '');
    check('projects', 'Dark/Light desktop/mobile → keyboard select → confirm/back → canceled close → discard draft', 'Controls reachable; no horizontal page overflow; no staged changes or commit from cancellation');
    receipt.stage = 'reject changed content after browser review';
    await openReview();
    await dialog().getByRole('checkbox', { name: /starter\.txt/ }).check();
    await dialog().getByLabel('Commit message', { exact: true }).fill('chore: browser starter');
    await dialog().getByRole('button', { name: 'Review commit', exact: true }).click();
    await writeFile(join(repository, 'starter.txt'), 'changed after review\n', { mode: 0o600 });
    await dialog().getByRole('button', { name: 'Confirm commit', exact: true }).click();
    await dialog().getByRole('alert').waitFor();
    assert.equal(execFileSync('git', ['-C', repository, 'ls-files'], { encoding: 'utf8' }), '');
    await dialog().getByRole('button', { name: 'Reload changes', exact: true }).click();
    await dialog().getByRole('checkbox', { name: /starter\.txt/ }).check();
    await dialog().getByLabel('Commit message', { exact: true }).fill('chore: browser starter');
    await dialog().getByRole('button', { name: 'Review commit', exact: true }).click();
    await dialog().getByRole('button', { name: 'Confirm commit', exact: true }).click();
    await dialog().getByRole('status').filter({ hasText: 'Created commit' }).waitFor();
    assert.equal(execFileSync('git', ['-C', repository, 'show', 'HEAD:starter.txt'], { encoding: 'utf8' }), 'changed after review\n');
    assert.equal(execFileSync('git', ['-C', repository, 'ls-tree', '--name-only', 'HEAD'], { encoding: 'utf8' }), 'starter.txt\n');
    assert.equal(await readFile(join(repository, 'keep.txt'), 'utf8'), 'preserve this file\n');
    assert.equal((await state()).repos[0].handoff.id, gateId);
    assert.equal((await state()).runs.length, 0);
    await dialog().getByRole('button', { name: 'Close', exact: true }).click();
    receipt.stage = 'commit remaining file then explicitly recheck';
    await openReview();
    await dialog().getByRole('checkbox', { name: /keep\.txt/ }).check();
    await dialog().getByLabel('Commit message', { exact: true }).fill('chore: retain remaining fixture');
    await dialog().getByRole('button', { name: 'Review commit', exact: true }).click();
    await dialog().getByRole('button', { name: 'Confirm commit', exact: true }).click();
    await dialog().getByRole('status').filter({ hasText: 'Created commit' }).waitFor();
    await dialog().getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    assert.equal((await state()).repos[0].handoff.id, gateId);
    await page.getByRole('button', { name: 'Recheck workspace', exact: true }).click();
    await page.getByRole('dialog', { name: 'Recheck reconciled workspace?', exact: true }).getByRole('button', { name: 'Recheck workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Operator reconciliation required', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await state()).settings.paused, true);
    assert.equal((await state()).runs.length, 0);
    assert.equal(execFileSync('git', ['-C', repository, 'status', '--porcelain'], { encoding: 'utf8' }), '');
    check('projects', 'Stale rejection → explicit selected commit → remaining-file commit → reload → separate clean Recheck', 'Only reviewed selections committed; unselected work preserved; gate persisted until recheck; global pause retained; zero ticket runs');
  }
  if (reviewFixture) {
    receipt.stage = 'configure protocol fixture';
    const executable = join(scratch, 'protocol-child');
    await writeFile(executable, `#!/usr/bin/env bun\nimport ${JSON.stringify(pathToFileURL(join(root, 'server/fixtures/runtime-child.ts')).href)};\n`, { mode: 0o700 });
    await writeFile(join(repository, 'fixture.json'), JSON.stringify({ scenario: 'hold', tokens: 0 }), { mode: 0o600 });
    await page.goto(`${origin}/settings`);
    await page.getByLabel('OMP executable').fill(executable);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Settings saved. Existing runs are not restarted.', { exact: true }).waitFor();
    const projectUrl = `${origin}/projects/${registered.repos[0].id}`;
    const ticketUrl = `${projectUrl}/tickets/T001`;
    await page.goto(ticketUrl);
    await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
    await editor.fill(changed.replace('Observe approval invalidation after an edit.', 'proof.txt contains verified.'));
    await page.getByRole('button', { name: 'Save revision', exact: true }).click();
    await page.getByRole('button', { name: 'Approve this revision', exact: true }).click();
    await page.locator('.ticket-facts').getByText('Current revision approved').waitFor();
    await page.goto(projectUrl);
    await page.getByRole('combobox', { name: 'Execution permission', exact: true }).click();
    await page.locator('.ant-select-dropdown').getByText('Approved tickets only', { exact: true }).click();

    async function waitForRun(status, id) {
      for (let attempt = 0; attempt < 150; attempt++) {
        const current = await state();
        const run = current.runs.filter(run => run.status === status && (!id || run.id === id)).sort((a, b) => b.started - a.started)[0];
        if (run && (status !== 'running' || run.dialog?.id === 'finish')) return run;
        await delay(100);
      }
      throw new Error('Timed out waiting for fixture run');
    }
    for (const via of ['ticket panel', 'Actions menu', 'drag confirmation']) {
      receipt.stage = `fixture execution for ${via}`;
      await page.goto(origin);
      await page.getByRole('button', { name: 'Allow new starts', exact: true }).click();
      const running = await waitForRun('running');
      await page.getByRole('button', { name: 'Pause all new starts', exact: true }).click();
      await page.getByRole('button', { name: 'Allow new starts', exact: true }).waitFor();
      await page.goto(`${origin}/runs/${running.id}`);
      await page.getByLabel('Your answer', { exact: true }).fill('finish');
      await page.getByRole('button', { name: 'Send answer', exact: true }).click();
      const completed = await waitForRun('needs_review', running.id);
      assert.equal(completed.id, running.id);
      await page.locator('.run-panel .status-needs_review').waitFor();
      await page.getByRole('heading', { name: 'Verification receipts', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Observed progress', exact: true }).waitFor();
      assert.equal(completed.progress.phase, 'Owned child work stopped');
      const artifact = completed.verification[0].artifact;
      const download = await page.request.get(`${origin}/api/runs/${completed.id}/proof/${artifact.id}`);
      assert.equal(download.status(), 200);
      assert.equal(await download.text(), 'verified\n');
      assert(download.headers()['content-disposition'].startsWith('attachment;'));
      check('runs', `Protocol fixture → persisted receipt → authenticated artifact (${via})`, 'Needs review, not Done; proof downloads exact bytes; no live provider');
      await page.screenshot({ path: join(proof, `receipt-${completed.id}.png`), fullPage: true });
      const openChanges = async () => {
        if (via === 'ticket panel') {
          await page.goto(ticketUrl);
          await page.getByRole('button', { name: 'Request changes', exact: true }).click();
        } else {
          await page.goto(projectUrl);
          if (via === 'Actions menu') {
            await page.getByRole('button', { name: 'Actions for T001', exact: true }).click();
            await page.getByRole('menuitem', { name: 'Request changes → Ready', exact: true }).click();
          } else {
            await page.getByRole('button', { name: 'Display', exact: true }).click();
            const empty = page.getByRole('checkbox', { name: 'Show empty columns', exact: true });
            await empty.check();
            await page.getByRole('button', { name: 'Display', exact: true }).click();
            await page.getByRole('button', { name: 'Drag T001; use Actions for keyboard or touch moves', exact: true }).dragTo(page.locator('.board-group-ready'));
          }
        }
        return page.getByRole('dialog', { name: 'Request changes and queue another run?', exact: true });
      };
      receipt.stage = `review feedback via ${via}`;
      let dialog = await openChanges();
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Request changes', exact: true }).isDisabled(), true);
      await dialog.getByRole('button', { name: 'Keep in review', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal((await state()).tickets[0].status, 'needs_review');
      dialog = await openChanges();
      const feedback = `Synthetic correction from ${via}: recheck the mapped path.`;
      await dialog.getByLabel('Required changes', { exact: true }).fill(feedback);
      await dialog.getByRole('button', { name: 'Request changes', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const reviewed = await state();
      assert.equal(reviewed.tickets[0].status, 'ready');
      assert.equal(reviewed.runs.find(run => run.id === completed.id).reviewFeedback.message, feedback);
      await page.reload();
      assert.equal((await state()).runs.find(run => run.id === completed.id).reviewFeedback.message, feedback);
      check('runs', `${via}: blank disabled → cancel → enter feedback → confirm → reload`, 'Cancel preserved Needs review; Ready saved only with durable run/revision-linked feedback');
      if (handoffFixture) {
        receipt.stage = `operator reconciliation after ${via}`;
        await page.goto(projectUrl);
        await page.getByRole('heading', { name: 'Operator reconciliation required', exact: true }).waitFor();
        const gate = (await state()).repos[0].handoff;
        assert.equal(gate.runId, completed.id);
        assert(gate.files.includes('proof.txt'));
        await page.screenshot({ path: join(proof, `handoff-${completed.id}.png`), fullPage: true });
        const openRecheck = async () => {
          await page.getByRole('button', { name: 'Recheck workspace', exact: true }).click();
          return page.getByRole('dialog', { name: 'Recheck reconciled workspace?', exact: true });
        };
        let recheck = await openRecheck();
        await recheck.getByRole('button', { name: 'Keep blocked', exact: true }).click();
        await recheck.waitFor({ state: 'hidden' });
        assert.equal((await state()).repos[0].handoff.id, gate.id);
        recheck = await openRecheck();
        await recheck.getByRole('button', { name: 'Recheck workspace', exact: true }).click();
        await page.getByText('Workspace still needs operator reconciliation. No files changed by this check.', { exact: true }).waitFor();
        assert.equal((await state()).repos[0].handoff.id, gate.id);
        assert.equal(await readFile(join(repository, 'proof.txt'), 'utf8'), 'verified\n');
        // Simulated operator reconciliation: preserve synthetic work outside owned repo; never commit/reset/stash.
        await rename(join(repository, 'proof.txt'), join(scratch, `operator-preserved-${completed.id}.txt`));
        await page.reload();
        await page.getByRole('heading', { name: 'Operator reconciliation required', exact: true }).waitFor();
        recheck = await openRecheck();
        await recheck.getByRole('button', { name: 'Recheck workspace', exact: true }).click();
        await page.getByRole('heading', { name: 'Operator reconciliation required', exact: true }).waitFor({ state: 'hidden' });
        const reconciled = await state();
        assert.equal(reconciled.repos[0].handoff, undefined);
        assert.equal(reconciled.settings.paused, true);
        assert.equal(reconciled.runs.length, ['ticket panel', 'Actions menu', 'drag confirmation'].indexOf(via) + 1);
        assert.equal(await readFile(join(scratch, `operator-preserved-${completed.id}.txt`), 'utf8'), 'verified\n');
        check('projects', `Git handoff (${via}): cancel → dirty recheck → preserve file externally → reload → clean recheck`, 'Dirty gate persisted without ticket replay or file changes; only explicit clean recheck released it; global pause preserved');
      }
    }
  }
  assert(alive(server), 'Owned server died during browser journey');
  assert.equal(browserErrors, 0, 'Unexpected browser runtime errors');
  receipt.browserRuntimeErrors = browserErrors;
  receipt.status = 'passed';
  receipt.stage = 'complete';
} catch (error) {
  receipt.failureType = error instanceof Error ? error.name : 'UnknownError';
  receipt.failureLocation = error instanceof Error ? error.stack?.match(/smoke\.mjs:\d+:\d+/)?.[0] : undefined;
  if (authenticated && page && await page.getByLabel('Password', { exact: true }).count() === 0) {
    await page.screenshot({ path: join(proof, 'failed.png'), fullPage: true }).catch(() => {});
  }
  // No arbitrary exception/DOM/session payloads: browser errors can contain input values.
  console.error(`Verification failed at ${receipt.stage} (${receipt.failureType}, ${receipt.failureLocation ?? 'unknown location'}); no secret-bearing error payload retained.`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  try { await browser?.close(); await stop(server); await stop(setup); receipt.cleanup = true; }
  catch { receipt.cleanup = false; receipt.status = 'failed'; process.exitCode = 1; }
  receipt.finished = new Date().toISOString();
  await writeFile(join(proof, 'result.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  await access(join(proof, 'result.json'));
  console.log(`${receipt.status}: ${proof} (cleanup ${receipt.cleanup ? 'complete' : 'incomplete'})`);
}
