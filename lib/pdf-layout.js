/**
 * Shared PDFKit layout for working-paper reports.
 * Table cells wrap and grow instead of clipping or overlapping neighbours.
 */
const INK = "#101828";
const MUTED = "#667085";
const LINE = "#e4e7ec";
const ACCENT = "#b45309";

const FOOTER_RESERVE = 36;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 4;
const MIN_ROW_H = 16;
const LINE_GAP = 1.15;

function pageMetrics(doc) {
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  return { left, contentWidth };
}

function ensureSpace(doc, h) {
  const bottom = doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE;
  if (doc.y + h > bottom) doc.addPage();
}

function cellWidth(widths, i) {
  return Math.max(14, (widths[i] || 0) - CELL_PAD_X * 2);
}

/** Break tokens that are wider than the cell so they cannot paint into the next column. */
function wrapToWidth(doc, text, width) {
  const raw = text == null ? "" : String(text);
  if (!raw || width < 8) return raw;
  if (doc.widthOfString(raw) <= width) return raw;
  return raw
    .split(/(\s+)/)
    .map((token) => {
      if (!token || /^\s+$/.test(token) || doc.widthOfString(token) <= width) return token;
      let out = "";
      let chunk = "";
      for (const ch of token) {
        if (chunk && doc.widthOfString(chunk + ch) > width) {
          out += `${chunk}\n`;
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      return out + chunk;
    })
    .join("");
}

function measureCellHeight(doc, text, width, font, size) {
  doc.font(font).fontSize(size);
  const wrapped = wrapToWidth(doc, text, width);
  return doc.heightOfString(wrapped, { width, lineGap: LINE_GAP });
}

function rowFont(opts) {
  return opts.header || opts.bold ? "Helvetica-Bold" : "Helvetica";
}

function rowSize(opts) {
  return opts.header ? 8 : 8.2;
}

function measureRowHeight(doc, cells, widths, opts) {
  const font = rowFont(opts);
  const size = rowSize(opts);
  let max = MIN_ROW_H - CELL_PAD_Y * 2;
  cells.forEach((c, i) => {
    const h = measureCellHeight(doc, c, cellWidth(widths, i), font, size);
    if (h > max) max = h;
  });
  return Math.max(MIN_ROW_H, Math.ceil(max + CELL_PAD_Y * 2));
}

function drawTableRow(doc, cells, widths, aligns, opts, left) {
  const rowH = measureRowHeight(doc, cells, widths, opts);
  ensureSpace(doc, rowH + 2);
  const y = doc.y;
  const totalW = widths.reduce((a, b) => a + b, 0);
  if (opts.fill) {
    doc.save();
    doc.rect(left, y, totalW, rowH).fill(opts.fill);
    doc.restore();
  }
  const font = rowFont(opts);
  const size = rowSize(opts);
  doc.font(font).fontSize(size).fillColor(opts.header ? MUTED : opts.ink || INK);
  let x = left;
  cells.forEach((c, i) => {
    const w = cellWidth(widths, i);
    const wrapped = wrapToWidth(doc, c, w);
    doc.text(wrapped, x + CELL_PAD_X, y + CELL_PAD_Y, {
      width: w,
      align: aligns[i] || "left",
      lineGap: LINE_GAP,
    });
    x += widths[i];
    doc.y = y;
    doc.x = left;
  });
  doc
    .moveTo(left, y + rowH)
    .lineTo(left + totalW, y + rowH)
    .lineWidth(0.5)
    .strokeColor(LINE)
    .stroke();
  doc.y = y + rowH;
  doc.x = left;
}

function table(doc, headers, rows, widths, aligns) {
  const { left } = pageMetrics(doc);
  const headerH = measureRowHeight(doc, headers, widths, { header: true });
  const firstH = rows[0] ? measureRowHeight(doc, rows[0].cells, widths, rows[0] || {}) : 0;
  ensureSpace(doc, headerH + firstH + 6);
  drawTableRow(doc, headers, widths, aligns, { header: true }, left);
  rows.forEach((r) => drawTableRow(doc, r.cells, widths, aligns, r || {}, left));
  doc.y += 4;
  doc.x = left;
  doc.font("Helvetica").fillColor(INK);
}

function banner(doc, { title, body, fill, ink, titleSize, bodySize }) {
  const { left, contentWidth } = pageMetrics(doc);
  const pad = 8;
  const width = contentWidth - pad * 2;
  let textH = 0;
  if (title) {
    doc.font("Helvetica-Bold").fontSize(titleSize || 8);
    textH += doc.heightOfString(String(title), { width, lineGap: LINE_GAP });
    if (body) textH += 3;
  }
  if (body) {
    doc.font("Helvetica").fontSize(bodySize || 7.6);
    textH += doc.heightOfString(String(body), { width, lineGap: LINE_GAP });
  }
  const h = pad + textH + pad;
  ensureSpace(doc, h + 10);
  const y = doc.y + 4;
  doc.save();
  doc.rect(left, y, contentWidth, h).fill(fill);
  doc.restore();
  let ty = y + pad;
  if (title) {
    doc
      .font("Helvetica-Bold")
      .fontSize(titleSize || 8)
      .fillColor(ink)
      .text(String(title), left + pad, ty, { width, lineGap: LINE_GAP });
    ty = doc.y + 2;
  }
  if (body) {
    doc
      .font("Helvetica")
      .fontSize(bodySize || 7.6)
      .fillColor(ink)
      .text(String(body), left + pad, ty, { width, lineGap: LINE_GAP });
  }
  doc.y = y + h + 8;
  doc.x = left;
  doc.font("Helvetica").fillColor(INK);
}

function drawFooters(doc, render) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    render(i, range.count);
    doc.page.margins.bottom = savedBottom;
  }
}

module.exports = {
  INK,
  MUTED,
  LINE,
  ACCENT,
  FOOTER_RESERVE,
  CELL_PAD_X,
  CELL_PAD_Y,
  MIN_ROW_H,
  pageMetrics,
  ensureSpace,
  wrapToWidth,
  measureRowHeight,
  table,
  banner,
  drawFooters,
};
