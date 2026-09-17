// SMTP transport: postfix on genius-eye-mail (mail.geniuseye.ai:587, STARTTLS,
// bare username on AUTH). Nothing product-specific lives here.
import nodemailer from 'nodemailer';

export function createSmtpTransport({ host, port = 587, user, pass, secure = port === 465 }) {
  const t = nodemailer.createTransport({
    host, port, secure,
    requireTLS: !secure,           // STARTTLS on 587; never plaintext
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async send({ from, to, subject, text, html, replyTo }) {
      const info = await t.sendMail({ from, to, subject, text, html: html ?? undefined, replyTo: replyTo ?? undefined });
      return { messageId: info.messageId ?? null, accepted: info.accepted };
    },
    verify: () => t.verify(),
  };
}
