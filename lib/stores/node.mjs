// Local runtime storage: SQLite through node:sqlite, photos as files. Used by `npm start` and `npm test`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function nodeStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return {
    get: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    run: (sql, ...args) => {
      const result = db.prepare(sql).run(...args);
      return { changes:Number(result.changes), lastInsertRowid:Number(result.lastInsertRowid) };
    },
    exec: sql => db.exec(sql),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

// Photos live next to the database in a `photos` directory, one file per key.
export function fileBlobs(directory) {
  const file = key => join(directory, key.replace(/[^\w-]/g, '_'));
  return {
    async put(key, bytes) { await mkdir(directory, { recursive: true }); await writeFile(file(key), bytes); },
    async get(key) { try { return new Uint8Array(await readFile(file(key))); } catch { return null; } },
    async delete(key) { await rm(file(key), { force: true }); },
  };
}

// Scheduled backups (MYO_BACKUP_DIR): one file per backup. Point it at a different disk or a synced folder.
export function fileBackups(directory) {
  return {
    async put(name, bytes) { await mkdir(directory, { recursive: true }); await writeFile(join(directory, name), bytes); },
    async get(name) { try { return new Uint8Array(await readFile(join(directory, name))); } catch { return null; } },
    async delete(name) { await rm(join(directory, name), { force: true }); },
    async list() {
      let names = [];
      try { names = await readdir(directory); } catch { return []; }
      return Promise.all(names.map(async name => ({ name, size:(await stat(join(directory, name))).size })));
    },
  };
}
