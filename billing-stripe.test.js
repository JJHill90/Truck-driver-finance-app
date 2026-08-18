const { applySubscriptionToUser } = require("./lib/billing-stripe");

describe("applySubscriptionToUser", () => {
  it("stores cancel_at_period_end so Pro benefits can continue until period end", () => {
    const user = { username: "dave", plan: "free" };
    applySubscriptionToUser(user, {
      id: "sub_123",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: Math.floor(new Date("2026-09-15T00:00:00Z").getTime() / 1000),
      customer: "cus_abc",
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    });
    expect(user.plan).toBe("pro");
    expect(user.subscriptionStatus).toBe("active");
    expect(user.cancelAtPeriodEnd).toBe(true);
    expect(user.stripeSubscriptionId).toBe("sub_123");
    expect(user.stripeCustomerId).toBe("cus_abc");
    expect(user.subscriptionInterval).toBe("month");
    expect(user.currentPeriodEnd).toBe("2026-09-15T00:00:00.000Z");
  });

  it("clears cancelAtPeriodEnd when Stripe resumes renewal", () => {
    const user = {
      username: "dave",
      plan: "pro",
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: "sub_123",
    };
    applySubscriptionToUser(user, {
      id: "sub_123",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: Math.floor(new Date("2026-10-15T00:00:00Z").getTime() / 1000),
    });
    expect(user.cancelAtPeriodEnd).toBe(false);
  });
});
