/**
 * Pro+ taxpayer briefing PDF for a registered tax agent.
 * Registration-aware working paper — not a lodged return and not tax advice.
 */
const PDFDocument = require("pdfkit");
const { INK, MUTED, ACCENT, pageMetrics, ensureSpace, table, banner, drawFooters } = require("./pdf-layout");

const WARN_FILL = "#fef3c7";
const WARN_INK = "#92400e";
const HAVE_FILL = "#ecfdf3";
const MISS_FILL = "#fef3f2";
const UNKNOWN_FILL = "#fffbeb";

function money(n) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? "-$" : "$") + s;
}

function fyLabel(fy) {
  return String(fy || "").replace("-", "\u2013") || "\u2014";
}

function dash(value) {
  const s = value == null ? "" : String(value).trim();
  return s || "\u2014";
}

function statusFill(status) {
  if (status === "have") return HAVE_FILL;
  if (status === "missing") return MISS_FILL;
  return UNKNOWN_FILL;
}

function buildAccountantPackPdf(pack = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const { left, contentWidth } = pageMetrics(doc);
  const identity = pack.identity || {};
  const registration = pack.registration || {};
  const income = pack.income || {};
  const deductions = pack.deductions || {};
  const totals = pack.totals || {};
  const payg = pack.payg || {};
  const travel = pack.travel || {};
  const checklist = pack.checklist || {};

  function heading(text) {
    ensureSpace(doc, 58);
    doc.moveDown(0.45);
    doc.x = left;
    doc.font("Helvetica-Bold").fontSize(11.5).fillColor(INK).text(text);
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(left + contentWidth, doc.y + 2)
      .lineWidth(1)
      .strokeColor(ACCENT)
      .stroke();
    doc.moveDown(0.35);
    doc.font("Helvetica").fontSize(8.5).fillColor(INK);
  }

  function note(text) {
    if (!text) return;
    ensureSpace(doc, 22);
    doc.x = left;
    doc.font("Helvetica-Oblique").fontSize(7.8).fillColor(MUTED).text(text, { width: contentWidth });
    doc.font("Helvetica").fillColor(INK);
  }

  function paragraph(text) {
    if (!text) return;
    ensureSpace(doc, 20);
    doc.x = left;
    doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(text, { width: contentWidth });
  }

  doc.font("Helvetica-Bold").fontSize(17).fillColor(INK).text("Taxpayer briefing for your tax agent");
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor(MUTED)
    .text("Individual-return working paper \u2014 not a lodged return and not tax advice");
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor(INK).text(`Australian financial year ${fyLabel(pack.financialYear)}`);
  doc
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      `Generated ${new Date(pack.generatedAt || Date.now()).toLocaleString("en-AU", {
        timeZone: "Australia/Sydney",
        timeZoneName: "short",
      })} \u00b7 ${registration.label || "Taxpayer"}`
    );

  banner(doc, {
    body:
      pack.disclaimer ||
      "Prepared for a registered tax agent. Verify every figure against source records and the ATO income statement.",
    fill: WARN_FILL,
    ink: WARN_INK,
    bodySize: 7.8,
  });

  heading("Registration and identity (from Profile)");
  const identityRows = [
    { cells: ["Registration", dash(registration.label)] },
    { cells: ["Legal name", dash(identity.name)] },
    { cells: ["Occupation", dash(identity.occupation || registration.driverTypeLabel)] },
    { cells: ["TFN stored in the app", identity.tfnSupplied ? "Not stored \u2014 profile says TFN is with the employer" : "Not stored"] },
  ];
  if (registration.id === "employee") {
    identityRows.push({ cells: ["PAYG employer", dash(identity.employer)] });
    identityRows.push({
      cells: ["Annual salary on Profile", identity.annualSalary ? money(identity.annualSalary) : "\u2014"],
    });
  }
  if (registration.id === "sole_trader") {
    identityRows.push({ cells: ["Trading name", dash(identity.tradingName || identity.employer)] });
    identityRows.push({ cells: ["ABN", dash(identity.abn)] });
    identityRows.push({ cells: ["GST registered", identity.gstRegistered ? "Yes" : "Not marked"] });
  }
  if (registration.id === "partnership") {
    identityRows.push({ cells: ["Partnership", dash(identity.partnershipName)] });
    identityRows.push({ cells: ["Your distribution share", `${identity.partnerSharePercent || 50}%`] });
    identityRows.push({ cells: ["ABN", dash(identity.abn)] });
  }
  if (identity.licenceClass) identityRows.push({ cells: ["Licence class", identity.licenceClass.toUpperCase()] });
  if (identity.workVehicle) identityRows.push({ cells: ["Work vehicle", dash(identity.workVehicle)] });
  if (identity.cars && identity.cars.length) {
    identity.cars.forEach((car, i) => {
      const bits = [car.make, car.model, car.registration && `Rego ${car.registration}`, car.active && "Active"]
        .filter(Boolean)
        .join(" ");
      identityRows.push({
        cells: [
          i === 0 ? "Work cars" : "",
          `${bits || "Vehicle"} \u00b7 work-use ${car.workUsePercent != null ? `${car.workUsePercent}%` : "\u2014"}`,
        ],
      });
    });
  }
  table(doc, ["Field", "Detail"], identityRows, [200, contentWidth - 200], ["left", "left"]);
  note(registration.description);
  if (registration.notes) note(registration.notes);

  heading("Return totals");
  const payableLabel =
    payg.direction === "refund"
      ? "Estimated refund (PAYG minus tax)"
      : payg.direction === "pay"
        ? "Estimated tax payable"
        : "Tax payable / refund";
  table(doc, 
    ["Figure", "Amount"],
    [
      { cells: ["Assessable income", money(totals.assessableIncome)] },
      { cells: ["Deductible expenses", money(totals.deductibleExpenses)] },
      { cells: ["Taxable income", money(totals.taxableIncome)] },
      { cells: ["Estimated tax (incl. Medicare)", money(totals.estimatedTax)] },
      { cells: ["PAYG withheld", money(totals.paygWithheld)] },
      {
        cells: [payableLabel, money(payg.direction === "refund" ? payg.refundEstimate : totals.taxPayable)],
        bold: true,
      },
    ],
    [contentWidth - 120, 120],
    ["left", "right"]
  );
  if (travel.daysClaimed) {
    note(
      `Work travel / LAFHA days on file: ${travel.daysClaimed} (${travel.determination || "ATO meal rate"}). Confirm against payslips.`
    );
  }

  heading("Income mapped to individual-return labels");
  const incRows = (income.items || []).map((row) => ({
    cells: [`Item ${row.item}`, row.label, String(row.count), money(row.grossTotal), money(row.assessableTotal)],
  }));
  if (!incRows.length) incRows.push({ cells: ["\u2014", "No income recorded for this year", "", "", ""] });
  incRows.push({
    cells: ["", "Total assessable", "", money(income.grossTotal), money(income.assessableTotal)],
    bold: true,
  });
  table(doc, 
    ["Item", "Label", "Rows", "Gross", "Assessable"],
    incRows,
    [70, contentWidth - 310, 50, 95, 95],
    ["left", "left", "right", "right", "right"]
  );
  note(income.note);
  if (income.reimbursements) note(`Reimbursements excluded from assessable income: ${money(income.reimbursements)}.`);

  if ((income.payers || []).length) {
    heading("Payers / employers");
    table(doc, 
      ["Payer", "Rows", "Assessable", "PAYG withheld"],
      income.payers.map((p) => ({
        cells: [p.payer, String(p.count), money(p.assessableTotal), money(p.paygWithheld)],
      })),
      [contentWidth - 260, 50, 105, 105],
      ["left", "right", "right", "right"]
    );
  }

  heading("Deductions by ATO schedule");
  const dedRows = (deductions.schedules || []).map((row) => ({
    cells: [row.id, row.label, String(row.count), money(row.deductibleTotal)],
  }));
  if (!dedRows.length) dedRows.push({ cells: ["\u2014", "No deductions recorded for this year", "", ""] });
  dedRows.push({
    cells: ["", "Total deductible", "", money(deductions.deductibleTotal)],
    bold: true,
  });
  table(doc, 
    ["Schedule", "Label", "Rows", "Deductible"],
    dedRows,
    [70, contentWidth - 215, 50, 95],
    ["left", "left", "right", "right"]
  );
  note(deductions.note);
  if (deductions.noReceiptCount) {
    note(`${deductions.noReceiptCount} row(s) marked no receipt \u2014 agent should confirm substantiation.`);
  }

  if ((deductions.categories || []).length) {
    heading("Deduction categories (working paper)");
    table(doc, 
      ["Category", "ATO schedule", "Rows", "Deductible"],
      deductions.categories.slice(0, 18).map((c) => ({
        cells: [c.label, c.atoSchedule || "\u2014", String(c.count), money(c.deductibleTotal)],
      })),
      [contentWidth - 285, 140, 50, 95],
      ["left", "left", "right", "right"]
    );
  }

  heading("Still needed from the taxpayer");
  const checkRows = (checklist.items || []).map((item) => ({
    cells: [item.status === "have" ? "Have" : item.status === "missing" ? "Missing" : "Ask", item.label, item.detail],
    fill: statusFill(item.status),
  }));
  if (!checkRows.length) checkRows.push({ cells: ["\u2014", "No checklist items", ""] });
  table(doc, ["Status", "Item", "Detail"], checkRows, [70, 190, contentWidth - 260], ["left", "left", "left"]);
  note(
    `${checklist.haveCount || 0} on file \u00b7 ${checklist.missingCount || 0} missing \u00b7 ${checklist.unknownCount || 0} for the agent to collect (private health, HELP, spouse, TFN are never stored here).`
  );

  heading("Notes for the registered agent");
  (pack.agentNotes || []).forEach((line) => paragraph(`\u2022  ${line}`));

  drawFooters(doc, (pageIndex, pageCount) => {
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Taxpayer briefing \u00b7 FY ${fyLabel(pack.financialYear)} \u00b7 page ${pageIndex + 1} of ${pageCount} \u00b7 not a lodged return`,
        left,
        doc.page.height - 28,
        { width: contentWidth, align: "left" }
      );
  });

  return doc;
}

module.exports = { buildAccountantPackPdf };
