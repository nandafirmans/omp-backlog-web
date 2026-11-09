import { expect, test } from 'bun:test';
import type { AgentWorkspace } from '../server/agent-workspace-contracts';
import { currentPlan, workspaceEditorsChanged } from './agentWorkspaceState';

const workspace: AgentWorkspace = {
  id: 'workspace-1', repoId: 'repo-1', title: 'Saved idea', createdAt: 1, updatedAt: 2, archived: false, version: 3,
  prompt: 'Discuss the change', ticketMarkdown: 'Reviewed ticket', currentPlanRevisionId: 'revision-2',
  planRevisions: [
    { id: 'revision-1', revisionHash: 'hash-1', markdown: 'Old plan', createdAt: 1, approvedAt: 2 },
    { id: 'revision-2', revisionHash: 'hash-2', markdown: 'Current plan', createdAt: 3 },
  ],
  messages: [{ role: 'assistant', text: 'Saved discussion', status: 'partial' }], model: null, thinking: '',
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
