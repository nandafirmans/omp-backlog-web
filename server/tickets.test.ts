import { describe, expect, test } from 'bun:test';
import { parseTicket } from './tickets';

const frontmatter = '---\nid: T001\ntitle: Export orders\ndepends_on: []\n---\n\n';

describe('ticket completion criteria', () => {
  test('short requests preserve every completion condition', () => {
    const ticket = parseTicket(frontmatter + 'Export filtered orders. Preserve authorization.\n\nDone when:\n- Only matching orders are exported.\n- [ ] Unauthorized access is rejected.\n- Verify CSV escaping through the browser.\n');
    expect(ticket.criteria).toEqual(['Only matching orders are exported.', 'Unauthorized access is rejected.', 'Verify CSV escaping through the browser.']);
  });

  test('existing structured tickets keep all criteria without attachment bullets', () => {
    const ticket = parseTicket(frontmatter + '# Goal\nExport orders.\n\n# Requirements\nPreserve authorization.\n\n# Acceptance criteria\n- Matching orders are exported.\n- Unauthorized access is rejected.\n\n# Verification\nExercise the browser.\n\n# Attachments\n- [Records](attachments/records.json)\n');
    expect(ticket.criteria).toEqual(['Matching orders are exported.', 'Unauthorized access is rejected.']);
  });

  test('requests require a description and nonempty completion bullets', () => {
    expect(() => parseTicket(frontmatter + 'Done when:\n- Export works.\n')).toThrow('Describe what to change');
    expect(() => parseTicket(frontmatter + 'Export orders.\n')).toThrow('Add Done when:');
    expect(() => parseTicket(frontmatter + 'Export orders.\n\nDone when:\n- \n- [ ]\n')).toThrow('List observable results');
  });
});
