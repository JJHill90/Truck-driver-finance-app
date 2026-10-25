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

## Redirect loop (apex ↔ www)

Live check (25 Oct 2026): `https://www.godriverhub.com/` returns **301** to
`https://godriverhub.com/`, and `https://godriverhub.com/` returns **301**
to `https://www.godriverhub.com/`. DNS is already right and must stay:

| Host | Type | Value |
|------|------|--------|
| `@` | `A` | `216.24.57.1` (Render) |
| `www` | `CNAME` | the `haulage-finance` onrender hostname (section 2) |

Nameservers are Ace Host (`ds902-dns*.centos-server.net`), not a Cloudflare
zone. The `server: cloudflare` header is Render’s edge. Do not edit DNS,
MX, or cPanel mail (`support@godriverhub.com` stays on cPanel).

The two 301s are different programs:

| Request | Who answers | How to tell |
|---------|-------------|-------------|
| `www` → apex | This app, `wwwToApexRedirect` in `lib/driverhub-public-origin.js` | `x-powered-by: Express`, `x-render-origin-server: Render`, `rndr-id`, body `Moved Permanently. Redirecting to https://godriverhub.com/` |
| apex → www | Render’s custom-domain edge (Go `net/http` Redirect) on `216.24.57.1` | No Express headers, no `rndr-id`, body `<a href="https://www.godriverhub.com/">Moved Permanently</a>.` |

The apex request never reaches Node, so app code cannot cancel it.
The service’s onrender URL still returns 200.
`https://www.godriverhub.com/haulage/` returns 200 because the app
skips `/haulage` (a host-change 301 opens Chrome in the Play WebView).
`https://godriverhub.com/haulage/` is still Render’s 301 to www.

Render’s rule ([custom domains](https://render.com/docs/custom-domains)):
the hostname you **add** is canonical. Adding `www.godriverhub.com` makes
Render 301 the apex to www. Adding `godriverhub.com` makes Render 301 www
to the apex. The live apex → www edge redirect means **www was the domain
added** on `haulage-finance`. The app then 301s www back to the apex on
marketing paths. That is the loop. Do not “fix” it by reversing the app
redirect; that would make www canonical and leave the edge redirect in place.

### Dashboard steps (Joshua)

Do this on service **`haulage-finance`** only. Leave DNS and email alone.

1. Render Dashboard → **haulage-finance** → **Settings → Custom Domains**.
2. Confirm `www.godriverhub.com` is the domain that was added, and
   `godriverhub.com` is listed only as a redirect to www.
3. **Remove** `www.godriverhub.com`. That also removes Render’s apex → www
   redirect. The service stays up on its onrender URL.
4. **Add Custom Domain** and type `godriverhub.com` only. Do not type `www`.
5. Render adds `www.godriverhub.com` itself and 301s it to the apex.
   Click **Verify**. Public DNS already points at Render, so this should
   go green without a zone edit. If the dashboard asks for different DNS
   records, stop and compare — do not change MX.
6. On **haulage-finance → Environment**, set
   `APP_BASE_URL` = `https://godriverhub.com` (no `www`, no trailing slash).
   Recovery links and Stripe success/cancel/portal URLs use this value.
7. On **go-taxation-suite → Environment**, set
   `DRIVERHUB_PUBLIC_URL` = `https://godriverhub.com` so Suite’s `/haulage`
   sends people to Driver Hub.
8. Stripe Dashboard → Developers → Webhooks: add
   `https://godriverhub.com/api/haulage/billing/webhook` (POST,
   `checkout.session.completed` and `customer.subscription.*`). Keep the
   existing onrender endpoint until a test event succeeds.
9. GitHub repo secret `HAULAGE_BASE_URL` (Actions daily backup) can stay on
   the onrender origin. Point it at `https://godriverhub.com` only after
   the apex returns 200.
10. Play Console / App Store, after the checks below are green: privacy
    `https://godriverhub.com/privacy`, terms `https://godriverhub.com/terms`,
    support `https://godriverhub.com/support`, marketing
    `https://godriverhub.com/`. Ship a new AAB before the Play WebView is
    expected to open the apex. Builds already in the store still open
    `www` `/haulage/`. After step 4, Render 301s that www URL to the apex
    (including `/haulage/`). The WebView allowlist includes both hosts, so
    the hop should stay in the app; the new AAB opens the apex directly.

Check (one hop, then stop):

```bash
curl -sI --max-redirs 0 https://godriverhub.com/
curl -sI --max-redirs 0 https://www.godriverhub.com/
curl -sI --max-redirs 0 https://godriverhub.com/haulage/
curl -sI --max-redirs 0 https://godriverhub.com/privacy
```

Expect apex `200` with `x-powered-by: Express`, and `www` a single `301`
to `https://godriverhub.com/`.

## 1. Add the domain on Render

1. Open Render → service **`haulage-finance`** → **Settings → Custom Domains**.
2. Add **only** the apex: `godriverhub.com`. Render automatically adds
   `www.godriverhub.com` and redirects it to the apex. Adding `www` as the
   domain instead makes Render 301 the apex to www, which loops with this
   app (see **Redirect loop** above). If www is already the added domain,
   remove it, then add the apex. Adding `www` as a second custom domain
   fails with a duplicate / “already verified” error.
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
(`lib/driverhub-public-origin.js`). That middleware only runs when the
request reaches Express. Render’s edge redirect (no `x-powered-by`) is
configured in the dashboard, not in this repo.

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
flush public caches, then Verify:

- Google: https://developers.google.com/speed/public-dns/cache
- Cloudflare: https://one.one.one.one/purge-cache/

Check both resolvers. Verify stays red while either still has Ace Host:

```bash
dig @8.8.8.8 +short A godriverhub.com
dig @1.1.1.1 +short A godriverhub.com
```

### If the browser shows a certificate / SSL error

That is expected **until Render Verify is green and the certificate
says Issued**. Pointing the `A` record at `216.24.57.1` before that
sends HTTPS to Cloudflare with **no cert for this hostname**:

- Browser: `NET::ERR_SSL_PROTOCOL_ERROR` / “connection is not private”
- `curl https://godriverhub.com/` → handshake failure, no peer cert
- `http://godriverhub.com/` → Cloudflare **409** / error **1001**

Ace Host still has a Let’s Encrypt cert (`CN=godriverhub.com`, issued
for the parked site). Resolvers that have not picked up the new `A`
record (often `8.8.8.8` for a few hours) open that old cert and the
hyphenated `go-driverhub.com` park page — not Driver Hub.

Until Verify is green:

1. Keep using the service’s `onrender.com` URL (Driver Hub home and `/haulage/`).
2. Flush Google’s cache, wait until `dig @8.8.8.8 +short A godriverhub.com`
   is **only** `216.24.57.1`, then click **Verify** again.
3. In cPanel Zone Editor, delete leftover
   `_acme-challenge.godriverhub.com` TXT (cPanel AutoSSL). It can stall
   Render’s new certificate.
4. Do **not** set `APP_BASE_URL` until `curl -sI https://godriverhub.com/`
   returns `200`.

A leftover **AAAA** or a **CAA** list that omits `letsencrypt.org` /
`pki.goog` also blocks issuance after a green Verify.

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
