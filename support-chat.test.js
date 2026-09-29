const { answerQuestion, buildArticles } = require("./lib/support-chat");

describe("support chat companion", () => {
  it("answers truck-driver meal / LAFHA rates from the FY tables", () => {
    const res = answerQuestion("What is the meal allowance for truck drivers?", {
      product: "haulage",
      financialYear: "2025-26",
      supportEmail: "support@godriverhub.com",
    });
    expect(res.ok).toBe(true);
    expect(res.handoff).toBe(false);
    expect(res.answer).toMatch(/TD 2025\/4/);
    expect(res.answer).toMatch(/\$31\.15/);
    expect(res.answer).toMatch(/\$128\.00/);
    expect(res.answer).toMatch(/not tax, financial or legal advice/i);
  });

  it("answers cents-per-km from the year-aware car rate", () => {
    const res = answerQuestion("How do I claim car kilometres?", {
      product: "haulage",
      financialYear: "2025-26",
    });
    expect(res.ok).toBe(true);
    expect(res.handoff).toBe(false);
    expect(res.answer).toMatch(/\$0\.88/);
    expect(res.answer).toMatch(/5,000/);
  });

  it("answers receipt substantiation thresholds", () => {
    const res = answerQuestion("Do I need a receipt for work expenses?", {
      product: "haulage",
      financialYear: "2025-26",
    });
    expect(res.ok).toBe(true);
    expect(res.answer).toMatch(/\$300\.00/);
    expect(res.answer).toMatch(/\$150\.00/);
  });

  it("uses Tables 1–3 for Suite travel questions", () => {
    const res = answerQuestion("What are the work travel meal rates?", {
      product: "suite",
      financialYear: "2025-26",
    });
    expect(res.ok).toBe(true);
    expect(res.answer).toMatch(/Tables 1–3/);
    expect(res.answer).not.toMatch(/Table 5 sets reasonable meal amounts/);
  });

  it("hands unknown or out-of-scope topics to support email", () => {
    const res = answerQuestion("How do I report bitcoin on my tax return?", {
      product: "haulage",
      supportEmail: "support@godriverhub.com",
    });
    expect(res.ok).toBe(true);
    expect(res.handoff).toBe(true);
    expect(res.answer).toMatch(/support@godriverhub\.com/);
    expect(res.answer).toMatch(/bitcoin/i);
    expect(res.prompt).toMatch(/bitcoin/i);
  });

  it("rejects an empty question", () => {
    const res = answerQuestion("   ");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/question/i);
  });

  it("builds haulage articles for the requested year", () => {
    const articles = buildArticles({ product: "haulage", financialYear: "2026-27" });
    const meals = articles.find((a) => a.id === "meals-lafha");
    expect(meals.body).toMatch(/TD 2026\/4/);
    expect(meals.body).toMatch(/\$132\.50/);
  });
});
