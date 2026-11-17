// The JSON API: one route table, with access rules checked before any handler runs.
import { config } from './config.mjs';
import { requireThat, readJson } from './validate.mjs';
import { currentUser } from './auth.mjs';
import account from './routes/account.mjs';
import portal from './routes/portal.mjs';
import diary from './routes/diary.mjs';
import bookings from './routes/bookings.mjs';
import admin from './routes/admin.mjs';

// access: 'public' (anyone), 'user' (signed in), 'staff' (signed-in admin).
// `before` runs ahead of reading the body (used for rate limiting). `path` may be a RegExp; its match is passed on.
export const routes = [...account, ...portal, ...diary, ...bookings, ...admin];

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
function checkOrigin(request) {
  requireThat(request.headers['sec-fetch-site'] !== 'cross-site', 'Request origin is not allowed.', 403);
  const origin = request.headers.origin;
  if (origin) requireThat(origin === (config.origin || 'http://' + request.headers.host), 'Request origin is not allowed.', 403);
}

export async function handleApi(request, response, path) {
  if (request.method === 'POST') checkOrigin(request);
  const user = currentUser(request);
  const [route, match] = findRoute(request.method, path);
  if (route?.access !== 'public') requireThat(user, 'Sign in to continue.', 401);
  requireThat(route, 'Route not found.', 404);
  if (route.access === 'staff') requireThat(user.admin, 'Staff access is required.', 403);
  route.before?.(request);
  const data = request.method === 'POST' ? await readJson(request) : undefined;
  return route.handler({ user, data, request, response, match, url:new URL(request.url,'http://localhost') });
}
