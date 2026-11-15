import { expect, test } from 'bun:test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeStore, createStore } from './store';
import { reconcileTickets, writeTicket } from './tickets';
import { eligible } from './runtime';
import type { Repo } from './contracts';

test('chat creation holds survive restart, reconciliation and requirements edits in Automatic', async () => {
  const root = await mkdtemp(join(tmpdir(), 'backlog-creation-hold-'));
  const path = join(root, 'repo'); await mkdir(path);
  const data = join(root, 'private');
  let store = createStore(data);
  const repo: Repo = { id: 'repo', name: 'Hold fixture', path, git: false, mode: 'automatic', lastStarted: 0 };
  const markdown = '---\nid: T001\ntitle: Held chat outcome\ndepends_on: []\n---\n\nPreserve creation permission boundary.\n\nDone when:\n- Observe the requested outcome.\n';
  try {
    store.save('repos', repo);
    const ticket = await writeTicket(store, repo, markdown);
    store.save('tickets', { ...ticket, creationHold: true });
    closeStore(store); store = createStore(data);
    await reconcileTickets(store, true);
    let held = store.get('tickets', 'repo/T001')!;
    expect(held.creationHold).toBe(true);
    expect(eligible(store, repo, held)).toBe(false);
    await writeTicket(store, repo, markdown.replace('Observe the requested outcome.', 'Observe the refined outcome.'), held.revision, held.id);
    await reconcileTickets(store, true);
    held = store.get('tickets', 'repo/T001')!;
    expect(held.creationHold).toBe(true);
    expect(held.status).toBe('draft');
    expect(eligible(store, repo, held)).toBe(false);
    expect(store.get('repos', repo.id)?.mode).toBe('automatic');
    expect(store.list('runs')).toEqual([]);
  } finally { closeStore(store); }
});
