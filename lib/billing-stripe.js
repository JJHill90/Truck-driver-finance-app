/**
 * Stripe Checkout + Customer Portal + webhook for Taxation Hub Pro.
 *
 * Plans:
 *   Taxation Hub / Driver Hub — $5/month or $60/year (AUD)
 *   Go Taxation Suite         — Pro $10/month or $110/year (AUD)
 *                             — Pro+ $18/month or $190/year (AUD)
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_ID                 Driver Hub monthly (preferred)
 *   STRIPE_PRICE_ID_YEARLY          Driver Hub yearly (preferred)
 *   STRIPE_PRICE_ID_SUITE           Suite Pro monthly (preferred)
 *   STRIPE_PRICE_ID_SUITE_YEARLY    Suite Pro yearly (preferred)
 *   STRIPE_PRICE_ID_SUITE_PLUS      Suite Pro+ monthly
 *   STRIPE_PRICE_ID_SUITE_PLUS_YEARLY Suite Pro+ yearly
 *   APP_BASE_URL            success/cancel + portal return URLs
 *
 * Without STRIPE_SECRET_KEY, checkout returns a clear “not configured” error;
 * entitlements/trials still work.
 */
const Stripe = require("stripe");
const {
  pricingForProduct,
  normalizeBillingProduct,
  normalizeCheckoutPlan,
  SUBSCRIPTION_TIER_PRO_PLUS,
} = require("./entitlements");

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
  });
}

