import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDrafts } from '../assets/drafts.js';

// CUX-03: which care answers a draft keeps, where (tab storage or memory only), and when drafts are cleared.
// A minimal stand-in for the DOM and sessionStorage, so the module runs under Node.
class Storage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
function field(name, { type = 'text', value = '', tag = 'INPUT', noDraft = false } = {}) {
  return { name, type, tagName:tag, value, defaultValue:value, checked:false, defaultChecked:false, files:[],
    matches:selector => selector === '[data-no-draft]' && noDraft };
}
function form(dataset, fields) {
  return { dataset, elements:fields, closest:() => null, querySelector:() => null };
}
const root = forms => ({ querySelectorAll:() => forms });
// Renders a fresh copy of the care intake and home-access forms, as the portal does after every save.
function render() {
  const intake = form({ careAction:'intake' }, [
    field('feeding', { tag:'TEXTAREA' }), field('medication', { tag:'TEXTAREA' }), field('emergency'),
    field('password', { type:'password' }), field('token'),
  ]);
  const access = form({ careAction:'home-access' }, [field('instructions', { tag:'TEXTAREA', noDraft:true }), field('key_label')]);
  const booking = form({ action:'bookings' }, [field('notes', { tag:'TEXTAREA' })]);
  return { intake, access, booking, root:root([intake, access, booking]) };
}
const set = (form, name, value) => { form.elements.find(element => element.name === name).value = value; };
const get = (form, name) => form.elements.find(element => element.name === name).value;
const stored = () => [...globalThis.sessionStorage.map.values()].join('\n');

beforeEach(() => { globalThis.sessionStorage = new Storage(); });

test('routine care answers survive a reload; health and emergency answers survive only a re-render', () => {
  const drafts = createDrafts();
  drafts.use(7);
  const first = render();
  set(first.intake, 'feeding', 'Two cups, 7 AM');
  set(first.intake, 'medication', 'Apoquel 16 mg');
  set(first.intake, 'emergency', 'Sam 413-555-0100');
  drafts.capture(first.root);
  // Re-render in the same page: everything typed comes back.
  const again = render();
  drafts.restore(again.root);
  assert.deepEqual(['feeding','medication','emergency'].map(name => get(again.intake, name)), ['Two cups, 7 AM','Apoquel 16 mg','Sam 413-555-0100']);
  assert.deepEqual(drafts.status(again.intake), { saved:true, memoryOnly:true, updated:drafts.status(again.intake).updated });
  // Browser storage holds the feeding answer only.
  assert.match(stored(), /Two cups/);
  assert.doesNotMatch(stored(), /Apoquel|413-555/);
  // Reload: a new module instance reading the tab's storage.
  const reloaded = createDrafts();
  reloaded.use(7);
  const page = render();
  reloaded.restore(page.root);
  assert.deepEqual(['feeding','medication','emergency'].map(name => get(page.intake, name)), ['Two cups, 7 AM','','']);
});

test('passwords, tokens and entry instructions are never kept, even in memory', () => {
  const drafts = createDrafts();
  drafts.use(7);
  const page = render();
  set(page.intake, 'password', 'hunter2-secret');
  set(page.intake, 'token', 'abc123token');
  set(page.access, 'instructions', 'Code 4321, key under the mat');
  set(page.access, 'key_label', 'Blue fob');
  drafts.capture(page.root);
  const again = render();
  drafts.restore(again.root);
  assert.deepEqual([get(again.intake, 'password'), get(again.intake, 'token'), get(again.access, 'instructions')], ['', '', '']);
  assert.equal(get(again.access, 'key_label'), 'Blue fob', 'other care answers are kept in memory');
  assert.doesNotMatch(stored(), /hunter2|abc123|4321|Blue fob/);
});

test('portal forms keep their routine answers as before', () => {
  const drafts = createDrafts();
  drafts.use(7);
  const page = render();
  set(page.booking, 'notes', 'Side gate');
  drafts.capture(page.root);
  const reloaded = createDrafts();
  reloaded.use(7);
  const again = render();
  reloaded.restore(again.root);
  assert.equal(get(again.booking, 'notes'), 'Side gate');
});

test('discarding clears a draft, and another account never sees it', () => {
  const drafts = createDrafts();
  drafts.use(7);
  const page = render();
  set(page.intake, 'feeding', 'Ann’s dog food');
  set(page.booking, 'notes', 'Ann’s gate code is in the vault');
  drafts.capture(page.root);
  drafts.discard(page.intake);
  assert.equal(drafts.status(page.intake).saved, false);
  // A different account signs in in the same tab.
  drafts.use(8);
  const other = render();
  drafts.restore(other.root);
  assert.deepEqual([get(other.intake, 'feeding'), get(other.booking, 'notes')], ['', '']);
  assert.doesNotMatch(stored(), /Ann’s/, 'the first account’s stored drafts are removed');
  // Sign-out clears everything.
  set(other.booking, 'notes', 'Bob’s note');
  drafts.capture(other.root);
  drafts.clear();
  assert.equal(globalThis.sessionStorage.length, 0);
});

test('drafts expire after 24 hours', () => {
  const drafts = createDrafts();
  drafts.use(7);
  const page = render();
  set(page.intake, 'feeding', 'Old note');
  const realNow = Date.now;
  try {
    drafts.capture(page.root);
    const unrelated = root([form({ action:'other' }, [])]); // touches no care form, so only age can remove the draft
    Date.now = () => realNow() + 23 * 60 * 60_000;
    drafts.capture(unrelated);
    assert.match(stored(), /Old note/, 'still kept within 24 hours');
    Date.now = () => realNow() + 25 * 60 * 60_000;
    drafts.capture(unrelated);
    assert.doesNotMatch(stored(), /Old note/);
  } finally { Date.now = realNow; }
});
