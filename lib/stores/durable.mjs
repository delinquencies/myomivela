// Cloudflare runtime storage: the Durable Object's built-in SQLite, photos in R2.
// The SQL API is synchronous and the object is a single instance, so transactions behave as they do under Node.
export function durableStore(storage) {
  const sql = storage.sql;
  return {
    get: (query, ...args) => sql.exec(query, ...args).toArray()[0],
    all: (query, ...args) => sql.exec(query, ...args).toArray(),
    run(query, ...args) {
      const cursor = sql.exec(query, ...args);
      cursor.toArray();
      return { changes:cursor.rowsWritten, lastInsertRowid:sql.exec('SELECT last_insert_rowid() AS id').one().id };
    },
    exec: query => { sql.exec(query); },
    // BEGIN/COMMIT are not allowed in Durable Objects; transactionSync gives the same all-or-nothing behaviour.
    transaction: fn => storage.transactionSync(fn),
  };
}

export function r2Blobs(bucket) {
  return {
    async put(key, bytes, mime) { await bucket.put(key, bytes, { httpMetadata:{ contentType:mime } }); },
    async get(key) { const object = await bucket.get(key); return object ? new Uint8Array(await object.arrayBuffer()) : null; },
    async delete(key) { await bucket.delete(key); },
  };
}

// Scheduled backups on Cloudflare: a second R2 bucket (binding BACKUPS), under backups/.
export function r2Backups(bucket) {
  const key = name => 'backups/' + name;
  return {
    async put(name, bytes) { await bucket.put(key(name), bytes, { httpMetadata:{ contentType:'application/gzip' } }); },
    async get(name) { const object = await bucket.get(key(name)); return object ? new Uint8Array(await object.arrayBuffer()) : null; },
    async delete(name) { await bucket.delete(key(name)); },
    async list() {
      const found = [];
      let cursor;
      do {
        const page = await bucket.list({ prefix:'backups/', cursor });
        found.push(...page.objects.map(object => ({ name:object.key.slice('backups/'.length), size:object.size })));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return found;
    },
  };
}
