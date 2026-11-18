// Staff-managed fee rules and holidays (C3.4). Quotes pick up a change at once; booked prices never change.
import { all, get, run } from '../db.mjs';
import { requireThat, field, integer } from '../validate.mjs';
import { feeKinds, feeParams } from '../fees.mjs';

const validDay = day => {
  const date = new Date(day + 'T12:00:00Z');
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(+date) && date.toISOString().slice(0, 10) === day, 'Choose a valid date.');
  return day;
};
const listing = () => ({
  rules:all('SELECT * FROM fee_rules ORDER BY id').map(rule => ({ ...rule, params:JSON.parse(rule.params), active:Boolean(rule.active) })),
  holidays:all('SELECT * FROM holidays ORDER BY day'),
});

export default [
  { method:'GET', path:'/api/fee-rules', access:'owner', handler:listing },

  // Creates a rule, or updates one by id. `code` is a short unique name (letters, digits, dashes).
  { method:'POST', path:'/api/fee-rules', access:'owner', handler:({ data }) => {
    requireThat(feeKinds.includes(data.kind), 'Choose a kind of fee.', 400, 'fee_rule_invalid');
    requireThat(['flat','percent'].includes(data.amount_type), 'Choose a flat amount or a percentage.', 400, 'fee_rule_invalid');
    const value = data.amount_type === 'flat' ? integer(data.value, 100_000, 0) : integer(data.value, 100, 0);
    const label = field(data.label, 80);
    const params = JSON.stringify(feeParams(data.kind, data.params ?? {}));
    const active = data.active === false ? 0 : 1;
    if (data.id !== undefined) {
      const rule = get('SELECT * FROM fee_rules WHERE id=?', integer(data.id));
      requireThat(rule, 'Fee rule not found.', 404);
      run('UPDATE fee_rules SET label=?,kind=?,amount_type=?,value=?,params=?,active=? WHERE id=?', label, data.kind, data.amount_type, value, params, active, rule.id);
      return { id:rule.id };
    }
    const code = field(data.code, 40);
    requireThat(/^[a-z0-9-]+$/.test(code), 'Use lowercase letters, digits and dashes for the code.', 400, 'fee_rule_invalid');
    requireThat(!get('SELECT id FROM fee_rules WHERE code=?', code), 'A fee rule with this code already exists.', 409, 'fee_rule_exists');
    const id = run('INSERT INTO fee_rules(code,label,kind,amount_type,value,params,active) VALUES(?,?,?,?,?,?,?)',
      code, label, data.kind, data.amount_type, value, params, active).lastInsertRowid;
    return { id };
  } },

  { method:'POST', path:'/api/fee-rules/delete', access:'owner', handler:({ data }) => {
    requireThat(run('DELETE FROM fee_rules WHERE id=?', integer(data.id)).changes, 'Fee rule not found.', 404);
    return {};
  } },

  { method:'POST', path:'/api/holidays', access:'owner', handler:({ data }) => {
    run('INSERT INTO holidays(day,name) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET name=excluded.name', validDay(field(data.day, 10)), field(data.name, 80));
    return listing();
  } },
  { method:'POST', path:'/api/holidays/delete', access:'owner', handler:({ data }) => {
    run('DELETE FROM holidays WHERE day=?', validDay(field(data.day, 10)));
    return listing();
  } },
];
