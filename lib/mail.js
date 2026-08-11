/**
 * Outbound email for recovery, password reminders, and Support contact.
 *
 * Delivery channels (first match wins for support):
 *   1. SMTP — SMTP_HOST + MAIL_FROM (+ optional SMTP_USER / SMTP_PASS)
 *   2. Resend API — RESEND_API_KEY (optional MAIL_FROM / RESEND_FROM)
 *
 * Without either channel, sendMail logs the message and returns sent:false
 * so the Support UI can fall back to a browser FormSubmit delivery path.
 */
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

const DEFAULT_SUPPORT_EMAIL = "hilljj1990@gmail.com";

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function mailConfigured() {
  return smtpConfigured() || resendConfigured();
}

function supportInbox(to) {
  return (
    String(to || process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() ||
    DEFAULT_SUPPORT_EMAIL
  );
}

function mailFromAddress() {
  return (
    process.env.MAIL_FROM ||
    process.env.RESEND_FROM ||
    "Driver Hub <onboarding@resend.dev>"
  );
}

function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return String(process.env.APP_BASE_URL).replace(/\/$/, "");
  if (req && req.headers) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "http";
    if (host) return `${proto}://${host}`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

function createTransport() {
  if (!smtpConfigured() || !nodemailer) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth:
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER || "",
            pass: process.env.SMTP_PASS || "",
          }
        : undefined,
  });
}

/**
 * @returns {Promise<{ sent: boolean, channel?: string, preview?: string, error?: string }>}
 */
async function sendViaResend({ to, subject, text, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, error: "RESEND_API_KEY not set" };

  const payload = {
    from: mailFromAddress(),
    to: [to],
    subject,
    text,
    html: html || undefined,
  };
  if (replyTo) payload.reply_to = replyTo;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg =
        (data && (data.message || data.error || data.name)) || `Resend HTTP ${res.status}`;
      console.warn("[mail:resend]", errMsg);
      return { sent: false, channel: "resend", error: String(errMsg) };
    }
    return { sent: true, channel: "resend" };
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    console.warn("[mail:resend]", errMsg);
    return { sent: false, channel: "resend", error: errMsg };
  }
}

/**
 * @returns {Promise<{ sent: boolean, channel?: string, preview?: string, error?: string }>}
 */
