// @ts-check
// Portal routes (CUX-01): one registry of every portal destination, who may open it, and how old links map onto it.
// Pure data and functions: no DOM, no history changes and no translated text. The portal (Codex) renders the result
// of resolveLocation() and routesFor(); the server still enforces access on every API call.

/** @typedef {'signed_out'|'customer'|'owner'|'sitter'} Role */
/** @typedef {'ready'|'sign_in_required'|'forbidden'|'not_found'} Outcome */
/**
 * @typedef {{ id:string, pattern:RegExp, params?:string[], roles:Role[], parent:string|null, labelKey?:string, menu?:Role[] }} RouteDescriptor
 * `pattern` matches the hash without '#'. `params` names its capture groups (all positive integers or step names).
 * `labelKey` is an English catalog key the portal translates; `menu` lists the roles that see it in navigation.
 */

const customer = /** @type {Role[]} */ (['customer']);
const staff = /** @type {Role[]} */ (['owner','sitter']);
const owner = /** @type {Role[]} */ (['owner']);
const anyone = /** @type {Role[]} */ (['signed_out','customer','owner','sitter']);

/** @type {RouteDescriptor[]} */
export const routes = [
  // Signed out
  { id:'sign-in', pattern:/^sign-in$/, roles:['signed_out'], parent:null },
  { id:'register', pattern:/^register$/, roles:['signed_out'], parent:'sign-in' },
  { id:'recover', pattern:/^recover$/, roles:['signed_out'], parent:'sign-in' },
  // Customers
  { id:'client-home', pattern:/^client-home$/, roles:customer, parent:null, labelKey:'Home', menu:customer },
  { id:'upcoming', pattern:/^upcoming$/, roles:[...customer, ...staff], parent:null, labelKey:'My bookings', menu:[...customer, ...staff] },
  { id:'book', pattern:/^book$/, roles:['signed_out', ...customer], parent:null, labelKey:'Book a visit', menu:customer },
  // The booking flow's steps (CUX-02). Choosing care and seeing a price work signed out; the rest need an account.
  { id:'book-step', pattern:/^book\/(service|details|about)$/, params:['step'], roles:['signed_out', ...customer], parent:'book' },
  { id:'book-intake', pattern:/^book\/intake\/([1-3])$/, params:['step'], roles:customer, parent:'book' },
  { id:'book-review', pattern:/^book\/review$/, roles:customer, parent:'book' },
  { id:'book-done', pattern:/^book\/done\/(\d+)$/, params:['booking'], roles:customer, parent:'upcoming' },
  { id:'pets', pattern:/^pets$/, roles:customer, parent:null, labelKey:'My pets', menu:customer },
  { id:'pet-new', pattern:/^pets\/new$/, roles:customer, parent:'pets' },
  { id:'pet', pattern:/^pet\/(\d+)$/, params:['pet'], roles:customer, parent:'pets' },
  { id:'care', pattern:/^care$/, roles:customer, parent:null, labelKey:'Care details', menu:customer },
  { id:'diary', pattern:/^diary$/, roles:[...customer, ...staff], parent:null, labelKey:'Pet Diary', menu:[...customer, ...staff] },
  // Customers and staff: one visit.
  { id:'visit', pattern:/^visit\/(\d+)$/, params:['booking'], roles:[...customer, ...staff], parent:'upcoming' },
  // Staff
  { id:'staff-home', pattern:/^staff-home$/, roles:staff, parent:null, labelKey:'Staff home', menu:staff },
  { id:'history', pattern:/^history$/, roles:staff, parent:null, labelKey:'Booking history', menu:staff },
  { id:'clients', pattern:/^clients$/, roles:staff, parent:null, labelKey:'Clients', menu:staff },
  { id:'client', pattern:/^client\/(\d+)$/, params:['client'], roles:staff, parent:'clients' },
  { id:'settings', pattern:/^settings$/, roles:owner, parent:null, labelKey:'Services & availability', menu:owner },
  { id:'settings-group', pattern:/^settings\/(hours|services|policies|team|backups)$/, params:['group'], roles:owner, parent:'settings' },
  { id:'financials', pattern:/^financials$/, roles:owner, parent:null, labelKey:'Financials', menu:owner },
  // Everyone signed in
  { id:'account', pattern:/^account$/, roles:[...customer, ...staff], parent:null, labelKey:'Account' },
];
const byId = new Map(routes.map(route => [route.id, route]));

