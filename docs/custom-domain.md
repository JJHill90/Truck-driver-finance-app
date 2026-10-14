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

Edit the zone that the **nameservers** actually serve. This domain’s
nameservers are `ds902-dns1.centos-server.net` /
`ds902-dns2.centos-server.net` (Ace Host / cPanel). Records added only
at the registrar do nothing while those NS stay in place.

Open Ace Host / cPanel → **Zone Editor** (or Advanced DNS) and set:

| Host | Type | Value |
|------|------|--------|
| `@` / `gotaxationsuite.com` | `A` | `216.24.57.1` |
| `www` | `CNAME` | `go-taxation-suite.onrender.com` |

Use Render’s values if the dashboard shows different ones.

**Remove / do not keep:**

- The old parking `A` `162.247.78.68` (Ace Host).
- `www` CNAME → `gotaxationsuite.com` (that still hits the old host).
- Any **AAAA** (IPv6) on `@` or `www`. Render is IPv4-only; leftover
  AAAA records fail verification even when A is correct.
- URL redirects / “parked domain” / domain-forwarding features.

**CAA:** this domain has none. Do **not** add CAA unless you need it.
If you already have CAA, also add:

```
gotaxationsuite.com.  CAA  0 issue "letsencrypt.org"
gotaxationsuite.com.  CAA  0 issue "pki.goog"
```

Leave MX / SPF alone if you still use Ace Host mail. They do not block
Render verify.

Set TTL to 1–5 minutes while testing. In Render click **Verify** after
`dig +short A gotaxationsuite.com` returns **only** `216.24.57.1`.
Until then keep using `https://go-taxation-suite.onrender.com/`.

`www` redirects to the apex on the Suite host (`lib/suite-public-origin.js`).

### If Render says it could not verify

That banner always mentions AAAA and CAA. Check the live records first:

```bash
dig +short A gotaxationsuite.com
dig +short AAAA gotaxationsuite.com
dig +short CNAME www.gotaxationsuite.com
dig +short CAA gotaxationsuite.com
```

Verification fails until the apex `A` is Render’s `216.24.57.1` (not
`162.247.78.68`) and `www` CNAMEs to `go-taxation-suite.onrender.com`.
Then click Verify again. TLS issues after that usually mean a leftover
AAAA or a CAA list that omits `letsencrypt.org` / `pki.goog`.

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
