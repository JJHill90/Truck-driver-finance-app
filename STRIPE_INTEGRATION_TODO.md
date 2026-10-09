# Stripe Checkout integration

Scenario A: an existing Checkout Session call was already in [`lib/billing-stripe.js`](lib/billing-stripe.js). Checkout Studio parameters were applied there. Hosted Checkout still starts from Profile → Plan → Upgrade to Pro (`POST /api/haulage/billing/checkout`).

Installed Stripe Node SDK: **17.7.0** (`package.json` / lockfile). `ui_mode` is therefore **`hosted`**, not `hosted_page` (that string is for SDK 21.0.0+).

## Values to Replace

No sample placeholders were introduced. `mode`, `success_url`, `cancel_url`, and `line_items` already used real app values and were left as-is.

**Files containing these parameters:**

- [`lib/billing-stripe.js`](lib/billing-stripe.js)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `subscription` | Keep. Suite / Driver Hub Pro is recurring. |
| success_url | `` `${APP_BASE_URL}/suite/?billing=success` `` (or `/haulage/` on Driver Hub) | Already built from `APP_BASE_URL` + the product home path. Set `APP_BASE_URL` on Render. |
| cancel_url | `` `${APP_BASE_URL}/suite/?billing=cancel` `` | Same as above. |
| line_items[].price | Env Price id, or a Price created at checkout time if the env is empty | Set Suite Price ids on **go-taxation-suite** (do not reuse Driver Hub $5/$60 ids). |

## Configured Parameters

These parameters were configured in Checkout Studio and are set on the existing session create call.

**Files containing these parameters:**

- [`lib/billing-stripe.js`](lib/billing-stripe.js)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted` (SDK 17.7.0) |
| billing_address_collection | `auto` |
| phone_number_collection.enabled | `false` |
| automatic_tax.enabled | `false` |
| allow_promotion_codes | `false` |
| payment_method_collection | `always` |
| submit_type | `auto` |
| integration_identifier | `hosted_mobile_app_0001` |
| origin_context | `mobile_app` |

Fulfillment fields already on the call were **kept** so a paid session still binds to the signed-in profile: `customer`, `client_reference_id`, `metadata`, `subscription_data`. Removing them would leave Pro stuck on Free after payment.

## Setup and next steps

### Environment (Render service `go-taxation-suite`)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` — without this, Upgrade shows “Card payments are not configured yet”. |
| `STRIPE_PRICE_ID_SUITE` | Suite Pro monthly ($10 AUD) |
| `STRIPE_PRICE_ID_SUITE_YEARLY` | Suite Pro yearly ($110 AUD) |
| `STRIPE_PRICE_ID_SUITE_PLUS` | Optional Pro+ monthly ($18) |
| `STRIPE_PRICE_ID_SUITE_PLUS_YEARLY` | Optional Pro+ yearly ($190) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from the webhook endpoint |
| `APP_BASE_URL` | `https://go-taxation-suite.onrender.com` |

Driver Hub uses a **different** service and Price ids (`STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`). Do not copy those onto Suite.

### Webhook

Do not open the URL in a browser (GET returns `Cannot GET /…`).

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://go-taxation-suite.onrender.com/api/haulage/billing/webhook`
3. Add events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` on Render
5. Confirm recent deliveries show **200**

### How it works

1. Signed-in user taps Upgrade to Pro (website or Play WebView).
2. Server creates a Stripe Customer if needed, then a **hosted** Checkout Session in `subscription` mode.
3. Browser/WebView redirects to Stripe’s page.
4. On success, Stripe POSTs the webhook; the server sets `plan: pro` on that username.
5. User returns to `/?billing=success`.

Play Store does not sell this as an IAP. Stripe stays on the website.

### Testing

Use Stripe test mode keys and [test cards](https://docs.stripe.com/testing#cards):

- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

Any future expiry, any CVC, any postcode.

### Project structure

No new routes or packages. Only the existing create-session object in [`lib/billing-stripe.js`](lib/billing-stripe.js) changed.

### Next steps

1. Put the Suite env vars on Render and let the service restart.
2. Create the three webhook events if you have not already.
3. Run a test-mode upgrade, then switch to live keys / live Prices before charging real cards.
4. If Checkout returns an API error about `integration_identifier` or `origin_context`, those fields are from Checkout Studio and are not in Stripe Node 17’s types. Upgrade `stripe` to 21+ (and then change `ui_mode` to `hosted_page`) or remove those two keys.
5. `submit_type` is only documented for `payment` mode. If Stripe rejects it on this subscription session, remove `submit_type` only.

### Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
- https://docs.stripe.com/payments/checkout
- https://docs.stripe.com/keys-best-practices
