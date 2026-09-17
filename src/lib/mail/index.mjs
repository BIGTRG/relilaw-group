// Mail (§11) behind an adapter. SERVER ONLY.
//
//   mailer.send({ userId?, to, template, subject, text, html })
//     → transport.send({ from, to, subject, text, html })   (SMTP, fake, ...)
//     → email_log row (queued → sent | failed), always, even when the
//       transport throws. Nothing is sent that is not logged.
//
// The transport is the only thing that knows how mail leaves the box. Today
// it is postfix on genius-eye-mail over SMTP (./smtp.mjs); swapping the
// server is a one-line change in the composition root, not here.
import { createSmtpTransport } from './smtp.mjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {{ db: import('pg').Pool, transport: { send(msg): Promise<{ messageId?: string }> }, from: string }} opts
 */
export function createMailer({ db, transport, from }) {
  if (!transport?.send) throw new Error('mail transport must implement send()');
  if (!from) throw new Error('mail FROM address is required');

  async function send({ userId = null, to, template, subject, text, html = null, replyTo = null }) {
    if (typeof to !== 'string' || !EMAIL.test(to)) throw new Error('mail: invalid recipient');
    if (!template || !subject || !text) throw new Error('mail: template, subject and text are required');
    const { rows } = await db.query(
      `insert into email_log (user_id, to_email, template, subject) values ($1, $2, $3, $4) returning id`,
      [userId, to, template, subject]);
    const logId = rows[0].id;
    try {
      const r = await transport.send({ from, to, subject, text, html, replyTo });
      await db.query(
        `update email_log set status = 'sent', sent_at = now(), message_id = $2 where id = $1`,
        [logId, r?.messageId ?? null]);
      return { ok: true, logId, messageId: r?.messageId ?? null };
    } catch (e) {
      await db.query(`update email_log set status = 'failed' where id = $1`, [logId]).catch(() => {});
      return { ok: false, logId, error: e?.message ?? String(e) };
    }
  }

  return { send, from };
}

/** Composition root for the running app: SMTP settings from env only. */
let mailer;
export function getMailer(db) {
  if (!mailer) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
    if (!SMTP_HOST || !SMTP_FROM) throw new Error('SMTP_HOST and SMTP_FROM are not set');
    const transport = createSmtpTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT ?? 587), user: SMTP_USER, pass: SMTP_PASS,
    });
    mailer = createMailer({ db, transport, from: SMTP_FROM });
  }
  return mailer;
}

/** A transport that delivers nowhere and remembers everything (tests). */
export function createMemoryTransport({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    async send(msg) {
      if (fail) throw new Error('transport down');
      sent.push(msg);
      return { messageId: `<mem-${sent.length}@test>` };
    },
  };
}
