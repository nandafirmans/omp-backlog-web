import type { DraftMessage, DraftSnapshot } from './drafting-contracts';

export interface PlanRevision {
  id: string;
  revisionHash: string;
  markdown: string;
  createdAt: number;
  approvedAt?: number;
}
export interface AgentWorkspace {
  id: string;
  repoId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  version: number;
  prompt: string;
  ticketMarkdown: string;
  currentPlanRevisionId: string | null;
  planRevisions: PlanRevision[];
  messages: DraftMessage[];
  model: { provider: string; id: string } | null;
  thinking: string;
}
export type AgentWorkspaceSummary = Pick<AgentWorkspace, 'id' | 'repoId' | 'title' | 'createdAt' | 'updatedAt' | 'archived' | 'version'>;
export interface AgentWorkspaceSnapshot { workspace: AgentWorkspace; draft: DraftSnapshot | null }
export interface AgentWorkspaceRecord extends AgentWorkspace {
  repoPath: string;
  acceptedTurns: { key: string; hash: string }[];
}
