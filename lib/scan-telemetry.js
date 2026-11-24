/**
 * Scan outcomes only. Never store images, names, ABNs or amounts.
 */
const events = [];
const MAX = 200;

function recordScan(event) {
  const row = {
    at: new Date().toISOString(),
    product: event.product === "suite" ? "suite" : "haulage",
    ok: Boolean(event.ok),
    errorType: String(event.errorType || (event.ok ? "" : "unreadable")).slice(0, 80),
    durationMs: Math.max(0, Math.round(Number(event.durationMs) || 0)),
    bytes: Math.max(0, Math.round(Number(event.bytes) || 0)),
    mime: String(event.mime || "").slice(0, 40),
  };
  events.push(row);
  if (events.length > MAX) events.shift();
  if (!row.ok || row.durationMs > 20000) {
    console.warn(`scan ${JSON.stringify(row)}`);
  }
  return row;
}

function scanStats() {
  const failed = events.filter((row) => !row.ok).length;
  const slow = events.filter((row) => row.durationMs > 20000).length;
  return { total: events.length, failed, slow };
}

module.exports = { recordScan, scanStats };
