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

// MYO_TARGET=worker runs the suites against the Cloudflare runtime (`wrangler dev`) instead of Node.
export const target = process.env.MYO_TARGET === 'worker' ? 'worker' : 'node';
export const nodeOnly = target === 'worker' ? 'needs the Node runtime (direct database or process access)' : false;

function spawnTarget(dir, port, env, dbPath) {
  if (target === 'worker') {
    const vars = { MYO_ADMIN_EMAIL:adminLogin.email, MYO_ADMIN_PASSWORD:adminLogin.password, ...env };
    const args = ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', join(dir, 'state'), '--inspector-port', String(port + 1),
      '--show-interactive-dev-session=false', ...Object.entries(vars).filter(([name]) => name.startsWith('MYO_')).flatMap(([name, value]) => ['--var', name + ':' + value])];
    // detached: wrangler starts workerd as a child, and stop() kills the whole process group.
    return spawn(join(root, 'node_modules', '.bin', 'wrangler'), args, {
      cwd:root, detached:true, stdio:['ignore','pipe','pipe'], env:{ ...process.env, WRANGLER_SEND_METRICS:'false' },
    });
  }
  return spawn(process.execPath, ['--no-warnings', join(root, 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, PORT:String(port), MYO_DB:dbPath || join(dir, 'test.sqlite'), MYO_ADMIN_EMAIL:adminLogin.email,
      MYO_ADMIN_PASSWORD:adminLogin.password, NODE_ENV:'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Starts the app on a free port with private storage. Returns helpers bound to that instance.
// `dbPath` is only meaningful on Node; on the Worker the database lives inside wrangler's state directory.
export async function startServer(env = {}, { dbPath } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'myo-test-'));
  const port = await freePort();
  const child = spawnTarget(dir, port, env, dbPath);
  let output = '';
  await new Promise((done, fail) => {
    // The Worker is ready when it answers (waitForWorker below); its "Ready on" line can come before that.
    if (target === 'worker') waitForWorker('http://127.0.0.1:' + port).then(done, fail);
    const ready = /listening/;
    const read = chunk => { output += chunk; if (ready.test(output)) done(); };
    child.stdout.on('data', target === 'node' ? read : chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.once('exit', code => fail(new Error('Server exited with ' + code + ': ' + output)));
    setTimeout(() => fail(new Error('Server did not start: ' + output)), 60_000).unref();
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
    base, call, output: () => output, dbPath: target === 'node' ? dbPath || join(dir, 'test.sqlite') : undefined,
    async stop() {
      const exited = new Promise(done => child.once('exit', done));
      if (target === 'worker') { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } } else child.kill();
      await exited;
      await rm(dir, { recursive:true, force:true });
    },
  };
}

// "Ready on" can print before the Durable Object has finished starting; wait for a real answer.
async function waitForWorker(base) {
  for (let attempt = 0; attempt < 250; attempt++) {
    try { if ((await fetch(base + '/api/session')).ok) return; } catch { /* not listening yet */ }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error('Worker did not answer at ' + base);
}

export const iso = ms => new Date(ms).toISOString();
export const hours = n => n * 3_600_000;
