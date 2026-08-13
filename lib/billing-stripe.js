/**
 * Stripe Checkout + Customer Portal + webhook for Taxation Hub Pro ($5/mo AUD).
 *
 * Env:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET
 *   STRIPE_PRICE_ID          recurring price for Pro (preferred)
 *   APP_BASE_URL            success/cancel + portal return URLs
 *
 * Without STRIPE_SECRET_KEY, checkout returns a clear “not configured” error;
 * entitlements/trials still work.
 */
const Stripe = require("stripe");
const { PRO_PRICE_AUD, PRO_PRICE_LABEL } = require("./entitlements");

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

async function ensurePriceId(stripe) {
  if (process.env.STRIPE_PRICE_ID) return process.env.STRIPE_PRICE_ID;

  // Dev convenience: create a product+price once and log the id (prefer setting env).
  const product = await stripe.products.create({
    name: "Taxation Hub Pro",
    description: `Unlimited uploads, PDF/EOFY export and forecast — ${PRO_PRICE_LABEL}`,
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: PRO_PRICE_AUD * 100,
    currency: "aud",
    recurring: { interval: "month" },
  });
  console.warn(
    `[billing] Created Stripe price ${price.id} — set STRIPE_PRICE_ID=${price.id} in the environment.`
  );
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
 * @param {{ user: object, req: object, saveCustomerId: Function }} args
 */
async function createCheckoutSession({ user, req, saveCustomerId }) {
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

  const customerId = await ensureCustomer(stripe, user);
  if (customerId !== user.stripeCustomerId && typeof saveCustomerId === "function") {
    saveCustomerId(customerId);
  }

  const priceId = await ensurePriceId(stripe);
  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: user.username,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/haulage/?billing=success`,
    cancel_url: `${base}/haulage/?billing=cancel`,
    metadata: { username: user.username },
    subscription_data: {
      metadata: { username: user.username },
    },
    allow_promotion_codes: true,
  });
  return { url: session.url, sessionId: session.id };
}

async function createPortalSession({ user, req }) {
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
  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${base}/haulage/?billing=portal`,
  });
  return { url: session.url };
}

function applySubscriptionToUser(user, sub) {
  if (!user || !sub) return;
  user.stripeSubscriptionId = sub.id || user.stripeSubscriptionId || null;
  user.subscriptionStatus = sub.status || null;
  user.plan = ["active", "trialing"].includes(sub.status) ? "pro" : "free";
  if (sub.current_period_end) {
    user.currentPeriodEnd = new Date(sub.current_period_end * 1000).toISOString();
  }
  if (sub.customer) {
    user.stripeCustomerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id || user.stripeCustomerId;
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
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  applySubscriptionToUser,
  PRO_PRICE_AUD,
  PRO_PRICE_LABEL,
};
