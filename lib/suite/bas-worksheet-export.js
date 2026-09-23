/**
 * Excel / CSV export of the GST activity statement worksheet.
 * SpreadsheetML 2003 opens in Excel, Google Sheets and LibreOffice.
 */
const { basDownloadStem } = require("./bas-pack");

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function moneyPlain(n) {
  return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function worksheetRows(pack = {}) {
  const identity = pack.identity || {};
  const period = pack.period || {};
  const rows = [
    ["GST activity statement worksheet"],
    ["Working paper — copy these ATO boxes when you lodge. This is not a lodged BAS."],
    [],
    ["Field", "Value"],
    ["Legal name", identity.name || ""],
    ["Trading name", identity.tradingName || ""],
    ["ABN", identity.abnFormatted || identity.abn || ""],
    ["GST registered", identity.gstRegistered ? "Yes" : "No"],
    ["Entity type", identity.entityType || ""],
    ["Financial year", pack.financialYear || ""],
    ["Period", pack.quarterLabel || ""],
    ["Period start", period.startLabel || period.start || ""],
    ["Period end", period.endLabel || period.end || ""],
    ["Lodge by", period.dueDateLabel || period.dueDate || ""],
    ["Generated", pack.generatedAt || ""],
    [],
    ["ATO box", "Description", "Amount (AUD)"],
  ];
  for (const box of pack.boxes || []) {
    rows.push([box.atoBox || box.id, box.label, moneyPlain(box.amount)]);
  }
  rows.push([]);
  rows.push(["Net GST (signed)", "", moneyPlain(pack.netGst)]);
  rows.push(["GST-free sales", "", moneyPlain(pack.gstFreeSales)]);
  rows.push(["GST-free purchases", "", moneyPlain(pack.gstFreePurchases)]);
  rows.push(["Income rows", "", String(pack.incomeCount || 0)]);
  rows.push(["Expense rows", "", String(pack.expenseCount || 0)]);
  rows.push([]);
  rows.push(["How to lodge"]);
  for (const step of (pack.lodgement && pack.lodgement.howToLodge) || []) {
    rows.push([step]);
  }
  rows.push([]);
  rows.push(["Important", pack.note || ""]);

  if (Array.isArray(pack.quarterly) && pack.quarterly.length) {
    rows.push([]);
    rows.push(["Quarterly breakdown"]);
    rows.push(["Quarter", "Lodge by", "G1", "1A", "G11", "1B", "9"]);
    for (const q of pack.quarterly) {
      rows.push([
        q.shortLabel || q.label,
        (q.period && (q.period.dueDateLabel || q.period.dueDate)) || "",
        moneyPlain(q.sales),
        moneyPlain(q.gstOnSales),
        moneyPlain(q.purchases),
        moneyPlain(q.gstOnPurchases),
        moneyPlain(q.netGst),
      ]);
    }
  }
  return rows;
}

function buildBasWorksheetCsv(pack = {}) {
  const lines = worksheetRows(pack).map((row) => row.map(csvEscape).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function cellXml(value, index) {
  const text = value == null ? "" : String(value);
  const isNum = text !== "" && /^-?\d+(\.\d+)?$/.test(text);
  const type = isNum ? "Number" : "String";
  return `<Cell ss:Index="${index + 1}"><Data ss:Type="${type}">${xmlEscape(text)}</Data></Cell>`;
}

function buildBasWorksheetExcel(pack = {}) {
  const rows = worksheetRows(pack)
    .map((row) => {
      const cells = row.map((value, i) => cellXml(value, i)).join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");
  return [
    '<?xml version="1.0"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    "<Styles>",
    '<Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="11"/></Style>',
    "</Styles>",
    '<Worksheet ss:Name="BAS worksheet">',
    `<Table>${rows}</Table>`,
    "</Worksheet>",
    "</Workbook>",
    "",
  ].join("\n");
}

function basExportFilename(pack, ext, product = "suite") {
  return `${basDownloadStem(pack, product)}.${ext}`;
}

module.exports = {
  worksheetRows,
  buildBasWorksheetCsv,
  buildBasWorksheetExcel,
  basExportFilename,
};
