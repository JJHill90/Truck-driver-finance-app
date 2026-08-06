/**
 * Support contact form: validate payloads and persist messages under data/.
 * Email delivery is handled by lib/mail.js when SMTP is configured.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const MESSAGES_FILE = path.join(DATA_DIR, "support-messages.json");

const DEFAULT_SUPPORT_EMAIL = "hilljj1990@gmail.com";
const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_PHONE = 40;
const MAX_MESSAGE = 4000;

function supportInbox() {
  return String(process.env.SUPPORT_EMAIL || DEFAULT_SUPPORT_EMAIL).trim() || DEFAULT_SUPPORT_EMAIL;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadMessages() {
  ensureDataDir();
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.messages)) return data.messages;
    }
  } catch {
    /* fall through */
  }
  return [];
}

function saveMessages(list) {
  ensureDataDir();
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ messages: list }, null, 2), "utf8");
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
function validateContact(body = {}) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const message = String(body.message || "").trim();

  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_NAME) return { ok: false, error: "Name is too long." };
  if (!email) return { ok: false, error: "Please enter an email so we can reply." };
  if (email.length > MAX_EMAIL) return { ok: false, error: "Email is too long." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  if (phone.length > MAX_PHONE) return { ok: false, error: "Phone number is too long." };
  if (!message) return { ok: false, error: "Please enter a message." };
  if (message.length > MAX_MESSAGE) {
    return { ok: false, error: "Message is too long (max about 4000 characters)." };
  }

  return {
    ok: true,
    data: { name, email, phone, message },
  };
}

/**
 * Resolve the signed-in username from Express auth middleware.
 * Sessions store a bare username string (`req.user === "JJHill90"`), not an
 * object — reading `.username` would always look signed-out.
 *
 * @param {string|{username?: string}|null|undefined} user
 * @returns {string|null}
 */
function sessionUsername(user) {
  if (user == null) return null;
  if (typeof user === "string") {
    const trimmed = user.trim();
    return trimmed || null;
  }
  if (typeof user === "object" && user.username != null) {
    const trimmed = String(user.username).trim();
    return trimmed || null;
  }
  return null;
}

/**
 * Persist a support enquiry and return the stored record.
 */
function saveContactMessage({ name, email, phone, message, username }) {
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name,
    email,
    phone: phone || "",
    message,
    username: sessionUsername(username),
  };
  const list = loadMessages();
  list.push(entry);
  // Keep a reasonable rolling history.
  const trimmed = list.length > 500 ? list.slice(list.length - 500) : list;
  saveMessages(trimmed);
  return entry;
}

function mailtoHref({ name, email, phone, message }) {
  const to = supportInbox();
  const subject = `Haulage Finance support — from ${name}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    "",
    message,
  ]
    .filter((line) => line != null)
    .join("\n");
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

module.exports = {
  DEFAULT_SUPPORT_EMAIL,
  supportInbox,
  sessionUsername,
  validateContact,
  saveContactMessage,
  loadMessages,
  mailtoHref,
};
