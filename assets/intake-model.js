// @ts-check
// Care intake model (CUX-03): one inventory of every intake field, where each answer lives, which answers the pet
// profile already holds, what is required when, how sensitive each answer is (and so whether a draft may be kept in the
// browser), and one validator returning every field error at once. Pure: no DOM, no storage, no translated text.
// The server (lib/routes/intake.mjs) and the portal (Codex) both use it, so the rules can't drift apart.
import { myoConfig } from './myo-config.js';

/**
 * sensitivity: 'routine' (feeding, routines: fine to keep as a tab draft), 'health' and 'emergency' (kept in memory for a
 * re-render, never written to browser storage), 'secret' (never kept at all). draft follows from it.
 * @typedef {{ key:string, type:'text'|'textarea'|'select'|'number'|'boolean', owner:'household', required:'always'|'overnight',
 *   sensitivity:'routine'|'health'|'emergency'|'secret', draft:'session'|'memory'|'never', profileKeys:string[], maxLength?:number }} IntakeField
 */
const routine = { sensitivity:'routine', draft:'session' };
const health = { sensitivity:'health', draft:'memory' };
const emergency = { sensitivity:'emergency', draft:'memory' };

/** @type {IntakeField[]} */
export const intakeFields = [
  // `profileKeys` are the pet-profile answers (assets/portal.js profileGroups) that already cover this field. The
  // portal prefills an empty intake field from them, newest saved answer first; it never overwrites a saved intake answer.
  { key:'pets', type:'textarea', owner:'household', required:'always', ...routine, profileKeys:['age','breed','sex','weight'] },
  { key:'feeding', type:'textarea', owner:'household', required:'always', ...routine, profileKeys:['food','portion','feeding','restrictions'] },
  { key:'health', type:'textarea', owner:'household', required:'always', ...health, profileKeys:['health','allergies','heartworm'] },
  { key:'medication', type:'textarea', owner:'household', required:'always', ...health, profileKeys:['medication'] },
  { key:'behavior', type:'textarea', owner:'household', required:'always', ...routine, profileKeys:['behavior','notes'] },
  { key:'vaccines', type:'textarea', owner:'household', required:'always', ...health, profileKeys:['vaccinations'] },
  { key:'vet', type:'text', owner:'household', required:'always', ...emergency, profileKeys:['vet','vetPhone'] },
  { key:'emergency', type:'text', owner:'household', required:'always', ...emergency, profileKeys:['contact','contactPhone'] },
  { key:'decisionMakers', type:'text', owner:'household', required:'always', ...emergency, profileKeys:[] },
  { key:'vetAuthorization', type:'select', owner:'household', required:'always', ...emergency, profileKeys:[] },
  { key:'spendingLimit', type:'number', owner:'household', required:'always', ...emergency, profileKeys:[] },
  { key:'overnightAlone', type:'textarea', owner:'household', required:'overnight', ...routine, profileKeys:[] },
  { key:'overnightBehavior', type:'textarea', owner:'household', required:'overnight', ...routine, profileKeys:[] },
  { key:'overnightAcknowledgment', type:'boolean', owner:'household', required:'overnight', ...routine, profileKeys:[] },
].map(field => ({ ...field, maxLength:['text','textarea'].includes(field.type) ? myoConfig.intakeMaxLength : undefined }));
// The service the client is planning, which decides whether the overnight questions apply.
export const intakeServices = ['walk','dropIn','overnight'];
const fieldsByKey = new Map(intakeFields.map(field => [field.key, field]));

// Groups for a progressive form (CUX-03 / DUX-05). Stable ids; the portal translates their titles.
export const intakeGroups = [
  { id:'routines', fields:['pets','feeding','behavior','overnightAlone','overnightBehavior','overnightAcknowledgment'] },
  { id:'health', fields:['health','medication','vaccines'] },
  { id:'emergency', fields:['vet','emergency','decisionMakers','vetAuthorization','spendingLimit'] },
];

// Other answers the portal holds that must never be kept as drafts, whatever form they appear in: passwords, home-entry
// instructions and codes, recovery tokens and payment details. Matched against field names.
const secretNames = /^(password|current|instructions|entry|code|lockbox|alarm|key_?code|token|card|cvc|cvv|iban|account_?number)$/i;

