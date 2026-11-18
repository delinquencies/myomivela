// The JSON API: one route table, with access rules checked before any handler runs.
import { config } from './config.mjs';
import { requireThat, readJson, readText } from './validate.mjs';
import { currentUser, isOwner } from './auth.mjs';
import { errorResponse, decodedPath } from './headers.mjs';
import * as idempotency from './idempotency.mjs';
import account from './routes/account.mjs';
import portal from './routes/portal.mjs';
import diary from './routes/diary.mjs';
import bookings from './routes/bookings.mjs';
import admin from './routes/admin.mjs';
import compliance from './routes/compliance.mjs';
import access from './routes/access.mjs';
import care from './routes/care.mjs';
import clients from './routes/clients.mjs';
import fees from './routes/fees.mjs';
import payments from './routes/payments.mjs';
import series from './routes/series.mjs';
import packages from './routes/packages.mjs';
import outbox from './routes/outbox.mjs';
import staff from './routes/staff.mjs';

// access: 'public' (anyone), 'user' (signed in), 'staff' (any staff account), 'owner' (staff with the owner role).
// Signed-in POSTs honour an Idempotency-Key header (lib/idempotency.mjs) unless the route sets `idempotent:false`.
// `rawBody` routes receive ctx.rawBody (text) instead of ctx.data. `before(ctx)` runs ahead of reading the body (used for rate limiting). `maxBody` raises the 4 MB body limit. `path` may be a RegExp; its match is passed on.
export const routes = [...account, ...portal, ...diary, ...bookings, ...admin, ...compliance, ...access, ...care, ...clients, ...fees, ...payments, ...series, ...packages, ...outbox, ...staff];

function findRoute(method, path) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.path instanceof RegExp) {
      const match = route.path.exec(path);
      if (match) return [route, match];
    } else if (route.path === path) return [route, null];
  }
  return [null, null];
}

// Same-origin check for writes, alongside SameSite=Strict cookies and the JSON-only body rule.
function checkOrigin(request, url) {
  requireThat(request.headers.get('sec-fetch-site') !== 'cross-site', 'Request origin is not allowed.', 403);
  const origin = request.headers.get('origin');
  if (origin) requireThat(origin === (config.origin || url.origin), 'Request origin is not allowed.', 403);
}

// Handles one /api/ request and returns a Response. `clientAddress` comes from the runtime and keys the rate limits.
// Handlers receive ctx and return plain data (sent as JSON) or a Response; they add cookies through ctx.cookies.
export async function handleApi(request, { clientAddress }) {
  try {
    const url = new URL(request.url);
    const path = decodedPath(url);
    if (request.method === 'POST') checkOrigin(request, url);
    const user = currentUser(request);
    const [route, match] = findRoute(request.method, path);
    if (route?.access !== 'public') requireThat(user, 'Sign in to continue.', 401);
    requireThat(route, 'Route not found.', 404);
    if (route.access === 'staff') requireThat(user.admin, 'Staff access is required.', 403);
    if (route.access === 'owner') requireThat(isOwner(user), 'Only the owner can do this.', 403, 'owner_only');
    const ctx = { user, request, url, match, clientAddress, cookies:[] };
    route.before?.(ctx);
    // Webhooks need the exact bytes that were signed, so `rawBody` routes get the body as text instead of JSON.
    if (route.rawBody) ctx.rawBody = await readText(request, route.maxBody);
    else ctx.data = request.method === 'POST' ? await readJson(request, route.maxBody) : undefined;
    const key = request.headers.get('idempotency-key');
    const guarded = key !== null && request.method === 'POST' && route.access !== 'public' && route.idempotent !== false;
    if (guarded) {
      const replay = idempotency.claim(user, key, path, ctx.data);
      if (replay) return new Response(replay.body, { status:replay.status, headers:{
        'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'private, no-store', 'Idempotent-Replay':'true',
      } });
    }
    let result;
    try { result = await route.handler(ctx); }
    catch (error) { if (guarded) idempotency.release(user, key); throw error; }
    const body = result instanceof Response ? null : JSON.stringify(result ?? null);
    if (guarded) idempotency.complete(user, key, result instanceof Response ? result.status : 200, body ?? 'null');
    const response = result instanceof Response ? result
      : new Response(body, { headers:{ 'Content-Type':'application/json; charset=utf-8' } });
    if (!response.headers.has('Cache-Control')) response.headers.set('Cache-Control','private, no-store');
    for (const cookie of ctx.cookies) response.headers.append('Set-Cookie', cookie);
    return response;
  } catch (error) { return errorResponse(error); }
}