function appBaseUrl(req) {
  if (process.env.APP_BASE_URL) return String(process.env.APP_BASE_URL).replace(/\/$/, "");
  if (req && req.headers) {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "http";
    if (host) return `${proto}://${host}`;
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

function normaliseInterval(interval) {
  const v = String(interval || "month").toLowerCase();
  return v === "year" || v === "yearly" || v === "annual" ? "year" : "month";
}

function configuredPriceId(product, interval = "month", plan = "pro") {
  const period = normaliseInterval(interval);
  const isSuite = normalizeBillingProduct(product) === "suite";
  const plus = normalizeCheckoutPlan(plan) === SUBSCRIPTION_TIER_PRO_PLUS;
  if (isSuite && plus) {
    if (period === "year") {
      return String(
        process.env.STRIPE_PRICE_ID_SUITE_PLUS_YEARLY || process.env.GOTAX_STRIPE_PRICE_ID_PLUS_YEARLY || ""
      ).trim();
    }
    return String(process.env.STRIPE_PRICE_ID_SUITE_PLUS || process.env.GOTAX_STRIPE_PRICE_ID_PLUS || "").trim();
  }
  if (isSuite) {
    if (period === "year") {
      return String(process.env.STRIPE_PRICE_ID_SUITE_YEARLY || process.env.GOTAX_STRIPE_PRICE_ID_YEARLY || "").trim();
    }
    return String(process.env.STRIPE_PRICE_ID_SUITE || process.env.GOTAX_STRIPE_PRICE_ID || "").trim();
  }
  if (period === "year") return String(process.env.STRIPE_PRICE_ID_YEARLY || "").trim();
  return String(process.env.STRIPE_PRICE_ID || "").trim();
}

function plusPriceIds() {
  return [
    process.env.STRIPE_PRICE_ID_SUITE_PLUS,
    process.env.STRIPE_PRICE_ID_SUITE_PLUS_YEARLY,
    process.env.GOTAX_STRIPE_PRICE_ID_PLUS,
    process.env.GOTAX_STRIPE_PRICE_ID_PLUS_YEARLY,
  ]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function tierFromSubscription(sub) {
  const meta = sub && sub.metadata;
  const fromMeta = String((meta && (meta.tier || meta.plan)) || "")
    .toLowerCase()
    .replace(/\+/g, "_plus");
  if (fromMeta === SUBSCRIPTION_TIER_PRO_PLUS) return SUBSCRIPTION_TIER_PRO_PLUS;
  const priceId =
    sub &&
    sub.items &&
    sub.items.data &&
    sub.items.data[0] &&
    sub.items.data[0].price &&
    sub.items.data[0].price.id;
  if (priceId && plusPriceIds().includes(String(priceId))) return SUBSCRIPTION_TIER_PRO_PLUS;
  return "pro";
}

async function ensurePriceId(stripe, interval = "month", product = "haulage", plan = "pro") {
  const period = normaliseInterval(interval);
  const plus = normalizeCheckoutPlan(plan) === SUBSCRIPTION_TIER_PRO_PLUS;
  const fromEnv = configuredPriceId(product, period, plus ? SUBSCRIPTION_TIER_PRO_PLUS : "pro");
  if (fromEnv) return fromEnv;

  const prices = pricingForProduct(product);
  const isYear = period === "year";
  const isSuite = prices.product === "suite";
  const usePlus = isSuite && plus;
  const label = usePlus
    ? isYear
      ? prices.plusPriceYearlyLabel
      : prices.plusPriceLabel
    : isYear
      ? prices.priceYearlyLabel
      : prices.priceLabel;
  const amount = usePlus
    ? isYear
      ? prices.plusPriceYearlyAud
      : prices.plusPriceAud
    : isYear
      ? prices.priceYearlyAud
      : prices.priceAud;
  const planName = usePlus ? "Pro+" : "Pro";

  // Dev convenience: create a product+price once and log the id (prefer setting env).
  // Suite must not reuse the Driver Hub $5/$60 price ids.
  const stripeProduct = await stripe.products.create({
    name: isYear ? `${prices.productName} ${planName} (yearly)` : `${prices.productName} ${planName}`,
    description: usePlus
      ? `Accountant share, extra entity, BAS pack, cloud OCR and priority support — ${label}`
      : `Unlimited uploads, PDF/EOFY export and forecast — ${label}`,
  });
  const price = await stripe.prices.create({
    product: stripeProduct.id,
    unit_amount: amount * 100,
    currency: "aud",
    recurring: { interval: period },
  });
  const envKey = isSuite
    ? usePlus
      ? isYear
        ? "STRIPE_PRICE_ID_SUITE_PLUS_YEARLY"
        : "STRIPE_PRICE_ID_SUITE_PLUS"
      : isYear
        ? "STRIPE_PRICE_ID_SUITE_YEARLY"
        : "STRIPE_PRICE_ID_SUITE"
    : isYear
      ? "STRIPE_PRICE_ID_YEARLY"
      : "STRIPE_PRICE_ID";
  console.warn(`[billing] Created Stripe price ${price.id} — set ${envKey}=${price.id} in the environment.`);
  return price.id;
}

async function ensureCustomer(stripe, user) {
  if (user.stripeCustomerId) {
    try {
      await stripe.customers.retrieve(user.stripeCustomerId);
      return user.stripeCustomerId;
    } catch {
      /* recreate below */
    }
  }
  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.username,
    metadata: { username: user.username },
  });
  return customer.id;
}

/**
 * @param {{ user: object, req: object, saveCustomerId: Function, interval?: "month"|"year", product?: string, homePath?: string, plan?: string }} args
 */
async function createCheckoutSession({
  user,
  req,
  saveCustomerId,
  interval = "month",
  product = "haulage",
  homePath = "/haulage/",
  plan = "pro",
}) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error(
      "Card payments are not configured yet (missing STRIPE_SECRET_KEY). Entitlements still apply for trials."
    );
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  if (!user.email) {
    const err = new Error("Add an email on your Profile before upgrading — Stripe receipts need it.");
    err.code = "EMAIL_REQUIRED";
    throw err;
  }

  const period = normaliseInterval(interval);
  const prices = pricingForProduct(product);
  const checkoutPlan =
    prices.product === "suite" ? normalizeCheckoutPlan(plan) : "pro";
  if (checkoutPlan === SUBSCRIPTION_TIER_PRO_PLUS && !prices.plusPriceAud) {
    const err = new Error("Pro+ checkout is only available on Go Taxation Suite.");
    err.code = "PLAN_UNAVAILABLE";
    throw err;
  }
  const customerId = await ensureCustomer(stripe, user);
  if (customerId !== user.stripeCustomerId && typeof saveCustomerId === "function") {
    saveCustomerId(customerId);
  }

  const priceId = await ensurePriceId(stripe, period, product, checkoutPlan);
  const base = appBaseUrl(req);
  const home = String(homePath || "/haulage/").replace(/\/?$/, "/");
  const priceLabel =
    checkoutPlan === SUBSCRIPTION_TIER_PRO_PLUS
      ? period === "year"
        ? prices.plusPriceYearlyLabel
        : prices.plusPriceLabel
      : period === "year"
        ? prices.priceYearlyLabel
        : prices.priceLabel;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.username,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}${home}?billing=success`,
    cancel_url: `${base}${home}?billing=cancel`,
    metadata: {
      username: user.username,
      interval: period,
      product: prices.product,
      plan: checkoutPlan,
      tier: checkoutPlan,
    },
    subscription_data: {
      metadata: {
        username: user.username,
        interval: period,
        product: prices.product,
        plan: checkoutPlan,
        tier: checkoutPlan,
      },
    },
    allow_promotion_codes: true,
  });
  return {
    url: session.url,
    sessionId: session.id,
    interval: period,
    product: prices.product,
    plan: checkoutPlan,
    priceLabel,
  };
}

async function createPortalSession({ user, req, homePath = "/haulage/" }) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error("Card payments are not configured yet.");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  if (!user.stripeCustomerId) {
    const err = new Error("No billing customer on file — start a Pro subscription first.");
    err.code = "NO_CUSTOMER";
    throw err;
  }
  const base = appBaseUrl(req);
  const home = String(homePath || "/haulage/").replace(/\/?$/, "/");
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${base}${home}?billing=portal`,
  });
  return { url: session.url };
}

