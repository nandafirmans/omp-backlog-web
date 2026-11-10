import { expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentWorkspaceRecord, TaskProposal } from './agent-workspace-contracts';
import type { Repo, Runtime } from './contracts';
import { previewBatch, publishBatch, saveBatchReview } from './batch-publication';
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
    for (const stage of ['gate', 'staged', 'journaled', 'renamed', 'synced', 'reconciled']) {
      const op = await previewBatch(store, repo, workspace.id, { version: 2, reviewId: review.id, reviewVersion: review.version, acknowledgeStalePlan: false });
      await expect(writeTicket(store, repo, op.tickets[0]!.markdown)).rejects.toMatchObject({ status: 409 });
      await expect(publishBatch(store, repo, workspace.id, op.id, point => { if (point === stage) throw new Error('simulated interruption'); })).rejects.toThrow('simulated interruption');
      closeStore(store); store = createStore(join(root, 'private'));
      const raw = 'a'.repeat(64); const csrf = 'batch-csrf';
      database(store).query('INSERT OR REPLACE INTO sessions VALUES(?,?,1,?)').run(digest(raw), csrf, Date.now() + 60_000);
      const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
      const api = createApi(store, runtime);
      const request = (path: string, init: RequestInit = {}) => api(new Request(`http://127.0.0.1:4310${path}`, { ...init, headers: { cookie: `omp_session=${raw}`, origin: 'http://127.0.0.1:4310', 'x-csrf-token': csrf, 'content-type': 'application/json' } }));
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
      if (stage === 'staged') {
        await expect(publishBatch(store, repo, workspace.id, op.id)).rejects.toMatchObject({ status: 409 });
        expect(store.get('batchOperations', op.id)?.state).toBe('blocked');
        continue;
      }
      const completed = await publishBatch(store, repo, workspace.id, op.id);
      expect(completed.state).toBe('complete');
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
    store.save('batchOperations', bound);
    await writeFile(join(repo.path, '.omp-backlog', 'tickets', 'T900', 'ticket.md'), externalMarkdown.replace('Existing work.', 'Changed work.'));
    await expect(publishBatch(store, repo, workspace.id, bound.id)).rejects.toMatchObject({ status: 409 });
    const refreshed = await previewBatch(store, repo, workspace.id, { version: 5, reviewId: restored.id, reviewVersion: restored.version, acknowledgeStalePlan: false });
    await publishBatch(store, repo, workspace.id, refreshed.id);
    expect(store.get('tickets', `repo/${refreshed.tickets[0]!.id}`)?.dependencies).toEqual(['T900']);
    expect(eligible(store, repo, store.get('tickets', `repo/${refreshed.tickets[0]!.id}`)!)).toBe(false);
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
    const op = await preview();
    await expect(publishBatch(store, other, workspace.id, op.id)).rejects.toMatchObject({ status: 404 });
    await expect(publishBatch(store, repo, 'foreign-workspace', op.id)).rejects.toMatchObject({ status: 404 });
    await expect(publishBatch(store, repo, workspace.id, 'f'.repeat(64))).rejects.toMatchObject({ status: 404 });
    let renamed = 0;
    await expect(publishBatch(store, repo, workspace.id, op.id, point => {
      if (point === 'renamed' && ++renamed === 2) throw new Error('interrupted after two');
    })).rejects.toThrow('interrupted after two');
    closeStore(store); store = createStore(join(root, 'private'));
    await reconcileTickets(store, true);
    expect(op.tickets.filter(item => store.get('tickets', `${repo.id}/${item.id}`))).toHaveLength(2);
    for (const item of op.tickets) {
      const ticket = store.get('tickets', `${repo.id}/${item.id}`);
      if (ticket) expect(eligible(store, { ...repo, mode: 'automatic' }, ticket)).toBe(false);
    }
    const [first, second] = await Promise.all([publishBatch(store, repo, workspace.id, op.id), publishBatch(store, repo, workspace.id, op.id)]);
    expect(first.state).toBe('complete'); expect(second.id).toBe(first.id);
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
    await expect(publishBatch(store, repo, workspace.id, conflicted.id)).rejects.toMatchObject({ status: 409 });
  } finally { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
