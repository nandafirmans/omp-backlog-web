import { expect, test } from 'bun:test';
import { proposedTicketMarkdown } from './ticketProposal';

const ticket = '---\nid: T001\ntitle: Export visible tasks\ndepends_on: []\n---\n\nExport filtered tasks.\n\nDone when:\n- CSV preserves filters.\n';

test('ticket handoff excludes conversational prose and unrelated fenced examples', () => {
  const reply = `Example data:\n\n\`\`\`json\n{"synthetic":true}\n\`\`\`\n\nProposed ticket:\n\n\`\`\`markdown\n${ticket}\`\`\`\n\nReview before creating.`;
  expect(proposedTicketMarkdown(reply)).toBe(ticket);
});

test('unfenced ticket handoff preserves YAML metadata and embedded code', () => {
  const complete = `${ticket}\nExample:\n\n\`\`\`csv\n"Task","State"\n\`\`\`\n`;
  expect(proposedTicketMarkdown(complete)).toBe(complete);
});
