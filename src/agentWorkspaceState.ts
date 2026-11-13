import type { AgentWorkspace, PlanRevision } from '../server/agent-workspace-contracts';

export function currentPlan(workspace: AgentWorkspace | undefined): PlanRevision | undefined {
  return workspace?.planRevisions.find(revision => revision.id === workspace.currentPlanRevisionId);
}

export function workspaceEditorsChanged(workspace: AgentWorkspace, editors: { title: string; prompt: string; plan: string; ticketMarkdown: string }, initialTicketMarkdown: string): boolean {
  return editors.title !== workspace.title || editors.prompt !== workspace.prompt || editors.plan !== (currentPlan(workspace)?.markdown ?? '') || editors.ticketMarkdown !== (workspace.ticketMarkdown || initialTicketMarkdown);
}

export function mergeWorkspaceRuntime(current: AgentWorkspace, incoming: AgentWorkspace): AgentWorkspace {
  const sameEditors = current.title === incoming.title && current.prompt === incoming.prompt
    && current.ticketMarkdown === incoming.ticketMarkdown && current.archived === incoming.archived
    && current.currentPlanRevisionId === incoming.currentPlanRevisionId
    && current.planRevisions.length === incoming.planRevisions.length
    && current.planRevisions.every((revision, index) => revision.id === incoming.planRevisions[index]?.id && revision.approvedAt === incoming.planRevisions[index]?.approvedAt);
  if (sameEditors) return incoming;
  // Background reads cannot adopt another editor's version while retaining local text.
  return {
    ...current, messages: incoming.messages, model: incoming.model, thinking: incoming.thinking,
    proposalSets: incoming.proposalSets, researchReferences: incoming.researchReferences, extraction: incoming.extraction,
  };
}