function applySubscriptionToUser(user, sub) {
  if (!user || !sub) return;
  user.stripeSubscriptionId = sub.id || user.stripeSubscriptionId || null;
  user.subscriptionStatus = sub.status || null;
  user.plan = ["active", "trialing"].includes(sub.status) ? "pro" : "free";
  user.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  if (sub.current_period_end) {
    user.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
  }
  if (sub.customer) {
    user.stripeCustomerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id || user.stripeCustomerId;
  }
  const interval =
    sub.items &&
    sub.items.data &&
    sub.items.data[0] &&
    sub.items.data[0].price &&
    sub.items.data[0].price.recurring &&
    sub.items.data[0].price.recurring.interval;
  if (interval === "year" || interval === "month") {
    user.subscriptionInterval = interval;
  }
  if (["active", "trialing"].includes(String(sub.status || "").toLowerCase())) {
    user.subscriptionTier = tierFromSubscription(sub);
  } else {
    user.subscriptionTier = null;
  }
  // Paid Stripe Pro supersedes an admin forced-Free grant.
  if (["active", "trialing"].includes(String(sub.status || "").toLowerCase())) {
    try {
      const { clearForcedFreeGrantOnPaid } = require("./entitlements");
      clearForcedFreeGrantOnPaid(user);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Cancel at period end — keeps Pro benefits until currentPeriodEnd.
 * @param {{ user: object, saveUser?: Function }} args
 */
/**
 * Immediate cancel (account wipe). Stops further invoices.
 * @param {{ user: object }} args
 */
async function cancelSubscriptionImmediately({ user }) {
  const stripe = getStripe();
  if (!stripe || !user || !user.stripeSubscriptionId) {
    return { canceled: false };
  }
  await stripe.subscriptions.cancel(user.stripeSubscriptionId);
  user.subscriptionStatus = "canceled";
  user.cancelAtPeriodEnd = false;
  user.stripeSubscriptionId = null;
  return { canceled: true };
}

async function cancelSubscriptionAtPeriodEnd({ user }) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error("Card payments are not configured yet.");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  if (!user || !user.stripeSubscriptionId) {
    const err = new Error("No active Pro subscription to cancel.");
    err.code = "NO_SUBSCRIPTION";
    throw err;
  }
  const sub = await stripe.subscriptions.update(user.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  applySubscriptionToUser(user, sub);
  return {
    cancelAtPeriodEnd: true,
    currentPeriodEnd: user.currentPeriodEnd,
    subscriptionStatus: user.subscriptionStatus,
  };
}

/**
 * Undo a scheduled cancel (resume auto-renewal).
 * @param {{ user: object }} args
 */
async function resumeSubscription({ user }) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error("Card payments are not configured yet.");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  if (!user || !user.stripeSubscriptionId) {
    const err = new Error("No subscription on file to resume.");
    err.code = "NO_SUBSCRIPTION";
    throw err;
  }
  const sub = await stripe.subscriptions.update(user.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
  applySubscriptionToUser(user, sub);
  return {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: user.currentPeriodEnd,
    subscriptionStatus: user.subscriptionStatus,
  };
}

/**
 * @param {{ rawBody: Buffer, signature: string, findUserByUsername: Function, findUserByCustomerId: Function, saveUser: Function }} args
 */
async function handleWebhook({ rawBody, signature, findUserByUsername, findUserByCustomerId, saveUser }) {
  const stripe = getStripe();
  if (!stripe) {
    const err = new Error("Stripe not configured");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const err = new Error("STRIPE_WEBHOOK_SECRET is not set");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  const type = event.type;

  async function loadUserFromSub(sub) {
    const username = sub.metadata && sub.metadata.username;
    if (username) {
      const u = findUserByUsername(username);
      if (u) return u;
    }
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer && sub.customer.id;
    if (customerId) return findUserByCustomerId(customerId);
    return null;
  }

  if (type === "checkout.session.completed") {
    const session = event.data.object;
    const username = session.client_reference_id || (session.metadata && session.metadata.username);
    let user = username ? findUserByUsername(username) : null;
    if (!user && session.customer) {
      user = findUserByCustomerId(
        typeof session.customer === "string" ? session.customer : session.customer.id
      );
    }
    if (user) {
      if (session.customer) {
        user.stripeCustomerId =
          typeof session.customer === "string" ? session.customer : session.customer.id;
      }
      if (session.subscription) {
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
        const sub = await stripe.subscriptions.retrieve(subId);
        applySubscriptionToUser(user, sub);
      } else {
        user.plan = "pro";
        user.subscriptionStatus = "active";
        user.cancelAtPeriodEnd = false;
      }
      saveUser(user);
    }
  }

  if (
    type === "customer.subscription.updated" ||
    type === "customer.subscription.created" ||
    type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object;
    const user = await loadUserFromSub(sub);
    if (user) {
      applySubscriptionToUser(user, sub);
      if (type === "customer.subscription.deleted") {
        user.plan = "free";
        user.subscriptionStatus = "canceled";
        user.cancelAtPeriodEnd = false;
      }
      saveUser(user);
    }
  }

  return { received: true, type };
}

module.exports = {
  stripeConfigured,
  getStripe,
  appBaseUrl,
  normaliseInterval,
  createCheckoutSession,
  createPortalSession,
  cancelSubscriptionImmediately,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription,
  handleWebhook,
  applySubscriptionToUser,
  ensurePriceId,
  configuredPriceId,
  tierFromSubscription,
};
