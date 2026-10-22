import { expect, test } from 'bun:test';
import { attachmentReference } from './attachments';

const file = { name: 'image.png', type: 'image/png', size: 128 };

test('repeated clipboard image names get distinct safe relative Markdown references', () => {
  const first = attachmentReference(file);
  const second = attachmentReference(file);
  expect(first.name).not.toBe(second.name);
  expect(first.url).toBe(`attachments/${encodeURIComponent(first.name)}`);
  expect(first.markdown).toBe(`![image](${first.url})`);
  expect(first.name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/);
});

test('unsafe stems are sanitized, long names bounded, and file references remain links', () => {
  const reference = attachmentReference({ name: `../../${'a'.repeat(200)} [notes].PDF`, type: 'application/pdf', size: 200 });
  expect(reference.name.length).toBeLessThanOrEqual(120);
  expect(reference.name).not.toContain('..');
  expect(reference.name).not.toContain('/');
  expect(reference.markdown.startsWith('!')).toBe(false);
  expect(reference.name.endsWith('.pdf')).toBe(true);
});

test('clipboard image MIME supplies a missing extension without disguising unsupported types', () => {
  expect(attachmentReference({ ...file, name: 'clipboard' }).name.endsWith('.png')).toBe(true);
  expect(() => attachmentReference({ ...file, name: 'script.sh' })).toThrow('Unsupported');
  expect(() => attachmentReference({ ...file, size: 0 })).toThrow('1 byte');
  expect(() => attachmentReference({ ...file, size: 10 * 1024 * 1024 + 1 })).toThrow('10 MiB');
});
