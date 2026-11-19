// @ts-check
// Booking intent (CUX-02): one resumable booking task, from choosing care through the requirements to review and
// sending. Pure: no DOM, no requests, no translated text. The portal (Codex) dispatches events as things happen and
// renders the state; the server still decides prices, requirements and availability.
//
// Rules this models (owner decisions of Nov 19, 2026, enforced on the server): a paid booking needs a complete care
// intake and the client's one Meet & Greet (booked 24 hours ahead); a paid request owes a 50% deposit within 48 hours.
// Whether a first request may be sent before the Meet & Greet is undecided, so the meeting stays a requirement.
import { hrefFor } from './portal-route-state.js';

/**
 * @typedef {{ service:number|null, pets:number[], primaryPet:number|null, date:string|null, slot:number|null, start:number|null,
 *   arrive:number|null, depart:number|null, notes:string }} Selection
 * @typedef {{ id:'account'|'intake'|'meet'|'vaccines'|'agreement', status:'todo'|'scheduled'|'done', href:string, returnTo:string, detail?:object }} Prerequisite
 * @typedef {{ intentId:string, userId:number|null, revision:number, selection:Selection, quote:object|null, quoteRevision:number|null,
 *   prerequisites:Prerequisite[], blockers:object[], hold:{ expires:number }|null, sent:{ id:number, href:string }|null,
 *   updated:number }} Intent
 */

const emptySelection = () => ({ service:null, pets:[], primaryPet:null, date:null, slot:null, start:null, arrive:null, depart:null, notes:'' });
const reviewHref = () => hrefFor('book-review');
// Fields that change the price or the time: changing any of them invalidates the quote and any hold.
const pricedFields = ['service','pets','primaryPet','slot','start','arrive','depart'];

/** A new booking task. `service` may come from a homepage link. @returns {Intent} */
export function createIntent({ userId = null, service = null, now = Date.now(), id = null } = {}) {
  return { intentId:id ?? now.toString(36) + Math.random().toString(36).slice(2, 8), userId, revision:0,
    selection:{ ...emptySelection(), service }, quote:null, quoteRevision:null, prerequisites:[], blockers:[], hold:null, sent:null, updated:now };
}

