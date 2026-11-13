import { expect, test } from 'bun:test';
import type { AgentWorkspace } from '../server/agent-workspace-contracts';
import { currentPlan, mergeWorkspaceRuntime, workspaceEditorsChanged } from './agentWorkspaceState';

const workspace: AgentWorkspace = {
  id: 'workspace-1', repoId: 'repo-1', title: 'Saved idea', createdAt: 1, updatedAt: 2, archived: false, version: 3,
  prompt: 'Discuss the change', ticketMarkdown: 'Reviewed ticket', currentPlanRevisionId: 'revision-2',
  planRevisions: [
    { id: 'revision-1', revisionHash: 'hash-1', markdown: 'Old plan', createdAt: 1, approvedAt: 2 },
    { id: 'revision-2', revisionHash: 'hash-2', markdown: 'Current plan', createdAt: 3 },
  ],
  messages: [{ role: 'assistant', text: 'Saved discussion', status: 'partial' }], model: null, thinking: '',
  proposalSets: [], researchReferences: [], extraction: null,
};
const editors = { title: workspace.title, prompt: workspace.prompt, plan: 'Current plan', ticketMarkdown: workspace.ticketMarkdown };

test('saved discussion and historical approvals do not make workspace editors dirty', () => {
  expect(workspaceEditorsChanged(workspace, editors, 'Template')).toBe(false);
  expect(currentPlan(workspace)?.id).toBe('revision-2');
  expect(currentPlan(workspace)?.approvedAt).toBeUndefined();
  expect(workspaceEditorsChanged({ ...workspace, messages: [...workspace.messages, { role: 'assistant', text: 'More output' }] }, editors, 'Template')).toBe(false);
});

test('each human editor is protected independently', () => {
  for (const key of ['title', 'prompt', 'plan', 'ticketMarkdown'] as const) {
    expect(workspaceEditorsChanged(workspace, { ...editors, [key]: `${editors[key]} changed` }, 'Template')).toBe(true);
  }
});

test('new workspace template is not an unsaved change until edited', () => {
  const blank = { ...workspace, prompt: '', ticketMarkdown: '', planRevisions: [], currentPlanRevisionId: null };
  const initial = { title: blank.title, prompt: '', plan: '', ticketMarkdown: 'Template' };
  expect(workspaceEditorsChanged(blank, initial, 'Template')).toBe(false);
  expect(workspaceEditorsChanged(blank, { ...initial, ticketMarkdown: 'Human ticket' }, 'Template')).toBe(true);
});

test('background turn recovery never adopts another tab editor version, including repeated polls', () => {
  const incoming: AgentWorkspace = {
    ...workspace, version: 4, title: 'Other tab title', prompt: 'Other tab prompt', ticketMarkdown: 'Other tab ticket',
    currentPlanRevisionId: 'revision-3', planRevisions: [...workspace.planRevisions, { id: 'revision-3', revisionHash: 'hash-3', markdown: 'Other tab plan', createdAt: 4 }],
    messages: [{ role: 'assistant', text: 'Completed turn', status: 'complete' }],
    extraction: { key: 'turn-key', status: 'failed', error: 'Invalid extraction' },
  };
  const once = mergeWorkspaceRuntime(workspace, incoming);
  const twice = mergeWorkspaceRuntime(once, incoming);
  expect(twice.version).toBe(3);
  expect(twice.title).toBe('Saved idea');
  expect(twice.prompt).toBe('Discuss the change');
  expect(twice.ticketMarkdown).toBe('Reviewed ticket');
  expect(currentPlan(twice)?.markdown).toBe('Current plan');
  expect(twice.messages).toEqual(incoming.messages);
  expect(twice.extraction?.status).toBe('failed');
  expect(workspaceEditorsChanged(twice, editors, 'Template')).toBe(false);
});

test('own model and research updates can advance version only when saved editors are unchanged', () => {
  const incoming = { ...workspace, version: 4, model: { provider: 'fixture', id: 'text' }, thinking: 'off' };
  const next = mergeWorkspaceRuntime(workspace, incoming);
  expect(next.version).toBe(4);
  expect(next.model).toEqual({ provider: 'fixture', id: 'text' });
  expect(workspaceEditorsChanged(next, { ...editors, prompt: 'Unsaved local objective' }, 'Template')).toBe(true);
});
