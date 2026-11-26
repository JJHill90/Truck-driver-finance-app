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
    prNumber: 235,
    date: "2026-11-27",
    items: [
      "A scanned invoice is saved as business income, with the payer, the ABN and the GST on the GST line.",
      "Parking is on the expense category list. A faded photo that cannot be read is left blank for you to check.",
    ],
  },
  {
    prNumber: 234,
    date: "2026-11-26",
    items: [
      "iPhone HEIC photos are converted on the server when the phone cannot do it.",
      "Tax invoices use the invoice date, business or owner-driver income, the GST dollars and the ex-GST amount.",
      "A shop receipt is not treated as an invoice to a customer. A date the scan did not read is left blank.",
    ],
  },
  {
    prNumber: 233,
    date: "2026-11-25",
    items: [
      "Every update is checked by scanning a real receipt photo before it can ship. An empty read cannot pass that check.",
      "A blank photo is reported as a failed read, not as a receipt with no compliance flags.",
    ],
  },
  {
    prNumber: 232,
    date: "2026-11-25",
    items: [
      "Income saves again for salary, business sales and other assessable income. The review card includes GST.",
      "A receipt the scanner cannot read shows as an error, not 'within ATO policy'. HEIC photos convert on the server.",
      "A tax invoice is business income, dated from the invoice date, with ABN, GST and the ex-GST amount. Employee tools over $300 use decline in value.",
    ],
  },
  {
    prNumber: 231,
    date: "2026-11-24",
    items: [
      "A receipt or invoice the scanner cannot read asks you to try again or enter it manually. Sample amounts are not invented.",
      "Phone photos keep their orientation and more detail. The Suite scanner retries if the server is waking up.",
      "An invoice scanned on Expenses is flagged so it can be saved as income. Low-confidence fields are marked for you to check.",
    ],
  },
  {
    prNumber: 230,
    date: "2026-11-24",
    items: [
      "ABNs are read from spaced, dotted and unspaced numbers on receipts and invoices, including the income uploader.",
      "An invoice's taxable income leaves out the GST. The EOFY PDF is branded Go Taxation Suite.",
      "The review banner updates after you add income or expenses. Receipt checks use general wording. A bank line starting with TAX; drops that prefix, and the CSV preview clears after import.",
    ],
  },
  {
    prNumber: 229,
    date: "2026-11-23",
    items: [
      "The EOFY PDF is named suite-eofy and uses Suite categories. Work-car fuel stays on D1. Stationery is not the driver logbook label.",
      "The GST $75,000 tracker counts business income excluding GST. Salary is left out. From 1 July 2026 the $18,201–$45,000 rate is 15%.",
      "The annual salary target counts salary and wages. A business invoice is not added to that percentage.",
      "Bank CSV rows that look personal, such as food delivery, start unticked. Receipt and invoice ABNs, GST, the issue date and the document kind are shown on the scan.",
    ],
  },
  {
    prNumber: 228,
    date: "2026-11-22",
    items: [
      "The primary mod user list loads only after you open that panel. Other people's names and emails are not on the page before then.",
      "BAS G1 and 1A no longer count salary, wages or allowances as GST sales.",
      "Importing a bank CSV stays on the page you were using.",
    ],
  },
  {
    prNumber: 227,
    date: "2026-11-21",
    items: [
      "A possible duplicate asks once whether to save anyway, and an old photo that is not on the ledger no longer blocks the save.",
      "Deleting an expense or income row also removes its photo from the gallery.",
      "The manual expense category list includes Fuel (work car). The vendor warning appears only when the vendor is empty.",
      "The Dashboard counts documents still awaiting approval. Support mail uses the Suite address.",
    ],
  },
  {
    prNumber: 226,
    date: "2026-11-20",
    items: [
      "Approving an invoice finishes, or shows an error, instead of freezing on Saving remittance.",
      "Saved expenses, including fuel, stay on the Expenses list and can be deleted.",
      "Approving a BP receipt keeps the vendor you can see and stays on Expenses.",
    ],
  },
  {
    prNumber: 225,
    date: "2026-11-19",
    items: [
      "Forecast and the EOFY report name income and deductions with the individual tax return labels.",
    ],
  },
  {
    prNumber: 224,
    date: "2026-11-19",
    items: [
      "Scanning a receipt or invoice sends the photo again. A failed scan no longer tells you to start a local server.",
    ],
  },
  {
    prNumber: 223,
    date: "2026-11-17",
    items: [
      "A tax invoice keeps the customer, the issue date and the GST amount, and you pick an income type before it is saved.",
      "BP, Ampol, Shell, 7-Eleven and Caltex fuel receipts save as Fuel (work car) when that is the category on screen.",
      "The EOFY report shows the $75,000 GST turnover tracker, your tax bracket, and an instant asset write-off flag. The $300 evidence warning stays.",
      "Bank CSV lines for Telstra, Optus, Vodafone and client invoices are suggested before you import them.",
    ],
  },
  {
    prNumber: 222,
    date: "2026-11-06",
    items: [
      "Saving your profile shows green text under each field once that choice is active.",
    ],
  },
  {
    prNumber: 221,
    date: "2026-11-06",
    items: [
      "Expected income on your profile shows on the dashboard and Forecast as how close this year is. Changing registration type, employer or expected income updates that figure straight away.",
      "Your profile introduces you by name as you type, including occupation, registration and GST.",
      "The EOFY report and travel figures pick up registration, occupation, employer and expected income as soon as the profile saves.",
    ],
  },
  {
    prNumber: 220,
    date: "2026-11-04",
    items: [
      "Add receipt puts the photo in the receipt photos and the income document photos straight away. A restart is no longer needed to see that it saved.",
    ],
  },
  {
    prNumber: 219,
    date: "2026-11-04",
    items: [
      "The live scan picture focuses on the receipt or invoice inside the amber frame, and a tap on the page refocuses it.",
    ],
  },
  {
    prNumber: 218,
    date: "2026-11-04",
    items: [
      "The camera picture on screen uses the full preview, so a receipt stays sharp.",
      "Autofocus stays with the camera. A guessed focus distance is no longer applied.",
    ],
  },
  {
    prNumber: 217,
    date: "2026-11-04",
    items: [
      "A close receipt or invoice still gets a focus attempt when the camera does not report focus, and the saved photo uses the camera's own pixels.",
    ],
  },
  {
    prNumber: 216,
    date: "2026-11-04",
    items: [
      "The camera focuses on the page inside the amber frame instead of jumping to the largest sensor size.",
      "Tap the page if it looks soft. The shutter waits for that focus before the photo is taken.",
    ],
  },
  {
    prNumber: 215,
    date: "2026-11-04",
    items: [
      "An open app loads a new version on its own while you are using it.",
      "Delete removes a receipt photo or PDF even when the file is already missing. The amount in the ledger stays.",
      "A photo or PDF that does not save on the server is not left behind as an empty card. Upload that document again.",
      "Uploading a receipt or payslip that matches a saved entry on the same day and amount asks before it is added again.",
    ],
  },
  {
    prNumber: 214,
    date: "2026-11-04",
    items: [
      "Saving a receipt keeps the photo or PDF on the server disk. The amount is no longer stored without the file.",
      "A document that already says the photo is missing still needs to be uploaded once. Later updates keep that file.",
    ],
  },
  {
    prNumber: 213,
    date: "2026-11-03",
    items: [
      "Scan with camera stays open while camera access is still a prompt. It closes and explains how to turn Camera on only when access was refused.",
    ],
  },
  {
    prNumber: 212,
    date: "2026-11-03",
    items: [
      "Invoice and receipt photos are saved on the server disk with your tax records. A new version no longer leaves them in a temporary container folder.",
      "If a photo is still on the server or in a backup, it is put back. A photo that was already removed needs to be uploaded again.",
    ],
  },
  {
    prNumber: 211,
    date: "2026-11-03",
    items: [
      "Invoice and receipt photos stay on the server when a new version is published.",
      "If a photo went missing after an update and a backup still has it, that file is put back.",
    ],
  },
  {
    prNumber: 210,
    date: "2026-11-03",
    items: [
      "Scan with camera uses an A4-shaped frame so a full invoice page fits, including the corners.",
      "Receipt and Long receipt are still there for a till slip or a longer docket.",
      "The camera keeps focus on the page and asks for a sharper photo.",
    ],
  },
  {
    prNumber: 209,
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
