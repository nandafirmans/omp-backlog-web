import { afterEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Store, Ticket } from './contracts';
import type { AssistedConfirmation } from './drafting-contracts';
import { handleAssistedCreation } from './assisted-creation';
import { closeStore, createStore, digest, subscribe } from './store';
import { createCompleteTicket, MAX_ATTACHMENT, MAX_MARKDOWN, reconcileTickets, validateCompleteTicket, writeTicket } from './tickets';
import { eligible } from './runtime';

const fixtures: { root: string; store: Store }[] = [];
async function fixture(mode: Repo['mode'] = 'automatic') {
  const root = await mkdtemp(join(tmpdir(), 'omp-assisted-publication-'));
  const store = createStore(join(root, 'private'));
  const path = join(root, 'repo');
  await mkdir(path);
  const repo: Repo = { id: 'fixture', name: 'Disposable publication fixture', path, mode, git: false, lastStarted: 0 };
  store.save('repos', repo);
  fixtures.push({ root, store });
  return { root, store, repo, tickets: join(path, '.omp-backlog', 'tickets') };
}
afterEach(async () => {
  for (const { root, store } of fixtures.splice(0)) { closeStore(store); await rm(root, { recursive: true, force: true }); }
});
const markdown = (id = 'T001') => `---\nid: ${id}\ntitle: Synthetic reviewed ticket\ndepends_on: []\n---\n\nDescribe a synthetic result.\n\nDone when:\n- The complete reviewed payload is observable.\n`;
const bytes = new TextEncoder().encode('synthetic attachment bytes');
function request(text: string, files: { name: string; bytes: Uint8Array }[] = [], confirmation?: string, extra?: [string, string]) {
  const form = new FormData();
  form.set('markdown', text);
  for (const file of files) form.append('files', new File([Uint8Array.from(file.bytes)], file.name));
  if (confirmation) form.set('confirmation', confirmation);
  if (extra) form.set(...extra);
  return new Request('http://localhost/api/repos/fixture/assisted-create', { method: 'POST', body: form });
}
async function prepare(store: Store, repo: Repo, text: string, files: { name: string; bytes: Uint8Array }[] = []) {
  return await (await handleAssistedCreation(store, repo, request(text, files), 'assisted-prepare')).json() as AssistedConfirmation;
}
async function create(store: Store, repo: Repo, text: string, review: AssistedConfirmation, files: { name: string; bytes: Uint8Array }[] = []) {
  return handleAssistedCreation(store, repo, request(text, files, review.confirmation), 'assisted-create');
}

