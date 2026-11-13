import type { TaskExtraction } from './agent-workspace-contracts';
import type { ExtractionStrategy } from './drafting-contracts';

export const EXTRACTION_LIMITS = { proposals: 12, payloadBytes: 64 * 1024, sets: 12, storedBytes: 256 * 1024, questions: 24, listItems: 32, stringBytes: 8192 } as const;
export interface ExtractionSource { workspaceId: string; planRevisionId: string | null; strategy: ExtractionStrategy; referenceIds: string[]; existingTicketIds?: string[] }
function invalid(reason: string): never { throw new Error(`Task extraction invalid: ${reason}. Previous proposal sets were retained; no repair or retry was attempted.`); }
function exact(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) invalid(`${label} must contain exactly ${fields.join(', ')}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > EXTRACTION_LIMITS.stringBytes || value.includes('\0')) invalid(`${label} must be nonempty text within 8 KiB`);
}
function strings(value: unknown, label: string, max: number = EXTRACTION_LIMITS.listItems, min = 0): asserts value is string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(`${label} has an invalid item count`);
  value.forEach(item => text(item, label));
  if (new Set(value).size !== value.length) invalid(`${label} must not contain duplicates`);
}
export function validateTaskExtraction(output: string, source: ExtractionSource): TaskExtraction {
  if (Buffer.byteLength(output) > EXTRACTION_LIMITS.payloadBytes) invalid('output exceeds 64 KiB');
  let decoded: unknown;
  try { decoded = JSON.parse(output); } catch { invalid('expected one complete strict JSON object, without Markdown fences'); }
  const value = exact(decoded, ['strategy', 'sourceWorkspaceId', 'sourcePlanRevisionId', 'rationale', 'proposals', 'openQuestions'], 'root');
  if (value.strategy !== source.strategy || value.sourceWorkspaceId !== source.workspaceId || value.sourcePlanRevisionId !== source.planRevisionId) invalid('strategy or source workspace/plan does not match the accepted turn');
  text(value.rationale, 'rationale');
  strings(value.openQuestions, 'openQuestions', EXTRACTION_LIMITS.questions);
  if (!Array.isArray(value.proposals) || !value.proposals.length || value.proposals.length > EXTRACTION_LIMITS.proposals || source.strategy === 'single' && value.proposals.length !== 1 || source.strategy === 'multiple' && value.proposals.length < 2) invalid('proposal count does not match strategy (1–12 total)');
  const dependencies = new Map<string, string[]>();
  for (const candidate of value.proposals) {
    const proposal = exact(candidate, ['key', 'title', 'description', 'acceptanceCriteria', 'verification', 'dependsOn', 'sourceReferences'], 'proposal');
    text(proposal.key, 'key');
    if (!/^task-[a-z][a-z0-9-]{0,47}$/.test(proposal.key) || dependencies.has(proposal.key)) invalid('keys must be unique temporary task- names, never authoritative ticket IDs');
    text(proposal.title, 'title'); text(proposal.description, 'description');
    if (Buffer.byteLength(proposal.title) > 200) invalid('title exceeds 200 bytes');
    const sections = Array.from(proposal.description.matchAll(/\b(why|scope|out[ -]of[ -]scope)\s*:\s*([\s\S]*?)(?=\b(?:why|scope|out[ -]of[ -]scope)\s*:|$)/gi));
    if (!['why', 'scope', 'out-of-scope'].every(label => sections.some(section => section[1]!.toLowerCase().replaceAll(' ', '-') === label && section[2]!.trim()))) invalid('description must explicitly label nonempty Why:, Scope:, and Out-of-scope: sections');
    strings(proposal.acceptanceCriteria, 'acceptanceCriteria', EXTRACTION_LIMITS.listItems, 1);
    strings(proposal.verification, 'verification', EXTRACTION_LIMITS.listItems, 1);
    if (proposal.acceptanceCriteria.some(criterion => /^(?:implement successfully|works? as expected|no bugs)[.!]?$/i.test(criterion.trim()))) invalid('acceptance criteria must describe observable outcomes, not generic success claims');
    strings(proposal.dependsOn, 'dependsOn', EXTRACTION_LIMITS.proposals);
    strings(proposal.sourceReferences, 'sourceReferences', EXTRACTION_LIMITS.listItems);
    if (proposal.sourceReferences.some(id => !source.referenceIds.includes(id))) invalid('sourceReferences must name host-confirmed reference IDs');
    dependencies.set(proposal.key, proposal.dependsOn);
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  function visit(key: string): void {
    if (visiting.has(key)) invalid('dependency cycle');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of dependencies.get(key)!) {
      if (dependency === key) invalid('dependency must not name itself');
      if (dependencies.has(dependency)) visit(dependency);
      else if (!source.existingTicketIds?.includes(dependency)) invalid('dependency must name a selected task or existing ticket');
    }
    visiting.delete(key); visited.add(key);
  }
  for (const key of dependencies.keys()) visit(key);
  return decoded as TaskExtraction;
}
export function extractionInstruction(source: ExtractionSource): string {
  return `Explicit task extraction: produce exactly one strict JSON object, with no Markdown fences, preamble, or trailing text. No tools, implementation, publication, authoritative ticket IDs, or hidden repair turns. Strategy ${JSON.stringify(source.strategy)}: single requires exactly 1 proposal; multiple requires 2–12; auto chooses 1–12 and explains its choice in rationale using implementation boundaries, dependencies and independently verifiable outcomes. Never split merely by file/component count. Use actual conversation/plan requirements and provided research; do not invent repository APIs, components or behavior. Each description answers what/why/in-scope/out-of-scope, dependencies identify prerequisites, criteria describe observable completion and verification gives concrete checks. Reject generic criteria such as "Implement successfully", "Works as expected", "No bugs". Report ambiguous/incomplete requirements as openQuestions rather than inventing decisions. Required exact schema: {"strategy":${JSON.stringify(source.strategy)},"sourceWorkspaceId":${JSON.stringify(source.workspaceId)},"sourcePlanRevisionId":${JSON.stringify(source.planRevisionId)},"rationale":"nonempty explanation","proposals":[{"key":"task-example","title":"nonempty, max 200 bytes","description":"Why: ...\\nScope: ...\\nOut-of-scope: ...","acceptanceCriteria":["observable criterion"],"verification":["concrete verification"],"dependsOn":[],"sourceReferences":[]}],"openQuestions":[]}. All strings must be nonempty and at most 8 KiB; output at most 64 KiB. Maximum 32 entries per list, 24 open questions. Unique keys match task-[a-z][a-z0-9-]{0,47}. Dependencies may name only other proposal keys, with no self-reference or cycle. sourceReferences may name only these host-confirmed IDs: ${JSON.stringify(source.referenceIds)}. Include genuine uncertainties in openQuestions; never invent source evidence.`;
}
