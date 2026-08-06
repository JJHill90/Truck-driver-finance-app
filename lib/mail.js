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
    "Haulage Finance <onboarding@resend.dev>"
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

function buildSupportNotificationText({ name, email, phone, message, username }) {
  return [
    "New support message from Haulage Finance.",
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : "Phone: (not provided)",
    username ? `Signed-in username: ${username}` : "Signed-in username: (guest / not signed in)",
    "",
    "Message:",
    message,
  ].join("\n");
}

function buildSupportConfirmationText({ name, supportEmail }) {
  return [
    `Hi ${name},`,
    "",
    "Thanks for contacting Haulage Finance support.",
    `Your request has been sent to the developer (${supportEmail}).`,
    "We’ll reply to this email address as soon as we can.",
    "",
    "— Haulage Finance",
  ].join("\n");
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
  const subject = `Haulage Finance support — from ${name}`;
  const text = buildSupportNotificationText({ name, email, phone, message, username });

  const toDev = await sendMail({ to: inbox, subject, text, replyTo: email });
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
      subject: "Haulage Finance — we received your support request",
      text: buildSupportConfirmationText({ name, supportEmail: inbox }),
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
  const subject = "Haulage Finance — recover your username and password";
  const text = [
    "You requested to recover your Haulage Finance account.",
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
  const subject = "Haulage Finance — please change your password";
  const text = [
    `Hi ${username},`,
    "",
    "Your Haulage Finance password is more than 90 days old.",
    "For security, please choose a new strong password:",
    changeUrl,
    "",
    "You can also change it any time on the Profile tab after signing in.",
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
  buildSupportConfirmationText,
};
