import type { TaskProposal } from '../server/agent-workspace-contracts';

export function dependencyIssues(proposals: TaskProposal[]): string[] {
  const keys = new Set(proposals.map(proposal => proposal.key));
  const issues: string[] = [];
  if (keys.size !== proposals.length) issues.push('Task keys must be unique.');
  for (const proposal of proposals) for (const dependency of proposal.dependsOn) {
    if (!keys.has(dependency) && !/^T[0-9]{3,8}$/.test(dependency)) issues.push(`${proposal.key} depends on missing or unselected task ${dependency}.`);
    if (dependency === proposal.key) issues.push(`${proposal.key} cannot depend on itself.`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(proposals.map(proposal => [proposal.key, proposal]));
  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    const cyclic = (byKey.get(key)?.dependsOn ?? []).some(dependency => keys.has(dependency) && visit(dependency));
    visiting.delete(key); visited.add(key);
    return cyclic;
  }
  if (proposals.some(proposal => visit(proposal.key))) issues.push('Dependencies contain a cycle.');
  return issues;
}

export function moveProposal(proposals: TaskProposal[], index: number, direction: -1 | 1): TaskProposal[] {
  const target = index + direction;
  if (target < 0 || target >= proposals.length) return proposals;
  const next = [...proposals];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
