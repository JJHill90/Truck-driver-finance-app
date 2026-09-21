/**
 * Free users may open Forecast and EOFY and look around.
 * Payment prompts fire on a paid-feature click, or after lingering on the tab.
 */

const BROWSE_LINGER_MS = 30000;
const BROWSE_VIEWS = ["forecast", "report"];

function requestMethod(method) {
  return String(method || "GET").toUpperCase();
}

function haulagePathFromUrl(url) {
  const raw = String(url || "");
  const match = raw.match(/\/api\/haulage(\/[^?#]*)?/);
  if (!match) return "";
  return match[1] || "/";
}

/**
 * 402s that fire just because a tab opened or /report refreshed live forecast.
 * Feature clicks (PDF, JSON, BAS, share, extra entity, Recalculate) stay promptable.
 */
function isBrowseSafePaymentGate(method, url) {
  const m = requestMethod(method);
  if (m !== "GET") return false;
  const path = haulagePathFromUrl(url);
  if (!path) {
    const raw = String(url || "");
    if (/\/api\/haulage\/fuelhub\/forecast\b/.test(raw)) return false;
    return /\/api\/haulage\/forecast(?:\/|\?|$)/.test(raw);
  }
  if (path === "/fuelhub/forecast" || path.startsWith("/fuelhub/forecast/")) return false;
  return path === "/forecast" || path.startsWith("/forecast/");
}

function shouldLingerOnView(view) {
  return BROWSE_VIEWS.includes(String(view || ""));
}

function lingerShouldRun({ view, isPro, alreadyPrompted }) {
  if (!shouldLingerOnView(view)) return false;
  if (isPro) return false;
  if (alreadyPrompted) return false;
  return true;
}

function lingerPromptPayload(view, entitlements) {
  const price = (entitlements && entitlements.priceLabel) || "$5/month";
  const yearly = (entitlements && entitlements.priceYearlyLabel) || "$60/year";
  if (view === "forecast") {
    return {
      error: `You've been looking at Forecast. Live numbers unlock with Pro (${price} or ${yearly}).`,
      code: "PRO_REQUIRED",
      plan: "pro",
      entitlements,
    };
  }
  return {
    error: `You've been looking at the EOFY report. PDF, JSON export and accountant packs unlock with Pro (${price} or ${yearly}).`,
    code: "PRO_REQUIRED",
    plan: "pro",
    entitlements,
  };
}

function hasEofyPacks(ent) {
  return Boolean(
    ent && (ent.canShareAccountant || ent.canBasPack || ent.canYearCompare || ent.isProPlus)
  );
}

/** Which checkout tier a locked accountant-pack button should open. */
function upgradePlanForPacks(ent) {
  if (hasEofyPacks(ent)) return null;
  if (ent && ent.product === "suite") return "pro_plus";
  return "pro";
}

module.exports = {
  BROWSE_LINGER_MS,
  BROWSE_VIEWS,
  requestMethod,
  haulagePathFromUrl,
  isBrowseSafePaymentGate,
  shouldLingerOnView,
  lingerShouldRun,
  lingerPromptPayload,
  hasEofyPacks,
  upgradePlanForPacks,
};