// Old links that still work. Each maps a legacy hash to its canonical hash.
/** @type {[RegExp, (match:RegExpExecArray) => string][]} */
const legacy = [
  [/^checkout-(\d+)$/, match => 'visit/' + match[1]],
  [/^pet-(\d+)$/, match => 'pet/' + match[1]],
  [/^pet-intake$/, () => 'pets/new'],
];

/** The role a session has: signed out, a customer, or a staff member's role. @param {{ admin?:boolean, role?:string|null }|null|undefined} session @returns {Role} */
export function roleOf(session) {
  if (!session) return 'signed_out';
  if (!session.admin) return 'customer';
  return session.role === 'sitter' ? 'sitter' : 'owner';
}
/** Where a role starts. @param {Role} role */
export const homeFor = role => role === 'signed_out' ? 'sign-in' : role === 'customer' ? 'client-home' : 'staff-home';

/** The hash for a route id and its params. @param {string} id @param {Record<string, string|number>} [params] */
export function hrefFor(id, params = {}) {
  const shapes = { 'book-step':'book/{step}', 'book-intake':'book/intake/{step}', 'book-done':'book/done/{booking}', 'pet-new':'pets/new',
    pet:'pet/{pet}', visit:'visit/{booking}', client:'client/{client}', 'settings-group':'settings/{group}', 'book-review':'book/review' };
  const shape = shapes[/** @type {keyof typeof shapes} */ (id)] ?? id;
  return '#' + shape.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

/** Navigation for a session: the routes its role sees in the menu, in registry order. @param {{ admin?:boolean, role?:string|null }|null|undefined} session */
export function routesFor(session) {
  const role = roleOf(session);
  return routes.filter(route => route.menu?.includes(role)).map(route => ({ id:route.id, labelKey:route.labelKey, href:hrefFor(route.id) }));
}

// Query parameters the portal carries through canonicalization (booking intent and staff sign-in).
const keptQuery = ['service','rate','staff'];

/**
 * Resolves a location for a session. Never touches the browser.
 * @param {{ hash?:string, search?:string }|string} location a Location-like object, or a URL / '#hash' string
 * @param {{ admin?:boolean, role?:string|null }|null|undefined} session
 * @returns {{ id:string, params:Record<string, string|number>, parent:string|null, canonical:string, outcome:Outcome,
 *   legacy:boolean, query:Record<string,string>, requested:string, returnTo?:string }}
 */
export function resolveLocation(location, session) {
  const url = typeof location === 'string' ? new URL(location, 'https://portal.invalid/portal/index.html') : location;
  const raw = (url.hash || '').replace(/^#/, '');
  let hash;
  try { hash = decodeURIComponent(raw); } catch { hash = '\u0000invalid'; } // a malformed escape is simply not found
  const search = new URLSearchParams(url.search || '');
  const query = Object.fromEntries(keptQuery.filter(name => search.has(name)).map(name => [name, /** @type {string} */ (search.get(name))]));
  const queryString = Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
  const role = roleOf(session);
  const requested = hash;
  let wasLegacy = false;
  for (const [pattern, map] of legacy) {
    const match = pattern.exec(hash);
    if (match) { hash = map(match); wasLegacy = true; break; }
  }
  const home = homeFor(role);
  const result = (/** @type {string} */ id, /** @type {Outcome} */ outcome, params = {}, extra = {}) => {
    const route = /** @type {RouteDescriptor} */ (byId.get(id));
    return { id, params, parent:route.parent, canonical:queryString + hrefFor(id, params), outcome, legacy:wasLegacy, query, requested, ...extra };
  };
  // No hash: the role's home (with a booking intent, the booking form).
  if (!hash) return result(query.service && (role === 'customer' || role === 'signed_out') ? 'book' : home, 'ready');
  for (const route of routes) {
    const match = route.pattern.exec(hash);
    if (!match) continue;
    /** @type {Record<string, string|number>} */
    const params = {};
    (route.params || []).forEach((name, index) => {
      const value = match[index + 1];
      params[name] = /^\d+$/.test(value) && name !== 'step' ? Number(value) : value;
    });
    if (Object.values(params).some(value => typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1))) break;
    if (route.roles.includes(role)) return result(route.id, 'ready', params);
    // Signing in, registering or recovering while already signed in simply goes home.
    if (route.roles.length === 1 && route.roles[0] === 'signed_out') return result(home, 'ready');
    // A signed-out visitor is sent to sign in and brought back afterwards; a signed-in role without access is refused.
    if (role === 'signed_out') return result('sign-in', 'sign_in_required', {}, { returnTo:queryString + hrefFor(route.id, params) });
    return result(home, 'forbidden', {}, { returnTo:undefined });
  }
  return result(home, 'not_found');
}
