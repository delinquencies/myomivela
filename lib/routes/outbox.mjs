// Staff view of outgoing messages (C3.6), and a manual send for when no scheduler is running.
import { all } from '../db.mjs';
import { drainOutbox, emailEnabled, render } from '../outbox.mjs';

export default [
  { method:'GET', path:'/api/outbox', access:'staff', handler:() => ({
    email_enabled:emailEnabled(),
    messages:all(`SELECT o.*, u.name AS recipient FROM outbox o JOIN users u ON u.id=o.user ORDER BY o.id DESC LIMIT 100`)
      .map(message => ({ id:message.id, recipient:message.recipient, template:message.template, status:message.status,
        attempts:message.attempts, created:message.created, sent_at:message.sent_at, last_error:message.last_error, ...render(message) })),
  }) },
  { method:'POST', path:'/api/outbox/drain', access:'staff', idempotent:false, handler:() => drainOutbox() },
];
