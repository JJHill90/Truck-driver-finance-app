const {
  BROWSE_LINGER_MS,
  isBrowseSafePaymentGate,
  shouldLingerOnView,
  lingerShouldRun,
  lingerPromptPayload,
  hasEofyPacks,
  upgradePlanForPacks,
  haulagePathFromUrl,
} = require("./lib/browse-upgrade");

describe("browse-upgrade prompts", () => {
  it("uses a 30s linger before prompting on Forecast or EOFY", () => {
    expect(BROWSE_LINGER_MS).toBe(30000);
    expect(shouldLingerOnView("forecast")).toBe(true);
    expect(shouldLingerOnView("report")).toBe(true);
    expect(shouldLingerOnView("dashboard")).toBe(false);
    expect(shouldLingerOnView("profile")).toBe(false);
  });

  it("does not linger for Pro users or after a prompt already fired", () => {
    expect(lingerShouldRun({ view: "forecast", isPro: false, alreadyPrompted: false })).toBe(true);
    expect(lingerShouldRun({ view: "report", isPro: false, alreadyPrompted: false })).toBe(true);
    expect(lingerShouldRun({ view: "forecast", isPro: true, alreadyPrompted: false })).toBe(false);
    expect(lingerShouldRun({ view: "forecast", isPro: false, alreadyPrompted: true })).toBe(false);
    expect(lingerShouldRun({ view: "expenses", isPro: false, alreadyPrompted: false })).toBe(false);
  });

  it("treats GET /forecast as browse-safe so opening EOFY or Forecast does not modal", () => {
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/forecast")).toBe(true);
    expect(isBrowseSafePaymentGate("GET", "http://localhost:3000/api/haulage/forecast?mode=realtime")).toBe(
      true
    );
    expect(isBrowseSafePaymentGate("get", "/api/haulage/forecast?mode=manual&projectedIncome=1")).toBe(true);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/report")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/report.pdf")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/fuelhub/forecast")).toBe(false);
    expect(isBrowseSafePaymentGate("POST", "/api/haulage/forecast")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/bas")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/bas.pdf")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/bas.xls")).toBe(false);
    expect(isBrowseSafePaymentGate("GET", "/api/haulage/bas.csv")).toBe(false);
    expect(isBrowseSafePaymentGate("POST", "/api/haulage/accountant-share")).toBe(false);
    expect(haulagePathFromUrl("https://example.test/api/haulage/forecast?fy=2025-26")).toBe("/forecast");
  });

  it("writes linger copy that still lets the tab stay open", () => {
    const forecast = lingerPromptPayload("forecast", {
      priceLabel: "$10/month",
      priceYearlyLabel: "$110/year",
    });
    expect(forecast.code).toBe("PRO_REQUIRED");
    expect(forecast.plan).toBe("pro");
    expect(forecast.error).toMatch(/Forecast/);
    expect(forecast.error).toMatch(/\$10\/month/);

    const report = lingerPromptPayload("report", {
      priceLabel: "$5/month",
      priceYearlyLabel: "$60/year",
    });
    expect(report.error).toMatch(/EOFY report/);
    expect(report.error).toMatch(/PDF/);
  });

  it("sends Suite accountant packs to Pro+ checkout and Taxation Hub packs to Pro", () => {
    expect(hasEofyPacks({ canShareAccountant: true })).toBe(true);
    expect(hasEofyPacks({ isProPlus: true })).toBe(true);
    expect(hasEofyPacks({ isPro: true })).toBe(false);
    expect(upgradePlanForPacks({ product: "suite", isPro: false })).toBe("pro_plus");
    expect(upgradePlanForPacks({ product: "haulage", isPro: false })).toBe("pro");
    expect(upgradePlanForPacks({ product: "suite", canShareAccountant: true })).toBe(null);
  });
});
