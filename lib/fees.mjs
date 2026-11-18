// Fee rules (C3.4): weekend, holiday, after-hours and short-notice surcharges, added to a quote as `fee` lines.
// Rules apply in a fixed order (by kind, then by id) and each line is rounded on its own, so a total never depends
// on how the lines are summed. Percentages are of the service lines (base or nightly, plus extra pets).
import { all } from './db.mjs';
import { requireThat } from './validate.mjs';

export const feeKinds = ['weekend','holiday','after_hours','short_notice'];
const easternDay = new Intl.DateTimeFormat('sv-SE',{ dateStyle:'short', timeZone:'America/New_York' });
const easternClock = new Intl.DateTimeFormat('en-GB',{ hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'America/New_York' });
const minuteOfDay = ms => { const [h, m] = easternClock.format(ms).split(':').map(Number); return h * 60 + m; };
const clock = text => { const [h, m] = text.split(':').map(Number); return h * 60 + m; };
const weekday = day => new Date(day + 'T12:00:00Z').getUTCDay();

// Defaults for each kind's params, and the checks a rule's params must pass when staff save it.
export const paramDefaults = {
  weekend:{ days:[0,6] },               // the weekdays (0 = Sunday) of a visit, or of a stay's nights, that count
  holiday:{},                           // a visit on, or a stay night of, a date in the holidays list
  after_hours:{ before:'08:00', after:'18:00' }, // a visit starting before, or ending after, these Eastern times
  short_notice:{ hours:24 },            // a booking requested less than this many hours before it starts
};
export function feeParams(kind, params = {}) {
  requireThat(params && typeof params === 'object' && !Array.isArray(params), 'Enter valid rule settings.');
  const merged = { ...paramDefaults[kind], ...params };
  if (kind === 'weekend') requireThat(Array.isArray(merged.days) && merged.days.length && merged.days.length <= 7 &&
    merged.days.every(day => Number.isInteger(day) && day >= 0 && day <= 6), 'Choose the weekend days.');
  if (kind === 'after_hours') requireThat([merged.before, merged.after].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) &&
    clock(merged.before) < clock(merged.after), 'Enter the hours as HH:MM, with the morning time first.');
  if (kind === 'short_notice') requireThat(Number.isInteger(merged.hours) && merged.hours >= 1 && merged.hours <= 168, 'Short notice is 1 to 168 hours.');
  return Object.fromEntries(Object.keys(paramDefaults[kind]).map(key => [key, merged[key]]));
}

export const activeRules = () => all('SELECT * FROM fee_rules WHERE active=1').map(rule => ({ ...rule, params:JSON.parse(rule.params) }))
  .sort((a, b) => feeKinds.indexOf(a.kind) - feeKinds.indexOf(b.kind) || a.id - b.id);

// The fee lines for a booking. `lines` are the service lines from quote(); `nights` are a stay's night dates
// (empty for a visit). Weekend and holiday fees count each qualifying night of a stay, at the per-night amount.
export function feeLines({ lines, starts, ends, nights = [], now = Date.now(), rules = activeRules(), holidays }) {
  if (!rules.length || !Number.isSafeInteger(starts)) return [];
  holidays ??= new Set(all('SELECT day FROM holidays').map(row => row.day));
  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  const stay = nights.length > 0;
  const perUnit = stay ? subtotal / nights.length : subtotal;
  const days = stay ? nights : [easternDay.format(starts)];
  const fees = [];
  for (const rule of rules) {
    let units = 0, unit = subtotal;
    if (rule.kind === 'weekend') { units = days.filter(day => rule.params.days.includes(weekday(day))).length; unit = perUnit; }
    else if (rule.kind === 'holiday') { units = days.filter(day => holidays.has(day)).length; unit = perUnit; }
    else if (rule.kind === 'after_hours') units = !stay && (minuteOfDay(starts) < clock(rule.params.before) ||
      (ends > starts && (easternDay.format(ends - 1) !== days[0] || minuteOfDay(ends - 1) + 1 > clock(rule.params.after)))) ? 1 : 0;
    else if (rule.kind === 'short_notice') units = starts - now < rule.params.hours * 60 * 60_000 ? 1 : 0;
    if (!units) continue;
    const each = rule.amount_type === 'flat' ? rule.value : Math.round(unit * rule.value / 100);
    if (each > 0) fees.push({ code:'fee', label:rule.label, quantity:units, cents:each * units });
  }
  return fees;
}
