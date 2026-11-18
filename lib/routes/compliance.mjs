// Vaccine records and documents, vaccine requirements, and the service agreement (C2.2).
import { get, run, transaction, photos } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { documentFrom } from '../photos.mjs';
import { blockers, latestAgreement } from '../compliance.mjs';

const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const ownVaccine = (user, id) => get('SELECT v.* FROM pet_vaccines v JOIN pets p ON p.id=v.pet WHERE v.id=? AND p.owner=?', integer(id), user.id);

export default [
  // What would stop a booking, for showing it before the customer reviews (holds and requests check again).
  { method:'GET', path:'/api/blockers', access:'user', handler:({ user, url }) => {
    requireThat(!user.admin, 'Use a customer account to check a booking.', 403);
    const q = name => url.searchParams.get(name);
    const service = get('SELECT * FROM services WHERE id=?', integer(Number(q('service'))));
    requireThat(service, 'Service not found.', 404);
    const petIds = (q('pets') || '').split(',').filter(Boolean).map(value => integer(Number(value)));
    for (const id of petIds) requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?', id, user.id), 'Pet not found.', 404);
    const starts = integer(Number(q('starts'))), ends = integer(Number(q('ends')));
    requireThat(ends > starts, 'Choose a valid time.');
    return { blockers:blockers(user, { service, petIds, starts, ends }) };
  } },

  // Adds or updates a vaccine record for the customer's pet. Changing it clears staff verification.
  { method:'POST', path:'/api/vaccines', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to add vaccine records.', 403);
    const pet = integer(data.pet);
    requireThat(get('SELECT id FROM pets WHERE id=? AND owner=?', pet, user.id), 'Pet not found.', 404);
    const name = field(data.name, 60);
    requireThat(isDay(data.expires), 'Enter the expiry date.', 400, 'invalid_date');
    requireThat(data.given == null || data.given === '' || (isDay(data.given) && data.given <= data.expires), 'Enter a given date on or before the expiry date.', 400, 'invalid_date');
    const given = data.given || null;
    run(`INSERT INTO pet_vaccines(pet,name,given,expires) VALUES(?,?,?,?)
      ON CONFLICT(pet,name) DO UPDATE SET given=excluded.given, expires=excluded.expires, verified_at=NULL, verified_by=NULL`, pet, name, given, data.expires);
    return { id:get('SELECT id FROM pet_vaccines WHERE pet=? AND name=?', pet, name).id };
  } },

  // Attaches a PDF or photo of the record. The file is stored first, then linked; a replaced file is deleted.
  { method:'POST', path:'/api/vaccines/document', access:'user', maxBody:8_000_000, handler:async ({ user, data }) => {
    requireThat(ownVaccine(user, data.id), 'Vaccine record not found.', 404);
    const [mime, bytes] = documentFrom(data.document);
    const key = 'vaccines/' + crypto.randomUUID();
    await photos.put(key, bytes, mime);
    let previous;
    try {
      transaction(() => {
        const record = ownVaccine(user, data.id);
        requireThat(record, 'Vaccine record not found.', 404);
        previous = record.document_key;
        run('UPDATE pet_vaccines SET document_key=?, document_mime=?, verified_at=NULL, verified_by=NULL WHERE id=?', key, mime, record.id);
      });
    } catch (error) { await photos.delete(key); throw error; }
    if (previous) await photos.delete(previous);
    return {};
  } },

  // The document, for its owner or staff only. Served as a download so a PDF never runs in the site's origin.
  { method:'GET', path:/^\/api\/vaccines\/(\d+)\/document$/, access:'user', handler:async ({ user, match }) => {
    const record = get('SELECT v.document_key, v.document_mime, v.name, p.owner FROM pet_vaccines v JOIN pets p ON p.id=v.pet WHERE v.id=?', Number(match[1]));
    requireThat(record?.document_key && (user.admin || record.owner === user.id), 'Document not found.', 404);
    const bytes = await photos.get(record.document_key);
    requireThat(bytes, 'Document not found.', 404);
    const extension = record.document_mime === 'application/pdf' ? 'pdf' : record.document_mime.split('/')[1];
    return new Response(bytes, { headers:{ 'Content-Type':record.document_mime, 'Cache-Control':'private, no-store',
      'Content-Disposition':'attachment; filename="vaccine-record.' + extension + '"' } });
  } },

  { method:'POST', path:'/api/vaccines/verify', access:'staff', handler:({ user, data }) => {
    requireThat(run('UPDATE pet_vaccines SET verified_at=?, verified_by=? WHERE id=?', Date.now(), user.id, integer(data.id)).changes, 'Vaccine record not found.', 404);
    return {};
  } },

  // Which vaccines a species needs. An empty list turns the vaccine gate off for that species.
  { method:'POST', path:'/api/vaccine-requirements', access:'owner', handler:({ data }) => transaction(() => {
    const species = field(data.species, 40).toLowerCase();
    requireThat(Array.isArray(data.names) && data.names.length <= 12, 'List the required vaccines.');
    const names = [...new Set(data.names.map(name => field(name, 60)))];
    run('DELETE FROM vaccine_requirements WHERE species=?', species);
    for (const name of names) run('INSERT INTO vaccine_requirements(species,name) VALUES(?,?)', species, name);
    return {};
  }) },

  { method:'GET', path:'/api/agreement', access:'user', handler:({ user }) => {
    const agreement = latestAgreement();
    if (!agreement) return null;
    const accepted = get('SELECT accepted_at FROM agreement_acceptances WHERE user=? AND version=?', user.id, agreement.version);
    return { version:agreement.version, title:agreement.title, body_en:agreement.body_en, body_es:agreement.body_es,
      published:agreement.published, accepted:Boolean(accepted), accepted_at:accepted?.accepted_at ?? null };
  } },

  { method:'POST', path:'/api/agreement/accept', access:'user', handler:({ user, data }) => {
    requireThat(!user.admin, 'Use a customer account to accept the agreement.', 403);
    const agreement = latestAgreement();
    requireThat(agreement && agreement.version === data.version, 'A newer agreement has been published. Please read it first.', 409, 'agreement_changed');
    run('INSERT INTO agreement_acceptances(user,version,accepted_at) VALUES(?,?,?) ON CONFLICT DO NOTHING', user.id, agreement.version, Date.now());
    return {};
  } },

  // Publishes a new version. Everyone must accept it before their next booking.
  { method:'POST', path:'/api/agreements', access:'owner', handler:({ data }) => transaction(() => {
    const version = (get('SELECT MAX(version) AS last FROM agreements')?.last || 0) + 1;
    run('INSERT INTO agreements(version,title,body_en,body_es,published) VALUES(?,?,?,?,?)',
      version, field(data.title, 120), field(data.body_en, 20000), field(data.body_es, 20000), Date.now());
    return { version };
  }) },
];
