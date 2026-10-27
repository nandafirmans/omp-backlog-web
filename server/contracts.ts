export type Mode = 'paused' | 'approved' | 'automatic';
export type Status = 'draft' | 'ready' | 'running' | 'stopping' | 'paused' | 'blocked' | 'failed' | 'interrupted' | 'needs_review' | 'done';
export interface Repo { id: string; name: string; path: string; git: boolean; mode: Mode; lastStarted: number; handoff?: { id: string; runId: string | null; detected: number; files: string[]; reason: string } }
export interface Attachment { name: string; size: number; hash: string }
export interface WorkspaceReview { id: string; head: string | null; files: { path: string; status: string; before?: string; after?: string; mode?: string; diff?: string; blocked?: string }[] }
export interface Ticket { id: string; repoId: string; title: string; markdown: string; revision: string; approvedRevision: string | null; status: Status; dependencies: string[]; criteria: string[]; attachments: Attachment[]; error: string | null; order: number; removed: boolean; runId: string | null }
export interface Dialog { id: string; method: string; title?: string; message?: string; options?: unknown[]; [key: string]: unknown }
export interface ProofArtifact { id: string; name: string; size: number; sha256: string }
export interface VerificationReceipt { id: string; runId: string; revision: string; criterion: string; feature: string; entryPoint: string; method: string; outcome: 'passed' | 'failed' | 'blocked' | 'not_run'; details: string; recipe: string; source: 'agent_report'; recorded: number; artifact?: ProofArtifact }
export interface Run { id: string; repoId: string; ticketId: string; revision: string; status: Status; started: number; finished: number | null; pid: number | null; sessionId: string | null; sessionFile: string | null; snapshot: string; transcript: string; evidence: string[]; blocker: string | null; changedFiles: string; dialog: Dialog | null; error: string | null; verification?: VerificationReceipt[]; reviewFeedback?: { message: string; recorded: number }; progress?: { phase: string; latestAction: string; tokenBudget: number; deadline: number; tokens?: { total: number; sampled: number; basis: string } } }
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export interface Settings { executable: string; model: string; thinking?: string; roots: string[]; timeLimitMinutes: number; tokenBudget: number; paused: boolean }
export interface Snapshot { repos: Repo[]; tickets: Ticket[]; runs: Run[]; settings: Settings }
export interface Store {
  list<K extends keyof Entities>(kind: K): Entities[K][];
  get<K extends keyof Entities>(kind: K, id: string): Entities[K] | undefined;
  save<K extends keyof Entities>(kind: K, value: Entities[K]): void;
  transaction<T>(fn: () => T): T;
  settings(): Settings;
  setSettings(value: Settings): void;
  notify(): void;
  dataDir: string;
}
export interface Entities { repos: Repo; tickets: Ticket; runs: Run }
export interface Runtime {
  wake(): void;
  reconcile(): Promise<void>;
  control(runId: string, action: 'pause' | 'resume'): Promise<void>;
  answer(runId: string, response: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}
