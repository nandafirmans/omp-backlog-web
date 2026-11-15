import { expect, test } from 'bun:test';
import type { AgentWorkspace } from '../server/agent-workspace-contracts';
import { acceptedComposerText, mergeWorkspaceRuntime } from './agentWorkspaceState';

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
  expect(twice.planRevisions.find(revision => revision.id === twice.currentPlanRevisionId)?.markdown).toBe('Current plan');
  expect(twice.messages).toEqual(incoming.messages);
  expect(twice.extraction?.status).toBe('failed');
});

test('own model and research updates can advance version only when saved editors are unchanged', () => {
  const incoming = { ...workspace, version: 4, model: { provider: 'fixture', id: 'text' }, thinking: 'off' };
  const next = mergeWorkspaceRuntime(workspace, incoming);
  expect(next.version).toBe(4);
  expect(next.model).toEqual({ provider: 'fixture', id: 'text' });
});

test('automatic names update the title and version without adopting unrelated editor changes', () => {
  const initial = { ...workspace, title: 'Untitled workspace' };
  const incoming = { ...initial, title: 'Personal expense tracker', titleSource: 'automatic' as const, version: 4 };
  expect(mergeWorkspaceRuntime(initial, incoming)).toEqual(incoming);
  const concurrent = mergeWorkspaceRuntime(initial, { ...incoming, prompt: 'Other tab text' });
  expect(concurrent.title).toBe('Personal expense tracker');
  expect(concurrent.prompt).toBe(initial.prompt);
  expect(concurrent.version).toBe(initial.version);
  const manual = { ...initial, titleSource: 'manual' as const };
  expect(mergeWorkspaceRuntime(manual, incoming).title).toBe('Untitled workspace');
});

test('only an accepted exact submitted draft clears the composer', () => {
  expect(acceptedComposerText('submitted', 'submitted', true)).toBe('');
  expect(acceptedComposerText('submitted', 'submitted', false)).toBe('submitted');
  expect(acceptedComposerText('newer typing', 'submitted', true)).toBe('newer typing');
  expect(acceptedComposerText('first line\nsecond line', 'first line\r\nsecond line', true)).toBe('');
  expect(acceptedComposerText('first line\nsecond line', 'first line\rsecond line', true)).toBe('');
  expect(acceptedComposerText('first line\rsecond line', 'first line\r\nsecond line', true)).toBe('');
  expect(acceptedComposerText('newer\nmessage', 'first line\r\nsecond line', true)).toBe('newer\nmessage');
});