describe('assisted reviewed publication', () => {
  test('prepare is private; changed Markdown, attachment bytes, repository and mode invalidate confirmation', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[Input example](attachments/rows.txt)\n';
    const files = [{ name: 'rows.txt', bytes }];
    const review = await prepare(store, repo, text, files);
    expect(review.mode).toBe('automatic');
    expect(review.confirmation).toMatch(/^[a-f0-9]{64}$/);
    expect(store.list('tickets')).toHaveLength(0);
    expect(await lstat(tickets).catch(() => null)).toBeNull();
    await expect(create(store, repo, text.replace('Synthetic reviewed ticket', 'Changed title'), review, files)).rejects.toThrow('review');
    await expect(create(store, repo, text, review, [{ name: 'rows.txt', bytes: new Uint8Array([2]) }])).rejects.toThrow('review');
    const other = { ...repo, id: 'other' };
    store.save('repos', other);
    await expect(create(store, other, text, review, files)).rejects.toThrow('review');
    store.save('repos', { ...repo, mode: 'paused' });
    await expect(create(store, repo, text, review, files)).rejects.toThrow('mode changed');
    expect(store.list('tickets')).toHaveLength(0);
    expect(await lstat(tickets).catch(() => null)).toBeNull();
  });

  test('complete Markdown and attachment revision appear together, with no partial runnable observation', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[Reviewed sample records](attachments/rows.txt)\n![Expected layout](attachments/layout.png)\n';
    const files = [{ name: 'rows.txt', bytes }, { name: 'layout.png', bytes: new Uint8Array([1, 2, 3]) }];
    const expected = validateCompleteTicket(text, files);
    const review = await prepare(store, repo, text, files);
    const observations: Ticket[] = [];
    const unsubscribe = subscribe(store, () => observations.push(...store.list('tickets')));
    const response = await create(store, repo, text, review, files);
    unsubscribe();
    expect(response.status).toBe(201);
    const ticket = await response.json() as Ticket;
    expect(ticket.markdown).toBe(text);
    expect(ticket.attachments).toEqual(expected.attachments);
    expect(ticket.revision).toBe(expected.revision);
    expect(ticket.error).toBeNull();
    expect(ticket.approvedRevision).toBeNull();
    expect(eligible(store, repo, ticket)).toBe(true);
    expect(observations.length).toBeGreaterThan(0);
    for (const observed of observations) {
      expect(observed.revision).toBe(expected.revision);
      expect(observed.attachments).toEqual(expected.attachments);
    }
    expect(await Bun.file(join(tickets, 'T001', 'ticket.md')).text()).toBe(text);
    for (const file of files) expect(digest(await Bun.file(join(tickets, 'T001', 'attachments', file.name)).bytes())).toBe(digest(file.bytes));
    expect((await readdir(join(repo.path, '.omp-backlog'))).filter(name => name.startsWith('.assisted-stage-'))).toEqual([]);
  });

  test('lost-response retry returns one exact ticket; editing or removing it cannot republish', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown();
    const review = await prepare(store, repo, text);
    const [first, concurrent] = await Promise.all([create(store, repo, text, review), create(store, repo, text, review)]);
    const original = await first.json() as Ticket;
    expect((await concurrent.json() as Ticket).revision).toBe(original.revision);
    const retry = await create(store, repo, text, review);
    expect(retry.status).toBe(200);
    expect((await retry.json() as Ticket).revision).toBe(original.revision);
    expect(await readdir(tickets)).toEqual(['T001']);
    await writeFile(join(tickets, 'T001', 'ticket.md'), text.replace('Synthetic reviewed ticket', 'External edit'));
    await expect(create(store, repo, text, review)).rejects.toThrow('Previously created ticket changed');
    expect(await Bun.file(join(tickets, 'T001', 'ticket.md')).text()).toContain('External edit');
    await rm(join(tickets, 'T001'), { recursive: true });
    await expect(create(store, repo, text, review)).rejects.toThrow('Previously created ticket changed');
    expect(await lstat(join(tickets, 'T001')).catch(() => null)).toBeNull();
  });

  test('retry also rejects attachment edits and exact-byte external directory replacement', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[Input records](attachments/rows.txt)\n';
    const files = [{ name: 'rows.txt', bytes }];
    const review = await prepare(store, repo, text, files);
    await create(store, repo, text, review, files);
    await writeFile(join(tickets, 'T001', 'attachments', 'rows.txt'), 'changed');
    await expect(create(store, repo, text, review, files)).rejects.toThrow('Previously created ticket changed');
    const original = join(tickets, 'T001');
    const replacement = join(tickets, 'replacement');
    await mkdir(join(replacement, 'attachments'), { recursive: true });
    await writeFile(join(replacement, 'ticket.md'), text);
    await writeFile(join(replacement, 'attachments', 'rows.txt'), bytes);
    await rename(original, join(tickets, 'old'));
    await rename(replacement, original);
    await expect(create(store, repo, text, review, files)).rejects.toThrow('Previously created ticket changed');
  });

  test('duplicate IDs including external empty directories and symlinks are never overwritten', async () => {
    const { store, repo, tickets, root } = await fixture();
    const text = markdown();
    const review = await prepare(store, repo, text);
    await mkdir(join(tickets, 'T001'), { recursive: true });
    await expect(create(store, repo, text, review)).rejects.toThrow('already exists');
    expect(await readdir(join(tickets, 'T001'))).toEqual([]);
    await rm(join(tickets, 'T001'), { recursive: true });
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(tickets, 'T001'));
    await expect(create(store, repo, text, review)).rejects.toThrow('already exists');
    expect((await lstat(join(tickets, 'T001'))).isSymbolicLink()).toBe(true);
    expect(await readdir(outside)).toEqual([]);
    await rm(join(tickets, 'T001'));
    await writeTicket(store, repo, text);
    await expect(prepare(store, repo, text)).rejects.toThrow('already exists');
    await expect(create(store, repo, text, review)).rejects.toThrow('already exists');
    expect(await Bun.file(join(tickets, 'T001', 'ticket.md')).text()).toBe(text);
  });

  test('external directory or symlink arriving during staging loses no bytes to atomic publication', async () => {
    const { store, repo, tickets, root } = await fixture();
    const outside = join(root, 'external');
    await mkdir(outside);
    for (const id of ['T001', 'T002']) {
      const text = markdown(id) + '\n[Input example](attachments/rows.txt)\n';
      let reads = 0;
      const file = { name: 'rows.txt', get bytes() {
        if (++reads === 5) {
          if (id === 'T001') mkdirSync(join(tickets, id));
          else symlinkSync(outside, join(tickets, id));
        }
        return bytes;
      } };
      await expect(createCompleteTicket(store, repo, text, [file], { mode: repo.mode, expires: Date.now() + 60_000 })).rejects.toThrow('already exists');
      expect(await readdir(id === 'T001' ? join(tickets, id) : outside)).toEqual([]);
    }
  });

  test('project mode changing while attachments stage invalidates creation before publication', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[Input sample](attachments/rows.txt)\n';
    let reads = 0;
    const file = { name: 'rows.txt', get bytes() {
      if (++reads === 5) store.save('repos', { ...repo, mode: 'paused' });
      return bytes;
    } };
    await expect(createCompleteTicket(store, repo, text, [file], { mode: repo.mode, expires: Date.now() + 60_000 })).rejects.toThrow('mode changed');
    expect(await readdir(tickets)).toEqual([]);
    expect(store.list('tickets')).toHaveLength(0);
    expect((await readdir(join(repo.path, '.omp-backlog'))).filter(name => name.startsWith('.assisted-stage-'))).toEqual([]);
  });

  test('an interrupted staged attachment never becomes a ticket and only owned staging is cleaned', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[First sample](attachments/first.txt)\n[Second sample](attachments/second.txt)\n';
    let reads = 0;
    const interrupted = { name: 'second.txt', get bytes() { if (++reads > 4) throw new Error('fixture interrupted attachment write'); return bytes; } };
    const files = [{ name: 'first.txt', bytes }, interrupted];
    await mkdir(join(repo.path, '.omp-backlog', '.assisted-stage-unrelated'), { recursive: true });
    await writeFile(join(repo.path, '.omp-backlog', '.assisted-stage-unrelated', 'keep.txt'), 'unrelated');
    await expect(createCompleteTicket(store, repo, text, files, { mode: repo.mode, expires: Date.now() + 60_000 })).rejects.toThrow('fixture interrupted');
    await reconcileTickets(store, true);
    expect(store.list('tickets')).toHaveLength(0);
    expect(await readdir(tickets)).toEqual([]);
    expect((await readdir(join(repo.path, '.omp-backlog'))).sort()).toEqual(['.assisted-stage-unrelated', 'tickets']);
    expect(await Bun.file(join(repo.path, '.omp-backlog', '.assisted-stage-unrelated', 'keep.txt')).text()).toBe('unrelated');
  });

  test('incomplete multipart bytes stay outside storage until the full reviewed request arrives', async () => {
    const { store, repo, tickets } = await fixture();
    const text = markdown() + '\n[Input sample](attachments/rows.txt)\n';
    const files = [{ name: 'rows.txt', bytes }];
    const review = await prepare(store, repo, text, files);
    const full = request(text, files, review.confirmation);
    const headers = new Headers(full.headers);
    const body = new Uint8Array(await full.arrayBuffer());
    let finish!: () => void;
    const receiving = Promise.withResolvers<void>();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(body.subarray(0, Math.floor(body.length / 2)));
      finish = () => { controller.enqueue(body.subarray(Math.floor(body.length / 2))); controller.close(); };
      receiving.resolve();
    } });
    const pending = handleAssistedCreation(store, repo, new Request(full.url, { method: 'POST', headers, body: stream }), 'assisted-create');
    await receiving.promise;
    await reconcileTickets(store, true);
    expect(store.list('tickets')).toHaveLength(0);
    expect(await lstat(tickets).catch(() => null)).toBeNull();
    finish();
    expect((await pending).status).toBe(201);
    expect(store.list('tickets')).toHaveLength(1);
  });

  test('paused and approved-only creation never grants automatic execution or approval', async () => {
    for (const mode of ['paused', 'approved'] as const) {
      const { store, repo } = await fixture(mode);
      const text = markdown();
      const review = await prepare(store, repo, text);
      const ticket = await (await create(store, repo, text, review)).json() as Ticket;
      expect(review.mode).toBe(mode);
      expect(ticket.approvedRevision).toBeNull();
      expect(eligible(store, repo, ticket)).toBe(false);
      expect(store.get('repos', repo.id)?.mode).toBe(mode);
    }
  });

  test('expired publication review and complete-payload validation fail before admission', async () => {
    const { store, repo, tickets } = await fixture();
    await expect(createCompleteTicket(store, repo, markdown(), [], { mode: repo.mode, expires: Date.now() - 1 })).rejects.toThrow('review expired');
    await expect(prepare(store, repo, markdown() + '\n[Missing input](attachments/missing.txt)')).rejects.toThrow('Missing attachment');
    await expect(prepare(store, repo, markdown(), [{ name: 'rows.txt', bytes }])).rejects.toThrow('unreferenced');
    await expect(prepare(store, repo, markdown() + '\n![](attachments/rows.txt)\n', [{ name: 'rows.txt', bytes }])).rejects.toThrow('needs a purpose');
    await expect(prepare(store, repo, markdown() + '\n[Input](attachments/rows.txt)\n', [{ name: 'rows.txt', bytes }, { name: 'rows.txt', bytes }])).rejects.toThrow('Duplicate');
    await expect(prepare(store, repo, markdown(), [{ name: 'unsafe.exe', bytes }])).rejects.toThrow('unsafe');
    await expect(prepare(store, repo, markdown() + 'x'.repeat(MAX_MARKDOWN))).rejects.toThrow('512 KiB');
    await expect(prepare(store, repo, markdown(), [{ name: 'rows.txt', bytes: new Uint8Array(MAX_ATTACHMENT + 1) }])).rejects.toThrow('10 MiB');
    await expect(handleAssistedCreation(store, repo, request(markdown(), [], undefined, ['mode', 'automatic']), 'assisted-prepare')).rejects.toThrow('Unexpected');
    expect(store.list('tickets')).toHaveLength(0);
    expect(await lstat(tickets).catch(() => null)).toBeNull();
  });
});
