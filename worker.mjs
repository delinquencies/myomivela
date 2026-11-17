// Production runtime on Cloudflare. The Worker serves the public site and portal from static assets and
// forwards /api/ to a single Durable Object, which owns the SQLite database and runs the same app as Node.
import { DurableObject } from 'cloudflare:workers';
import { configure } from './lib/config.mjs';
import { useStorage } from './lib/db.mjs';
import { durableStore, r2Blobs } from './lib/stores/durable.mjs';
import { ensureAdmin } from './lib/auth.mjs';
import { handleApi } from './lib/api.mjs';
import { withSecurityHeaders, errorResponse, decodedPath } from './lib/headers.mjs';
import { isPublicPath } from './lib/site.mjs';

export class MyoApi extends DurableObject {
  constructor(state, env) {
    super(state, env);
    // Rate limits read CF-Connecting-IP, which Cloudflare sets on every request.
    configure({ ...env, MYO_TRUST_PROXY:'cloudflare' });
    state.blockConcurrencyWhile(async () => {
      useStorage(durableStore(state.storage), r2Blobs(env.PHOTOS));
      await ensureAdmin();
    });
  }
  fetch(request) {
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