// Requirements from the server's blockers and status, in the order the client should do them.
const order = ['account','intake','meet','vaccines','agreement'];
function prerequisitesFrom({ signedIn, blockers = [], meetStatus = null }) {
  /** @type {Prerequisite[]} */
  const list = [];
  const back = reviewHref();
  if (!signedIn) list.push({ id:'account', status:'todo', href:hrefFor('book-step', { step:'about' }), returnTo:back });
  for (const blocker of blockers) {
    if (blocker.code === 'intake_required') list.push({ id:'intake', status:'todo', href:hrefFor('book-intake', { step:'1' }), returnTo:back, detail:{ reason:blocker.reason, missing:blocker.missing ?? [] } });
    if (blocker.code === 'meet_required') list.push({ id:'meet', status:(meetStatus ?? blocker.status) === 'scheduled' ? 'scheduled' : 'todo', href:'?service=meet' + hrefFor('book'), returnTo:back });
    if (String(blocker.code).startsWith('vaccine_')) list.push({ id:'vaccines', status:'todo', href:blocker.pet_id ? hrefFor('pet', { pet:blocker.pet_id }) : hrefFor('pets'), returnTo:back, detail:{ code:blocker.code, pet:blocker.pet_id, vaccine:blocker.vaccine } });
    if (blocker.code === 'agreement_required') list.push({ id:'agreement', status:'todo', href:hrefFor('care'), returnTo:back });
  }
  // One entry per requirement (several vaccines collapse into the first), in a fixed order.
  const seen = new Set();
  return list.filter(item => !seen.has(item.id) && seen.add(item.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/**
 * Applies one event and returns the new intent (the old one is not changed).
 * Events:
 * - { type:'select', changes:Partial<Selection> }: the client changed the service, pets, primary pet, day, time or notes.
 * - { type:'quoted', revision, quote, signedIn, meetStatus? }: a quote answered for `revision` (older answers are ignored).
 * - { type:'requirement_done', id }: the client finished a requirement elsewhere (the next quote confirms it).
 * - { type:'held', expires } / { type:'hold_expired' }: the review hold started or ran out.
 * - { type:'signed_in', userId }: a signed-out intent now belongs to this account.
 * - { type:'sent', booking:{ id } }: the request was accepted.
 * - { type:'discard' }: start again.
 * @param {Intent} intent @param {any} event @param {number} [now] @returns {Intent}
 */
export function reduce(intent, event, now = Date.now()) {
  const next = { ...intent, updated:now };
  switch (event.type) {
    case 'select': {
      const changes = Object.fromEntries(Object.entries(event.changes || {}).filter(([key]) => key in emptySelection()));
      const priced = Object.keys(changes).some(key => pricedFields.includes(key) && JSON.stringify(changes[key]) !== JSON.stringify(intent.selection[key]));
      next.selection = { ...intent.selection, ...changes };
      if ('pets' in changes && next.selection.primaryPet !== null && !next.selection.pets.includes(next.selection.primaryPet)) next.selection.primaryPet = null;
      // A new service or day clears a time chosen for the old one.
      if ('service' in changes && changes.service !== intent.selection.service) Object.assign(next.selection, { date:null, slot:null, start:null, arrive:null, depart:null });
      if ('date' in changes && changes.date !== intent.selection.date && !('start' in changes)) Object.assign(next.selection, { slot:null, start:null });
      if (priced) Object.assign(next, { revision:intent.revision + 1, quote:null, quoteRevision:null, hold:null });
      return next;
    }
    case 'quoted':
      if (event.revision !== intent.revision) return intent; // a late answer for an earlier choice
      next.quote = event.quote;
      next.quoteRevision = event.revision;
      next.blockers = event.quote?.blockers ?? [];
      next.prerequisites = prerequisitesFrom({ signedIn:Boolean(event.signedIn), blockers:next.blockers, meetStatus:event.meetStatus });
      return next;
    case 'requirement_done':
      next.prerequisites = intent.prerequisites.map(item => item.id === event.id ? { ...item, status:'done' } : item);
      next.quote = null; next.quoteRevision = null; // re-quote to confirm with the server
      return next;
    case 'held':
      return { ...next, hold:{ expires:event.expires } };
    case 'hold_expired':
      return { ...next, hold:null };
    case 'signed_in':
      if (intent.userId !== null && intent.userId !== event.userId) return createIntent({ userId:event.userId, now }); // never carry another account's task
      return { ...next, userId:event.userId, revision:intent.revision + 1, quote:null, quoteRevision:null, hold:null };
    case 'sent':
      return { ...next, sent:{ id:event.booking.id, href:hrefFor('book-done', { booking:event.booking.id }) }, hold:null };
    case 'discard':
      return createIntent({ userId:intent.userId, now });
    default:
      return intent;
  }
}

/**
 * The flow's steps for a progress indicator, and where the client should be now.
 * @param {Intent} intent @param {number} [now]
 */
export function flowState(intent, now = Date.now()) {
  const s = intent.selection;
  const chosenTime = s.start !== null || (s.arrive !== null && s.depart !== null);
  const quoteFresh = intent.quote !== null && intent.quoteRevision === intent.revision;
  const open = intent.prerequisites.filter(item => item.status !== 'done');
  const holdLive = intent.hold !== null && intent.hold.expires > now;
  const steps = [
    { id:'service', href:hrefFor('book-step', { step:'service' }), done:s.service !== null && s.pets.length > 0 },
    { id:'details', href:hrefFor('book-step', { step:'details' }), done:chosenTime && quoteFresh },
    { id:'requirements', href:open[0]?.href ?? reviewHref(), done:quoteFresh && open.length === 0 },
    { id:'review', href:reviewHref(), done:intent.sent !== null },
    { id:'done', href:intent.sent?.href ?? reviewHref(), done:intent.sent !== null },
  ];
  const current = intent.sent ? 'done' : steps.find(step => !step.done)?.id ?? 'review';
  /** @type {{ code:string, href:string }} */
  let nextAction;
  if (intent.sent) nextAction = { code:'view_confirmation', href:intent.sent.href };
  else if (s.service === null || !s.pets.length) nextAction = { code:'choose_care', href:steps[0].href };
  else if (!chosenTime) nextAction = { code:'choose_time', href:steps[1].href };
  else if (!quoteFresh) nextAction = { code:'refresh_quote', href:steps[1].href };
  else if (open.length) nextAction = { code:'resolve_' + open[0].id, href:open[0].href };
  else nextAction = { code:holdLive ? 'send_request' : 'review', href:reviewHref() };
  return { intentId:intent.intentId, revision:intent.revision, selection:s, steps:steps.map(step => ({ ...step, current:step.id === current })),
    currentStep:current, prerequisites:intent.prerequisites, blockers:intent.blockers, quote:quoteFresh ? intent.quote : null,
    hold:holdLive ? intent.hold : null, resumeLocation:nextAction.href, nextAction };
}

/** The Idempotency-Key for sending this intent: the same choice sent twice is one request. @param {Intent} intent */
export const requestKey = intent => 'intent-' + intent.intentId + '-' + intent.revision;

// Saving and restoring (CUX-03 policy): only the choice itself is kept, never prices, holds or requirements (they are
// re-checked), and never across accounts. Notes are routine text and may be kept.
const storedKeys = ['service','pets','primaryPet','date','slot','start','arrive','depart','notes'];
/** @param {Intent} intent */
export function serialize(intent) {
  if (intent.sent) return null; // a sent request is finished
  return JSON.stringify({ v:1, intentId:intent.intentId, userId:intent.userId, updated:intent.updated,
    selection:Object.fromEntries(storedKeys.map(key => [key, intent.selection[key]])) });
}
/**
 * Restores a saved intent for `userId`, or returns null if it belongs to another account, is older than a day, or is
 * unreadable. A signed-out intent may be adopted by whoever signs in next.
 * @param {string|null} text @param {number|null} userId @param {number} [now] @returns {Intent|null}
 */
export function restore(text, userId, now = Date.now()) {
  if (!text) return null;
  let saved;
  try { saved = JSON.parse(text); } catch { return null; }
  if (saved?.v !== 1 || typeof saved.selection !== 'object' || now - Number(saved.updated) > 86_400_000) return null;
  if (saved.userId !== null && saved.userId !== userId) return null;
  const selection = { ...emptySelection() };
  for (const key of storedKeys) if (key in saved.selection) selection[key] = saved.selection[key];
  if (!Array.isArray(selection.pets)) selection.pets = [];
  return { ...createIntent({ userId, now, id:String(saved.intentId) }), selection, revision:1 };
}
