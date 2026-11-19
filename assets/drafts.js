// Keeps what someone has typed or chosen in portal forms when the portal re-renders after another save,
// and across a reload of the tab. Only fields that differ from what the page rendered are kept, so a draft
// never hides newer data from the server. Selected photos survive re-renders but not reloads (browsers cannot
// restore a file). Drafts live in this tab's sessionStorage, which the browser clears when the tab closes; they are
// also cleared on sign-out, on a change of account, when their form is saved, and when discarded.
//
// What may be kept (CUX-03, assets/intake-model.js draftPolicy): routine answers (feeding, routines, the chosen
// service) are written to tab storage; health and emergency answers in care forms are kept in memory only, so they
// survive a re-render but never reach browser storage; passwords, entry instructions and codes, tokens and payment
// details are never kept, nor is any field marked data-no-draft. Drafts expire after 24 hours.
import { draftPolicy } from './intake-model.js';

const prefix = 'myo-drafts:';
const keepFor = 24 * 60 * 60_000;
// A form is identified by what it does and what it belongs to: "events|12|", "status|12|Completed", "pets||".
// Care forms (data-care-action) are "care:intake||", "care:vaccines|4|" and so on.
const isCare = form => !form.dataset.action && Boolean(form.dataset.careAction);
const identity = form => [isCare(form) ? 'care:' + form.dataset.careAction : form.dataset.action, form.dataset.id || form.dataset.careId || '',
  form.querySelector('input[type="hidden"][name="status"]')?.value || ''].join('|');
const formSelector = 'form[data-action], form[data-care-action]';
// Portal forms keep every ordinary field except secrets; care forms follow the intake model's policy.
const policyFor = (form, field) => {
  const policy = draftPolicy(field.name);
  return policy === 'never' || isCare(form) ? policy : 'session';
};
const ignored = (field, form) => !field.name || field.matches('[data-no-draft]') || ['password','hidden','submit','button','reset'].includes(field.type)
  || (form && policyFor(form, field) === 'never');
const choice = field => ['radio','checkbox'].includes(field.type);

export function createDrafts() {
  let user = null;
  let drafts = new Map(); // identity -> { saved, open, step, fields:[{ name, value, checked? }], files:{ name: File } }

  const storageKey = () => prefix + user;
  // Removes stored drafts belonging to any account other than `keep` (all of them when keep is null).
  function purgeOthers(keep) {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(prefix) && key !== (keep === null ? null : prefix + keep)) sessionStorage.removeItem(key);
      }
    } catch { /* storage blocked */ }
  }
  function load() {
    try { return new Map(JSON.parse(sessionStorage.getItem(storageKey()) || '[]')); } catch { return new Map(); }
  }
  function persist() {
    const now = Date.now();
    for (const [id, draft] of drafts) if (now - draft.saved > keepFor) drafts.delete(id);
    // File objects cannot be stored, and memory-only answers must not be.
    const stored = [...drafts].map(([id, { files, ...draft }]) => [id, { ...draft, fields:draft.fields.filter(field => !field.memory) }]);
    try { sessionStorage.setItem(storageKey(), JSON.stringify(stored)); } catch { /* storage full or blocked */ }
  }

  return {
    // Switches to the signed-in user's drafts (loaded from this tab's storage on first use).
    use(id) {
      if (user === id) return;
      // Another account's drafts never carry over: switching account starts from this account's own drafts only.
      if (user !== null) drafts = new Map();
      purgeOthers(id);
      user = id;
      drafts = new Map([...load(), ...drafts]);
    },
    // Records the changed fields of every form under root. Forms marked data-submitted were just saved and are dropped.
    capture(root) {
      if (user === null) return;
      for (const form of root.querySelectorAll(formSelector)) {
        const id = identity(form);
        if (form.dataset.submitted) { drafts.delete(id); continue; }
        const fields = [];
        const files = {};
        for (const field of form.elements) {
          if (ignored(field, form)) continue;
          const memory = policyFor(form, field) === 'memory' ? { memory:true } : {};
          if (field.type === 'file') { if (field.files[0]) files[field.name] = field.files[0]; continue; }
          if (field.type === 'radio') { if (field.checked && !field.defaultChecked) fields.push({ name:field.name, value:field.value, checked:true, ...memory }); continue; }
          if (field.type === 'checkbox') { if (field.checked !== field.defaultChecked) fields.push({ name:field.name, value:field.value, checked:field.checked, ...memory }); continue; }
          if (field.tagName === 'SELECT' && field.defaultValue === undefined) {
            const initial = [...field.options].find(option => option.defaultSelected)?.value ?? field.options[0]?.value ?? '';
            if (field.value !== initial) fields.push({ name:field.name, value:field.value, ...memory });
            continue;
          }
          if (field.value !== field.defaultValue) fields.push({ name:field.name, value:field.value, ...memory });
        }
        const open = Boolean(form.closest('details')?.open);
        const step = Number(form.dataset.draftStep || 0);
        if (fields.length || Object.keys(files).length || open || step) drafts.set(id, { saved:Date.now(), open, step, fields, files });
        else drafts.delete(id);
      }
      persist();
    },
    // Puts recorded drafts back into matching forms under root. onChoice(form, input) runs after a radio or
    // checkbox is restored (the booking form rebuilds its times from the chosen service and day);
    // onFile(form, input, file) runs after a photo is restored.
    restore(root, { onChoice = () => {}, onFile = () => {}, onStep = () => {} } = {}) {
      for (const form of root.querySelectorAll(formSelector)) {
        const draft = drafts.get(identity(form));
        if (!draft) continue;
        if (draft.open) { const details = form.closest('details'); if (details) details.open = true; }
        for (const field of draft.fields) {
          if ('checked' in field) {
            const input = [...form.elements].find(element => !ignored(element, form) && choice(element) && element.name === field.name && element.value === field.value);
            if (!input) continue; // that option no longer exists (for example, the time was taken)
            input.checked = field.checked;
            if (field.checked) onChoice(form, input);
          } else {
            const input = [...form.elements].find(element => !ignored(element, form) && !choice(element) && element.type !== 'file' && element.name === field.name);
            if (input) input.value = field.value;
          }
        }
        for (const [name, file] of Object.entries(draft.files || {})) {
          const input = [...form.elements].find(element => !ignored(element, form) && element.type === 'file' && element.name === name);
          if (!input) continue;
          try {
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
            onFile(form, input, file);
          } catch { /* older browsers cannot set files; the photo has to be chosen again */ }
        }
        if (draft.step) onStep(form, draft.step);
      }
    },
    // Forgets one form's draft (after it was saved).
    forget(form) {
      drafts.delete(identity(form));
      if (user !== null) persist();
    },
    // Forgets one form's draft because the person chose to discard it. Same effect as forget(); a separate name so
    // the portal's "Discard changes" action reads clearly.
    discard(form) { this.forget(form); },
    // Whether a form has a kept draft, and whether any of it is held in memory only (lost on reload), so the portal can
    // say so honestly.
    status(form) {
      const draft = drafts.get(identity(form));
      return { saved:Boolean(draft), memoryOnly:Boolean(draft?.fields.some(field => field.memory)), updated:draft?.saved ?? null };
    },
    // Forgets everything for every account in this tab (on sign-out).
    clear() {
      drafts = new Map();
      user = null;
      purgeOthers(null);
    },
  };
}
