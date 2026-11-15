import type { AgentWorkspace } from '../server/agent-workspace-contracts';


export function acceptedComposerText(current: string, submitted: string, accepted: boolean): string {
  return accepted && current.replace(/\r\n?/g, '\n') === submitted.replace(/\r\n?/g, '\n') ? '' : current;
}


export function mergeWorkspaceRuntime(current: AgentWorkspace, incoming: AgentWorkspace): AgentWorkspace {
  if (current.title === 'Untitled workspace' && current.titleSource !== 'manual' && incoming.titleSource === 'automatic') {
    current = { ...current, title: incoming.title, titleSource: incoming.titleSource };
  }
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
