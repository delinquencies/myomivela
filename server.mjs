import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const database = resolve(process.env.MYO_DB || '.myo/data.sqlite');
await mkdir(dirname(database), { recursive: true });
const db = new DatabaseSync(database);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS pets(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, species TEXT NOT NULL, details TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY, name TEXT NOT NULL, minutes INTEGER NOT NULL, cents INTEGER NOT NULL, UNIQUE(name, minutes));
  CREATE TABLE IF NOT EXISTS slots(id INTEGER PRIMARY KEY, starts INTEGER NOT NULL, ends INTEGER NOT NULL, CHECK(ends > starts));
  CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY, owner INTEGER NOT NULL REFERENCES users(id), service INTEGER NOT NULL REFERENCES services(id), starts INTEGER NOT NULL, ends INTEGER NOT NULL, cents INTEGER NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Requested', arrived INTEGER, departed INTEGER);
  CREATE TABLE IF NOT EXISTS booking_pets(booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), PRIMARY KEY(booking,pet));
  CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, booking INTEGER NOT NULL REFERENCES bookings(id), pet INTEGER NOT NULL REFERENCES pets(id), kind TEXT NOT NULL, notes TEXT NOT NULL, published INTEGER NOT NULL, mime TEXT, photo BLOB);
  CREATE INDEX IF NOT EXISTS booking_time ON bookings(starts, ends, status);
  CREATE INDEX IF NOT EXISTS diary_pet ON events(pet,published);
