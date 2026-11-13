import { expect, test } from 'bun:test';
import { pendingAgentTurn, pendingTurnBody } from './pendingAgentTurn';

async function fields(body: FormData) {
  return Promise.all(Array.from(body, async ([name, value]) => typeof value === 'string' ? [name, value] : [name, value.name, value.type, Array.from(new Uint8Array(await value.arrayBuffer()))]));
}

test('recovery reconstructs the exact submitted context and attachment bytes independently of composer edits', async () => {
  const body = new FormData();
  body.append('prompt', 'Discuss checkout'); body.append('intent', 'planning'); body.append('contextVersion', '7');
  body.append('excluded', '["file:private.txt"]');
  body.append('files', new File([new Uint8Array([0, 12, 255])], 'example.png', { type: 'image/png' }));
  const expected = await fields(body);
  const pending = pendingAgentTurn('workspace', body);
  body.set('prompt', 'Changed composer'); body.delete('files');
  const recovered = structuredClone(pending);
  expect(await fields(pendingTurnBody(recovered))).toEqual(expected);
  expect(recovered.key).toBe(pending.key);
  expect(await fields(pendingTurnBody(recovered))).toEqual(await fields(pendingTurnBody(pending)));
});

test('intentionally initiating a modified payload cannot reuse an earlier turn identity', () => {
  const first = new FormData(); first.set('prompt', 'First objective');
  const original = pendingAgentTurn('workspace', first);
  first.set('prompt', 'Modified objective');
  const changed = pendingAgentTurn('workspace', first);
  expect(changed.key).not.toBe(original.key);
  expect(pendingTurnBody(original).get('prompt')).toBe('First objective');
  expect(pendingTurnBody(changed).get('prompt')).toBe('Modified objective');
});
