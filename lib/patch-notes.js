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
    prNumber: 232,
    bullets: [
      "A receipt photo is read on the server even when no cloud vision key is set. A failed read is an error, not a 'no compliance flags' message.",
      "iPhone HEIC photos convert on the server. A tax invoice keeps its invoice date, ABN, GST and invoice number, and the amount that counts is ex-GST.",
      "An expense keeps the date you or the receipt set. The EOFY briefing updates after you delete entries. Owner-driver invoice income counts toward the GST tracker.",
    ],
  },
  {
    prNumber: 231,
    bullets: [
      "A receipt the scanner cannot read says to try again or enter it manually. It no longer fills in a sample roadhouse.",
      "Phone photos keep their orientation and more detail. Diesel litres, the ABN and the date are taken from what is printed.",
      "A slow or failed scan is logged without the photo, and you can retry if the server is waking up.",
    ],
  },
  {
    prNumber: 230,
    bullets: [
      "The expense approve card shows the ABN, the GST and, for diesel, the litres and on-road or off-road choice that BAS 7D uses.",
      "The income page scans invoices into Income, with an ABN field. EOFY updates after you approve income. A new photo is not marked missing from the ledger.",
      "Owner-driver lodgement and the EOFY PDF use business wording. The salary target reads as an income target. Payslip and allowance bank lines start unticked.",
    ],
  },
  {
    prNumber: 229,
    bullets: [
      "The EOFY PDF uses Driver Hub category names and a haulage-eofy file name. Fuel tax credit is calculated only after litres and on-road or off-road use are entered.",
      "The salary target and forecast year-to-date salary count salary and wages. Business income is shown separately. The GST tracker uses business income excluding GST, with thousands separators.",
      "The lodgement title follows the income on file when owner-driver or business income is present. Travel allowance days name meal receipts and CSV allowance rows, not only payslips.",
      "Deleting a ledger row removes the row and its photo. Delete photo only removes the file. Receipt scans show the allowance in words, and ABNs on receipts and invoices are filled in.",
    ],
  },
  {
    prNumber: 228,
    bullets: [
      "The primary mod user list loads only after that panel is opened. Other people's names and emails are not placed on the page before then.",
      "An owner-driver invoice no longer shows expected super or a daily allowance, and GST is left out of taxable income when the invoice charges it.",
    ],
  },
  {
    prNumber: 227,
    bullets: [
      "A possible duplicate asks once whether to save anyway. Photos that are not on the ledger no longer block the save.",
      "Deleting a ledger row also removes its photo. Approving a receipt stays on Expenses and updates the saved count.",
      "Diesel receipts ask for litres and on-road or off-road use, and the fuel tax credit is BAS label 7D.",
      "Owner-driver invoices are not flagged for super or PAYG. Tolls sit under work-related travel. Overnight meals show the TD 2026/4 allowance. A GST $75,000 tracker counts business income.",
    ],
  },
  {
    prNumber: 226,
    bullets: [
      "Approving an invoice finishes, or shows an error, instead of freezing on Saving remittance.",
      "Saved expenses stay on the Expenses list, and the saved count updates with them.",
      "BAS G1 and 1A leave out salary, wages and allowances.",
    ],
  },
  {
    prNumber: 225,
    bullets: [
      "Forecast and the EOFY report name income and deductions with the individual tax return labels, including travel meals as work-related travel.",
    ],
  },
  {
    prNumber: 224,
    bullets: [
      "Scanning a receipt or invoice sends the photo again. A failed scan on the live site no longer says to start a local server.",
    ],
  },
  {
    prNumber: 223,
    bullets: [
      "Tax invoices use the bill-to party, the issue date and the GST dollar amount, and ask for an income type before they join the ledger.",
      "Truck fuel, repairs, tyres, tolls and overnight meals stay on the Hub menus. Suite car-fuel labels no longer appear there.",
      "A daily backup stays on the server. Opening Profile no longer downloads the archive to this browser.",
      "The login screen and the app show the same version.",
    ],
  },
  {
    prNumber: 222,
    bullets: [
      "Saving a profile shows green text under each field once that choice is active.",
    ],
  },
  {
    prNumber: 221,
    bullets: [
      "Profile expected income shows on the dashboard and Forecast as how close this year is to that total. Changing employer, driver type or expected income updates that figure straight away.",
      "Profile introduces you by name as you type, including your employer, licence and work vehicle.",
      "EOFY report, allowance caps and Forecast pick up the name, driver type, employer and salary as soon as the profile saves.",
    ],
  },
  {
    prNumber: 220,
    bullets: [
      "Add receipt puts the photo in Expense receipt photos and Income document photos straight away. A restart is no longer needed to see that it saved.",
    ],
  },
  {
    prNumber: 219,
    bullets: [
      "The live scan picture focuses on the receipt inside the amber frame, and a tap on the slip refocuses it.",
    ],
  },
  {
    prNumber: 218,
    bullets: [
      "The camera picture on screen uses the phone's full preview, so a receipt stays sharp.",
      "Autofocus stays with the camera. A guessed focus distance is no longer applied.",
    ],
  },
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
