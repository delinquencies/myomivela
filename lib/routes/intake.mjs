import { get, run } from '../db.mjs';
import { field, requireThat } from '../validate.mjs';
import { myoConfig } from '../../assets/myo-config.js';

export function readIntake(owner) {
  const row = get('SELECT body,updated FROM care_intakes WHERE owner=?', owner);
  return row ? { ...JSON.parse(row.body), updated: row.updated } : null;
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
  {
    method: 'POST',
    path: '/api/intake',
    access: 'user',
    handler: ({ user, data }) => {
      requireThat(!user.admin, 'Use a customer account to save care intake.', 403);
      requireThat(
        ['walk', 'dropIn', 'overnight'].includes(data.service),
        'Choose a service.',
        400,
        'invalid_field'
      );
      const body = { service: data.service };
      for (const [key] of myoConfig.intakeFields) {
        if (key === 'spendingLimit') {
          requireThat(
            typeof data[key] === 'number' &&
              Number.isFinite(data[key]) &&
              data[key] >= 0 &&
              data[key] <= 1000000,
            'Enter a valid spending limit.',
            400,
            'invalid_field'
          );
          body[key] = data[key];
        } else {
          body[key] = field(data[key], myoConfig.intakeMaxLength);
        }
      }
      requireThat(
        ['yes', 'no'].includes(body.vetAuthorization),
        'Choose emergency care authorization.',
        400,
        'invalid_field'
      );
      if (data.service === 'overnight') {
        body.overnightAlone = field(data.overnightAlone, myoConfig.intakeMaxLength);
        body.overnightBehavior = field(data.overnightBehavior, myoConfig.intakeMaxLength);
        requireThat(
          data.overnightAcknowledgment === true,
          'Acknowledge overnight care requirements.',
          400,
          'invalid_field'
        );
        body.overnightAcknowledgment = true;
      }
      const updated = Date.now();
      run(
        'INSERT INTO care_intakes(owner,body,updated) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body,updated=excluded.updated',
        user.id,
        JSON.stringify(body),
        updated
      );
      return { updated };
    },
  },
];
