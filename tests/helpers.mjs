import { spawn, spawnSync } from 'node:child_process';
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

// Most suites start visits booked days ahead, so they lift the early-start limit. Pass
// { MYO_EARLY_START_MINUTES:'' } to test the real rule (the visit buffer).
// Tests also get a fixed vault key (base64 of 32 bytes) for home-access details.
const testDefaults = { MYO_PRICING_MODE:'catalog', MYO_EARLY_START_MINUTES:'1000000', MYO_VAULT_KEY:Buffer.from('test-vault-key-0123456789abcdef!').toString('base64') };

function spawnTarget(dir, port, env, dbPath, inspectorPort) {
  if (target === 'worker') {
    const vars = { MYO_ADMIN_EMAIL:adminLogin.email, MYO_ADMIN_PASSWORD:adminLogin.password, ...testDefaults, ...env };
    const args = ['dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', join(dir, 'state'), '--inspector-port', String(inspectorPort),
      '--show-interactive-dev-session=false', ...Object.entries(vars).filter(([name, value]) => name.startsWith('MYO_') && value !== '').flatMap(([name, value]) => ['--var', name + ':' + value])];
    // detached: wrangler starts workerd as a child, and stop() kills the whole process group.
    return spawn(process.execPath, [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
      cwd:root, detached:true, windowsHide:true, stdio:['ignore','pipe','pipe'],
      env:{ ...process.env, WRANGLER_SEND_METRICS:'false', XDG_CONFIG_HOME:join(dir,'config'), WRANGLER_LOG_PATH:join(dir,'logs') },
    });
  }
  return spawn(process.execPath, ['--no-warnings', join(root, 'server.mjs')], {
    cwd: dir,
    env: { ...process.env, PORT:String(port), MYO_DB:dbPath || join(dir, 'test.sqlite'), MYO_ADMIN_EMAIL:adminLogin.email,
      MYO_ADMIN_PASSWORD:adminLogin.password, NODE_ENV:'test', ...testDefaults, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Starts the app on a free port with private storage. Returns helpers bound to that instance.
// `dbPath` is only meaningful on Node; on the Worker the database lives inside wrangler's state directory.
export async function startServer(env = {}, { dbPath } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'myo-test-'));
  const port = await freePort();
  // wrangler also needs a debugger port; ask for a free one rather than assuming port + 1 is unused.
  const child = spawnTarget(dir, port, env, dbPath, target === 'worker' ? await freePort() : 0);
  let output = '';
  await new Promise((done, fail) => {
    // The Worker is ready when it answers (waitForWorker below); its "Ready on" line can come before that.
    if (target === 'worker') waitForWorker('http://127.0.0.1:' + port,()=>child.exitCode===null).then(done, fail);
    const ready = /listening/;
    const read = chunk => { output += chunk; if (ready.test(output)) done(); };
    child.stdout.on('data', target === 'node' ? read : chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.once('exit', code => fail(new Error('Server exited with ' + code + ': ' + output)));
    setTimeout(() => fail(new Error('Server did not start: ' + output)), 60_000).unref();
  });
  const base = 'http://127.0.0.1:' + port;
  const jars = {}; // who -> Map(cookie name -> value)
  const cookieHeader = who => jars[who]?.size ? [...jars[who]].map(([name, value]) => name + '=' + value).join('; ') : '';
  async function call(who, method, path, body, headers = {}) {
    const response = await fetch(base + path, {
      method, redirect:'manual',
      headers: { ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...(cookieHeader(who) ? { cookie:cookieHeader(who) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Like a browser: keep each cookie by name, and drop one the server expires (Max-Age=0).
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)];
      jars[who] ??= new Map();
      if (/;\s*Max-Age=0\b/i.test(cookie) || !value) jars[who].delete(name); else jars[who].set(name, value);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    let json; try { json = JSON.parse(bytes); } catch { /* not JSON */ }
    return { status:response.status, json, bytes, headers:response.headers };
  }
  return {
    base, call, cookies: who => new Map(jars[who] || []), forgetCookie: (who, name) => jars[who]?.delete(name), output: () => output, dbPath: target === 'node' ? dbPath || join(dir, 'test.sqlite') : undefined,
    async stop() {
      const exited = new Promise(done => child.once('exit', done));
      if (target === 'worker' && process.platform === 'win32') {
        const killed=spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:5000});
        if(killed.status!==0)child.kill();
      }
      else if (target === 'worker') { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } } else child.kill();
      await exited;
      await rm(dir, { recursive:true, force:true, maxRetries:20, retryDelay:100 });
    },
  };
}

// "Ready on" can print before the Durable Object has finished starting; wait for a real answer.
async function waitForWorker(base,alive=()=>true) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if(!alive())throw new Error('Worker exited before it was ready.');
    try { if ((await fetch(base + '/api/session')).ok) return; } catch { /* not listening yet */ }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error('Worker did not answer at ' + base);
}

export const iso = ms => new Date(ms).toISOString();
export const hours = n => n * 3_600_000;
