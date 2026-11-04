/**
 * Public Driver Hub patch notes (godriverhub.com/patch-notes).
 *
 * Newest first. Each future Driver Hub PR that bumps HAULAGE_PR_NUMBER
 * appends one entry here. The heading is formatVersionLabel(prNumber) —
 * the same ladder as the in-app version label. Summarise only that change.
 * Do not invent older fixes. This log starts at the first entry.
 *
 * Served on the Driver Hub process for godriverhub.com, localhost, and
 * other non-Suite hosts. Not served for APP_PRODUCT=suite, and not on
 * gotaxationsuite.com or gotaxationhub.com.
 */
const fs = require("fs");
const path = require("path");
const { formatVersionLabel } = require("./version");
const { isStandaloneSuite } = require("./suite/product");
const { hostFromRequest: hubHostFromRequest } = require("./driverhub-public-origin");
const { isSuiteOfficialHost } = require("./suite-public-origin");
const { isTaxationHubOfficialHost } = require("./taxationhub-public-origin");

const PAGE_TEMPLATE = path.join(__dirname, "..", "public", "patch-notes-driverhub.html");
const SUPPORT_EMAIL = "support@godriverhub.com";
const ENTRIES_PLACEHOLDER = "<!-- PATCH_NOTES_ENTRIES -->";

/**
 * @type {{ prNumber: number, bullets: string[] }[]}
 * Keep the newest PR at the top. prNumber must match that release's
 * HAULAGE_PR_NUMBER when the note is added.
 */
const PATCH_NOTES = [
  {
    prNumber: 217,
    bullets: [
      "A close receipt still gets a focus attempt when the phone does not report focus, and the saved photo uses the camera's own pixels.",
    ],
  },
  {
    prNumber: 216,
    bullets: [
      "The camera focuses on the page inside the amber frame instead of jumping to the largest sensor size.",
      "Tap the page if it looks soft. The shutter waits for that focus before the photo is taken.",
    ],
  },
  {
    prNumber: 215,
    bullets: [
      "An open app loads a new version on its own while you are using it.",
      "Delete removes a receipt photo or PDF even when the file is already missing. The ledger amount stays.",
      "An upload that does not store the photo or PDF does not leave an empty card.",
      "Uploading a receipt or payslip that matches a saved entry on the same day and amount asks before it is added again.",
    ],
  },
  {
    prNumber: 214,
    bullets: [
      "Saving a receipt keeps the photo on the disk. A scan no longer drops the file after the amount is stored.",
    ],
  },
  {
    prNumber: 213,
    bullets: [
      "Scan with camera no longer closes by itself and says camera permission is blocked while access is still a prompt, or before the phone has asked.",
      "If camera access was refused, the message explains how to turn Camera on in settings. Upload file is still available.",
    ],
  },
  {
    prNumber: 212,
    bullets: [
      "Receipt photos are copied onto the saved disk before a new version removes the temporary folder.",
      "A photo that was already removed, and is not in a backup, still needs to be uploaded again.",
    ],
  },
  {
    prNumber: 211,
    bullets: [
      "Invoice and receipt photos stay saved when a new version is published.",
      "If a photo went missing after an update and a backup still has it, that file is put back.",
    ],
  },
  {
    prNumber: 208,
    bullets: [
      "Published this public Driver Hub patch notes page at /patch-notes on godriverhub.com.",
      "Each note uses the same version label the app shows (Version .N, then 1.00, 1.01, and so on).",
      "The page lists support@godriverhub.com and the existing Driver Hub contact form, which posts to the current support inbox.",
      "The Driver Hub website overview links here. This is the first public entry — earlier releases are not listed.",
    ],
  },
];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publishedNotes() {
  const seen = new Set();
  const notes = PATCH_NOTES.map((entry) => {
    const prNumber = Math.floor(Number(entry && entry.prNumber));
    if (!Number.isFinite(prNumber) || prNumber <= 0) {
      throw new Error("Patch note prNumber must be a positive integer");
    }
    if (seen.has(prNumber)) {
      throw new Error(`Duplicate patch note for PR ${prNumber}`);
    }
    seen.add(prNumber);
    const bullets = (Array.isArray(entry.bullets) ? entry.bullets : [])
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    if (!bullets.length) {
      throw new Error(`Patch note ${prNumber} needs at least one bullet`);
    }
    return {
      prNumber,
      label: formatVersionLabel(prNumber),
      bullets,
    };
  });
  notes.sort((a, b) => b.prNumber - a.prNumber);
  return notes;
}

function shouldServeDriverHubPatchNotes(req) {
  if (isStandaloneSuite()) return false;
  const host = hubHostFromRequest(req);
  if (isSuiteOfficialHost(host)) return false;
  if (isTaxationHubOfficialHost(host)) return false;
  return true;
}

function renderEntries(notes) {
  const oldest = notes[notes.length - 1];
  const start = `<p class="patch-log-start">This public log starts at ${escapeHtml(oldest.label)}. Earlier Driver Hub releases are not listed.</p>`;
  const articles = notes
    .map((note) => {
      const items = note.bullets.map((line) => `<li>${escapeHtml(line)}</li>`).join("\n");
      return `<article class="patch-note">
          <h2>${escapeHtml(note.label)}</h2>
          <ul>
            ${items}
          </ul>
        </article>`;
    })
    .join("\n");
  return `${start}\n${articles}`;
}

function renderPage() {
  const notes = publishedNotes();
  const template = fs.readFileSync(PAGE_TEMPLATE, "utf8");
  if (!template.includes(ENTRIES_PLACEHOLDER)) {
    throw new Error("Driver Hub patch notes template is missing PATCH_NOTES_ENTRIES");
  }
  return template.replace(ENTRIES_PLACEHOLDER, renderEntries(notes));
}

module.exports = {
  SUPPORT_EMAIL,
  PATCH_NOTES,
  publishedNotes,
  shouldServeDriverHubPatchNotes,
  renderPage,
};
