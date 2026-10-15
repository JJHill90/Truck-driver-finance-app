# Official domain — godriverhub.com

The website on the Driver Hub front page (store buttons, Privacy, Terms,
Support) is the same Express app as Driver Hub / Taxation Hub. It is **not**
a second site.

Attach **`https://godriverhub.com/`** as a custom domain on Render service
**`haulage-finance`**. Then these paths are the public pages:

| Page | Official URL |
|------|----------------|
| Marketing / store links | `https://godriverhub.com/` |
| Open the app | `https://godriverhub.com/haulage/` |
| Privacy | `https://godriverhub.com/privacy` |
| Terms | `https://godriverhub.com/terms` |
| Support | `https://godriverhub.com/support` |
| Stripe webhook | `https://godriverhub.com/api/haulage/billing/webhook` |

Use **HTTPS**. The `http://` form will not keep session cookies, Stripe
Checkout, or Play / App Store policy URLs. Render issues a certificate
after DNS verifies.

Do **not** attach this domain to Go Taxation Suite (`go-taxation-suite`).
Accounts stay on Driver Hub disk `haulage-data`. Suite stays on
`https://gotaxationsuite.com/` — see [`custom-domain.md`](custom-domain.md).

## 1. Add the domain on Render

1. Open Render → service **`haulage-finance`** → **Settings → Custom Domains**.
2. Add **only** the apex: `godriverhub.com`. Render automatically adds
   `www.godriverhub.com` and redirects it to the apex. Adding `www` as a
   second custom domain fails with a duplicate / “already verified” error.
3. Copy the DNS records Render shows (apex `A` / `ALIAS`, `www` `CNAME`).

Do **not** add this domain on `go-taxation-suite`. If it already appears
on another Render service, delete it there first — a hostname can only
belong to one service.

cPanel / AutoSSL “this domain is verified” is **not** Render Verify.
Render only verifies after public DNS points at Render (next section).

## 2. Point DNS at Render

Edit the zone that the **nameservers** actually serve (often Ace Host /
cPanel Zone Editor — the same place as `gotaxationsuite.com`). Records
added only at the registrar do nothing while those NS stay in place.

Set:

| Host | Type | Value |
|------|------|--------|
| `@` / `godriverhub.com` | `A` | Render’s apex IP (often `216.24.57.1`) |
| `www` | `CNAME` | `haulage-finance.onrender.com` |

Use Render’s values if the dashboard shows different ones.

**Remove / do not keep** (these are what currently block Verify):

- Apex `A` `162.247.78.68` (Ace Host). Render needs **only**
  `216.24.57.1` (or the IP shown in the dashboard).
- `www` CNAME → `godriverhub.com` (that still hits Ace Host). It must
  CNAME to `haulage-finance.onrender.com`.
- Apache / cPanel redirects from `godriverhub.com` → `go-driverhub.com`
  (parked hyphenated site). Changing the `A` record stops that; also
  turn off Redirects / parked-domain forwarding in cPanel.
- Any **AAAA** (IPv6) on `@` or `www`. Render is IPv4-only; leftover
  AAAA records fail verification even when A is correct.
- URL redirects / “parked domain” / domain-forwarding features.

**CAA:** do **not** add CAA unless you need it. If you already have CAA,
also add:

```
godriverhub.com.  CAA  0 issue "letsencrypt.org"
godriverhub.com.  CAA  0 issue "pki.goog"
```

Leave MX / SPF alone if you still use cPanel mail. They do not block
Render verify.

Set TTL to 1–5 minutes while testing. In Render click **Verify** after
`dig +short A godriverhub.com` returns **only** Render’s IP.
Until then keep using the `onrender.com` URL for the app.

`www` redirects to the apex on the Driver Hub host
(`lib/driverhub-public-origin.js`).

### If Render says it could not verify

That is expected while DNS still answers Ace Host. Check the **live**
records (not the cPanel editor preview):

```bash
dig +short A godriverhub.com
dig +short AAAA godriverhub.com
dig +short CNAME www.godriverhub.com
dig +short CAA godriverhub.com
```

| Result | Meaning |
|--------|---------|
| `A` `162.247.78.68` | Still Ace Host. Change `@` to `216.24.57.1`. |
| `www` CNAME `godriverhub.com` | Still the old host. Point `www` at `haulage-finance.onrender.com`. |
| `A` `216.24.57.1` and `www` CNAME `haulage-finance.onrender.com` | Ready. Click **Verify** again. |

TTL on the parking records is often 4 hours. After you save, wait or
flush Google / Cloudflare public DNS caches, then Verify.

TLS issues after a green Verify usually mean a leftover AAAA or a CAA
list that omits `letsencrypt.org` / `pki.goog`.

## 3. Point the app at the official origin

On **`haulage-finance`** in Render → Environment:

| Key | Value |
|-----|--------|
| `APP_BASE_URL` | `https://godriverhub.com` |
| `CORS_ORIGINS` | optional; apex + www are already allowlisted |

Optional, on **`go-taxation-suite`**:

| Key | Value |
|-----|--------|
| `DRIVERHUB_PUBLIC_URL` | `https://godriverhub.com` |

That sends Suite `/haulage` hits to the official Driver Hub host.

The Render `onrender.com` URL still serves `/haulage/` (the app) and `/`
(the same overview). DNS just gives that service a public name.

## 4. Stripe

After `APP_BASE_URL` is the official origin, add (or switch) the webhook
to:

`https://godriverhub.com/api/haulage/billing/webhook`

Keep the existing onrender webhook until Checkout success/cancel URLs
also use the official domain (they follow `APP_BASE_URL`). Destination
events stay the same: `checkout.session.completed` and
`customer.subscription.*`. **POST only.** Use Driver Hub Price ids
(`STRIPE_PRICE_ID` / `STRIPE_PRICE_ID_YEARLY`), not Suite’s.

## 5. Play Console / App Store Connect

Once `https://godriverhub.com/privacy` returns 200:

- Privacy policy = `https://godriverhub.com/privacy`
- Support = `https://godriverhub.com/support`
- Marketing = `https://godriverhub.com/`

Do **not** retarget the Play WebView (`mobile/capacitor.config.json`
`server.url`) until the official host serves `/haulage/` over HTTPS.
Testers on the onrender `/haulage/` URL keep working until you ship a
new AAB that uses the custom domain.

## 6. Check it

```bash
curl -sI https://godriverhub.com/
curl -sI https://godriverhub.com/privacy
curl -sI https://godriverhub.com/haulage/
```

Expect `200` (and `www` → `301` to the apex). Same pages as the
`haulage-finance` onrender host.
