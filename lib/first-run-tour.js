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
      title: `Welcome to ${app}`,
      body: "A short first look at the tabs you will use. Tap Next to move through each highlight.",
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
      id: "dash-allowances",
      view: "dashboard",
      target: "#allowance-caps",
      title: "Overnight and caps",
      body: "Travel nights and meal/accommodation caps sit here when you have away-from-home work.",
    },
    {
      id: "exp-nav",
      view: "expenses",
      target: '.nav-btn[data-view="expenses"]',
      title: "Expenses",
      body: "Work receipts live here. Scan a photo or add a line by hand — both reach the same ledger.",
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
      title: "Approve the total",
      body: "After a scan, this box asks you to approve one overall total. It only hits the ledger when you tap Yes.",
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
      title: "Ledger and reconcile",
      body: "Tick rows and tap Reconcile to lock them. Reconciled lines cannot be edited until unlocked.",
    },
    {
      id: "inc-nav",
      view: "income",
      target: '.nav-btn[data-view="income"]',
      title: "Income",
      body: "Payslips, remittances and invoices. Same pattern as expenses: scan or enter, then approve.",
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
      title: "Approve net pay",
      body: "Payslip scans ask you to approve net pay here. Change the figure if the reader picked the wrong total.",
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
      title: "Income ledger",
      body: "Saved payslips land here. Tick rows and tap Reconcile when they match your bank or employer.",
    },
    {
      id: "rep-nav",
      view: "report",
      target: '.nav-btn[data-view="report"]',
      title: "EOFY report",
      body: "A live working paper for the selected year. It is not lodged with the ATO.",
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
      title: "Car expenses last",
      body: "Use this tab only if you claim a car. It is last so you still know it exists.",
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
