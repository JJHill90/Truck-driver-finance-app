const {
  answerQuestion,
  tokenize,
  suggestedPrompts,
  SUPPORT_EMAIL,
  DISCLAIMER,
} = require("./lib/tax-companion");

describe("tax companion", () => {
  it("answers ordinary-employee work travel meals from TD tables", () => {
    const res = answerQuestion("What is the reasonable amount for overnight work travel meals?", {
      product: "suite",
    });
    expect(res.answered).toBe(true);
    expect(res.topicId).toBe("work-travel-meals");
    expect(res.answer).toMatch(/Tables 1–3/);
    expect(res.answer).toMatch(/not tax advice/i);
    expect(res.mailto).toBeNull();
  });

  it("answers D1 cents per kilometre", () => {
    const res = answerQuestion("Can I claim car expenses cents per km?", { product: "suite" });
    expect(res.answered).toBe(true);
    expect(res.topicId).toBe("car-cents-km");
    expect(res.answer).toMatch(/5,000/);
  });

  it("answers home office PCG 2023/1", () => {
    const res = answerQuestion("working from home office hourly rate", { product: "suite" });
    expect(res.answered).toBe(true);
    expect(res.topicId).toBe("home-office");
    expect(res.answer).toMatch(/PCG 2023\/1/);
  });

  it("answers GST / BAS worksheet on Suite", () => {
    const res = answerQuestion("How do I fill in the BAS worksheet for GST?", { product: "suite" });
    expect(res.answered).toBe(true);
    expect(res.topicId).toBe("gst-bas");
    expect(res.answer).toMatch(/does not lodge a BAS/);
  });

  it("answers overtime meal on both products", () => {
    const suite = answerQuestion("overtime meal allowance amount", { product: "suite" });
    const hub = answerQuestion("overtime meal allowance amount", { product: "haulage" });
    expect(suite.topicId).toBe("overtime-meal");
    expect(hub.topicId).toBe("overtime-meal");
  });

  it("uses truck Table 5 meals on Taxation Hub", () => {
    const res = answerQuestion("truck driver travel allowance meals", { product: "haulage" });
    expect(res.answered).toBe(true);
    expect(res.topicId).toBe("truck-meals");
    expect(res.answer).toMatch(/Table 5/);
  });

  it("does not use truck Table 5 on Suite", () => {
    const res = answerQuestion("truck driver travel allowance meals", { product: "suite" });
    expect(res.topicId).not.toBe("truck-meals");
  });

  it("falls back to support email when it cannot match", () => {
    const res = answerQuestion("What is the capital gains discount on my crypto from 2014?", {
      product: "suite",
    });
    expect(res.answered).toBe(false);
    expect(res.email).toBe(SUPPORT_EMAIL);
    expect(res.answer).toMatch(/support@godriverhub\.com/);
    expect(res.mailto).toMatch(/^mailto:support@godriverhub\.com/);
    expect(res.mailto).toMatch(/crypto/);
  });

  it("tokenizes questions without stop words", () => {
    expect(tokenize("What can I claim for meals?")).toEqual(expect.arrayContaining(["claim", "meals"]));
  });

  it("keeps the standard disclaimer text", () => {
    expect(DISCLAIMER).toMatch(/not tax advice/);
    expect(DISCLAIMER).toMatch(/not an official ATO product/);
  });

  it("lists product-specific suggested prompts", () => {
    expect(suggestedPrompts("suite")).toEqual(expect.arrayContaining(["Overnight work travel meals"]));
    expect(suggestedPrompts("haulage")).toEqual(expect.arrayContaining(["Truck driver meal amounts"]));
  });

  it("is wired into both app shells", () => {
    const fs = require("fs");
    const path = require("path");
    const hub = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
    const suite = fs.readFileSync(path.join(__dirname, "public/suite/index.html"), "utf8");
    expect(hub).toMatch(/companion\.js/);
    expect(suite).toMatch(/companion\.js/);
  });

  it("uses the Suite companion welcome blurb", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "public/companion.js"), "utf8");
    expect(src).toMatch(
      /Hi I'm the companion chat for \$\{brand\}, I can answer any general taxation questions regarding expenses, income, or allowances/
    );
    expect(src).toMatch(/I can quick search anything related to ATO policies/);
    expect(src).toMatch(/link support@godriverhub\.com/);
  });
});