async function sendMail({ to, subject, text, html, replyTo }) {
  const from = process.env.MAIL_FROM || "noreply@haulage.local";
  const payload = { from, to, subject, text, html: html || text };
  if (replyTo) payload.replyTo = replyTo;

  const transport = createTransport();
  if (transport) {
    try {
      await transport.sendMail(payload);
      return { sent: true, channel: "smtp" };
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      console.warn("[mail:smtp]", errMsg);
      // Fall through to Resend if available.
      if (!resendConfigured()) {
        return { sent: false, channel: "smtp", error: errMsg };
      }
    }
  }

  if (resendConfigured()) {
    return sendViaResend({ to, subject, text, html, replyTo });
  }

  console.info("[mail:dev]", JSON.stringify({ to, subject, text, replyTo }));
  return { sent: false, preview: text };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function supportFieldLines({ name, email, phone, username }) {
  return {
    name: String(name || "").trim() || "(not provided)",
    email: String(email || "").trim() || "(not provided)",
    phone: String(phone || "").trim() || "(not provided)",
    username: String(username || "").trim() || "(guest / not signed in)",
  };
}

function buildSupportNotificationText({ name, email, phone, message, username }) {
  const fields = supportFieldLines({ name, email, phone, username });
  const body = String(message || "").trim() || "(empty message)";
  return [
    "Driver Hub — new support request",
    "====================================",
    "",
    "CONTACT DETAILS",
    "---------------",
    `Name:     ${fields.name}`,
    `Email:    ${fields.email}`,
    `Phone:    ${fields.phone}`,
    `Username: ${fields.username}`,
    "",
    "MESSAGE",
    "-------",
    body,
    "",
    "====================================",
    "Tip: hit Reply to answer this person directly.",
  ].join("\n");
}

function buildSupportNotificationHtml({ name, email, phone, message, username }) {
  const fields = supportFieldLines({ name, email, phone, username });
  const bodyHtml = escapeHtml(String(message || "").trim() || "(empty message)").replace(
    /\r\n|\r|\n/g,
    "<br />"
  );
  const rows = [
    ["Name", fields.name],
    ["Email", fields.email],
    ["Phone", fields.phone],
    ["Username", fields.username],
  ]
    .map(
      ([label, value], index) => `
      <tr>
        <td style="padding:12px 14px;border-top:${
          index === 0 ? "0" : "1px solid #d5dee7"
        };width:120px;vertical-align:top;font:600 13px/1.4 Arial,Helvetica,sans-serif;color:#5a6b7d;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:12px 14px;border-top:${
          index === 0 ? "0" : "1px solid #d5dee7"
        };vertical-align:top;font:400 15px/1.45 Arial,Helvetica,sans-serif;color:#1a2332;">
          ${
            label === "Email" && fields.email.includes("@")
              ? `<a href="mailto:${escapeHtml(fields.email)}" style="color:#0b3d6e;text-decoration:underline;">${escapeHtml(fields.email)}</a>`
              : escapeHtml(value)
          }
        </td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Driver Hub support</title></head>
<body style="margin:0;padding:0;background:#e8eef4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eef4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #c5d0db;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#0b3d6e;padding:18px 22px;">
              <div style="font:700 18px/1.3 Arial,Helvetica,sans-serif;color:#ffffff;letter-spacing:0.02em;">
                Driver Hub
              </div>
              <div style="margin-top:4px;font:400 13px/1.4 Arial,Helvetica,sans-serif;color:#f0c14b;">
                New support request
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 22px 8px;">
              <div style="font:700 12px/1.3 Arial,Helvetica,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#5a6b7d;">
                Contact details
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 22px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d5dee7;border-radius:10px;background:#f3f7fb;">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 22px 8px;">
              <div style="font:700 12px/1.3 Arial,Helvetica,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#5a6b7d;">
                Message
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 22px 22px;">
              <div style="padding:16px 18px;border:1px solid #d5dee7;border-radius:10px;background:#ffffff;font:400 15px/1.55 Arial,Helvetica,sans-serif;color:#1a2332;white-space:normal;">
                ${bodyHtml}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 22px 20px;">
              <div style="font:400 12px/1.45 Arial,Helvetica,sans-serif;color:#5a6b7d;">
                Tip: hit Reply to answer this person directly (Reply-To is set to their email).
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildSupportConfirmationText({ name, supportEmail }) {
  return [
    `Hi ${name},`,
    "",
    "Thanks for contacting Driver Hub support.",
    `Your request has been sent to the developer (${supportEmail}).`,
    "We’ll reply to this email address as soon as we can.",
    "",
    "— Driver Hub",
  ].join("\n");
}

function buildSupportConfirmationHtml({ name, supportEmail }) {
  const safeName = escapeHtml(name || "there");
  const safeInbox = escapeHtml(supportEmail || "");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Support request received</title></head>
<body style="margin:0;padding:0;background:#e8eef4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8eef4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #c5d0db;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#0b3d6e;padding:18px 22px;">
              <div style="font:700 18px/1.3 Arial,Helvetica,sans-serif;color:#ffffff;">Driver Hub</div>
              <div style="margin-top:4px;font:400 13px/1.4 Arial,Helvetica,sans-serif;color:#f0c14b;">Support request received</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px;font:400 15px/1.55 Arial,Helvetica,sans-serif;color:#1a2332;">
              <p style="margin:0 0 14px;">Hi ${safeName},</p>
              <p style="margin:0 0 14px;">Thanks for contacting Driver Hub support.</p>
              <p style="margin:0 0 14px;">Your request has been sent to the developer (${safeInbox}). We’ll reply to this email address as soon as we can.</p>
              <p style="margin:0;color:#5a6b7d;">— Driver Hub</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Deliver the support enquiry to the developer inbox and email a confirmation
 * to the person who submitted the form.
 *
 * @returns {Promise<{
 *   sent: boolean,
 *   confirmationSent: boolean,
 *   channel?: string,
 *   to: string,
 *   error?: string,
 *   preview?: string
 * }>}
 */
async function sendSupportEmail({ name, email, phone, message, username, to }) {
  const inbox = supportInbox(to);
  const subject = `Driver Hub support — from ${name}`;
  const text = buildSupportNotificationText({ name, email, phone, message, username });
  const html = buildSupportNotificationHtml({ name, email, phone, message, username });

  const toDev = await sendMail({ to: inbox, subject, text, html, replyTo: email });
  if (!toDev.sent) {
    return {
      sent: false,
      confirmationSent: false,
      channel: toDev.channel,
      to: inbox,
      error: toDev.error,
      preview: toDev.preview,
    };
  }

  let confirmationSent = false;
  try {
    const confirm = await sendMail({
      to: email,
      subject: "Driver Hub — we received your support request",
      text: buildSupportConfirmationText({ name, supportEmail: inbox }),
      html: buildSupportConfirmationHtml({ name, supportEmail: inbox }),
      replyTo: inbox,
    });
    confirmationSent = Boolean(confirm.sent);
    if (!confirm.sent) {
      console.warn("[mail:support-confirm]", confirm.error || "confirmation not sent");
    }
  } catch (err) {
    console.warn("[mail:support-confirm]", err && err.message ? err.message : err);
  }

  return {
    sent: true,
    confirmationSent,
    channel: toDev.channel,
    to: inbox,
  };
}

async function sendRecoveryEmail({ to, username, resetUrl }) {
  const subject = "Driver Hub — recover your username and password";
  const text = [
    "You requested to recover your Driver Hub account.",
    "",
    `Username: ${username}`,
    "",
    "Open this link to set a new password (expires in 1 hour):",
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
  return sendMail({ to, subject, text });
}

async function sendPasswordAgeEmail({ to, username, changeUrl }) {
  const subject = "Driver Hub — please change your password";
  const text = [
    `Hi ${username},`,
    "",
    "Your Driver Hub password is more than 90 days old.",
    "For security, please choose a new strong password:",
    changeUrl,
    "",
    "You can also change it any time on the Profile tab after signing in to Taxation Hub.",
  ].join("\n");
  return sendMail({ to, subject, text });
}

module.exports = {
  DEFAULT_SUPPORT_EMAIL,
  smtpConfigured,
  resendConfigured,
  mailConfigured,
  supportInbox,
  appBaseUrl,
  sendMail,
  sendRecoveryEmail,
  sendPasswordAgeEmail,
  sendSupportEmail,
  buildSupportNotificationText,
  buildSupportNotificationHtml,
  buildSupportConfirmationText,
  buildSupportConfirmationHtml,
  escapeHtml,
};
