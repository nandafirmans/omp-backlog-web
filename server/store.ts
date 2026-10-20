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
  const defaults: Settings = { executable: 'omp', model: '', roots: [join(homedir(), 'Development')], timeLimitMinutes: 30, tokenBudget: 100000, paused: false };
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
    settings() { const row = db.query<{ value: string }, []>('SELECT value FROM config WHERE id=1').get(); if (!row) throw new Error('Settings are missing'); return JSON.parse(row.value) as Settings; },
    setSettings(value) { db.query('UPDATE config SET value=? WHERE id=1').run(JSON.stringify(value)); store.notify(); },
    notify() { if (depth) dirty = true; else target.dispatchEvent(new Event('change')); },
  };
  databases.set(store, db);
  events.set(store, target);
  return store;
}
