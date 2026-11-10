/**
 * Shared SMTP helper (Nodemailer). Used by quote delivery and customer portal invites.
 */
let _nodemailer = null;
function nodemailer() {
  if (!_nodemailer) _nodemailer = require('nodemailer');
  return _nodemailer;
}

function httpErr(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function getSmtpTransport() {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  if (!user || !pass) throw httpErr(503, 'SMTP credentials not configured (SMTP_USER / SMTP_PASS)');

  return nodemailer().createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendMail({ to, subject, html, text, attachments } = {}) {
  const transport = getSmtpTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({
    from,
    to,
    subject,
    html,
    text,
    attachments: attachments || undefined,
  });
}
