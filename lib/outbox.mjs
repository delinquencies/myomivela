// Notification outbox (C3.6). Routes call notify() inside their transaction, so a message exists exactly when the
// change it reports was saved. drainOutbox() later renders each message in the recipient's language and hands it to
// the email driver; failures are retried with backoff. With no driver configured, messages wait (staff can list them).
import { all, get, run, transaction } from './db.mjs';
import { config } from './config.mjs';

const easternWhen = locale => new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { dateStyle:'medium', timeStyle:'short', timeZone:'America/New_York' });
const money = cents => '$' + (cents / 100).toFixed(2);
const maxAttempts = 6;

// Subject and text for each template, in English and Spanish. `p` are the params stored with the message.
const when = (p, l) => easternWhen(l).format(p.starts) + ' ET';
export const templates = {
  request_received:{
    en:p => ['New booking request', `${p.customer} requested ${p.service} on ${when(p,'en')}. Review it in the portal.`],
    es:p => ['Nueva solicitud de reserva', `${p.customer} solicitó ${p.service} el ${when(p,'es')}. Revísala en el portal.`] },
  request_received_client:{
    en:p => ['We have your request', `Thank you! Myomi has your request for ${p.service} on ${when(p,'en')} and will confirm it personally. You can follow it in your portal.`],
    es:p => ['Recibimos tu solicitud', `¡Gracias! Myomi recibió tu solicitud de ${p.service} para el ${when(p,'es')} y la confirmará personalmente. Puedes seguirla en tu portal.`] },
  booking_confirmed:{
    en:p => ['Your visit is confirmed', `Myomi confirmed ${p.service} on ${when(p,'en')}.`],
    es:p => ['Tu visita está confirmada', `Myomi confirmó ${p.service} el ${when(p,'es')}.`] },
  booking_cancelled:{
    en:p => ['Your booking was cancelled', `${p.service} on ${when(p,'en')} was cancelled.` + (p.fee_cents ? ` A cancellation fee of ${money(p.fee_cents)} applies.` : '')],
    es:p => ['Tu reserva fue cancelada', `${p.service} el ${when(p,'es')} fue cancelada.` + (p.fee_cents ? ` Se aplica un cargo por cancelación de ${money(p.fee_cents)}.` : '')] },
  customer_cancelled:{
    en:p => ['A customer cancelled', `${p.customer} cancelled ${p.service} on ${when(p,'en')}.`],
    es:p => ['Un cliente canceló', `${p.customer} canceló ${p.service} el ${when(p,'es')}.`] },
  change_decided:{
    en:p => [p.approved ? 'Your new time is confirmed' : 'Your change request was declined',
      p.approved ? `${p.service} is now on ${when(p,'en')}.` : `${p.service} stays on ${when(p,'en')}.`],
    es:p => [p.approved ? 'Tu nuevo horario está confirmado' : 'Tu solicitud de cambio fue rechazada',
      p.approved ? `${p.service} ahora es el ${when(p,'es')}.` : `${p.service} sigue el ${when(p,'es')}.`] },
  visit_started:{
    en:p => ['Your visit has started', `Myomi has started ${p.service}. Updates will appear in your Pet Diary.`],
    es:p => ['Tu visita comenzó', `Myomi comenzó ${p.service}. Las novedades aparecerán en tu Diario.`] },
  visit_completed:{
    en:p => ['Your visit is complete', `Myomi completed ${p.service}. The summary is in your Pet Diary.`],
    es:p => ['Tu visita terminó', `Myomi terminó ${p.service}. El resumen está en tu Diario.`] },
  payment_received:{
    en:p => ['Payment received', `Thank you. We received ${money(p.cents)}.`],
    es:p => ['Pago recibido', `Gracias. Recibimos ${money(p.cents)}.`] },
  vaccine_due:{
    en:p => [`${p.pet}'s ${p.vaccine} expires soon`, `${p.pet}'s ${p.vaccine} record expires on ${p.expires}. Upload the new record in the portal.`],
    es:p => [`La vacuna ${p.vaccine} de ${p.pet} vence pronto`, `El registro de ${p.vaccine} de ${p.pet} vence el ${p.expires}. Sube el nuevo registro en el portal.`] },
  keys_to_return:{
    en:p => ['Keys to return', `${p.customer} has no more visits booked. Return their key${p.key_label ? ' (' + p.key_label + ')' : ''}.`],
    es:p => ['Llaves por devolver', `${p.customer} no tiene más visitas. Devuelve su llave${p.key_label ? ' (' + p.key_label + ')' : ''}.`] },
};
export function render(message) {
  const user = get('SELECT locale FROM users WHERE id=?', message.user);
  const language = user?.locale === 'es' ? 'es' : 'en';
  const [subject, text] = templates[message.template][language](JSON.parse(message.params));
  return { subject, text, language };
}

