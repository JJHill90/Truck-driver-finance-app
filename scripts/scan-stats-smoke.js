#!/usr/bin/env node
/**
 * Read-only post-deploy check. Logs in with credentials from the environment
 * and fails if Tesseract or HEIC conversion is not available.
 *
 *   SCAN_SMOKE_BASE_URL=https://example.test \
 *   SCAN_SMOKE_USERNAME=... SCAN_SMOKE_PASSWORD=... \
 *   npm run smoke:scan
 *
 * The script never prints those values and does not write ledger data.
 */
const base = String(process.env.SCAN_SMOKE_BASE_URL || process.argv[2] || "").replace(/\/$/, "");
const username = process.env.SCAN_SMOKE_USERNAME || "";
const password = process.env.SCAN_SMOKE_PASSWORD || "";

if (!base || !username || !password) {
  console.error(
    "Set SCAN_SMOKE_BASE_URL, SCAN_SMOKE_USERNAME and SCAN_SMOKE_PASSWORD."
  );
  process.exit(1);
}

function cookiePair(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const line = raw[0] || res.headers.get("set-cookie") || "";
  return String(line).split(";")[0];
}

async function smoke(apiBase) {
  const login = await fetch(`${base}${apiBase}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!login.ok) {
    const text = await login.text();
    throw new Error(`${apiBase} login failed (${login.status}): ${text.slice(0, 180)}`);
  }
  const cookie = cookiePair(login);
  const res = await fetch(`${base}${apiBase}/admin/scan-stats`, {
    headers: { cookie, accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${apiBase} scan-stats failed (${res.status}): ${body.error || "no body"}`);
  }
  const engines = body.engines || {};
  if (engines.tesseract !== "ready") {
    throw new Error(`${apiBase} Tesseract is ${engines.tesseract || "missing"}${engines.tesseractError ? `: ${engines.tesseractError}` : ""}`);
  }
  if (engines.heic !== "ready") {
    throw new Error(`${apiBase} HEIC conversion is ${engines.heic || "missing"}${engines.heicError ? `: ${engines.heicError}` : ""}`);
  }
  console.log(
    `${apiBase} ok — tesseract=${engines.tesseract} heic=${engines.heic} vision=${engines.vision ? "configured" : "off"}`
  );
}

(async () => {
  await smoke("/api/haulage");
  await smoke("/api/suite");
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
