/**
 * First-run coach-mark tour (Taxation Hub / Go Taxation Suite).
 * Self-register sets firstRunTour: "pending". The overlay cannot be skipped,
 * but closing the tab or logging out ends it — it does not return.
 */
const STATUS_PENDING = "pending";
const STATUS_DONE = "done";

function isPending(user) {
  if (!user) return false;
  if (user.isAdmin) return false;
  if (user.needsFirstRunTour === true) return true;
  return user.firstRunTour === STATUS_PENDING;
}

function applyOnSelfRegister(user) {
  if (!user) return user;
  user.firstRunTour = STATUS_PENDING;
  return user;
}

function applyOnAdminCreate(user) {
  if (!user) return user;
  user.firstRunTour = STATUS_DONE;
  return user;
}

function markDone(user) {
  if (!user) return user;
  user.firstRunTour = STATUS_DONE;
  user.firstRunTourCompletedAt = new Date().toISOString();
  return user;
}

function shouldStart({ needsFirstRunTour, fuelhubOpen, authLocked, sessionActive }) {
  if (fuelhubOpen || authLocked) return false;
  if (sessionActive) return true;
  return Boolean(needsFirstRunTour);
}

function listSteps({ product } = {}) {
  const suite = product === "suite";
  const app = suite ? "Go Taxation Suite" : "Taxation Hub";
  return [
    {
      id: "dash-welcome",
      view: "dashboard",
      target: '.nav-btn[data-view="dashboard"]',
      press: true,
      title: `Welcome to ${app}`,
      body: "Tap the highlighted Dashboard tab. Each first look points at one control — follow the glow in order.",
    },
    {
      id: "dash-stats",
      view: "dashboard",
      target: "#stat-grid",
      title: "Live totals",
      body: "These cards track income in hand, deductions and spend as you save records. Empty on day one is normal.",
    },
    {
      id: "dash-charts",
      view: "dashboard",
      target: ".dashboard-charts",
      title: "Snapshot charts",
      body: "Pies update from your ledgers. Use them as a glance check, not as a lodged return.",
    },
    {
      id: "dash-nights",
      view: "dashboard",
      target: "#dashboard-overnight-box",
      title: "Travel days",
      body: "Nights away fill in from payslip travel lines. Empty until you approve a slip is normal.",
    },
    {
      id: "dash-allowances",
      view: "dashboard",
      target: "#allowance-caps",
      title: "Allowance caps",
      body: "Meal, accommodation and incidental caps sit here for away-from-home work.",
    },
    {
      id: "exp-nav",
      view: "expenses",
      target: '.nav-btn[data-view="expenses"]',
      press: true,
      title: "Expenses",
      body: "Tap Expenses. Work receipts live here — scan a photo or add a line by hand.",
    },
    {
      id: "exp-upload",
      view: "expenses",
      target: "#upload-zone",
      title: "Scan a receipt",
      body: "Camera or file. Keep vendor, date and the total in frame so the reader can pick them up.",
    },
    {
      id: "exp-guide",
      view: "expenses",
      target: ".receipt-photo-guide-gif",
      prepare: "open-guide",
      title: "How to shoot it",
      body: "Watch this clip once. Fit the top of the slip and the date, then capture. Copy that every time.",
    },
    {
      id: "exp-confirm",
      view: "expenses",
      target: "#scan-result",
      prepare: "show-scan-confirm",
      press: true,
      title: "Approve the total",
      body: "After a scan, tap Yes on the overall total. Nothing is saved during this look — try the button.",
    },
    {
      id: "exp-manual",
      view: "expenses",
      target: "#manual-receipt-form",
      title: "No photo",
      body: "Type the date, category and amount. Tick no-receipt when you will match it to a statement later.",
    },
    {
      id: "exp-ledger",
      view: "expenses",
      target: "#expense-list",
      prepare: "show-reconcile",
      press: true,
      title: "Ledger and reconcile",
      body: "Tick real rows later, then tap Reconcile to lock them. Try the highlighted button now — it will not lock anything.",
    },
    {
      id: "inc-nav",
      view: "income",
      target: '.nav-btn[data-view="income"]',
      press: true,
      title: "Income",
      body: "Tap Income. Payslips and remittances use the same scan-or-enter, then approve pattern.",
    },
    {
      id: "inc-upload",
      view: "income",
      target: "#income-upload-zone",
      title: "Scan a payslip",
      body: "Drop a payslip or remittance here. We look for net pay and the pay period when the scan is clear.",
    },
    {
      id: "inc-confirm",
      view: "income",
      target: "#income-scan-result",
      prepare: "show-income-confirm",
      press: true,
      title: "Approve net pay",
      body: "Tap Approve on net pay. Change the figure later if the reader picked the wrong total. Not saved now.",
    },
    {
      id: "inc-form",
      view: "income",
      target: "#income-form",
      title: "Enter pay by hand",
      body: "Net pay is the figure that counts. Add overnight nights when the slip shows travel days.",
    },
    {
      id: "inc-ledger",
      view: "income",
      target: "#income-list",
      prepare: "show-reconcile",
      press: true,
      title: "Income ledger",
      body: "Saved payslips land here. Tap Reconcile when they match your bank — try the button; nothing locks yet.",
    },
    {
      id: "rep-nav",
      view: "report",
      target: '.nav-btn[data-view="report"]',
      press: true,
      title: "EOFY report",
      body: "Tap EOFY Report. It is a live working paper for the year — not lodged with the ATO.",
    },
    {
      id: "rep-content",
      view: "report",
      target: "#report-content",
      title: "On-screen statement",
      body: "Income, deductions and an estimate stay in the app on Free. Look around — we will not block this tab now.",
    },
    {
      id: "rep-export",
      view: "report",
      target: ".report-action-buttons",
      title: "PDF and accountant pack",
      body: "Download PDF or JSON for you or your accountant. Export is a Pro extra; you can still see the buttons.",
    },
    {
      id: "rep-share",
      view: "report",
      target: "#accountant-share-create",
      optional: true,
      title: "Forward to an accountant",
      body: "A read-only share link and BAS worksheet sit here. Paid packs unlock later — this is just the layout.",
    },
    {
      id: "car-nav",
      view: "car-expenses",
      target: '.nav-btn[data-view="car-expenses"]',
      press: true,
      title: "Car expenses last",
      body: "Tap Car Expenses last — only if you claim a car. It is here so you still know the tab exists.",
    },
    {
      id: "car-method",
      view: "car-expenses",
      target: "#car-claim-method-box",
      title: "Cents/km or logbook",
      body: "ATO D1 lives here, plus fuel and running costs. Work-use % comes from your vehicle profile.",
    },
  ];
}

module.exports = {
  STATUS_PENDING,
  STATUS_DONE,
  isPending,
  applyOnSelfRegister,
  applyOnAdminCreate,
  markDone,
  shouldStart,
  listSteps,
};
