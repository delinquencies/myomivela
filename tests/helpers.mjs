import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const adminLogin = { email:'staff@example.test', password:'staff-pass-123456' };
export const password = 'correct-horse-battery';

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer().once('error', fail).listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

// Starts server.mjs on a free port with a private database. Returns helpers bound to that instance.
export async function startServer(env = {}, { dbPath } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'myo-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--no-warnings', join(root, 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, PORT:String(port), MYO_DB:dbPath || join(dir, 'test.sqlite'), MYO_ADMIN_EMAIL:adminLogin.email,
      MYO_ADMIN_PASSWORD:adminLogin.password, NODE_ENV:'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => output += chunk);
  await new Promise((done, fail) => {
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('listening')) done(); });
    child.once('exit', code => fail(new Error('Server exited with ' + code + ': ' + output)));
  });
  const base = 'http://127.0.0.1:' + port;
  const jars = {};
  async function call(who, method, path, body, headers = {}) {
    const response = await fetch(base + path, {
      method, redirect:'manual',
      headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...(jars[who] ? { cookie:jars[who] } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) jars[who] = cookie.split(';')[0];
    const bytes = Buffer.from(await response.arrayBuffer());
    let json; try { json = JSON.parse(bytes); } catch { /* not JSON */ }
    return { status:response.status, json, bytes, headers:response.headers };
  }
  return {
    base, call, output: () => output, dbPath: dbPath || join(dir, 'test.sqlite'),
    async stop() { child.kill(); await new Promise(done => child.once('exit', done)); await rm(dir, { recursive:true, force:true }); },
  };
}

export const iso = ms => new Date(ms).toISOString();
export const hours = n => n * 3_600_000;