/** How a field may be kept as a draft. Unknown fields in a care form are kept in memory only. @param {string} name @returns {'session'|'memory'|'never'} */
export function draftPolicy(name) {
  if (secretNames.test(name)) return 'never';
  if (name === 'service') return 'session';
  return fieldsByKey.get(name)?.draft ?? 'memory';
}

/** The fields required for a planned service. @param {string} service */
export const requiredFields = service => intakeFields.filter(field => field.required === 'always' || (field.required === 'overnight' && service === 'overnight')).map(field => field.key);

/**
 * Validates an intake. With `partial`, only the answers given are checked and missing ones are allowed (a draft saved
 * on the server); otherwise every required answer must be present. Returns every problem, not just the first.
 * @param {Record<string, unknown>} data
 * @param {{ partial?:boolean }} [options]
 * @returns {{ value:Record<string, unknown>, fieldErrors:{ field:string, code:string, params?:Record<string, number|string> }[], missing:string[] }}
 */
export function validateIntake(data, { partial = false } = {}) {
  /** @type {{ field:string, code:string, params?:Record<string, number|string> }[]} */
  const fieldErrors = [];
  /** @type {Record<string, unknown>} */
  const value = {};
  const service = data.service;
  if (service === undefined && partial) {
    // A partial save may come before the service is chosen.
  } else if (!intakeServices.includes(/** @type {string} */ (service))) fieldErrors.push({ field:'service', code:'choose_one' });
  else value.service = service;
  const required = new Set(requiredFields(/** @type {string} */ (service)));
  const missing = [];
  for (const field of intakeFields) {
    const raw = data[field.key];
    // An unticked acknowledgment (false) is simply not given; it matters only when the field is required.
    const absent = raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim()) || (field.type === 'boolean' && raw === false);
    if (absent) {
      if (required.has(field.key)) missing.push(field.key);
      continue;
    }
    if (field.type === 'number') {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1_000_000) fieldErrors.push({ field:field.key, code:'number_range', params:{ min:0, max:1_000_000 } });
      else value[field.key] = raw; // zero is a valid limit: no spending authorized
    } else if (field.type === 'boolean') {
      if (raw !== true) fieldErrors.push({ field:field.key, code:'acknowledge' });
      else value[field.key] = true;
    } else if (field.type === 'select') {
      if (!['yes','no'].includes(/** @type {string} */ (raw))) fieldErrors.push({ field:field.key, code:'choose_one' });
      else value[field.key] = raw;
    } else if (typeof raw !== 'string') fieldErrors.push({ field:field.key, code:'invalid' });
    else if (field.maxLength && raw.length > field.maxLength) fieldErrors.push({ field:field.key, code:'too_long', params:{ max:field.maxLength } });
    else value[field.key] = raw.trim();
  }
  if (!partial) for (const key of missing) fieldErrors.push({ field:key, code:key === 'overnightAcknowledgment' ? 'acknowledge' : 'required' });
  return { value, fieldErrors, missing };
}

/**
 * Where a saved intake stands for a planned service. `outdated` means a pet was added or its profile changed after the
 * intake was saved, so Myomi should see it reviewed; it does not block a request on its own.
 * @param {(Record<string, unknown> & { updated?:number, complete?:boolean })|null} saved
 * @param {{ service?:string, petsChangedAt?:number|null }} [context]
 * @returns {{ state:'absent'|'incomplete'|'outdated'|'complete', missing:string[], blocking:boolean }}
 */
export function intakeStatus(saved, { service, petsChangedAt = null } = {}) {
  if (!saved) return { state:'absent', missing:requiredFields(service ?? 'walk'), blocking:true };
  const { missing } = validateIntake({ ...saved, service:service ?? saved.service }, { partial:true });
  if (saved.complete === false || missing.length) return { state:'incomplete', missing, blocking:true };
  if (petsChangedAt && saved.updated && petsChangedAt > saved.updated) return { state:'outdated', missing:[], blocking:false };
  return { state:'complete', missing:[], blocking:false };
}
