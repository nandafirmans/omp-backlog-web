import { expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentWorkspaceRecord, ProposalSet } from './agent-workspace-contracts';
import type { Repo } from './contracts';
import { closeStore, createStore, digest } from './store';
import { previewBatch, publishBatch, recoverBatch, inspectBatch } from './batch-publication';
import { responseOperations, acceptResponseOperation, settleResponseOperations } from './response-operations';
import { eligible } from './runtime';
import { reconcileTickets } from './tickets';

async function fixture(run: (value: { root: string; repo: Repo; workspace: AgentWorkspaceRecord; set: ProposalSet }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'backlog-response-recovery-'));
  const repo: Repo = { id: 'repo', name: 'Response recovery', path: join(root, 'repo'), git: false, mode: 'automatic', lastStarted: 0 };
  await mkdir(repo.path);
  const workspace: AgentWorkspaceRecord = {
    id: 'workspace', repoId: repo.id, repoPath: repo.path, title: 'Discussion', createdAt: 1, updatedAt: 1, archived: false, version: 1,
    prompt: '', ticketMarkdown: '', currentPlanRevisionId: null, planRevisions: [], model: { provider: 'fixture', id: 'vision' }, thinking: 'medium',
    messages: [{ role: 'user', text: 'Deliver two independent outcomes', status: 'complete' }, { role: 'assistant', text: 'First add export, then its independent documentation.', status: 'complete' }],
    acceptedTurns: [{ key: 'original-request', hash: 'request-hash', contextHash: 'context', contextVersion: 1, acceptedAt: 1, intent: 'discussion', sourceWorkspaceId: 'workspace', sourcePlanRevisionId: null, model: { provider: 'fixture', id: 'vision' }, thinking: 'medium', researchReferenceIds: [], userMessageIndex: 0, assistantMessageIndex: 1, status: 'complete', sourceContext: { plan: null, research: [], preparedMessage: 'Original bounded source', preparedImages: [], uploads: [] } }],
    rejectedTurns: [], proposalSets: [], researchResults: [], researchReferences: [], extraction: null,
    responseOperations: [{ responseIndex: 1, state: 'generating', tickets: [] }],
  };
  const set: ProposalSet = { id: 'set', strategy: 'auto', sourceWorkspaceId: workspace.id, sourcePlanRevisionId: null, createdAt: 1, validationStatus: 'valid', researchReferences: [], payload: { strategy: 'auto', sourceWorkspaceId: workspace.id, sourcePlanRevisionId: null, rationale: 'Independently verifiable deliverables', openQuestions: [], proposals: [
    { key: 'task-export', title: 'Export data', description: 'Why: Users need an export. Scope: Export visible records. Out-of-scope: Scheduling.', acceptanceCriteria: ['Export includes the selected records'], verification: ['Compare exported rows with selected records'], dependsOn: [], sourceReferences: [] },
    { key: 'task-docs', title: 'Document export', description: 'Why: Users need instructions. Scope: Describe export. Out-of-scope: New behavior.', acceptanceCriteria: ['Instructions describe the available export'], verification: ['Follow instructions to export selected records'], dependsOn: ['task-export'], sourceReferences: [] },
  ] } };
  await run({ root, repo, workspace, set });
}

test('restart exposes interrupted generation without inference replay or duplicate publication', async () => {
  await fixture(async ({ root, repo, workspace }) => {
    let store = createStore(join(root, 'private'));
    try {
      store.save('repos', repo); store.save('agentWorkspaces', workspace);
      closeStore(store); store = createStore(join(root, 'private'));
      expect(responseOperations(store, repo, workspace.id)).toEqual([expect.objectContaining({ responseIndex: 1, state: 'interrupted', tickets: [] })]);
      acceptResponseOperation(store, repo, workspace.id, 1);
      expect(responseOperations(store, repo, workspace.id)[0]?.state).toBe('interrupted');
      expect(store.list('tickets')).toEqual([]);
      expect(store.list('batchOperations')).toEqual([]);
      expect(store.list('runs')).toEqual([]);
    } finally { closeStore(store); }
  });
});

test('lost response and partial response-publication reconcile same IDs, dependencies, attachment bytes and hold', async () => {
  await fixture(async ({ root, repo, workspace, set }) => {
    let store = createStore(join(root, 'private'));
    try {
      store.save('repos', repo); store.save('agentWorkspaces', workspace);
      const op = await previewBatch(store, repo, workspace.id, { version: workspace.version, acknowledgeStalePlan: true }, { responseIndex: 1, set, uploads: [{ name: 'sample.txt', data: Buffer.from('retained sample').toString('base64') }] });
      await expect(publishBatch(store, repo, workspace.id, op.id, point => { if (point === 'renamed') throw new Error('backend interrupted after first rename'); }, true)).rejects.toThrow('backend interrupted');
      closeStore(store); store = createStore(join(root, 'private'));
      await reconcileTickets(store, true);
      const result = responseOperations(store, repo, workspace.id)[0]!;
      expect(result.state).toBe('blocked');
      expect(result.publicationId).toBe(op.id);
      expect(result.tickets.map(ticket => ticket.id)).toEqual(op.tickets.map(ticket => ticket.id));
      for (const ticket of store.list('tickets')) expect(eligible(store, repo, ticket)).toBe(false);
      expect((await inspectBatch(store, repo, workspace.id, op.id)).safeToResume).toBe(true);
      await recoverBatch(store, repo, workspace.id, op.id);
      const completed = responseOperations(store, repo, workspace.id)[0]!;
      expect(completed.state).toBe('complete');
      expect(store.list('tickets')).toHaveLength(2);
      expect(store.list('tickets').every(ticket => ticket.creationHold && ticket.attachments[0]?.hash === digest('retained sample'))).toBe(true);
      expect(store.get('tickets', `repo/${op.tickets[1]!.id}`)?.dependencies).toEqual([op.tickets[0]!.id]);
      acceptResponseOperation(store, repo, workspace.id, 1);
      expect(store.list('batchOperations')).toHaveLength(1);
      closeStore(store); store = createStore(join(root, 'private'));
      expect(responseOperations(store, repo, workspace.id)[0]).toEqual(completed);
      expect(store.list('tickets')).toHaveLength(2);
      expect(store.list('runs')).toEqual([]);
    } finally { closeStore(store); }
  });
});

test('older attachment references require reattachment without inference or broken saved tickets', async () => {
  await fixture(async ({ root, repo, workspace }) => {
    const store = createStore(join(root, 'private'));
    try {
      workspace.responseOperations = [];
      workspace.messages[0]!.text = 'Implement the export shown in [Sample rows](attachments/rows.csv).';
      delete workspace.acceptedTurns[0]!.sourceContext;
      store.save('repos', repo); store.save('agentWorkspaces', workspace);
      acceptResponseOperation(store, repo, workspace.id, 1);
      await settleResponseOperations(store);
      const result = responseOperations(store, repo, workspace.id)[0]!;
      expect(result.state).toBe('clarification');
      expect(result.questions?.[0]).toContain('rows.csv');
      expect(result.questions?.[0]).toContain('Reattach');
      expect(store.list('tickets')).toEqual([]);
      expect(store.list('batchOperations')).toEqual([]);
      expect(store.list('runs')).toEqual([]);
    } finally { closeStore(store); }
  });
});
