/**
 * ATO-aligned GST activity statement worksheet PDF (pdfkit).
 * Working paper for transcription into the ATO Business Portal — not a lodged BAS.
 */
const PDFDocument = require("pdfkit");

const INK = "#101828";
const MUTED = "#667085";
const LINE = "#e4e7ec";
const ACCENT = "#b45309";
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
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const identity = pack.identity || {};
  const period = pack.period || {};

  function ensureSpace(h) {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
  }

  function heading(text) {
    ensureSpace(36);
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
    ensureSpace(22);
    doc.x = left;
    doc.font("Helvetica-Oblique").fontSize(7.8).fillColor(MUTED).text(text, { width: contentWidth });
    doc.font("Helvetica").fillColor(INK);
  }

  function table(headers, rows, widths, aligns) {
    const rowH = 16;
    const drawRow = (cells, opts) => {
      ensureSpace(rowH + 2);
      const y = doc.y;
      const totalW = widths.reduce((a, b) => a + b, 0);
      if (opts.fill) {
        doc.save();
        doc.rect(left, y, totalW, rowH).fill(opts.fill);
        doc.restore();
      }
      let x = left;
      doc
        .font(opts.header || opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(opts.header ? 8 : 8.2)
        .fillColor(opts.header ? MUTED : opts.ink || INK);
      cells.forEach((c, i) => {
        doc.text(String(c), x + 3, y + 4, {
          width: widths[i] - 6,
          align: aligns[i] || "left",
          lineBreak: false,
          ellipsis: true,
        });
        x += widths[i];
      });
      doc.moveTo(left, y + rowH).lineTo(left + totalW, y + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + rowH;
    };
    drawRow(headers, { header: true });
    rows.forEach((r) => drawRow(r.cells, r));
    doc.y += 4;
    doc.x = left;
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

  ensureSpace(42);
  doc.save();
  doc.rect(left, doc.y + 6, contentWidth, 34).fill(WARN_FILL);
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(WARN_INK)
    .text("Not a lodged BAS", left + 8, doc.y + 10, { width: contentWidth - 16 });
  doc
    .font("Helvetica")
    .fontSize(7.6)
    .fillColor(WARN_INK)
    .text(
      "Use this worksheet to complete your activity statement. Lodge on the ATO Business Portal, through a registered agent, or on the paper form.",
      left + 8,
      doc.y + 1,
      { width: contentWidth - 16 }
    );
  doc.y += 12;
  doc.x = left;

  heading("Entity");
  table(
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
  table(["Box", "Description", "Amount"], boxRows, [70, contentWidth - 190, 120], ["left", "left", "right"]);
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
    ensureSpace(16);
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
    table(
      ["Quarter", "Lodge by", "G1", "1A", "G11", "1B", "9"],
      qRows,
      [90, 72, 68, 62, 68, 62, contentWidth - 422],
      ["left", "left", "right", "right", "right", "right", "right"]
    );
  }

  heading("Record counts");
  table(
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

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
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
    doc.text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 32, {
      width: contentWidth,
      align: "right",
    });
  }

  return doc;
}

module.exports = { buildBasWorksheetPdf };
