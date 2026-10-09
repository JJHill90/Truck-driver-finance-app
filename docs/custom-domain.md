# Official domain — gotaxationsuite.com

The website we already built (app / store buttons, Privacy, Terms, Support)
is the same Express app as Go Taxation Suite. It is **not** a second site.

Attach **`https://gotaxationsuite.com/`** as a custom domain on Render
service **`go-taxation-suite`**. Then these paths are the public pages:

| Page | Official URL |
|------|----------------|
| Marketing / store links | `https://gotaxationsuite.com/` |
| Open the app | `https://gotaxationsuite.com/suite/` |
| Privacy | `https://gotaxationsuite.com/privacy` |
| Terms | `https://gotaxationsuite.com/terms` |
| Support | `https://gotaxationsuite.com/support` |
| Stripe webhook | `https://gotaxationsuite.com/api/haulage/billing/webhook` |

Use **HTTPS**. The `http://` form will not keep session cookies, Stripe
Checkout, or Play / App Store policy URLs. Render issues a certificate
after DNS verifies.

Do **not** attach this domain to Driver Hub (`haulage-finance`). Accounts
stay on Suite disk `gotax-data`.

## 1. Add the domain on Render

1. Open Render → service **`go-taxation-suite`** → **Settings → Custom Domains**.
2. Add `gotaxationsuite.com` and `www.gotaxationsuite.com`.
3. Copy the DNS records Render shows (usually an apex ALIAS/A and a `www` CNAME).

## 2. Point DNS at Render

At the registrar that owns `gotaxationsuite.com`, create exactly the
records Render listed. Wait until both hosts show **Verified** and TLS
is **Issued**. Until then, keep using
`https://go-taxation-suite.onrender.com/` — it stays live.

`www` redirects to the apex on the Suite host (`lib/suite-public-origin.js`).

## 3. Point the app at the official origin

On **`go-taxation-suite`** in Render → Environment:

| Key | Value |
|-----|--------|
| `APP_BASE_URL` | `https://gotaxationsuite.com` |
| `CORS_ORIGINS` | optional; apex + www are already allowlisted |

Optional, on **`haulage-finance`**:

| Key | Value |
|-----|--------|
| `SUITE_PUBLIC_URL` | `https://gotaxationsuite.com` |

That sends Driver Hub `/suite` hits to the official Suite host.

## 4. Stripe

After `APP_BASE_URL` is the official origin, add (or switch) the webhook
to:

`https://gotaxationsuite.com/api/haulage/billing/webhook`

Keep the existing onrender webhook until Checkout success/cancel URLs
also use the official domain (they follow `APP_BASE_URL`). Destination
events stay the same: `checkout.session.completed` and
`customer.subscription.*`. **POST only.**

## 5. Play Console / App Store Connect

Once `https://gotaxationsuite.com/privacy` returns 200:

- Privacy policy = `https://gotaxationsuite.com/privacy`
- Support = `https://gotaxationsuite.com/support`
- Marketing = `https://gotaxationsuite.com/`

Do **not** retarget the Play WebView (`mobile-suite` load URL /
`capacitor.config.json` `server.url`) until the official host serves
`/suite/` over HTTPS. Testers on
`https://go-taxation-suite.onrender.com/suite/` keep working until you
ship a new AAB that uses the custom domain.

## 6. Check it

```bash
curl -sI https://gotaxationsuite.com/
curl -sI https://gotaxationsuite.com/privacy
curl -sI https://gotaxationsuite.com/suite/
```

Expect `200` (and `www` → `301` to the apex). Same pages as
`https://go-taxation-suite.onrender.com/`.
