import { expect, test } from 'bun:test';
import { formAnswer, parseDialogForm } from './form-dialog';

test('the OMP ask form from a real run becomes one labeled radio field', () => {
  const html = '<form><p>Antislop mode is not configured for this UI change.</p><fieldset><legend>When should I apply the UI review?</legend><label><input type="radio" name="mode" value="during" checked> During implementation: apply the rules while building</label><label><input type="radio" name="mode" value="after"> After implementation: audit first, then wait for approval before fixes</label></fieldset></form>';
  expect(parseDialogForm(html)).toEqual({
    intro: ['Antislop mode is not configured for this UI change.'],
    fields: [{ kind: 'choice', name: 'mode', label: 'When should I apply the UI review?', multiple: false, initial: ['during'], options: [
      { value: 'during', label: 'During implementation: apply the rules while building' },
      { value: 'after', label: 'After implementation: audit first, then wait for approval before fixes' },
    ] }],
  });
});

test('checkboxes, selects, textareas and entities are parsed; hidden and submit inputs are left to OMP', () => {
  const form = parseDialogForm('<form><input type="hidden" name="token" value="x"><label>Areas<select name="area"><option value="ui">UI &amp; copy<option value="api" selected>API</select></label><fieldset><legend>Checks</legend><label><input type="checkbox" name="checks" value="lint" checked> Lint</label><label><input type="checkbox" name="checks" value="test"> Tests</label></fieldset><label>Notes<textarea name="notes">a &lt; b</textarea></label><button type="submit">Send</button></form>');
  expect(form?.fields).toEqual([
    { kind: 'choice', name: 'area', label: 'Areas', multiple: false, options: [{ value: 'ui', label: 'UI & copy' }, { value: 'api', label: 'API' }], initial: ['api'] },
    { kind: 'choice', name: 'checks', label: 'Checks', multiple: true, options: [{ value: 'lint', label: 'Lint' }, { value: 'test', label: 'Tests' }], initial: ['lint'] },
    { kind: 'text', name: 'notes', label: 'Notes', multiline: true, initial: 'a < b' },
  ]);
});

test('forms the dashboard cannot show faithfully are refused, so the run still fails closed', () => {
  expect(parseDialogForm('<form><p>No fields here</p></form>')).toBeNull();
  expect(parseDialogForm('<form><input type="file" name="upload"></form>')).toBeNull();
  expect(parseDialogForm('<form><img src="x" alt=""><input name="a"></form>')).toBeNull();
  expect(parseDialogForm('<form><script>alert(1)</script><input name="a"></form>')).toBeNull();
  expect(parseDialogForm('<form><input name="a" disabled></form>')).toBeNull();
});

test('answers must use known fields and offered options', () => {
  const form = parseDialogForm('<form><label><input type="radio" name="mode" value="during"> During</label><label><input type="checkbox" name="extra" value="a"> A</label><input name="note"></form>')!;
  expect(formAnswer(form, { mode: 'during', extra: ['a', 'a'], note: 'hi' })).toEqual({ mode: 'during', extra: ['a'], note: 'hi' });
  expect(formAnswer(form, {})).toEqual({});
  expect(() => formAnswer(form, { mode: 'after' })).toThrow('choose an offered option');
  expect(() => formAnswer(form, { extra: ['b'] })).toThrow('choose offered options');
  expect(() => formAnswer(form, { note: 3 })).toThrow('enter text');
  expect(() => formAnswer(form, { other: 'x' })).toThrow('Unknown form field other');
  expect(() => formAnswer(form, null)).toThrow('Answer shape does not match');
});
