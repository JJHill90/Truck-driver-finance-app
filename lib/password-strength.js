/**
 * Password strength scoring for Haulage registration / reset / change.
 * Based on common strong-password practice: length, character classes,
 * avoidance of very common passwords, and not embedding the username.
 */

const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password123",
    "123456",
    "12345678",
    "123456789",
    "1234567890",
    "qwerty",
    "qwerty123",
    "abc123",
    "abcdef",
    "admin",
    "admin123",
    "letmein",
    "welcome",
    "welcome1",
    "monkey",
    "dragon",
    "master",
    "login",
    "princess",
    "football",
    "baseball",
    "iloveyou",
    "sunshine",
    "whatever",
    "trustno1",
    "passw0rd",
    "password!",
    "haulage",
    "haulage1",
    "haulage_admin",
    "truckdriver",
    "truck123",
    "changeme",
    "secret",
    "secret123",
    "default",
  ].map((s) => s.toLowerCase())
);

const MIN_LENGTH = 8;
const STRONG_LENGTH = 12;

/**
 * @returns {{
 *   score: number,
 *   label: "weak"|"fair"|"strong",
 *   ok: boolean,
 *   hints: string[],
 *   message: string
 * }}
 */
function scorePassword(password, username = "") {
  const pwd = String(password || "");
  const hints = [];
  let score = 0;

  if (pwd.length >= MIN_LENGTH) score += 1;
  else hints.push(`Use at least ${MIN_LENGTH} characters`);

  if (pwd.length >= STRONG_LENGTH) score += 1;
  else if (pwd.length >= MIN_LENGTH) hints.push(`Aim for ${STRONG_LENGTH}+ characters for a strong password`);

  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
  else hints.push("Mix uppercase and lowercase letters");

  if (/\d/.test(pwd)) score += 1;
  else hints.push("Include at least one number");

  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  else hints.push("Include a symbol (e.g. ! ? # $)");

  const lower = pwd.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    score = Math.min(score, 1);
    hints.push("Avoid common passwords like “password123”");
  }

  const uname = String(username || "")
    .trim()
    .toLowerCase();
  if (uname && uname.length >= 3 && lower.includes(uname)) {
    score = Math.min(score, 1);
    hints.push("Don’t include your username in the password");
  }

  if (/(.)\1{3,}/.test(pwd)) {
    score = Math.max(0, score - 1);
    hints.push("Avoid long repeated characters");
  }

  let label = "weak";
  if (score >= 5) label = "strong";
  else if (score >= 3) label = "fair";

  // Registration / reset require at least "fair".
  const ok = score >= 3 && pwd.length >= MIN_LENGTH && !COMMON_PASSWORDS.has(lower);

  let message;
  if (label === "strong") message = "Strong password — good to go.";
  else if (label === "fair") message = "Fair password — consider making it stronger.";
  else message = "Weak password — please choose a stronger one.";

  return { score, label, ok, hints: [...new Set(hints)].slice(0, 4), message };
}

function assertStrongEnoughPassword(password, username = "") {
  const result = scorePassword(password, username);
  if (!result.ok) {
    const detail = result.hints.length ? ` ${result.hints[0]}.` : "";
    throw new Error(`Please choose a stronger password.${detail}`);
  }
  return result;
}

module.exports = {
  scorePassword,
  assertStrongEnoughPassword,
  COMMON_PASSWORDS,
  MIN_LENGTH,
  STRONG_LENGTH,
};
