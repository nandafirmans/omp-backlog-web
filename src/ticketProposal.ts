/** Transfer the proposal, not the surrounding conversational explanation. */
export function proposedTicketMarkdown(text: string): string {
  const fences = Array.from(text.matchAll(/(?:^|\n)(`{3,}|~{3,})[ \t]*([a-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?=\r?\n|$)/gi));
  const proposal = fences.find(fence => /^(?:\uFEFF)?---[ \t]*\r?\n/.test(fence[3])) ?? fences.find(fence => /^(?:markdown|md)$/i.test(fence[2]));
  return `${(proposal?.[3] ?? text).trim()}\n`;
}