// Queues a message for `user` (an id, or 'staff' for every staff account). Must run inside the caller's transaction.
export function notify(user, template, params, dedupeKey, sendAfter = Date.now()) {
  const now = Date.now();
  const recipients = user === 'staff' ? all('SELECT id FROM users WHERE admin=1').map(row => row.id) : [user];
  for (const id of recipients) {
    run('INSERT INTO outbox(user,template,params,send_after,dedupe_key,created) VALUES(?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING',
      id, template, JSON.stringify(params), sendAfter, dedupeKey + ':' + id, now);
  }
}
// The usual params for a booking message.
export function bookingParams(booking) {
  const row = get('SELECT b.starts, b.cancel_fee_cents, s.name AS service, u.name AS customer FROM bookings b JOIN services s ON s.id=b.service JOIN users u ON u.id=b.owner WHERE b.id=?', booking.id ?? booking);
  return { booking:booking.id ?? booking, starts:row.starts, service:row.service, customer:row.customer, fee_cents:row.cancel_fee_cents };
}

// Daily reminders: vaccines expiring in 30 and 7 days. Deduped per record and threshold.
export function scheduleReminders(now = Date.now()) {
  const day = offset => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
  for (const [threshold, last] of [[30, day(30)], [7, day(7)]]) {
    const due = all(`SELECT v.id, v.name AS vaccine, v.expires, p.name AS pet, p.owner FROM pet_vaccines v JOIN pets p ON p.id=v.pet
      WHERE v.expires>=? AND v.expires<=?`, day(0), last);
    for (const row of due) notify(row.owner, 'vaccine_due', { pet:row.pet, vaccine:row.vaccine, expires:row.expires }, 'vaccine:' + row.id + ':' + row.expires + ':' + threshold);
  }
}

// Email drivers. send() resolves when the provider accepted the message, and throws otherwise.
const drivers = {
  log:{ async send() {} },
};
export const emailEnabled = () => Boolean(drivers[config.email]);

// Sends what is due, up to `limit` messages. Safe to call often; returns counts for logs and tests.
export async function drainOutbox(now = Date.now(), limit = 25) {
  transaction(() => scheduleReminders(now));
  const driver = drivers[config.email];
  if (!driver) return { sent:0, failed:0, waiting:get("SELECT COUNT(*) AS count FROM outbox WHERE status='pending'").count };
  let sent = 0, failed = 0;
  for (const message of all("SELECT * FROM outbox WHERE status='pending' AND send_after<=? ORDER BY id LIMIT ?", now, limit)) {
    const to = get('SELECT email FROM users WHERE id=?', message.user)?.email;
    try {
      await driver.send({ to, ...render(message) });
      run("UPDATE outbox SET status='sent', sent_at=?, attempts=attempts+1, last_error=NULL WHERE id=?", Date.now(), message.id);
      sent++;
    } catch (error) {
      // Back off 1, 2, 4, 8 ... minutes; give up after a few attempts.
      const attempts = message.attempts + 1;
      run('UPDATE outbox SET status=?, attempts=?, last_error=?, send_after=? WHERE id=?', attempts >= maxAttempts ? 'failed' : 'pending', attempts,
        String(error.message || error).slice(0, 500), now + 2 ** (attempts - 1) * 60_000, message.id);
      failed++;
    }
  }
  return { sent, failed, waiting:get("SELECT COUNT(*) AS count FROM outbox WHERE status='pending'").count };
}
