import { expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentWorkspaceRecord, BatchOperation, TaskProposal } from './agent-workspace-contracts';
import type { Repo, Runtime } from './contracts';
import { inspectBatch, previewBatch, publishBatch, recoverBatch, saveBatchReview } from './batch-publication';
import { createRuntime, eligible } from './runtime';
import { closeStore, createStore, database, digest } from './store';
import { reconcileTickets, writeTicket } from './tickets';
import { createApi } from './api';

test('batch reserves IDs, survives restart and publishes once with dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-batch-'));
  let store = createStore(join(root, 'private'));
  try {
    const repo: Repo = { id: 'repo', name: 'repo', path: join(root, 'repo'), mode: 'automatic', git: false, lastStarted: 0 };
    await mkdir(repo.path); store.save('repos', repo);
    const proposals: TaskProposal[] = [
      { key: 'task-first', title: 'First', description: 'Why: Need first. Scope: Build first. Out-of-scope: Other work.', acceptanceCriteria: ['First output is visible'], verification: ['Check first output'], dependsOn: [], sourceReferences: [] },
      { key: 'task-second', title: 'Second', description: 'Why: Need second. Scope: Build second. Out-of-scope: Other work.', acceptanceCriteria: ['Second output is visible'], verification: ['Check second output'], dependsOn: ['task-first'], sourceReferences: [] },
    ];
    const payload = { strategy: 'multiple' as const, sourceWorkspaceId: 'workspace', sourcePlanRevisionId: null, rationale: 'Two dependent tasks', proposals, openQuestions: [] };
    const workspace: AgentWorkspaceRecord = { id: 'workspace', repoId: repo.id, repoPath: repo.path, title: 'Workspace', createdAt: 1, updatedAt: 1, archived: false, version: 1, prompt: '', ticketMarkdown: '', currentPlanRevisionId: null, planRevisions: [], messages: [], model: null, thinking: '', proposalSets: [{ id: 'set', strategy: 'multiple', sourceWorkspaceId: 'workspace', sourcePlanRevisionId: null, createdAt: 1, validationStatus: 'valid', payload, researchReferences: [] }], researchReferences: [], researchResults: [], extraction: null, acceptedTurns: [], rejectedTurns: [] };
    store.save('agentWorkspaces', workspace);
    const review = saveBatchReview(store, repo, workspace.id, { version: 1, reviewVersion: null, proposalSetId: 'set', proposals, selectedKeys: ['task-first', 'task-second'] });
    const renamed = structuredClone(proposals); renamed[0]!.key = 'task-renamed';
    expect(() => saveBatchReview(store, repo, workspace.id, { version: 2, reviewVersion: review.version, proposalSetId: 'set', proposals: renamed, selectedKeys: ['task-renamed'] })).toThrow('keys cannot be changed');
    expect(() => saveBatchReview(store, repo, workspace.id, { version: 2, reviewVersion: null, proposalSetId: 'set', proposals, selectedKeys: ['task-first'] })).toThrow();
    const changed = store.get('agentWorkspaces', workspace.id)!;
    changed.currentPlanRevisionId = 'new-plan'; store.save('agentWorkspaces', changed);
    await expect(previewBatch(store, repo, workspace.id, { version: 2, reviewId: review.id, reviewVersion: review.version, acknowledgeStalePlan: false })).rejects.toMatchObject({ status: 409 });
    changed.currentPlanRevisionId = null; store.save('agentWorkspaces', changed);
    for (const stage of ['gate', 'reserved', 'mid-write', 'staged', 'journaled', 'renamed', 'synced', 'reconciled', 'before-activation', 'after-activation']) {
      const op = await previewBatch(store, repo, workspace.id, { version: 2, reviewId: review.id, reviewVersion: review.version, acknowledgeStalePlan: false });
      await expect(writeTicket(store, repo, op.tickets[0]!.markdown)).rejects.toMatchObject({ status: 409 });
      await expect(publishBatch(store, repo, workspace.id, op.id, point => { if (point === stage) throw new Error('simulated interruption'); })).rejects.toThrow('simulated interruption');
      closeStore(store); store = createStore(join(root, 'private'));
      const raw = 'a'.repeat(64); const csrf = 'batch-csrf';
      store.setSettings({ ...store.settings(), roots: [root] });
      database(store).query('INSERT OR REPLACE INTO sessions VALUES(?,?,1,?)').run(digest(raw), csrf, Date.now() + 60_000);
      const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
      const api = createApi(store, runtime);
      const request = (path: string, init: RequestInit = {}) => api(new Request(`http://127.0.0.1:4310${path}`, { ...init, headers: { cookie: `omp_session=${raw}`, origin: 'http://127.0.0.1:4310', 'x-csrf-token': csrf, 'content-type': 'application/json' } }));
      if (stage === 'after-activation') {
        const compact = store.get('batchOperations', op.id)!;
        expect(compact.state).toBe('complete');
        expect(compact.compacted).toBe(true);
        expect(compact.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies }))).toEqual(op.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies })));
        expect(compact.tickets.every(ticket => ticket.markdown === '')).toBe(true);
        expect((await publishBatch(store, repo, workspace.id, op.id)).tickets).toEqual(compact.tickets);
        expect(compact.tickets.map(ticket => ticket.revision)).toEqual(op.tickets.map(ticket => digest(ticket.markdown + '\0[]')));
        store.save('batchOperations', { ...op, state: 'complete' });
        closeStore(store); store = createStore(join(root, 'private'));
        const migrated = store.get('batchOperations', op.id)!;
        expect(migrated.compacted).toBe(true);
        expect(migrated.tickets.map(ticket => ticket.revision)).toEqual(op.tickets.map(ticket => digest(ticket.markdown + '\0[]')));
        expect(migrated.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies }))).toEqual(op.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies })));
        expect(migrated.tickets.every(ticket => ticket.markdown === '')).toBe(true);
        continue;
      }
      expect(store.get('batchOperations', op.id)?.state).toBe('publishing');
      await expect(publishBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
      expect((await request(`/api/repos/repo/agent-workspaces/${workspace.id}/batch-publish`, { method: 'POST', body: JSON.stringify({ confirmation: op.id }) })).status).toBe(409);
      expect(store.get('batchOperations', op.id)?.state).toBe('publishing');
      await reconcileTickets(store, true);
      const state = await (await request('/api/state')).json() as { tickets: { id: string }[] };
      expect(state.tickets.filter(ticket => op.tickets.some(item => item.id === ticket.id))).toEqual([]);
      for (const item of op.tickets) {
        const ticket = store.get('tickets', `repo/${item.id}`);
        const action = await request(`/api/tickets/repo/${item.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve', revision: ticket?.revision ?? '', executionVersion: null }) });
        expect(action.status).toBe(404);
        expect((await request(`/api/tickets/repo/${item.id}/execution`, { method: 'PATCH', body: JSON.stringify({ revision: ticket?.revision ?? '', version: null, execution: {} }) })).status).toBe(404);
        expect((await request(`/api/repos/repo/tickets/${item.id}`, { method: 'PUT', body: JSON.stringify({ markdown: item.markdown, revision: ticket?.revision ?? '' }) })).status).toBe(404);
        expect((await request(`/api/repos/repo/tickets/${item.id}/attachments/example.txt`)).status).toBe(404);
      }
      for (const ticket of op.tickets) {
        const observed = store.get('tickets', `repo/${ticket.id}`);
        if (observed) expect(eligible(store, repo, observed)).toBe(false);
        if (observed) {
          expect(eligible(store, { ...repo, mode: 'paused' }, observed)).toBe(false);
          expect(eligible(store, { ...repo, mode: 'approved' }, { ...observed, approvedRevision: observed.revision, status: 'ready' })).toBe(false);
        }
      }
      if (stage === 'renamed') {
        for (const ticket of store.list('tickets')) if (!op.tickets.some(item => item.id === ticket.id)) store.save('tickets', { ...ticket, status: 'done' });
        store.setSettings({ ...store.settings(), executable: join(root, 'no-provider') });
        const scheduler = await createRuntime(store);
        const now = Date.now(); const clock = spyOn(Date, 'now').mockReturnValue(now);
        try {
          await scheduler.reconcile();
          clock.mockReturnValue(now + 2000);
          await scheduler.reconcile();
          expect(store.list('runs')).toEqual([]);
          store.setSettings({ ...store.settings(), paused: true });
          await scheduler.reconcile();
          expect(store.list('runs')).toEqual([]);
        } finally { clock.mockRestore(); await scheduler.close(); }
      }
      const inspection = await inspectBatch(store, repo, workspace.id, op.id);
      expect(inspection.confirmation).toBe(op.id);
      expect(inspection.tickets[0]!.expectedRevision).toBe(digest(op.tickets[0]!.markdown + '\0[]'));
      if (stage === 'renamed') {
        expect(inspection.safeToResume).toBe(true);
        expect(inspection.tickets[0]!.status).toBe('published');
        expect(inspection.tickets[0]!.published.files.status).toBe('match');
        expect(inspection.tickets[0]!.published.identity).toEqual(inspection.tickets[0]!.published.expectedIdentity);
        const operationPath = `/api/repos/repo/agent-workspaces/${workspace.id}/batch-operations/${op.id}`;
        const httpInspection = await request(`${operationPath}/inspect`);
        expect(httpInspection.status).toBe(200);
        expect((await httpInspection.json() as { safeToResume: boolean }).safeToResume).toBe(true);
        expect((await request(`${operationPath}/recover`, { method: 'POST', body: JSON.stringify({ confirm: false }) })).status).toBe(400);
        expect((await request(`/api/repos/repo/agent-workspaces/${workspace.id}/batch-operations/${'f'.repeat(64)}/inspect`)).status).toBe(404);
        expect((await api(new Request(`http://127.0.0.1:4310${operationPath}/inspect`))).status).toBe(401);
        expect((await api(new Request(`http://127.0.0.1:4310${operationPath}/recover`, { method: 'POST', headers: { origin: 'http://127.0.0.1:4310', 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) }))).status).toBe(401);
        expect((await api(new Request(`http://127.0.0.1:4310${operationPath}/recover`, { method: 'POST', headers: { cookie: `omp_session=${raw}`, origin: 'http://127.0.0.1:4310', 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) }))).status).toBe(403);
        expect((await request(`/api/repos/other/agent-workspaces/${workspace.id}/batch-operations/${op.id}/recover`, { method: 'POST', body: JSON.stringify({ confirm: true }) })).status).toBe(404);
        expect((await request(`/api/repos/repo/agent-workspaces/foreign/batch-operations/${op.id}/inspect`)).status).toBe(404);
        const extra = join(repo.path, '.omp-backlog', 'tickets', op.tickets[0]!.id, 'unexpected.txt');
        await writeFile(extra, 'foreign');
        const changedInspection = await inspectBatch(store, repo, workspace.id, op.id);
        expect(changedInspection.safeToResume).toBe(false);
        expect(changedInspection.tickets[0]!.published.files.status).toBe('unexpected');
        await expect(recoverBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
        await rm(extra);
        const publishedFile = join(repo.path, '.omp-backlog', 'tickets', op.tickets[0]!.id, 'ticket.md');
        await rename(publishedFile, `${publishedFile}.saved`);
        await symlink(`${publishedFile}.saved`, publishedFile);
        expect((await inspectBatch(store, repo, workspace.id, op.id)).safeToResume).toBe(false);
        await expect(recoverBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
        await rm(publishedFile);
        await rename(`${publishedFile}.saved`, publishedFile);
        expect(database(store).query<{ count: number }, [string]>("SELECT count(*) AS count FROM batch_reservations WHERE operation_id=?").get(op.id)?.count).toBe(op.tickets.length);
      }
      if (stage === 'staged' || stage === 'mid-write') {
        await expect(publishBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
        const unsafe = await inspectBatch(store, repo, workspace.id, op.id);
        expect(unsafe.safeToResume).toBe(false);
        expect(unsafe.tickets[0]!.stage.status).toBe('unproven');
        expect(unsafe.tickets[0]!.stage.files.status).toBe(stage === 'staged' ? 'match' : 'mismatch');
        await expect(recoverBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
        expect(store.get('batchOperations', op.id)?.state).toBe('publishing');
        continue;
      }
      if (stage === 'gate') {
        const response = await request(`/api/repos/repo/agent-workspaces/${workspace.id}/batch-operations/${op.id}/recover`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
        expect(response.status).toBe(200);
      }
      const resumed: string[] = [];
      const completed = await recoverBatch(store, repo, workspace.id, op.id, point => { resumed.push(point); });
      if (stage === 'renamed') expect(resumed.filter(point => point === 'synced')).toHaveLength(op.tickets.length);
      expect(completed.state).toBe('complete');
      expect(database(store).query<{ count: number }, [string]>("SELECT count(*) AS count FROM batch_reservations WHERE operation_id=?").get(op.id)?.count).toBe(0);
      const visible = await (await request('/api/state')).json() as { tickets: { id: string }[] };
      expect(op.tickets.every(item => visible.tickets.some(ticket => ticket.id === item.id))).toBe(true);
      const first = store.get('tickets', `repo/${op.tickets[0]!.id}`)!;
      expect(first.approvedRevision).toBeNull();
      expect((await request(`/api/tickets/repo/${first.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'approve', revision: first.revision, executionVersion: null }) })).status).toBe(200);
      expect(eligible(store, { ...repo, mode: 'approved' }, store.get('tickets', `repo/${first.id}`)!)).toBe(true);
      expect(eligible(store, repo, store.get('tickets', `repo/${op.tickets[0]!.id}`)!)).toBe(true);
      expect((await publishBatch(store, repo, workspace.id, op.id)).id).toBe(op.id);
      expect(await readFile(join(repo.path, '.omp-backlog/tickets', op.tickets[1]!.id, 'ticket.md'), 'utf8')).toContain(`depends_on: [${op.tickets[0]!.id}]`);
      expect(store.get('tickets', `repo/${op.tickets[0]!.id}`)?.approvedRevision).toBe(first.revision);
      expect(eligible(store, repo, store.get('tickets', `repo/${op.tickets[1]!.id}`)!)).toBe(false);
    }
    const conflict = await previewBatch(store, repo, workspace.id, { version: 2, reviewId: review.id, reviewVersion: review.version, acknowledgeStalePlan: false });
    const foreign = conflict.tickets[0]!.markdown.replace('title: First', 'title: Foreign');
    const foreignDir = join(repo.path, '.omp-backlog', 'tickets', conflict.tickets[0]!.id);
    await mkdir(foreignDir); await writeFile(join(foreignDir, 'ticket.md'), foreign);
    await expect(publishBatch(store, repo, workspace.id, conflict.id)).rejects.toMatchObject({ status: 409 });
    expect(store.get('batchOperations', conflict.id)?.state).toBe('blocked');
    expect(await readFile(join(foreignDir, 'ticket.md'), 'utf8')).toBe(foreign);
    await reconcileTickets(store, true);
    const blockedApi = createApi(store, { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} });
    const blockedState = await (await blockedApi(new Request('http://127.0.0.1:4310/api/state', { headers: { cookie: `omp_session=${'a'.repeat(64)}` } }))).json() as { tickets: { id: string }[] };
    expect(blockedState.tickets.some(ticket => ticket.id === conflict.tickets[0]!.id)).toBe(false);
    expect(eligible(store, repo, store.get('tickets', `repo/${conflict.tickets[0]!.id}`)!)).toBe(false);
    const externalMarkdown = '---\nid: T900\ntitle: Existing prerequisite\ndepends_on: []\n---\n\nExisting work.\n\nDone when:\n- Existing work is complete\n';
    await writeTicket(store, repo, externalMarkdown);
    const foreignRecord = store.get('tickets', `repo/${conflict.tickets[0]!.id}`)!;
    store.save('tickets', { ...foreignRecord, status: 'done' });
    const dependent = store.get('tickets', 'repo/T900')!;
    expect(eligible(store, repo, { ...dependent, dependencies: [foreignRecord.id] })).toBe(false);
    const withExternal = structuredClone(proposals); withExternal[0]!.dependsOn = ['T900'];
    const revised = saveBatchReview(store, repo, workspace.id, { version: 2, reviewVersion: review.version, proposalSetId: 'set', proposals: withExternal, selectedKeys: ['task-first', 'task-second'] });
    const missing = structuredClone(withExternal); missing[0]!.dependsOn = ['T999'];
    const missingReview = saveBatchReview(store, repo, workspace.id, { version: 3, reviewVersion: revised.version, proposalSetId: 'set', proposals: missing, selectedKeys: ['task-first', 'task-second'] });
    await expect(previewBatch(store, repo, workspace.id, { version: 4, reviewId: missingReview.id, reviewVersion: missingReview.version, acknowledgeStalePlan: false })).rejects.toMatchObject({ status: 409 });
    const restored = saveBatchReview(store, repo, workspace.id, { version: 4, reviewVersion: missingReview.version, proposalSetId: 'set', proposals: withExternal, selectedKeys: ['task-first', 'task-second'] });
    const bound = await previewBatch(store, repo, workspace.id, { version: 5, reviewId: restored.id, reviewVersion: restored.version, acknowledgeStalePlan: false });
    expect(bound.tickets[0]!.dependencies).toEqual(['T900']);
    expect(bound.externalRevisions.T900).toBe(store.get('tickets', 'repo/T900')!.revision);
    const tampered = structuredClone(bound); tampered.tickets[0]!.markdown += '\nChanged after preview\n';
    store.save('batchOperations', tampered);
    await expect(publishBatch(store, repo, workspace.id, bound.id)).rejects.toMatchObject({ status: 409 });
    const malformed = structuredClone(bound);
    Object.assign(malformed.tickets[0]!, { dependencies: null });
    store.save('batchOperations', malformed);
    expect((await inspectBatch(store, repo, workspace.id, bound.id)).safeToResume).toBe(false);
    await expect(publishBatch(store, repo, workspace.id, bound.id)).rejects.toMatchObject({ status: 409 });
    store.save('batchOperations', bound);
    await writeFile(join(repo.path, '.omp-backlog', 'tickets', 'T900', 'ticket.md'), externalMarkdown.replace('Existing work.', 'Changed work.'));
    await expect(publishBatch(store, repo, workspace.id, bound.id)).rejects.toMatchObject({ status: 409 });
    const refreshed = await previewBatch(store, repo, workspace.id, { version: 5, reviewId: restored.id, reviewVersion: restored.version, acknowledgeStalePlan: false });
    await publishBatch(store, repo, workspace.id, refreshed.id);
    expect(store.get('tickets', `repo/${refreshed.tickets[0]!.id}`)?.dependencies).toEqual(['T900']);
    expect(eligible(store, repo, store.get('tickets', `repo/${refreshed.tickets[0]!.id}`)!)).toBe(false);
    const activation = await previewBatch(store, repo, workspace.id, { version: 5, reviewId: restored.id, reviewVersion: restored.version, acknowledgeStalePlan: false });
    await expect(publishBatch(store, repo, workspace.id, activation.id, point => {
      if (point === 'before-activation') writeFileSync(join(repo.path, '.omp-backlog', 'tickets', 'T900', 'ticket.md'), externalMarkdown.replace('Existing work.', 'Changed at activation.'));
    })).rejects.toMatchObject({ status: 409 });
    expect(store.get('batchOperations', activation.id)?.state).toBe('blocked');
    expect((await inspectBatch(store, repo, workspace.id, activation.id)).safeToResume).toBe(false);
    await writeTicket(store, repo, externalMarkdown.replaceAll('T900', 'T901').replace('depends_on: []', 'depends_on: [T902]'));
    await writeTicket(store, repo, externalMarkdown.replaceAll('T900', 'T902').replace('depends_on: []', 'depends_on: [T901]'));
    const cyclic = structuredClone(proposals); cyclic[0]!.dependsOn = ['T901'];
    const cyclicReview = saveBatchReview(store, repo, workspace.id, { version: 5, reviewVersion: restored.version, proposalSetId: 'set', proposals: cyclic, selectedKeys: ['task-first', 'task-second'] });
    await expect(previewBatch(store, repo, workspace.id, { version: 6, reviewId: cyclicReview.id, reviewVersion: cyclicReview.version, acknowledgeStalePlan: false })).rejects.toMatchObject({ status: 409 });
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});

test('batch recovery after multiple renames preserves scope and serializes confirmations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'omp-batch-recovery-'));
  let store = createStore(join(root, 'private'));
  try {
    const repo: Repo = { id: 'repo', name: 'repo', path: join(root, 'repo'), mode: 'paused', git: false, lastStarted: 0 };
    const other: Repo = { ...repo, id: 'other', path: join(root, 'other') };
    await mkdir(repo.path); await mkdir(other.path); store.save('repos', repo); store.save('repos', other);
    const proposals: TaskProposal[] = ['first', 'second', 'third'].map(name => ({
      key: `task-${name}`, title: name, description: 'Why: Required. Scope: Implement task. Out-of-scope: Other tasks.',
      acceptanceCriteria: [`${name} is complete`], verification: [`Check ${name}`], dependsOn: [], sourceReferences: [],
    }));
    const payload = { strategy: 'multiple' as const, sourceWorkspaceId: 'workspace', sourcePlanRevisionId: null, rationale: 'Independent tasks', proposals, openQuestions: [] };
    const workspace: AgentWorkspaceRecord = { id: 'workspace', repoId: repo.id, repoPath: repo.path, title: 'Workspace', createdAt: 1, updatedAt: 1, archived: false, version: 1, prompt: '', ticketMarkdown: '', currentPlanRevisionId: null, planRevisions: [], messages: [], model: null, thinking: '', proposalSets: [{ id: 'set', strategy: 'multiple', sourceWorkspaceId: 'workspace', sourcePlanRevisionId: null, createdAt: 1, validationStatus: 'valid', payload, researchReferences: [] }], researchReferences: [], researchResults: [], extraction: null, acceptedTurns: [], rejectedTurns: [] };
    store.save('agentWorkspaces', workspace);
    const review = saveBatchReview(store, repo, workspace.id, { version: 1, reviewVersion: null, proposalSetId: 'set', proposals, selectedKeys: proposals.map(item => item.key) });
    const preview = () => previewBatch(store, repo, workspace.id, { version: 2, reviewId: review.id, reviewVersion: review.version, acknowledgeStalePlan: false });
    const stale = await preview();
    const clock = spyOn(Date, 'now').mockReturnValue(stale.expires + 1);
    try { await expect(publishBatch(store, repo, workspace.id, stale.id)).rejects.toMatchObject({ status: 409 }); }
    finally { clock.mockRestore(); }
    const swept = await preview();
    const expiryClock = spyOn(Date, 'now').mockReturnValue(swept.expires + 1);
    try { await preview(); } finally { expiryClock.mockRestore(); }
    expect(store.get('batchOperations', swept.id)?.compacted).toBe(true);
    await expect(publishBatch(store, repo, workspace.id, swept.id)).rejects.toMatchObject({ status: 409 });
    const op = await preview();
    await expect(publishBatch(store, repo, workspace.id, stale.id)).rejects.toMatchObject({ status: 409 });
    expect(store.get('batchOperations', stale.id)?.compacted).toBe(true);
    expect(store.get('batchOperations', stale.id)?.tickets).toEqual([]);
    const legacy = await preview();
    delete legacy.rootIdentity; legacy.state = 'publishing'; store.save('batchOperations', legacy);
    expect((await inspectBatch(store, repo, workspace.id, legacy.id)).reasons.join()).toContain('root identity was not recorded');
    await expect(publishBatch(store, repo, workspace.id, legacy.id)).rejects.toMatchObject({ status: 409 });
    await rename(repo.path, `${repo.path}-original`);
    await mkdir(repo.path);
    try {
      expect((await inspectBatch(store, repo, workspace.id, op.id)).reasons.join()).toContain('root identity changed');
      await expect(publishBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
      expect(existsSync(join(repo.path, '.omp-backlog'))).toBe(false);
    } finally { await rm(repo.path, { recursive: true }); await rename(`${repo.path}-original`, repo.path); }
    const malicious = await preview();
    malicious.state = 'publishing'; malicious.tickets[0]!.stage = join(root, 'outside');
    store.save('batchOperations', malicious);
    expect((await inspectBatch(store, repo, workspace.id, malicious.id)).safeToResume).toBe(false);
    await expect(publishBatch(store, repo, workspace.id, malicious.id)).rejects.toMatchObject({ status: 409 });
    expect(existsSync(join(root, 'outside'))).toBe(false);
    await expect(publishBatch(store, other, workspace.id, op.id)).rejects.toMatchObject({ status: 404 });
    await expect(recoverBatch(store, other, workspace.id, malicious.id)).rejects.toMatchObject({ status: 404 });
    await expect(publishBatch(store, repo, 'foreign-workspace', op.id)).rejects.toMatchObject({ status: 404 });
    await expect(publishBatch(store, repo, workspace.id, 'f'.repeat(64))).rejects.toMatchObject({ status: 404 });
    closeStore(store);
    const child = Bun.spawn({
      cmd: [process.execPath, '-e', `import { createStore } from './server/store'; import { publishBatch } from './server/batch-publication'; const store = createStore(process.env.DATA!); const repo = store.get('repos', 'repo')!; let renamed = 0; await publishBatch(store, repo, 'workspace', process.env.OP!, point => { if (point === 'renamed' && ++renamed === 2) process.kill(process.pid, 'SIGKILL'); });`],
      cwd: process.cwd(), env: { ...process.env, DATA: join(root, 'private'), OP: op.id }, stdout: 'ignore', stderr: 'pipe',
    });
    expect(await child.exited).not.toBe(0);
    store = createStore(join(root, 'private'));
    expect(store.get('batchOperations', stale.id)?.compacted).toBe(true);
    await expect(publishBatch(store, repo, workspace.id, stale.id)).rejects.toMatchObject({ status: 409 });
    await reconcileTickets(store, true);
    expect(op.tickets.filter(item => store.get('tickets', `${repo.id}/${item.id}`))).toHaveLength(2);
    for (const item of op.tickets) {
      const ticket = store.get('tickets', `${repo.id}/${item.id}`);
      if (ticket) expect(eligible(store, { ...repo, mode: 'automatic' }, ticket)).toBe(false);
    }
    const savedWorkspace = store.get('agentWorkspaces', workspace.id)!;
    store.save('agentWorkspaces', { ...savedWorkspace, version: savedWorkspace.version + 1, title: 'Edited after confirmation', archived: true });
    store.save('repos', { ...repo, mode: 'automatic' });
    expect((await inspectBatch(store, repo, workspace.id, op.id)).safeToResume).toBe(false);
    await expect(recoverBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
    store.save('repos', repo);
    const [first, second] = await Promise.all([recoverBatch(store, repo, workspace.id, op.id), recoverBatch(store, repo, workspace.id, op.id)]);
    store.save('agentWorkspaces', savedWorkspace);
    expect(first.state).toBe('complete'); expect(second.id).toBe(first.id);
    const compacted = store.get('batchOperations', op.id)!;
    expect(compacted.compacted).toBe(true);
    expect(compacted.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies }))).toEqual(op.tickets.map(({ key, id, dependencies }) => ({ key, id, dependencies })));
    expect(compacted.tickets.every(item => item.markdown === '')).toBe(true);
    const lastRename = await preview();
    let renames = 0;
    await expect(publishBatch(store, repo, workspace.id, lastRename.id, point => { if (point === 'renamed' && ++renames === lastRename.tickets.length) throw new Error('last rename'); })).rejects.toThrow('last rename');
    expect((await inspectBatch(store, repo, workspace.id, lastRename.id)).safeToResume).toBe(true);
    expect((await recoverBatch(store, repo, workspace.id, lastRename.id)).state).toBe('complete');
    const [concurrentA, concurrentB] = await Promise.all([preview(), preview()]);
    expect(concurrentA.tickets.some(a => concurrentB.tickets.some(b => a.id === b.id))).toBe(false);
    await expect(writeTicket(store, repo, concurrentA.tickets[0]!.markdown)).rejects.toMatchObject({ status: 409 });
    const [publishedA, publishedB] = await Promise.all([publishBatch(store, repo, workspace.id, concurrentA.id), publishBatch(store, repo, workspace.id, concurrentB.id)]);
    expect([publishedA.state, publishedB.state]).toEqual(['complete', 'complete']);
    const raceCandidate = await preview();
    store.save('batchOperations', { ...raceCandidate, invalidated: true });
    const [racingPreview, racingCreate] = await Promise.allSettled([preview(), writeTicket(store, repo, raceCandidate.tickets[0]!.markdown)]);
    expect(racingPreview.status).toBe('fulfilled');
    expect(racingCreate.status).toBe('rejected');
    if (racingPreview.status === 'fulfilled') expect(racingPreview.value.tickets[0]!.id).toBe(raceCandidate.tickets[0]!.id);
    const past = spyOn(Date, 'now').mockReturnValue(Date.now() - 700_000);
    let expired: BatchOperation;
    try { expired = await preview(); } finally { past.mockRestore(); }
    const active = await preview();
    const [duringCleanup, publishedDuringCleanup] = await Promise.all([preview(), publishBatch(store, repo, workspace.id, active.id)]);
    expect(store.get('batchOperations', expired.id)?.compacted).toBe(true);
    expect(publishedDuringCleanup.state).toBe('complete');
    expect(duringCleanup.tickets.some(a => active.tickets.some(b => a.id === b.id))).toBe(false);
    const audit = store.get('batchOperations', active.id)!;
    expect(publishedDuringCleanup).toEqual(audit);
    expect(audit.compacted).toBe(true);
    expect(await publishBatch(store, repo, workspace.id, active.id)).toEqual(audit);
    store.transaction(() => {
      for (let i = 0; i < 4096; i++) store.save('batchOperations', { ...audit, id: digest(`completed-history-${i}`) });
    });
    expect(database(store).query<{ count: number }, []>("SELECT count(*) AS count FROM records WHERE kind='batchOperations' AND json_extract(value,'$.state')='complete'").get()!.count).toBeGreaterThanOrEqual(4096);
    const lookupPlan = database(store).query<{ detail: string }, [string, string, number]>("EXPLAIN QUERY PLAN SELECT 1 FROM batch_reservations WHERE repo_path=? AND ticket_id=? AND state != 'complete' AND (state != 'prepared' OR expires > ?) LIMIT 1").all(repo.path, duringCleanup.tickets[0]!.id, Date.now());
    expect(lookupPlan.some(row => row.detail.includes('batch_reservation_lookup'))).toBe(true);
    await expect(writeTicket(store, repo, duringCleanup.tickets[0]!.markdown)).rejects.toMatchObject({ status: 409 });
    expect(op.tickets.map(item => store.get('tickets', `${repo.id}/${item.id}`)?.markdown)).toEqual(op.tickets.map(item => item.markdown));
    const outdated = await preview();
    const updated = saveBatchReview(store, repo, workspace.id, { version: 2, reviewVersion: review.version, proposalSetId: 'set', proposals, selectedKeys: proposals.map(item => item.key) });
    await expect(publishBatch(store, repo, workspace.id, outdated.id)).rejects.toMatchObject({ status: 409 });
    const conflicted = await previewBatch(store, repo, workspace.id, { version: 3, reviewId: updated.id, reviewVersion: updated.version, acknowledgeStalePlan: false });
    const key = `${repo.id}/${conflicted.tickets[0]!.id}`;
    database(store).exec(`CREATE TRIGGER reject_ticket BEFORE INSERT ON records WHEN NEW.kind='tickets' AND NEW.id='${key}' BEGIN SELECT RAISE(ABORT, 'synthetic SQLite conflict'); END`);
    await expect(publishBatch(store, repo, workspace.id, conflicted.id)).rejects.toThrow('synthetic SQLite conflict');
    expect(store.get('batchOperations', conflicted.id)?.state).toBe('blocked');
    database(store).exec('DROP TRIGGER reject_ticket');
    const beforeRestart = database(store).query<{ operation_id: string; ticket_id: string; state: string }, [string, string]>("SELECT operation_id,ticket_id,state FROM batch_reservations WHERE operation_id IN (?,?) ORDER BY operation_id,ticket_id").all(conflicted.id, malicious.id);
    expect(beforeRestart).toHaveLength(conflicted.tickets.length + malicious.tickets.length);
    closeStore(store); store = createStore(join(root, 'private'));
    await previewBatch(store, repo, workspace.id, { version: 3, reviewId: updated.id, reviewVersion: updated.version, acknowledgeStalePlan: false });
    const afterRestart = database(store).query<{ operation_id: string; ticket_id: string; state: string }, [string, string]>("SELECT operation_id,ticket_id,state FROM batch_reservations WHERE operation_id IN (?,?) ORDER BY operation_id,ticket_id").all(conflicted.id, malicious.id);
    expect(afterRestart).toEqual(beforeRestart);
    expect(store.get('batchOperations', conflicted.id)?.compacted).not.toBe(true);
    expect(store.get('batchOperations', malicious.id)?.compacted).not.toBe(true);
    await expect(publishBatch(store, repo, workspace.id, conflicted.id)).rejects.toMatchObject({ status: 409 });
    expect((await inspectBatch(store, repo, workspace.id, conflicted.id)).safeToResume).toBe(true);
    expect((await recoverBatch(store, repo, workspace.id, conflicted.id)).state).toBe('complete');
    const changed = await previewBatch(store, repo, workspace.id, { version: 3, reviewId: updated.id, reviewVersion: updated.version, acknowledgeStalePlan: false });
    const extra = join(repo.path, '.omp-backlog', 'tickets', changed.tickets[0]!.id, 'foreign.txt');
    await expect(publishBatch(store, repo, workspace.id, changed.id, point => { if (point === 'reconciled') writeFileSync(extra, 'foreign'); })).rejects.toMatchObject({ status: 409 });
    expect(store.get('batchOperations', changed.id)?.state).toBe('blocked');
    expect(await readFile(extra, 'utf8')).toBe('foreign');
    expect((await inspectBatch(store, repo, workspace.id, changed.id)).safeToResume).toBe(false);
    const swapped = await previewBatch(store, repo, workspace.id, { version: 3, reviewId: updated.id, reviewVersion: updated.version, acknowledgeStalePlan: false });
    let replaced = false;
    try {
      await expect(publishBatch(store, repo, workspace.id, swapped.id, point => {
        if (point === 'reconciled') { renameSync(repo.path, `${repo.path}-original`); mkdirSync(repo.path); replaced = true; }
      })).rejects.toMatchObject({ status: 409 });
      expect(replaced).toBe(true);
      expect(store.get('batchOperations', swapped.id)?.state).toBe('blocked');
    } finally { if (replaced) { await rm(repo.path, { recursive: true }); await rename(`${repo.path}-original`, repo.path); } }
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
