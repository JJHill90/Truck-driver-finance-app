/**
 * Optional outbound email for recovery / password reminders.
 * Uses Nodemailer when SMTP_* env vars are set; otherwise logs the message
 * and the API returns a same-origin recoveryUrl so users can still reset.
 */
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  nodemailer = null;
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
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
 * @returns {Promise<{ sent: boolean, preview?: string }>}
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || "noreply@haulage.local";
  const payload = { from, to, subject, text, html: html || text };

  const transport = createTransport();
  if (!transport) {
    console.info("[mail:dev]", JSON.stringify({ to, subject, text }));
    return { sent: false, preview: text };
  }
  await transport.sendMail(payload);
  return { sent: true };
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
  smtpConfigured,
  appBaseUrl,
  sendMail,
  sendRecoveryEmail,
  sendPasswordAgeEmail,
};
