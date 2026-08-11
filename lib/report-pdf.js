/**
 * Builds an accountant-ready EOFY ledger PDF (pdfkit) for a tax return working
 * paper: taxpayer profile, income schedule, work-related deduction schedule by
 * ATO label (D1–D5), detailed transaction ledgers, tax estimate and ATO
 * reasonable-amount / substantiation notes. First-party; uses year-correct rates.
 */
const PDFDocument = require("pdfkit");
const { getFinancialYearForDate, getCategoryMeta } = require("./ato-standards");
const { calcIncomeAssessability } = require("./tax-calculator");
const { deductionForYear } = require("./historical-rates");

function categoryLabel(id) {
  const meta = getCategoryMeta(id);
  return (meta && meta.label) || String(id || "").replace(/_/g, " ");
}

function money(n) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + s;
}

function fyLabel(fy) {
  return String(fy || "").replace("-", "\u2013");
}

const INK = "#101828";
const MUTED = "#667085";
const LINE = "#e4e7ec";
const ACCENT = "#b45309";

function buildReportPdf(report, records, fy) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const s = report.summary;
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  function ensureSpace(h) {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
  }

  function heading(text) {
    ensureSpace(40);
    doc.moveDown(0.6);
    doc.x = left;
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(text);
    doc.moveTo(left, doc.y + 2).lineTo(left + contentWidth, doc.y + 2).lineWidth(1).strokeColor(ACCENT).stroke();
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  }

  function note(text) {
    ensureSpace(24);
    doc.x = left;
    doc.font("Helvetica-Oblique").fontSize(7.8).fillColor(MUTED).text(text, { width: contentWidth });
    doc.font("Helvetica").fillColor(INK);
  }

  // Generic table: headers[], rows[{cells,bold}], widths[], aligns[]
  function table(headers, rows, widths, aligns) {
    const rowH = 15;
    const drawRow = (cells, opts) => {
      ensureSpace(rowH + 2);
      const y = doc.y;
      let x = left;
      doc
        .font(opts.header || opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts.header ? 8 : 8)
        .fillColor(opts.header ? MUTED : INK);
      cells.forEach((c, i) => {
        doc.text(String(c), x + 3, y + 3.5, { width: widths[i] - 6, align: aligns[i] || "left", lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.moveTo(left, y + rowH).lineTo(left + widths.reduce((a, b) => a + b, 0), y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + rowH;
    };
    drawRow(headers, { header: true });
    rows.forEach((r) => drawRow(r.cells, r));
    doc.y += 4;
    // Cells are drawn at explicit x offsets, which leaves doc.x at the last
    // column. Reset to the left margin so the following heading/note/paragraph
    // text starts from the left instead of the right side of the page.
    doc.x = left;
    doc.font("Helvetica").fillColor(INK);
  }

  // ---- Header ----------------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text("EOFY Performance Statement");
  doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text("Tax return working paper \u2014 prepared for a registered tax agent");
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(INK).text(`Australian financial year ${fyLabel(fy)}`);
  doc.fontSize(8.5).fillColor(MUTED).text(
    `Generated ${new Date(report.generatedAt || Date.now()).toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      timeZoneName: "short",
    })}`
  );

  // ---- Taxpayer profile ------------------------------------------------
  const d = report.driver || {};
  heading("Taxpayer / driver profile");
  const profileRows = [
    { cells: ["Name", d.name || "\u2014"] },
    { cells: ["Employer / payer", d.employer || "\u2014"] },
    { cells: ["ABN", d.abn || "\u2014"] },
    { cells: ["Driver type", String(d.driverType || "\u2014").replace(/_/g, " ")] },
    { cells: ["TFN supplied to employer", d.tfnSupplied ? "Yes" : "No"] },
    { cells: ["Salary band (travel allowance table)", (s.profile && s.profile.salaryBand ? s.profile.salaryBand.replace("band", "Band ") : "\u2014")] },
  ];
  table(["Field", "Detail"], profileRows, [200, contentWidth - 200], ["left", "left"]);

  // ---- Income schedule --------------------------------------------------
  heading("Assessable income (return income labels)");
  const incRows = (s.income.breakdown || []).map((b) => ({
    cells: [b.label, money(b.grossTotal), money(b.assessableTotal)],
  }));
  if (!incRows.length) incRows.push({ cells: [`No income recorded for FY ${fyLabel(fy)}`, "", ""] });
  incRows.push({ cells: ["Total assessable income", money(s.income.grossTotal), money(s.income.assessableTotal)], bold: true });
  table(["Income type", "Gross", "Assessable"], incRows, [contentWidth - 220, 110, 110], ["left", "right", "right"]);
  note("Include assessable income at the relevant labels on your return (e.g. item 1 Salary or wages; item 2 Allowances, earnings, tips). Allowances shown as assessable only where a related deduction is claimed.");

  // ---- Deduction schedule by ATO label ---------------------------------
  heading("Work-related deductions by ATO schedule (D1\u2013D5)");
  const dedRows = (s.expenses.breakdown || []).map((b) => ({
    cells: [b.label, b.atoSchedule || "\u2014", String(b.count), money(b.deductibleTotal)],
  }));
  if (!dedRows.length) dedRows.push({ cells: [`No deductions recorded for FY ${fyLabel(fy)}`, "", "", ""] });
  dedRows.push({ cells: ["Total deductions", "", "", money(s.expenses.deductibleTotal)], bold: true });
  table(["Category", "ATO schedule", "Items", "Deductible"], dedRows, [contentWidth - 250, 130, 45, 75], ["left", "left", "right", "right"]);
  note("ATO deduction labels: D1 Work-related car; D2 Work-related travel; D3 Work-related clothing, laundry & dry-cleaning; D4 Self-education; D5 Other work-related expenses. Amounts are the work-related (deductible) portion after apportionment.");

  // ---- Detailed expense ledger -----------------------------------------
  const fyExpenses = (records.expenses || []).filter((e) => getFinancialYearForDate(e.date) === fy);
  heading("Expense ledger (detail)");
  const expLedger = fyExpenses
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((e) => ({
      cells: [
        e.date || "",
        e.vendor || "\u2014",
        categoryLabel(e.category),
        (getCategoryMeta(e.category) && getCategoryMeta(e.category).atoSchedule ? String(getCategoryMeta(e.category).atoSchedule).split(" ")[0] : "\u2014"),
        money(e.amount),
        `${e.workUsePercent == null ? 100 : e.workUsePercent}%`,
        money(deductionForYear(e, fy).deductibleAmount),
      ],
    }));
  if (!expLedger.length) expLedger.push({ cells: ["\u2014", "No expense transactions", "", "", "", "", ""] });
  table(
    ["Date", "Vendor", "Category", "Sch.", "Amount", "Work", "Deductible"],
    expLedger,
    [58, 96, 118, 40, 60, 33, contentWidth - 405],
    ["left", "left", "left", "left", "right", "right", "right"]
  );

  // ---- Detailed income ledger ------------------------------------------
  const fyIncome = (records.income || []).filter((i) => getFinancialYearForDate(i.date) === fy);
  heading("Income ledger (detail)");
  const incLedger = fyIncome
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((i) => ({
      cells: [
        i.date || "",
        i.payer || i.entity || "\u2014",
        String(i.type || "").replace(/_/g, " "),
        money(i.grossTotal != null ? i.grossTotal : i.amount),
        money(calcIncomeAssessability(i).assessable),
      ],
    }));
  if (!incLedger.length) incLedger.push({ cells: ["\u2014", "No income transactions", "", "", ""] });
  table(
    ["Date", "Payer / entity", "Type", "Gross", "Assessable"],
    incLedger,
    [62, 150, 130, 85, contentWidth - 427],
    ["left", "left", "left", "right", "right"]
  );

  // ---- Tax estimate ----------------------------------------------------
  heading("Tax estimate");
  const t = s.taxEstimate || {};
  const taxRows = [
    { cells: ["Taxable income (assessable less deductions)", money(t.taxableIncome)] },
    { cells: ["Income tax", money(t.incomeTax)] },
    { cells: ["Medicare levy (2%)", money(t.medicareLevy)] },
  ];
  if (t.budgetRepairLevy) taxRows.push({ cells: ["Temporary Budget Repair Levy", money(t.budgetRepairLevy)] });
  taxRows.push({ cells: ["Total estimated tax", money(t.totalTax)], bold: true });
  taxRows.push({ cells: ["Effective rate", `${Number(t.effectiveRate || 0).toFixed(2)}%`] });
  table(["Item", "Amount"], taxRows, [contentWidth - 150, 150], ["left", "right"]);
  note(`Tax computed using the resident individual rates and levies for FY ${fyLabel(t.ratesFinancialYear || fy)}. Excludes offsets (e.g. LITO), HELP/HECS and private health considerations.`);

  // ---- ATO reasonable amounts ------------------------------------------
  const a = s.allowances || {};
  const meals = a.truckDriverMealsDaily || {};
  heading("ATO reasonable amounts & allowances (truck drivers)");
  const capRows = [
    { cells: ["Breakfast (reasonable amount)", money(meals.breakfast && meals.breakfast.cap)] },
    { cells: ["Lunch (reasonable amount)", money(meals.lunch && meals.lunch.cap)] },
    { cells: ["Dinner (reasonable amount)", money(meals.dinner && meals.dinner.cap)] },
    { cells: ["Overtime meal (reasonable amount)", money(a.overtimeMealCap)] },
  ];
  if (a.domesticTravelCaps) {
    capRows.push({ cells: ["Domestic travel \u2013 accommodation (daily)", money(a.domesticTravelCaps.accommodation)] });
    capRows.push({ cells: ["Domestic travel \u2013 incidentals (daily)", money(a.domesticTravelCaps.incidentals)] });
  }
  table(["Allowance", "Daily amount"], capRows, [contentWidth - 150, 150], ["left", "right"]);
  note("Reasonable amounts (per the relevant year's Taxation Determination) are a substantiation exception under Subdivision 900-B of the ITAA 1997. You may claim only what you actually incurred; a travel diary / work (fatigue) diary supports the claim. Meal amounts are per meal and cannot be aggregated or transferred between meals.");

  // ---- Substantiation & records ----------------------------------------
  heading("Substantiation & record-keeping");
  const sub = s.substantiation || {};
  doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(`\u2022 ${sub.message || "Keep records for all expenses."}`, { width: contentWidth });
  doc.text("\u2022 Written evidence (receipts/invoices) is required where total work-related deductions exceed $300.", { width: contentWidth });
  doc.text("\u2022 Retain records for five years from the date you lodge your return.", { width: contentWidth });
  doc.text("\u2022 Reimbursed amounts are not deductible; salary-sacrificed / employer-provided items are excluded.", { width: contentWidth });
  if (s.warnings && s.warnings.length) {
    doc.moveDown(0.2).font("Helvetica-Bold").fontSize(8.5).fillColor(ACCENT).text("Review items:");
    doc.font("Helvetica").fillColor(INK);
    s.warnings.slice(0, 8).forEach((w) => doc.text(`\u2022 ${w.message}`, { width: contentWidth }));
  }

  // ---- Disclaimer + page numbers ---------------------------------------
  doc.moveDown(0.6);
  note(report.disclaimer || "Estimates only \u2014 not tax advice.");
  note("This working paper is not a tax return and has not been lodged with the ATO. Provide it to your registered tax agent for review.");

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // allow writing in the bottom margin without paginating
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
      `FinanceHub EOFY working paper \u2014 FY ${fyLabel(fy)} \u2014 page ${i + 1} of ${range.count}`,
      left,
      doc.page.height - 26,
      { width: contentWidth, align: "center", lineBreak: false }
    );
    doc.page.margins.bottom = savedBottom;
  }
  doc.flushPages();

  return doc;
}

module.exports = { buildReportPdf };
