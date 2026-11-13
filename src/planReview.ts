import type { AgentWorkspace } from '../server/agent-workspace-contracts';

export interface PlanReview {
  workspaceId: string;
  version: number;
  revisionId: string | null;
  baseline: string;
  candidate: string;
}

export function reviewIsCurrent(review: PlanReview, workspace: AgentWorkspace | undefined, plan: string, fresh: AgentWorkspace): boolean {
  return !!workspace && workspace.id === review.workspaceId && fresh.id === review.workspaceId
    && workspace.version === review.version && fresh.version === review.version
    && workspace.currentPlanRevisionId === review.revisionId && fresh.currentPlanRevisionId === review.revisionId
    && !workspace.archived && !fresh.archived && plan === review.baseline;
}

export function planDiff(before: string, after: string): { kind: 'same' | 'add' | 'remove'; text: string }[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  // Bound quadratic work for unusually large plans; the fallback still shows every line.
  if (a.length * b.length > 1_000_000) return [...a.map(text => ({ kind: 'remove' as const, text })), ...b.map(text => ({ kind: 'add' as const, text }))];
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  }
  const result: { kind: 'same' | 'add' | 'remove'; text: string }[] = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: 'same', text: a[i++] }); j++; }
    else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) result.push({ kind: 'remove', text: a[i++] });
    else result.push({ kind: 'add', text: b[j++] });
  }
  return result;
}