`);
if (!db.prepare('PRAGMA table_info(bookings)').all().some(column => column.name === 'summary')) {
  db.exec("ALTER TABLE bookings ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
}

const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const hash = value => createHash('sha256').update(value).digest('hex');
function requireThat(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}
function field(value, limit, required = true) {
  requireThat(typeof value === 'string' && value.length <= limit && (!required || value.trim()), 'Enter a valid value.');
  return value.trim();
}
function integer(value, max = Number.MAX_SAFE_INTEGER, min = 1) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'Enter a valid number.');
  return value;
}
function email(value) {
  const address = field(value, 254).toLowerCase();
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address), 'Enter a valid email.');
  return address;
}
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
const adminEmail = process.env.MYO_ADMIN_EMAIL;
const adminPassword = process.env.MYO_ADMIN_PASSWORD;
if (adminEmail && adminPassword) {
  const address = email(adminEmail);
  requireThat(adminPassword.length >= 12 && adminPassword.length <= 128, 'Use an admin password of 12–128 characters.');
  const existing = get('SELECT admin FROM users WHERE email=?', address);
  requireThat(!existing || existing.admin, 'The configured admin email is already registered as a customer.');
  if (!existing) run('INSERT INTO users(email,name,password,admin) VALUES(?,?,?,1)', address, 'Myomi', passwordHash(adminPassword));
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
async function body(request) {
  requireThat(request.headers['content-type']?.split(';')[0] === 'application/json', 'Send JSON.', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    requireThat(size <= 4_000_000, 'Request is too large.', 413);
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks)); } catch { requireThat(false, 'Invalid JSON.'); }
  requireThat(data && typeof data === 'object' && !Array.isArray(data), 'Invalid request.');
  return data;
}
const cookieName = 'myo_session';
const cookieSecure = process.env.MYO_SECURE_COOKIES === '1' ? '; Secure' : '';
function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|; )myo_session=([a-f0-9]{64})(?:;|$)/)?.[1] || '';
}
function setSession(response, token, age) {
  response.setHeader('Set-Cookie', cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + age + cookieSecure);
}
const publicUser = user => ({ id:user.id, name:user.name, email:user.email, admin:Boolean(user.admin) });
function signIn(response, user) {
  const token = randomBytes(32).toString('hex');
  const seconds = 60 * 60 * 24 * 7;
  run('DELETE FROM sessions WHERE expires<?', Date.now());
  run('INSERT INTO sessions VALUES(?,?,?)', hash(token), user.id, Date.now() + seconds * 1000);
  setSession(response, token, seconds);
  return publicUser(user);
}

const activityTypes = ['Feeding','Water','Walk started','Walk completed','Potty','Medication','Playtime','Rest','Observation','Custom'];
const transitions = {
  Requested: ['Confirmed','Cancelled'],
  Confirmed: ['In Progress','Cancelled'],
  'In Progress': ['Completed'],
};
function reserveTime(slotId, service, exclude = 0) {
  const slot = get('SELECT * FROM slots WHERE id=?', integer(slotId));
  requireThat(slot && slot.starts > Date.now(), 'This time is no longer available.', 409);
  const end = slot.starts + service.minutes * 60_000;
  requireThat(end <= slot.ends, 'This service does not fit the appointment window.', 409);
  requireThat(!conflict(slot.starts,end,exclude), 'This time has already been reserved.', 409);
  return [slot.starts,end];
}
function conflict(start, end, exclude) {
  return get("SELECT id FROM bookings WHERE id<>? AND status IN ('Confirmed','In Progress') AND starts<? AND ends>?", exclude,end,start);
}
function bookingFor(user, id) {
  const booking = get('SELECT * FROM bookings WHERE id=?', integer(id));
  requireThat(booking && (user.admin || booking.owner === user.id), 'Booking not found.', 404);
  return booking;
}
function photoFrom(data) {
  if (!data) return [null,null];
  requireThat(typeof data === 'string', 'Use a JPEG, PNG, or WebP photo.');
  const match = data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  requireThat(match, 'Use a JPEG, PNG, or WebP photo.');
  const bytes = Buffer.from(match[2], 'base64');
  const mime = match[1];
  const valid = mime === 'image/jpeg' ? bytes.subarray(0,3).toString('hex') === 'ffd8ff'
    : mime === 'image/png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a'
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  requireThat(valid && bytes.length <= 2_500_000, 'Use a valid photo smaller than 2.5 MB.');
  return [mime,bytes];
}

const attempts = new Map();
function limitLogin(request) {
  const key = request.socket.remoteAddress;
  const now = Date.now();
  for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
  const entry = attempts.get(key) || { count:0, until:now + 60_000 };
  requireThat(entry.count < 12, 'Too many attempts. Try again in a minute.', 429);
  entry.count++;
  attempts.set(key, entry);
}
async function api(request, response, path) {
  const token = sessionToken(request);
  const user = token && get('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user WHERE token=? AND expires>?',hash(token),Date.now());
  if (request.method === 'GET' && path === '/api/catalog') return all('SELECT * FROM services ORDER BY name,minutes');
  if (request.method === 'POST') {
    requireThat(request.headers['sec-fetch-site'] !== 'cross-site', 'Request origin is not allowed.', 403);
    const origin = request.headers.origin;
    if (origin) requireThat(origin === (process.env.MYO_ORIGIN || 'http://' + request.headers.host), 'Request origin is not allowed.', 403);
  }
  if (request.method === 'POST' && ['/api/register','/api/login'].includes(path)) {
    limitLogin(request);
    const data = await body(request);
    const address = email(data.email);
    requireThat(typeof data.password === 'string' && data.password.length > 0 && data.password.length <= 128, 'Enter a valid password.');
    const password = data.password;
    const existing = get('SELECT * FROM users WHERE email=?',address);
    if (path === '/api/register') {
      requireThat(password.length >= 12, 'Use at least 12 characters for your password.');
      requireThat(!existing && address !== adminEmail?.toLowerCase(), 'This email cannot be registered.', 409);
      run('INSERT INTO users(email,name,password) VALUES(?,?,?)',address,field(data.name,100),passwordHash(password));
      return signIn(response,get('SELECT * FROM users WHERE email=?',address));
    }
    const candidate = passwordHash(password,existing?.password.split(':')[0] || 'no-account');
    requireThat(existing && timingSafeEqual(Buffer.from(candidate),Buffer.from(existing.password)), 'Email or password is incorrect.', 401);
    return signIn(response,existing);
  }
  if (request.method === 'GET' && path === '/api/session') return user ? publicUser(user) : null;
  requireThat(user, 'Sign in to continue.', 401);
  if (request.method === 'GET') {
    const media = path.match(/^\/api\/photos\/(\d+)$/);
    if (media) {
      const event = get('SELECT events.*, bookings.owner FROM events JOIN bookings ON bookings.id=events.booking WHERE events.id=?', Number(media[1]));
      requireThat(event?.photo && (user.admin || event.owner === user.id), 'Photo not found.', 404);
      response.writeHead(200, { 'Content-Type':event.mime, 'Content-Length':event.photo.length });
      response.end(event.photo);
      return;
    }
    if (path === '/api/portal') {
      const owner = user.admin ? '' : ' WHERE owner=?';
      const params = user.admin ? [] : [user.id];
      const bookings = all(`
        SELECT b.*, s.name AS service_name, u.name AS customer, u.email,
          (SELECT json_group_array(p.id) FROM booking_pets bp JOIN pets p ON p.id=bp.pet WHERE bp.booking=b.id) AS pet_ids
        FROM (SELECT * FROM bookings${owner}) b JOIN services s ON s.id=b.service JOIN users u ON u.id=b.owner
        ORDER BY b.starts
      `,...params).map(row => ({...row,pet_ids:JSON.parse(row.pet_ids)}));
      const events = all(`
        SELECT e.id,e.booking,e.pet,e.kind,e.notes,e.published,e.photo IS NOT NULL AS has_photo
        FROM events e JOIN bookings b ON b.id=e.booking ${user.admin ? '' : 'WHERE b.owner=?'} ORDER BY e.published DESC,e.id DESC
      `,...params);
      const services = all('SELECT * FROM services ORDER BY name,minutes');
      const slots = all('SELECT * FROM slots WHERE starts>? ORDER BY starts',Date.now()).map(slot => ({
        ...slot,
        service_ids: services.filter(service => {
          const end = slot.starts + service.minutes * 60_000;
          return end <= slot.ends && !conflict(slot.starts,end,0);
        }).map(service => service.id),
      }));
      return { user:publicUser(user), pets:all('SELECT * FROM pets'+owner+' ORDER BY name',...params), services, slots, bookings, events, activityTypes };
    }
  }
  requireThat(request.method === 'POST', 'Route not found.', 404);
  const data = await body(request);
  if (path === '/api/logout') {
    run('DELETE FROM sessions WHERE token=?',hash(token));
    setSession(response,'',0);
    return {};
  }
  if (path === '/api/pets') {
    requireThat(!user.admin, 'Use a customer account to create a pet.', 403);
    const values = [field(data.name,80),field(data.species,60),field(data.details,3000,false)];
    if (data.id !== undefined) {
      requireThat(run('UPDATE pets SET name=?,species=?,details=? WHERE id=? AND owner=?',...values,integer(data.id),user.id).changes, 'Pet not found.',404);
    } else run('INSERT INTO pets(owner,name,species,details) VALUES(?,?,?,?)',user.id,...values);
    return {};
  }
  if (path === '/api/bookings') {
    requireThat(!user.admin, 'Use a customer account to request care.',403);
    return transaction(() => {
      const service = get('SELECT * FROM services WHERE id=?',integer(data.service));
      requireThat(service,'Service not found.',404);
      requireThat(service.cents === data.cents,'The price changed. Refresh and review the updated total.',409);
      requireThat(Array.isArray(data.pets) && data.pets.length && data.pets.length <= 12,'Choose at least one pet.');
      const petIds = [...new Set(data.pets.map(value => integer(value)))];
      for (const id of petIds) requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?',id,user.id),'Pet not found.',404);
      const [starts,ends] = reserveTime(data.slot,service);
      requireThat(!get("SELECT id FROM bookings WHERE owner=? AND status='Requested' AND starts<? AND ends>?",user.id,ends,starts),'You already have a request for this time.',409);
      const result = run('INSERT INTO bookings(owner,service,starts,ends,cents,notes) VALUES(?,?,?,?,?,?)',user.id,service.id,starts,ends,service.cents,field(data.notes,1500,false));
      for (const pet of petIds) run('INSERT INTO booking_pets VALUES(?,?)',result.lastInsertRowid,pet);
      return { id:result.lastInsertRowid, status:'Requested' };
    });
  }
  if (path === '/api/status') {
    return transaction(() => {
      const booking = bookingFor(user,data.id);
      const allowed = user.admin ? transitions[booking.status] || [] : ['Requested','Confirmed'].includes(booking.status) && booking.starts > Date.now() ? ['Cancelled'] : [];
      requireThat(allowed.includes(data.status),'This booking cannot make that change.',409);
      if (data.status === 'Confirmed') {
        requireThat(booking.starts > Date.now() && !conflict(booking.starts,booking.ends,booking.id),'Choose an available future time.',409);
      }
      const arrived = data.status === 'In Progress' ? Date.now() : booking.arrived;
      const departed = data.status === 'Completed' ? Date.now() : booking.departed;
      const summary = data.status === 'Completed' ? field(data.summary,3000) : booking.summary;
      run('UPDATE bookings SET status=?,arrived=?,departed=?,summary=? WHERE id=?',data.status,arrived,departed,summary,booking.id);
      return {};
    });
  }
  if (path === '/api/reschedule') {
    return transaction(() => {
      const booking = bookingFor(user,data.id);
      requireThat(['Requested','Confirmed'].includes(booking.status) && (user.admin || booking.starts > Date.now()),'This booking cannot be moved.',409);
      const [starts,ends] = reserveTime(data.slot,{ minutes:(booking.ends-booking.starts)/60_000 },booking.id);
      run('UPDATE bookings SET starts=?,ends=?,status=? WHERE id=?',starts,ends,user.admin ? booking.status : 'Requested',booking.id);
      return {};
    });
  }
  requireThat(user.admin,'Staff access is required.',403);
  if (path === '/api/services') {
    const name = field(data.name,80);
    requireThat(['Dog walking','Drop-in visit','Overnight pet sitting'].includes(name),'Select one of the three care services.');
    run('INSERT INTO services(name,minutes,cents) VALUES(?,?,?) ON CONFLICT(name,minutes) DO UPDATE SET cents=excluded.cents',name,integer(data.minutes,1440),integer(data.cents,1000000,0));
    return {};
  }
  if (path === '/api/slots') {
    if (data.id !== undefined) {
      run('DELETE FROM slots WHERE id=?',integer(data.id));
    } else {
      const starts = Date.parse(field(data.starts,48));
      const ends = Date.parse(field(data.ends,48));
      requireThat(starts > Date.now() && ends > starts && ends-starts <= 86_400_000,'Choose a future window up to 24 hours.');
      run('INSERT INTO slots(starts,ends) VALUES(?,?)',starts,ends);
    }
    return {};
  }
  if (path === '/api/events') {
    const booking = bookingFor(user,data.id);
    requireThat(booking.status === 'In Progress','Start the visit before logging an activity.',409);
    const pet = integer(data.pet);
    requireThat(get('SELECT pet FROM booking_pets WHERE booking=? AND pet=?',booking.id,pet),'Pet is not part of this visit.',404);
    requireThat(activityTypes.includes(data.kind),'Choose an activity type.');
    const notes = field(data.notes,3000,false);
    const [mime,photo] = photoFrom(data.photo);
    run('INSERT INTO events(booking,pet,kind,notes,published,mime,photo) VALUES(?,?,?,?,?,?,?)',booking.id,pet,data.kind,notes,Date.now(),mime,photo);
    return {};
  }
  requireThat(false,'Route not found.',404);
}

const types = { '.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.xml':'application/xml','.txt':'text/plain' };
const server = createServer(async (request,response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','same-origin');
  response.setHeader('X-Frame-Options','DENY');
  try {
    const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if (path.startsWith('/api/')) {
      response.setHeader('Cache-Control','private, no-store');
      const data = await api(request,response,path);
      if (!response.writableEnded) {
        response.setHeader('Content-Type','application/json; charset=utf-8');
        response.end(JSON.stringify(data));
      }
      return;
    }
    requireThat(['GET','HEAD'].includes(request.method), 'Method not allowed.',405);
    requireThat(path === '/' || /^\/(?:index\.html|robots\.txt|sitemap\.xml|(?:assets|myo|portal)\/[\w./ -]*)$/.test(path), 'Page not found.',404);
    const file = resolve(root,'.'+path+(path.endsWith('/') ? 'index.html' : ''));
    requireThat(['assets','myo','portal'].some(dir => file.startsWith(resolve(root,dir)+sep)) ||
      ['index.html','robots.txt','sitemap.xml'].some(name => file === resolve(root,name)), 'Page not found.',404);
    const mime = types[extname(file)];
    requireThat(mime,'Page not found.',404);
    let content;
    try { content = await readFile(file); } catch { requireThat(false,'Page not found.',404); }
    response.setHeader('Content-Type',mime);
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!error.status) console.error(error);
    if (!response.headersSent) response.writeHead(error.status || 500, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    response.end(JSON.stringify({error:error.status ? error.message : 'The request could not be completed.'}));
  }
});
server.listen(Number(process.env.PORT || 45838),process.env.HOST || '127.0.0.1',() => console.log('myo. listening on port '+server.address().port));
