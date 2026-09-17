// Mail templates. Each returns { template, subject, text, html }. Text is the
// source of truth; HTML is the same words with the lightest possible dress.
// Email clients cannot load the design system, so the two brand colours the
// footer rule and heading use are inlined here and nowhere else in the app.
const BRAND = 'Robinson Employment Law Institute';
const APP_URL = () => process.env.PUBLIC_APP_URL || `https://app.${process.env.DOMAIN || 'relilaw.org'}`;
const DISCLAIMER = `${BRAND} is a trade name of Robinson Employment Institute, LLC, founded by the Robinson Family Trust. It provides compliance education, not legal advice.`;

const money = (cents, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(cents / 100);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const first = name => (name ?? '').trim().split(/\s+/)[0] || 'there';

function wrap({ title, paragraphs, cta = null }) {
  const body = paragraphs.map(p => `<p style="margin:0 0 14px;font:16px/1.55 'Public Sans',system-ui,sans-serif;color:#0E1922">${p}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${esc(cta.href)}" style="display:inline-block;padding:11px 18px;background:#0E1922;color:#FFFFFF;text-decoration:none;border-radius:4px;font:600 15px 'Public Sans',system-ui,sans-serif">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#FFFFFF">
<div style="max-width:560px;margin:0 auto">
  <div style="border-top:3px solid #B8863B;padding-top:18px;margin-bottom:18px">
    <div style="font:600 12px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.08em;color:#48545F;text-transform:uppercase">${esc(BRAND)}</div>
  </div>
  <h1 style="margin:0 0 16px;font:400 26px/1.25 Newsreader,Georgia,serif;color:#0E1922">${esc(title)}</h1>
  ${body}${button}
  <hr style="border:0;border-top:1px solid #C3CBD3;margin:26px 0 14px">
  <p style="margin:0;font:12px/1.5 'Public Sans',system-ui,sans-serif;color:#48545F">${esc(DISCLAIMER)}</p>
</div></body></html>`;
}

/** Sent once access to a course has been granted and the enrolment exists. */
export function enrolmentConfirmation({ user, product }) {
  const url = `${APP_URL()}/courses/${product.core_course_id}`;
  const subject = `You're enrolled: ${product.title}`;
  const text = [
    `Hello ${first(user.display_name)},`,
    '',
    `Your enrolment in ${product.title} (${product.code}) is confirmed. Your place in the ladder is open and your first lesson is waiting.`,
    '',
    `Start here: ${url}`,
    '',
    'Every lesson shows the date its citations were last verified by a named attorney. Work at your own pace; your progress is saved as you go.',
    '',
    `— ${BRAND}`,
    '',
    DISCLAIMER,
  ].join('\n');
  const html = wrap({
    title: subject,
    paragraphs: [
      `Hello ${esc(first(user.display_name))},`,
      `Your enrolment in <strong>${esc(product.title)}</strong> (${esc(product.code)}) is confirmed. Your place in the ladder is open and your first lesson is waiting.`,
      'Every lesson shows the date its citations were last verified by a named attorney. Work at your own pace; your progress is saved as you go.',
    ],
    cta: { href: url, label: 'Start the course' },
  });
  return { template: 'enrolment_confirmation', subject, text, html };
}

/** Sent when the Core issues a credential (a rank earned). */
export function credentialIssued({ user, product, publicRef, rankName = null }) {
  const verifyUrl = `${APP_URL()}/verify/${encodeURIComponent(publicRef)}`;
  const subject = rankName ? `${rankName} Belt earned — ${product.title}` : `Credential issued — ${product.title}`;
  const text = [
    `Hello ${first(user.display_name)},`,
    '',
    `You have earned ${rankName ? `the ${rankName} Belt` : 'your credential'} for ${product.title} (${product.code}).`,
    '',
    `Credential reference: ${publicRef}`,
    `Public verification: ${verifyUrl}`,
    '',
    'Anyone you share that link with — an employer, a client, a regulator — can confirm the credential without signing in.',
    '',
    `— ${BRAND}`,
    '',
    DISCLAIMER,
  ].join('\n');
  const html = wrap({
    title: subject,
    paragraphs: [
      `Hello ${esc(first(user.display_name))},`,
      `You have earned ${rankName ? `the <strong>${esc(rankName)} Belt</strong>` : 'your credential'} for <strong>${esc(product.title)}</strong> (${esc(product.code)}).`,
      `Credential reference: <code style="font-family:'IBM Plex Mono',ui-monospace,monospace">${esc(publicRef)}</code>`,
      'Anyone you share the verification link with — an employer, a client, a regulator — can confirm the credential without signing in.',
    ],
    cta: { href: verifyUrl, label: 'View public verification' },
  });
  return { template: 'credential_issued', subject, text, html };
}

/** Sent for each completed payment. Stripe also emails its own receipt if enabled; this is ours. */
export function receipt({ user, product, amountCents, currency = 'USD', sessionId, paidAt = new Date() }) {
  const when = paidAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const subject = `Receipt — ${product.title} (${money(amountCents, currency)})`;
  const text = [
    `Hello ${first(user.display_name)},`,
    '',
    `Thank you. This is your receipt from ${BRAND}.`,
    '',
    `Item:        ${product.title} (${product.code})`,
    `Amount paid: ${money(amountCents, currency)}`,
    `Date:        ${when}`,
    `Reference:   ${sessionId}`,
    '',
    `Access is attached to your account, not to this payment: sign in at ${APP_URL()} to continue.`,
    '',
    `— ${BRAND}`,
    '',
    DISCLAIMER,
  ].join('\n');
  const row = (k, v) => `<tr><td style="padding:6px 12px 6px 0;color:#48545F;font:14px 'Public Sans',system-ui,sans-serif">${k}</td><td style="padding:6px 0;font:14px 'IBM Plex Mono',ui-monospace,monospace;color:#0E1922">${esc(v)}</td></tr>`;
  const html = wrap({
    title: 'Your receipt',
    paragraphs: [
      `Hello ${esc(first(user.display_name))},`,
      `Thank you. This is your receipt from ${esc(BRAND)}.`,
      `<table style="border-collapse:collapse">${row('Item', `${product.title} (${product.code})`)}${row('Amount paid', money(amountCents, currency))}${row('Date', when)}${row('Reference', sessionId)}</table>`,
      `Access is attached to your account, not to this payment: sign in at <a href="${esc(APP_URL())}" style="color:#8A5E14">${esc(APP_URL())}</a> to continue.`,
    ],
  });
  return { template: 'receipt', subject, text, html };
}
