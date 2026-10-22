import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, closeStore, database } from './store';
import { createApi } from './api';
import { reconcileTickets, safePath, snapshotTicket, uploadAttachment, writeTicket } from './tickets';
import { eligible } from './runtime';
import type { Repo, Runtime } from './contracts';

const root = await mkdtemp(join(tmpdir(), 'omp-backlog-acceptance-'));
const store = createStore(join(root, 'private'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
store.setSettings({ ...store.settings(), roots: [workspace] });
const repo: Repo = { id: 'repo-test', name: 'Disposable', path: workspace, git: false, mode: 'paused', lastStarted: 0 };
store.save('repos', repo);
const markdown = (id = 'T001', dependencies = '[]') => `---\nid: ${id}\ntitle: Write proof\ndepends_on: ${dependencies}\n---\n\n# Goal\nWrite a proof file.\n\n# Requirements\n- Work only in this disposable directory.\n\n# Acceptance criteria\n- proof.txt contains verified.\n\n# Verification\nRead proof.txt.\n`;
afterAll(async () => {
  closeStore(store);
  // Snapshots are intentionally read-only; restore only our disposable fixture.
  await chmod(join(store.dataDir, 'snapshots', 'snapshot-test'), 0o700);
  await chmod(join(store.dataDir, 'snapshots', 'snapshot-test', 'attachments'), 0o700);
  await rm(root, { recursive: true, force: true });
});

describe('requirements and filesystem boundaries', () => {
  test('stale saves cannot overwrite an external revision; old approval is invalidated', async () => {
    const first = await writeTicket(store, repo, markdown());
    store.save('tickets', { ...first, approvedRevision: first.revision });
    const revised = await writeTicket(store, repo, markdown().replace('Write a proof file.', 'Write a checked proof file.'), first.revision, 'T001');
    expect(revised.revision).not.toBe(first.revision);
    expect(revised.approvedRevision).not.toBe(revised.revision);
    await expect(writeTicket(store, repo, markdown(), first.revision, 'T001')).rejects.toThrow();
    expect(store.get('tickets', `${repo.id}/T001`)?.revision).toBe(revised.revision);
  });
  test('path traversal and symlink escape are rejected', async () => {
    await symlink(root, join(workspace, 'escape'));
    await expect(safePath(workspace, join(workspace, 'escape', 'private'))).rejects.toThrow();
    await expect(safePath(workspace, join(workspace, '..', 'private'))).rejects.toThrow();
  });
  test('missing dependencies and cycles are ineligible and actionable', async () => {
    await writeTicket(store, repo, markdown('T002', '[T003]'));
    await reconcileTickets(store, true);
    expect(store.get('tickets', `${repo.id}/T002`)?.error).toBeTruthy();
    await writeTicket(store, repo, markdown('T003', '[T002]'));
    await reconcileTickets(store, true);
    expect(store.get('tickets', `${repo.id}/T002`)?.error).toBeTruthy();
    expect(store.get('tickets', `${repo.id}/T003`)?.error).toBeTruthy();
  });
  test('referenced attachment changes invalidate approval and run snapshot stays immutable', async () => {
    const ticket = await writeTicket(store, repo, markdown('T004') + '\n# Attachments\n- [Example](attachments/example.json)\n');
    const uploaded = await uploadAttachment(store, repo, 'T004', 'example.json', new TextEncoder().encode('{"value":1}'), ticket.revision);
    store.save('tickets', { ...uploaded, approvedRevision: uploaded.revision });
    const snapshot = await snapshotTicket(store, uploaded, 'snapshot-test');
    const original = await Bun.file(join(snapshot, 'attachments', 'example.json')).text();
    await writeFile(join(workspace, '.omp-backlog/tickets/T004/attachments/example.json'), '{"value":2}');
    await reconcileTickets(store, true);
    const changed = store.get('tickets', `${repo.id}/T004`)!;
    expect(changed.revision).not.toBe(uploaded.revision);
    expect(changed.approvedRevision).not.toBe(changed.revision);
    expect(await Bun.file(join(snapshot, 'attachments', 'example.json')).text()).toBe(original);
    await expect(uploadAttachment(store, repo, 'T004', '../unsafe.json', new Uint8Array(), changed.revision)).rejects.toThrow();
  });
  test('unreferenced uploads and empty purpose labels can be saved but cannot run or retain approval', async () => {
    const automatic = { ...repo, mode: 'automatic' as const };
    const approved = { ...repo, mode: 'approved' as const };
    const ticket = await writeTicket(store, repo, markdown('T005'));
    store.save('tickets', { ...ticket, status: 'ready', approvedRevision: ticket.revision });
    const uploaded = await uploadAttachment(store, repo, 'T005', 'expected.png', new Uint8Array([1]), ticket.revision);
    expect(uploaded.error).toContain('Attachment expected.png is unreferenced');
    expect(uploaded.approvedRevision).toBeNull();
    expect(eligible(store, automatic, uploaded)).toBe(false);

    const empty = await writeTicket(store, repo, markdown('T005') + '\n![   ](attachments/expected.png "   ")\n', uploaded.revision, 'T005');
    expect(empty.error).toContain('Attachment expected.png needs a purpose');
    expect(eligible(store, automatic, empty)).toBe(false);
    const fixed = await writeTicket(store, repo, markdown('T005') + '\n![Expected empty-state layout at narrow viewport](attachments/expected.png)\n', empty.revision, 'T005');
    expect(fixed.error).toBeNull();
    expect(eligible(store, automatic, fixed)).toBe(true);
    expect(eligible(store, approved, fixed)).toBe(false);
    store.save('tickets', { ...fixed, status: 'ready', approvedRevision: fixed.revision });
    expect(eligible(store, approved, store.get('tickets', `${repo.id}/T005`)!)).toBe(true);

    const revised = await writeTicket(store, repo, markdown('T005') + '\n![](attachments/expected.png)\n', fixed.revision, 'T005');
    expect(revised.error).toContain('needs a purpose');
    expect(revised.approvedRevision).toBeNull();
    expect(eligible(store, automatic, revised)).toBe(false);
    expect(eligible(store, approved, revised)).toBe(false);
  });
  test('missing attachment drafts accept uploads and a link title can supply their purpose', async () => {
    const ticket = await writeTicket(store, repo, markdown('T006') + '\n[](attachments/rows.json)\n');
    expect(ticket.error).toContain('Missing attachment rows.json');
    const uploaded = await uploadAttachment(store, repo, 'T006', 'rows.json', new TextEncoder().encode('[{"synthetic":true}]'), ticket.revision);
    expect(uploaded.error).toContain('Attachment rows.json needs a purpose');
    expect(eligible(store, { ...repo, mode: 'automatic' }, uploaded)).toBe(false);
    const fixed = await writeTicket(store, repo, markdown('T006') + "\n[ ](attachments/rows.json 'Synthetic example records for export verification')\n", uploaded.revision, 'T006');
    expect(fixed.error).toBeNull();
    expect(eligible(store, { ...repo, mode: 'automatic' }, fixed)).toBe(true);
    const extra = await uploadAttachment(store, repo, 'T006', 'notes.txt', new TextEncoder().encode('Use synthetic rows only.'), fixed.revision);
    expect(extra.error).toContain('Attachment notes.txt is unreferenced');
    expect(eligible(store, { ...repo, mode: 'automatic' }, extra)).toBe(false);
    const complete = await writeTicket(store, repo, fixed.markdown + '\n[Notes explaining the synthetic input constraints](attachments/notes.txt)\n', extra.revision, 'T006');
    expect(complete.error).toBeNull();
    expect(eligible(store, { ...repo, mode: 'automatic' }, complete)).toBe(true);
  });
  test('a purpose-bearing reference permits empty duplicate references to the same attachment', async () => {
    const ticket = await writeTicket(store, repo, markdown('T007') + '\n[](attachments/layout.png)\n![Expected empty-state layout](attachments/layout.png)\n![](attachments/layout.png)\n');
    expect(ticket.error).toContain('Missing attachment layout.png');
    const uploaded = await uploadAttachment(store, repo, 'T007', 'layout.png', new Uint8Array([1]), ticket.revision);
    expect(uploaded.error).toBeNull();
    expect(eligible(store, { ...repo, mode: 'automatic' }, uploaded)).toBe(true);
    const titlePurpose = await writeTicket(store, repo, markdown('T007') + '\n![](attachments/layout.png)\n[](attachments/layout.png "Expected empty-state layout")\n', uploaded.revision, 'T007');
    expect(titlePurpose.error).toBeNull();
    expect(eligible(store, { ...repo, mode: 'automatic' }, titlePurpose)).toBe(true);
  });
});

describe('dashboard access and mutation permission', () => {
  const runtime: Runtime = { wake() {}, async reconcile() {}, async control() {}, async answer() {}, async close() {} };
  const api = createApi(store, runtime);
  const request = (path: string, init: RequestInit = {}) => api(new Request(`http://127.0.0.1:4310${path}`, init));
  let cookie = '';
  let csrf = '';
  test('protected data and hostile origins are denied', async () => {
    expect((await request('/api/state')).status).toBe(401);
    expect((await api(new Request('http://evil.invalid/api/session'))).status).toBe(403);
    expect((await request('/api/login', { method: 'POST', headers: { Origin: 'http://evil.invalid', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
  test('login creates session, CSRF binds mutations, logout revokes it', async () => {
    const password = crypto.randomUUID() + crypto.randomUUID();
    database(store).query('INSERT INTO owner (id, username, hash) VALUES (1, ?, ?)').run('acceptance', await Bun.password.hash(password, { algorithm: 'argon2id' }));
    const login = await request('/api/login', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4310', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'acceptance', password }) });
    expect(login.status).toBe(200);
    cookie = login.headers.get('set-cookie')!.split(';')[0];
    csrf = (await login.json() as { csrf: string }).csrf;
    expect((await request('/api/state', { headers: { Cookie: cookie } })).status).toBe(200);
    const headers = { Cookie: cookie, Origin: 'http://127.0.0.1:4310', 'Content-Type': 'application/json' };
    expect((await request('/api/settings', { method: 'PATCH', headers, body: JSON.stringify({ paused: true }) })).status).toBe(403);
    expect((await request('/api/settings', { method: 'PATCH', headers: { ...headers, 'X-CSRF-Token': csrf }, body: JSON.stringify({ paused: true }) })).status).toBe(200);
    expect((await request('/api/logout', { method: 'POST', headers: { ...headers, 'X-CSRF-Token': csrf } })).status).toBe(200);
    expect((await request('/api/state', { headers: { Cookie: cookie } })).status).toBe(401);
  });
});
