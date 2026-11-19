// Care intake (CUX-03): one household record per customer, validated by the shared model in assets/intake-model.js.
// A full save must be complete. A partial save (`partial:true`) merges the answers given into what is saved, so the
// portal can save one group at a time; the record counts as complete only once every required answer is present.
import { get, run } from '../db.mjs';
import { requireThat } from '../validate.mjs';
import { validateIntake, intakeStatus, intakeGroups, requiredFields } from '../../assets/intake-model.js';

export function readIntake(owner) {
  const row = get('SELECT body,updated FROM care_intakes WHERE owner=?', owner);
  if (!row) return null;
  const body = JSON.parse(row.body);
  // Records saved before partial saves existed passed full validation, so they are complete.
  return { ...body, complete:body.complete !== false, updated:row.updated };
}
// When this customer's pets last changed (a new pet or an edited profile), for the "outdated" check.
export const petsChangedAt = owner => get(`SELECT MAX(v.created) AS at FROM pet_profile_versions v JOIN pets p ON p.id=v.pet WHERE p.owner=?`, owner)?.at ?? null;
export function intakeState(owner, service) {
  const saved = readIntake(owner);
  const status = intakeStatus(saved, { service:service ?? saved?.service, petsChangedAt:petsChangedAt(owner) });
  const required = new Set(requiredFields(service ?? saved?.service ?? 'walk'));
  return { ...status, updated:saved?.updated ?? null, service:saved?.service ?? null,
    groups:intakeGroups.map(group => {
      const fields = group.fields.filter(key => required.has(key));
      return { id:group.id, fields, complete:Boolean(saved) && fields.every(key => !status.missing.includes(key)) };
    }) };
}

export default [
  {
    method: 'GET',
    path: '/api/intake',
    access: 'user',
    handler: ({ user }) => {
      requireThat(!user.admin, 'Open the customer record to view care intake.', 403);
      return readIntake(user.id);
    },
  },
  // Where the intake stands: absent, incomplete (with the missing fields), outdated (pets changed since) or complete,
  // and each group's completion. `service` (walk, dropIn, overnight) checks it for a planned service.
  {
    method: 'GET',
    path: '/api/intake/status',
    access: 'user',
    handler: ({ user, url }) => {
      requireThat(!user.admin, 'Open the customer record to view care intake.', 403);
      const service = url.searchParams.get('service');
      requireThat(service === null || ['walk','dropIn','overnight'].includes(service), 'Choose a service.', 400, 'invalid_field', { fieldErrors:[{ field:'service', code:'choose_one' }] });
      return intakeState(user.id, service ?? undefined);
    },
  },
  {
    method: 'POST',
    path: '/api/intake',
    access: 'user',
    handler: ({ user, data }) => {
      requireThat(!user.admin, 'Use a customer account to save care intake.', 403);
      const partial = data.partial === true;
      const previous = partial ? readIntake(user.id) : null;
      const { value, fieldErrors } = validateIntake(data, { partial });
      // The first problem is the message; every problem is in fieldErrors for the form to show beside each field.
      const first = fieldErrors[0];
      requireThat(!first, first ? messageFor(first) : '', 400, 'invalid_field', { fieldErrors });
      const merged = partial ? { ...stripMeta(previous), ...value } : value;
      const complete = partial ? validateIntake(merged).fieldErrors.length === 0 : true;
      const updated = Date.now();
      run('INSERT INTO care_intakes(owner,body,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated=excluded.updated',
        user.id, JSON.stringify({ ...merged, complete }), updated);
      return { updated, complete, status:intakeState(user.id) };
    },
  },
];
const stripMeta = saved => {
  if (!saved) return {};
  const { complete, updated, ...answers } = saved;
  return answers;
};
// English messages for the server's own error text; the portal shows translated text from the field codes.
function messageFor({ field, code, params }) {
  if (field === 'service') return 'Choose a service.';
  if (code === 'acknowledge') return 'Acknowledge overnight care requirements.';
  if (field === 'vetAuthorization') return 'Choose emergency care authorization.';
  if (field === 'spendingLimit') return 'Enter a valid spending limit.';
  if (code === 'too_long') return 'Keep this answer under ' + params.max + ' characters.';
  return 'Enter a valid value.';
}
