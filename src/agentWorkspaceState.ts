import type { AgentWorkspace, PlanRevision } from '../server/agent-workspace-contracts';

export function currentPlan(workspace: AgentWorkspace | undefined): PlanRevision | undefined {
  return workspace?.planRevisions.find(revision => revision.id === workspace.currentPlanRevisionId);
}

export function workspaceEditorsChanged(workspace: AgentWorkspace, editors: { title: string; prompt: string; plan: string; ticketMarkdown: string }, initialTicketMarkdown: string): boolean {
  return editors.title !== workspace.title || editors.prompt !== workspace.prompt || editors.plan !== (currentPlan(workspace)?.markdown ?? '') || editors.ticketMarkdown !== (workspace.ticketMarkdown || initialTicketMarkdown);
}
