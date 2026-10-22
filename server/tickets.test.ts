import { describe, expect, test } from 'bun:test';
import { attachmentReferences, parseTicket } from './tickets';

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

describe('inline attachment references', () => {
  test('keeps decoded unique paths while inspecting labels and either quoted title', () => {
    expect(attachmentReferences([
      '[Representative export rows](attachments/example%20rows.json)',
      '![](attachments/expected.png "Expected empty-state layout")',
      "[ ](<attachments/expected.png> 'Expected layout at narrow viewport')",
      '[](attachments/staged.txt)',
      '[Documentation](https://example.com/guide)',
    ].join('\n'))).toEqual(['example rows.json', 'expected.png', 'staged.txt']);
  });

  test('retains local path and URL-encoding protections', () => {
    expect(() => attachmentReferences('[Purpose](../example.json)')).toThrow('Local attachment links');
    expect(() => attachmentReferences('[Purpose](attachments/%2e%2e%2fexample.json)')).toThrow('Unsafe or unsupported attachment');
    expect(() => attachmentReferences('[Purpose](attachments/%broken.json)')).toThrow('Invalid attachment URL encoding');
  });
});
