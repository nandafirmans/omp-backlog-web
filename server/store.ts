import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import type { Entities, Settings, Store } from './contracts';

const databases = new WeakMap<Store, Database>();
const events = new WeakMap<Store, EventTarget>();
export const token = () => randomBytes(32).toString('hex');
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const within = (root: string, path: string) => { const part = relative(root, path); return part === '' || (!part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && part !== '..' && !isAbsolute(part)); };
export function database(store: Store): Database {
  const db = databases.get(store);
  if (!db) throw new Error('Unknown store');
  return db;
}
export function subscribe(store: Store, callback: () => void): () => void {
  const target = events.get(store)!;
  target.addEventListener('change', callback);
  return () => target.removeEventListener('change', callback);
}
export function closeStore(store: Store): void { database(store).close(); }
export function createStore(directory = process.env.OMP_BACKLOG_DATA || join(homedir(), '.local/share/omp-backlog-web')): Store {
  const requested = resolve(directory);
  const appRoot = resolve(import.meta.dir, '..');
  if (within(appRoot, requested) || within(requested, appRoot)) throw new Error('Private application data must be outside the application source tree');
  if (existsSync(requested) && lstatSync(requested).isSymbolicLink()) throw new Error('Application data directory must not be a symlink');
  mkdirSync(requested, { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(requested);
  if (within(appRoot, dataDir) || within(dataDir, appRoot)) throw new Error('Private application data must be outside the application source tree');
  chmodSync(dataDir, 0o700);
  const filename = join(dataDir, 'backlog.sqlite');
  if (existsSync(filename) && lstatSync(filename).isSymbolicLink()) throw new Error('Database must not be a symlink');
  const db = new Database(filename, { create: true, strict: true });
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, authenticated INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS throttle (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, until_at INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS batch_reservations (operation_id TEXT NOT NULL, repo_path TEXT NOT NULL, ticket_id TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(operation_id,ticket_id));
    CREATE INDEX IF NOT EXISTS batch_reservation_lookup ON batch_reservations(repo_path,ticket_id,state,expires);
    CREATE INDEX IF NOT EXISTS batch_reservation_expiry ON batch_reservations(state,expires,operation_id);
    CREATE TABLE IF NOT EXISTS batch_index_meta (id INTEGER PRIMARY KEY CHECK(id=1));
    CREATE INDEX IF NOT EXISTS batch_workspace_lookup ON records(kind,json_extract(value,'$.repoId'),json_extract(value,'$.workspaceId'));
    CREATE INDEX IF NOT EXISTS batch_uncompacted_complete ON records(id) WHERE kind='batchOperations' AND json_extract(value,'$.state')='complete' AND coalesce(json_extract(value,'$.compacted'),0)=0;
    CREATE INDEX IF NOT EXISTS batch_uncompacted_prepared ON records(id) WHERE kind='batchOperations' AND json_extract(value,'$.state')='prepared' AND coalesce(json_extract(value,'$.compacted'),0)=0;
    CREATE TRIGGER IF NOT EXISTS batch_reservations_insert AFTER INSERT ON records WHEN NEW.kind='batchOperations' BEGIN
      INSERT INTO batch_reservations SELECT NEW.id,json_extract(NEW.value,'$.repoPath'),json_extract(item.value,'$.id'),json_extract(NEW.value,'$.state'),json_extract(NEW.value,'$.expires') FROM json_each(NEW.value,'$.tickets') item WHERE json_extract(NEW.value,'$.state') != 'complete' AND coalesce(json_extract(NEW.value,'$.invalidated'),0) = 0;
    END;
    CREATE TRIGGER IF NOT EXISTS batch_reservations_update AFTER UPDATE ON records WHEN NEW.kind='batchOperations' BEGIN
      DELETE FROM batch_reservations WHERE operation_id=NEW.id;
      INSERT INTO batch_reservations SELECT NEW.id,json_extract(NEW.value,'$.repoPath'),json_extract(item.value,'$.id'),json_extract(NEW.value,'$.state'),json_extract(NEW.value,'$.expires') FROM json_each(NEW.value,'$.tickets') item WHERE json_extract(NEW.value,'$.state') != 'complete' AND coalesce(json_extract(NEW.value,'$.invalidated'),0) = 0;
    END;
    CREATE TRIGGER IF NOT EXISTS batch_reservations_delete AFTER DELETE ON records WHEN OLD.kind='batchOperations' BEGIN DELETE FROM batch_reservations WHERE operation_id=OLD.id; END;`);
  if (!db.query('SELECT id FROM batch_index_meta WHERE id=1').get()) {
    db.transaction(() => {
      db.exec(`DELETE FROM batch_reservations;
        UPDATE records SET value=json_set(value,'$.invalidated',json('true'),'$.compacted',json('true'),'$.tickets',json('[]')) WHERE kind='batchOperations' AND json_extract(value,'$.state')='prepared' AND (coalesce(json_extract(value,'$.invalidated'),0)=1 OR json_extract(value,'$.expires') <= unixepoch()*1000);
        INSERT INTO batch_reservations SELECT records.id,json_extract(records.value,'$.repoPath'),json_extract(item.value,'$.id'),json_extract(records.value,'$.state'),json_extract(records.value,'$.expires') FROM records,json_each(records.value,'$.tickets') item WHERE records.kind='batchOperations' AND json_extract(records.value,'$.state') != 'complete' AND coalesce(json_extract(records.value,'$.invalidated'),0)=0;
        INSERT INTO batch_index_meta VALUES(1);`);
    })();
  }
  const completed = db.query<{ id: string; value: string }, []>("SELECT id,value FROM records WHERE kind='batchOperations' AND json_extract(value,'$.state')='complete' AND coalesce(json_extract(value,'$.compacted'),0)=0").all();
  const updateCompleted = db.query("UPDATE records SET value=? WHERE kind='batchOperations' AND id=?");
  db.transaction(() => {
    for (const row of completed) {
      const operation = JSON.parse(row.value);
      if (!Array.isArray(operation.tickets) || operation.tickets.some((ticket: { markdown?: unknown }) => !ticket || typeof ticket.markdown !== 'string')) continue;
      operation.tickets = operation.tickets.map(({ key, id, dependencies, markdown }: { key: string; id: string; dependencies: string[]; markdown: string }) => ({ key, id, dependencies, revision: digest(markdown + '\0[]'), markdown: '' }));
      operation.compacted = true;
      updateCompleted.run(JSON.stringify(operation), row.id);
    }
  })();
  db.exec("UPDATE records SET value=json_set(value,'$.invalidated',json('true'),'$.compacted',json('true'),'$.tickets',json('[]')) WHERE kind='batchOperations' AND json_extract(value,'$.state')='prepared' AND coalesce(json_extract(value,'$.compacted'),0)=0 AND (coalesce(json_extract(value,'$.invalidated'),0)=1 OR json_extract(value,'$.expires')<=unixepoch()*1000)");
  const defaults: Settings = { executable: 'omp', engineeringMode: 'standard', model: '', roots: [join(homedir(), 'Development')], timeLimitMinutes: 30, tokenBudget: 100000, maxConcurrentTickets: 1, paused: false };
  db.query('INSERT OR IGNORE INTO config(id,value) VALUES(1,?)').run(JSON.stringify(defaults));
  const target = new EventTarget();
  let depth = 0;
  let dirty = false;
  const store: Store = {
    dataDir,
    list<K extends keyof Entities>(kind: K): Entities[K][] { return (db.query('SELECT value FROM records WHERE kind=? ORDER BY id').all(kind) as { value: string }[]).map(row => JSON.parse(row.value) as Entities[K]); },
    get<K extends keyof Entities>(kind: K, id: string): Entities[K] | undefined { const row = db.query('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id) as { value: string } | null; return row ? JSON.parse(row.value) as Entities[K] : undefined; },
    save(kind, value) { const id = kind === 'tickets' && 'repoId' in value ? `${value.repoId}/${value.id}` : value.id; db.query('INSERT INTO records(kind,id,value) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind, id, JSON.stringify(value)); store.notify(); },
    transaction<T>(fn: () => T): T {
      if (depth) return fn();
      depth++;
      try { const value = db.transaction(fn)(); depth--; if (dirty) { dirty = false; target.dispatchEvent(new Event('change')); } return value; }
      catch (error) { depth--; dirty = false; throw error; }
    },
    settings() { const row = db.query<{ value: string }, []>('SELECT value FROM config WHERE id=1').get(); if (!row) throw new Error('Settings are missing'); const settings = JSON.parse(row.value) as Settings; return { ...settings, engineeringMode: settings.engineeringMode ?? 'pstack', maxConcurrentTickets: settings.maxConcurrentTickets ?? 1 }; },
    setSettings(value) { db.query('UPDATE config SET value=? WHERE id=1').run(JSON.stringify(value)); store.notify(); },
    notify() { if (depth) dirty = true; else target.dispatchEvent(new Event('change')); },
  };
  databases.set(store, db);
  events.set(store, target);
  return store;
}
