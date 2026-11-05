export type Mode = 'paused' | 'approved' | 'automatic';
export type Status = 'draft' | 'ready' | 'running' | 'stopping' | 'paused' | 'blocked' | 'failed' | 'interrupted' | 'needs_review' | 'done';
export interface VerificationRecipe { argv: string[]; files: string[]; timeoutSeconds: number }
export type CompletionPolicy = { mode: 'human'; revision: string; updated: number } | { mode: 'autonomous'; revision: string; updated: number; verification: VerificationRecipe; recipeHash: string; reviewerModel: string; maxCorrections: number; maxRecoveries: number };
export interface Candidate { head: string; ref: string; tree: string; indexHash: string; fingerprint: string; files: string[]; captured: number }
export interface HostVerification { id: string; source: 'host_execution'; candidateTree: string; recipeHash: string; argv: string[]; started: number; finished: number; exitCode: number | null; outcome: 'passed' | 'failed' | 'blocked'; output: string; outputHash?: string; outputTruncated?: boolean; environment?: { platform: string; arch: string; runtime: string } }
export interface IndependentReview { sessionId: string; model: string; candidateTree: string; verdict: 'pass' | 'changes_required' | 'inconclusive'; findings: string[]; criteria: { criterion: string; evidence: string }[]; recorded: number }
export interface Publication { operationId: string; state: 'prepared' | 'published' | 'complete'; commit: string | null; parent: string; tree: string; ref: string; recorded: number; noChanges: boolean }
export interface Lifecycle { policy: Extract<CompletionPolicy, { mode: 'autonomous' }>; phase: 'implementing' | 'verifying' | 'reviewing' | 'correcting' | 'recovering' | 'publishing' | 'complete' | 'assistance'; baseline: Candidate; candidate?: Candidate; recipeHash: string; corrections: number; recoveries: number; authorSessionId?: string; authorSessionFile?: string; authorFiles?: string[]; authorTokens: number; reviewerTokens?: number; reviewerModel?: string; verification: HostVerification[]; reviews: IndependentReview[]; publication?: Publication; exception?: string }
export interface Repo { id: string; name: string; path: string; git: boolean; mode: Mode; lastStarted: number; completion?: CompletionPolicy; handoff?: { id: string; runId: string | null; detected: number; files: string[]; reason: string } }
export interface Attachment { name: string; size: number; hash: string }
export interface WorkspaceReview { id: string; head: string | null; files: { path: string; status: string; before?: string; after?: string; mode?: string; diff?: string; blocked?: string }[] }
export interface ExecutionOverrides { model?: string; thinking?: string; tokenBudget?: number | null }
export interface RunConfiguration { model: string; thinking: string; tokenBudget: number | null; timeLimitMinutes: number }
export interface Ticket { id: string; repoId: string; title: string; markdown: string; revision: string; approvedRevision: string | null; status: Status; dependencies: string[]; criteria: string[]; attachments: Attachment[]; error: string | null; order: number; removed: boolean; runId: string | null; execution?: ExecutionOverrides; executionVersion?: string }
export interface Dialog { id: string; method: string; title?: string; message?: string; options?: unknown[]; [key: string]: unknown }
export interface ProofArtifact { id: string; name: string; size: number; sha256: string }
export interface VerificationReceipt { id: string; runId: string; revision: string; criterion: string; feature: string; entryPoint: string; method: string; outcome: 'passed' | 'failed' | 'blocked' | 'not_run'; details: string; recipe: string; source: 'agent_report'; recorded: number; artifact?: ProofArtifact }
export interface TranscriptEntry { id: string; kind: 'agent' | 'tool' | 'system' | 'user'; text: string; toolName?: string; input?: string; output?: string; diff?: string; state?: 'running' | 'complete' | 'error' }
export interface BlockerDetails { prerequisite: string; unblock: string; attempted?: string; permission?: string; verification?: string; suggestedPrompt: string }
export interface RecoveryNote { id: string; revision: string; instructions: string; recorded: number; reviewed?: number }
export interface RecoveryContext { sourceRunId: string; sourceRevision: string; note: RecoveryNote; blocker: string | null; details?: BlockerDetails; evidence: string[]; changedFiles: string }
export interface Run { id: string; repoId: string; ticketId: string; revision: string; status: Status; started: number; finished: number | null; pid: number | null; sessionId: string | null; sessionFile: string | null; snapshot: string; transcript: string; conversation?: TranscriptEntry[]; evidence: string[]; blocker: string | null; blockerDetails?: BlockerDetails; recoveryNote?: RecoveryNote; recoveryContext?: RecoveryContext; configuration?: RunConfiguration; changedFiles: string; dialog: Dialog | null; error: string | null; verification?: VerificationReceipt[]; reviewFeedback?: { message: string; recorded: number }; lifecycle?: Lifecycle; progress?: { phase: string; latestAction: string; tokenBudget: number | null; deadline: number; model?: string; thinking?: string; context?: { tokens: number; window: number; sampled: number; basis: string }; compaction?: { enabled?: boolean; active: boolean; sampled: number; lastEvent?: string; lastCompletedAt?: number }; tokens?: { total: number; sampled: number; basis: string } } }
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export interface Settings { executable: string; model: string; thinking?: string; roots: string[]; timeLimitMinutes: number; tokenBudget: number | null; paused: boolean }
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
