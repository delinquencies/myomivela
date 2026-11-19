// Production runtime on Cloudflare. The Worker serves the public site and portal from static assets and
// forwards /api/ to a single Durable Object, which owns the SQLite database and runs the same app as Node.
import { DurableObject } from 'cloudflare:workers';
import { configure, workerProblems } from './lib/config.mjs';
import { useStorage, transaction } from './lib/db.mjs';
import { durableStore, r2Blobs, r2Backups } from './lib/stores/durable.mjs';
import { ensureAdmin } from './lib/auth.mjs';
import { handleApi } from './lib/api.mjs';
import { drainOutbox } from './lib/outbox.mjs';
import { enforceDeposits } from './lib/deposits.mjs';
import { backupIfDue } from './lib/scheduled-backup.mjs';
import { withSecurityHeaders, errorResponse, decodedPath } from './lib/headers.mjs';
import { isPublicPath } from './lib/site.mjs';

export class MyoApi extends DurableObject {
  constructor(state, env) {
    super(state, env);
    // Rate limits read CF-Connecting-IP, which Cloudflare sets on every request.
    configure({ ...env, MYO_TRUST_PROXY:'cloudflare' });
    this.problems = workerProblems();
    if (this.problems.length) console.error('Refusing to serve the API until these settings are fixed:\n- ' + this.problems.join('\n- '));
    state.blockConcurrencyWhile(async () => {
      useStorage(durableStore(state.storage), r2Blobs(env.PHOTOS), env.BACKUPS ? r2Backups(env.BACKUPS) : null);
      await ensureAdmin();
      // The outbox is drained, and the daily backup checked, on an alarm: every five minutes while the object exists.
      if (!(await state.storage.getAlarm())) await state.storage.setAlarm(Date.now() + 60_000);
    });
  }
  async alarm() {
    // A misconfigured deployment sends nothing and charges nothing (MYO_EMAIL=log would mark messages sent unsent).
    if (this.problems.length) return this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
    try { transaction(() => enforceDeposits()); } catch (error) { console.error('Deposits:', error.message); }
    try { await drainOutbox(); } catch (error) { console.error('Outbox:', error.message); }
    try { await backupIfDue(); } catch (error) { console.error('Backup:', error.message); }
    await this.ctx.storage.setAlarm(Date.now() + 5 * 60_000);
  }
  fetch(request) {
    // GET /api/session still answers, so the site loads and a health check can see the deployment is up; the
    // details are in the Worker's log, not the response.
    if (this.problems.length && !(request.method === 'GET' && new URL(request.url).pathname === '/api/session'))
      return errorResponse(Object.assign(new Error('The service is not configured yet.'), { status:503, code:'not_configured' }));
    return handleApi(request, { clientAddress:request.headers.get('cf-connecting-ip') || 'unknown' });
  }
}

export default {
  async fetch(request, env) {
    configure({ ...env, MYO_TRUST_PROXY:'cloudflare' });
    const url = new URL(request.url);
    let response;
    try {
      const path = decodedPath(url);
      if (path.startsWith('/api/')) {
        // One named instance holds all data, so every booking check sees every other booking.
        response = await env.API.get(env.API.idFromName('myo')).fetch(request);
      } else {
        if (!['GET','HEAD'].includes(request.method)) throw Object.assign(new Error('Method not allowed.'), { status:405 });
        if (!isPublicPath(path)) throw Object.assign(new Error('Page not found.'), { status:404 });
        response = await env.ASSETS.fetch(request);
      }
    } catch (error) { response = errorResponse(error); }
    return withSecurityHeaders(response, url);
  },
};
