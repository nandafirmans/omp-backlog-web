import type { DraftIntent, DraftMessage, DraftSnapshot, ExtractionStrategy } from './drafting-contracts';
import type { ResearchReference, ResearchResult } from './agent-research-contracts';

export interface TaskProposal {
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  verification: string[];
  dependsOn: string[];
  sourceReferences: string[];
}
export interface TaskExtraction {
  strategy: ExtractionStrategy;
  sourceWorkspaceId: string;
  sourcePlanRevisionId: string | null;
  rationale: string;
  proposals: TaskProposal[];
  openQuestions: string[];
}
export interface ProposalSet {
  id: string;
  strategy: ExtractionStrategy;
  sourceWorkspaceId: string;
  sourcePlanRevisionId: string | null;
  createdAt: number;
  validationStatus: 'valid';
  payload: TaskExtraction;
  researchReferences: ResearchReference[];
}
export interface WorkspaceTurnReceipt {
  key: string;
  hash: string;
  contextHash: string;
  contextVersion: number;
  acceptedAt: number;
  intent: DraftIntent;
  strategy?: ExtractionStrategy;
  sourceWorkspaceId: string;
  sourcePlanRevisionId: string | null;
  model: DraftSnapshot['model'];
  thinking: string;
  researchReferenceIds: string[];
  userMessageIndex: number;
  assistantMessageIndex: number;
  status: 'accepted' | 'complete' | 'failed';
  proposalSetId?: string;
  error?: string;
  legacyContextUnavailable?: true;
}

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
  proposalSets: ProposalSet[];
  researchReferences: ResearchReference[];
  extraction: { key: string; status: 'pending' | 'valid' | 'failed'; error?: string; proposalSetId?: string } | null;
}
export type AgentWorkspaceSummary = Pick<AgentWorkspace, 'id' | 'repoId' | 'title' | 'createdAt' | 'updatedAt' | 'archived' | 'version'>;
export interface AgentWorkspaceSnapshot { workspace: AgentWorkspace; draft: DraftSnapshot | null }
export interface AgentWorkspaceRecord extends AgentWorkspace {
  repoPath: string;
  acceptedTurns: WorkspaceTurnReceipt[];
  researchResults: ResearchResult[];
  rejectedTurns: string[];
}
