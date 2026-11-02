/**
 * Public patch notes for https://gotaxationsuite.com/updates.
 *
 * Newest first. The first entry must use HAULAGE_PR_NUMBER — bump the version
 * and add that release's summary in the same change, before it ships to Render.
 * Bullets are what a driver or taxpayer sees, not commit titles.
 */
const { HAULAGE_PR_NUMBER, formatVersionLabel } = require("./version");

const PATCH_NOTES = [
  {
    prNumber: 207,
    date: "2026-11-03",
    items: [
      "This Updates page lists each version shipped to Go Taxation Suite, with a short summary of what changed.",
      "Questions about an update can go to support@godriverhub.com or the contact form on this page.",
    ],
  },
  {
    prNumber: 206,
    date: "2026-11-03",
    items: [
      "Add receipt, Edit and Delete on the ledgers use the same text colour and weight as Refresh invoice dates.",
      "Delete is a brighter red, so it is easier to see beside the other row buttons.",
      "Ledger text and the buttons on each row are easier to read.",
      "The Android app takes one photo at a time with the camera or the system photo picker. It does not ask for access to the whole photo library.",
      "When a scan finishes on the server, the phone shows those totals instead of an older read.",
    ],
  },
  {
    prNumber: 201,
    date: "2026-10-25",
    items: [
      "Income gallery thumbnails load from the saved document, including PDF payslips.",
      "A failed PDF read no longer leaves a blank stub saved on the remittance.",
    ],
  },
  {
    prNumber: 199,
    date: "2026-10-25",
    items: [
      "Open and download a receipt or payslip without leaving the app.",
      "Open PDF sits in the receipt viewer header.",
    ],
  },
  {
    prNumber: 198,
    date: "2026-10-25",
    items: [
      "EOFY PDF tables wrap long fields so the text is not cut off.",
      "PDF headings stay with the table row that follows them.",
    ],
  },
  {
    prNumber: 196,
    date: "2026-10-25",
    items: [
      "Fixed a freeze when opening the app that came from the lodgement brief refreshing in a loop.",
    ],
  },
  {
    prNumber: 195,
    date: "2026-10-25",
    items: [
      "You can start on Pro+ from the plan screen without buying Pro first.",
    ],
  },
  {
    prNumber: 194,
    date: "2026-10-25",
    items: [
      "Pro+ accountant packs include a taxpayer briefing for PAYG, sole trader and partnership.",
    ],
  },
  {
    prNumber: 193,
    date: "2026-10-25",
    items: [
      "The lodgement brief on the accountant pack follows the entity type and is included for Pro+.",
    ],
  },
];

function versionLabel(prNumber) {
  return formatVersionLabel(prNumber);
}

function listPatchNotes() {
  return PATCH_NOTES.map((note) => ({
    prNumber: note.prNumber,
    date: note.date,
    version: versionLabel(note.prNumber),
    items: note.items.slice(),
  }));
}

function currentPatchNote() {
  return listPatchNotes()[0] || null;
}

module.exports = {
  PATCH_NOTES,
  HAULAGE_PR_NUMBER,
  versionLabel,
  listPatchNotes,
  currentPatchNote,
};
