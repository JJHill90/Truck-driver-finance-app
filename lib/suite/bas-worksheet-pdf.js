/**
 * ATO-aligned GST activity statement worksheet PDF (pdfkit).
 * Working paper for transcription into the ATO Business Portal — not a lodged BAS.
 */
const PDFDocument = require("pdfkit");
const { INK, MUTED, ACCENT, pageMetrics, ensureSpace, table, banner, drawFooters } = require("../pdf-layout");

const NAVY = "#1e3a5f";
const WARN_FILL = "#fef3c7";
const WARN_INK = "#92400e";

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

function buildBasWorksheetPdf(pack = {}) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const { left, contentWidth } = pageMetrics(doc);
  const identity = pack.identity || {};
  const period = pack.period || {};

  function heading(text) {
    ensureSpace(doc, 36);
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
    ensureSpace(doc, 22);
    doc.x = left;
    doc.font("Helvetica-Oblique").fontSize(7.8).fillColor(MUTED).text(text, { width: contentWidth });
    doc.font("Helvetica").fillColor(INK);
  }

  doc.font("Helvetica-Bold").fontSize(16).fillColor(NAVY).text("GST activity statement worksheet");
  doc
    .font("Helvetica")
    .fontSize(9.2)
    .fillColor(MUTED)
    .text("Business Activity Statement working paper \u2014 copy these ATO boxes when you lodge");
  doc.moveDown(0.25);
  doc.fontSize(10).fillColor(INK).text(`${pack.quarterLabel || "Period"} \u00b7 Australian financial year ${fyLabel(pack.financialYear)}`);
  if (period.startLabel && period.endLabel) {
    doc.fontSize(8.6).fillColor(INK).text(`Tax period ${period.startLabel} to ${period.endLabel}`);
  }
  if (period.dueDateLabel) {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(NAVY)
      .text(`Lodge by ${period.dueDateLabel}${period.dueDateRolled ? " (next business day)" : ""}`);
    doc.font("Helvetica");
  }
  doc.fontSize(8).fillColor(MUTED).text(
    `Generated ${new Date(pack.generatedAt || Date.now()).toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      timeZoneName: "short",
    })}`
  );

  banner(doc, {
    title: "Not a lodged BAS",
    body: "Use this worksheet to complete your activity statement. Lodge on the ATO Business Portal, through a registered agent, or on the paper form.",
    fill: WARN_FILL,
    ink: WARN_INK,
  });

  heading("Entity");
  table(doc, 
    ["Field", "Detail"],
    [
      { cells: ["Legal name", dash(identity.name)] },
      { cells: ["Trading name", dash(identity.tradingName)] },
      { cells: ["ABN", dash(identity.abnFormatted || identity.abn)] },
      { cells: ["GST registered", identity.gstRegistered ? "Yes" : "No"] },
      { cells: ["Entity type", dash(identity.entityType).replace(/_/g, " ")] },
      { cells: ["Eligible for GST worksheet", pack.eligible ? "Yes" : "Review GST registration"] },
    ],
    [200, contentWidth - 200],
    ["left", "left"]
  );

  heading("ATO BAS boxes (GST)");
  const boxRows = (pack.boxes || []).map((b, i) => ({
    cells: [b.atoBox || b.id, b.label, money(b.amount)],
    bold: b.id === "9",
    fill: i % 2 ? "#f8fafc" : null,
  }));
  table(doc, ["Box", "Description", "Amount"], boxRows, [70, contentWidth - 190, 120], ["left", "left", "right"]);
  note("G1 and G11 are GST-inclusive. 1A and 1B use a stored GST figure or 1/11 of taxable amounts. Box 9 is 1A minus 1B only \u2014 PAYG and other BAS labels are not included. Capital purchases (G10) are not split from G11.");

  if (pack.gstFreeIncomeCount || pack.gstFreeExpenseCount) {
    note(
      `GST-free rows excluded from 1A/1B: ${pack.gstFreeIncomeCount || 0} sales (${money(pack.gstFreeSales)}) and ${pack.gstFreeExpenseCount || 0} purchases (${money(pack.gstFreePurchases)}).`
    );
  }

  if (period.dueDateNote) {
    note(period.dueDateNote);
  }

  heading("How to lodge with the ATO");
  (pack.lodgement && pack.lodgement.howToLodge ? pack.lodgement.howToLodge : []).forEach((step, i) => {
    ensureSpace(doc, 16);
    doc.x = left;
    doc.font("Helvetica").fontSize(8.4).fillColor(INK).text(`${i + 1}. ${step}`, { width: contentWidth });
  });

  if (Array.isArray(pack.quarterly) && pack.quarterly.length) {
    heading("Quarterly breakdown");
    const qRows = pack.quarterly.map((q) => ({
      cells: [
        q.shortLabel || q.label,
        q.period && q.period.dueDateLabel ? q.period.dueDateLabel : "\u2014",
        money(q.sales),
        money(q.gstOnSales),
        money(q.purchases),
        money(q.gstOnPurchases),
        money(q.netGst),
      ],
    }));
    table(doc, 
      ["Quarter", "Lodge by", "G1", "1A", "G11", "1B", "9"],
      qRows,
      [90, 72, 68, 62, 68, 62, contentWidth - 422],
      ["left", "left", "right", "right", "right", "right", "right"]
    );
  }

  heading("Record counts");
  table(doc, 
    ["Field", "Detail"],
    [
      { cells: ["Income rows", String(pack.incomeCount || 0)] },
      { cells: ["Expense rows", String(pack.expenseCount || 0)] },
      { cells: ["GST fraction", pack.gstFraction || "1/11"] },
      { cells: ["Accounting method", dash(pack.accountingMethodNote)] },
    ],
    [160, contentWidth - 160],
    ["left", "left"]
  );

  heading("Important");
  note(pack.note || "");

  drawFooters(doc, (pageIndex, pageCount) => {
    doc
      .font("Helvetica")
      .fontSize(7.2)
      .fillColor(MUTED)
      .text(
        "Working paper only \u2014 lodge the activity statement with the ATO. Not tax advice.",
        left,
        doc.page.height - 32,
        { width: contentWidth, align: "left" }
      );
    doc.text(`Page ${pageIndex + 1} of ${pageCount}`, left, doc.page.height - 32, {
      width: contentWidth,
      align: "right",
    });
  });

  return doc;
}

module.exports = { buildBasWorksheetPdf };
