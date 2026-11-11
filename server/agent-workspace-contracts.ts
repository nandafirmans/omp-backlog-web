import type { DraftIntent, DraftMessage, DraftSnapshot, ExtractionStrategy } from './drafting-contracts';
import type { ResearchReference, ResearchResult } from './agent-research-contracts';
import type { Mode } from './contracts';

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
export interface BatchReview { id: string; version: number; proposalSetId: string; proposals: TaskProposal[]; selectedKeys: string[]; updatedAt: number }
export interface BatchOperation {
  id: string; repoId: string; repoPath: string; workspaceId: string; reviewId: string; reviewVersion: number;
  workspaceVersion: number; mode: Mode; expires: number; acknowledgeStalePlan: boolean;
  state: 'prepared' | 'publishing' | 'complete' | 'blocked';
  phase?: 'staging' | 'publishing' | 'reconciling';
  error?: string;
  invalidated?: boolean; compacted?: boolean;
  rootIdentity?: { dev: number; ino: number; birthtimeMs: number };
  payloadHash: string; sourcePlanRevisionId: string | null; externalRevisions: Record<string, string>;
  tickets: { key: string; id: string; markdown: string; dependencies: string[]; revision?: string; stage?: string; dev?: number; ino?: number; birthtimeMs?: number }[];
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
  batchReview?: BatchReview | null;
  extraction: { key: string; status: 'pending' | 'valid' | 'failed'; error?: string; proposalSetId?: string } | null;
}
export type AgentWorkspaceSummary = Pick<AgentWorkspace, 'id' | 'repoId' | 'title' | 'createdAt' | 'updatedAt' | 'archived' | 'version'>;
export interface AgentWorkspaceSnapshot { workspace: AgentWorkspace; draft: DraftSnapshot | null; batchOperations?: { confirmation: string; publicationId: string; reviewId: string; state: BatchOperation['state']; mode: Mode; expires: number; error?: string; tickets: Pick<BatchOperation['tickets'][number], 'key' | 'id' | 'markdown' | 'dependencies'>[] }[] }
export interface AgentWorkspaceRecord extends AgentWorkspace {
  repoPath: string;
  acceptedTurns: WorkspaceTurnReceipt[];
  researchResults: ResearchResult[];
  rejectedTurns: string[];
}
