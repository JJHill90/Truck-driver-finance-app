# Go Taxation Hub marketing site — gotaxationhub.com

Public pages for **Go Taxation Hub** (the Taxation Hub app inside Driver Hub).
Same Express process as Driver Hub (`haulage-finance`). Not a new Render
service, and not Go Taxation Suite.

`https://godriverhub.com/` is unchanged. Suite (`go-taxation-suite`,
`gotaxationsuite.com`) is unchanged. Do not attach this domain to Suite,
and do not attach `godriverhub.com` or `gotaxationsuite.com` here as a
swap.

## Why this host, not a second site

Host routing keeps the Support form on the same origin (`POST
/api/haulage/support/contact` → `support@godriverhub.com`) with no new
CORS entry, no second disk, and no second bill. The branch only runs when
`Host` / `X-Forwarded-Host` is `gotaxationhub.com` or `www.gotaxationhub.com`.
Every other host, including `godriverhub.com`, localhost, and the onrender
URL, keeps today’s pages.

A separate static site would duplicate the HTML and post the contact form
cross-origin. A third web service would copy the whole Node app.

## Pages

| Page | URL |
|------|-----|
| Overview | `https://gotaxationhub.com/` |
| Support | `https://gotaxationhub.com/support` |
| Privacy | `https://gotaxationhub.com/privacy` |
| Terms | `https://gotaxationhub.com/terms` |
| Sitemap | `https://gotaxationhub.com/sitemap.xml` |
| Robots | `https://gotaxationhub.com/robots.txt` |

Preview paths on any host (not linked from Driver Hub): `/welcome-taxationhub`,
`/welcome-support-taxationhub`, `/privacy-taxationhub`, `/terms-taxationhub`.

Screenshots are the existing Taxation Hub Play captures, served from
`mobile/store/screenshots/play-1080x1920/` at `/welcome/taxhub-shots/`
(dashboard, expenses, income, EOFY). They are not copied into `public/`.

## Open the app

Visible copy on these pages names **Go Taxation Hub** (Taxation Hub for the
driver app). It does not call the site Driver Hub. The buttons still open
the Driver Hub app, which is the standalone sign-in.

Taxation Hub has no origin of its own. Sign-in is the Driver Hub login at
`/haulage/`. After a session exists, the shell opens Taxation Hub when
`localStorage.driverhub-selected-app` is `taxationhub` (legacy
`financehub` still migrates). A new sign-in otherwise lands on the app
picker.

CTAs use:

`https://godriverhub.com/haulage/?app=taxationhub`

That is the apex app URL (the same host Play versionCode 4 loads). The
`app` query is read only when it is `taxationhub` or `financehub`. It does
not select any other app. Visitors who are signed out still see the login
screen first; after sign-in or register the shell opens Taxation Hub
instead of the picker. `https://godriverhub.com/haulage/` with no query is
unchanged.

`/haulage` on `gotaxationhub.com` is a 302 to that URL. The marketing host
does not serve the SPA (sessions stay on `godriverhub.com`).

## Redirects (no apex ↔ www loop)

Same rule as [`custom-domain-driverhub.md`](custom-domain-driverhub.md):

| Who | Direction |
|-----|-----------|
| Render edge, **only if the apex was the domain you added** | `www` → apex, one 301 |
| This app (`lib/taxationhub-public-origin.js`) if a `www` request still reaches Node | `www` → apex, one 301 |

The app never redirects the apex to `www`. Adding `www.gotaxationhub.com`
as the custom domain makes Render 301 the apex to www, and this app 301s
www back to the apex. That is a loop. Add the apex only.

`www.gotaxationhub.com/anything` 301s once to
`https://gotaxationhub.com/anything` (path and query kept). It does not
jump straight to `godriverhub.com`. A following request for `/haulage/` on
the apex is a separate 302 to the app.

POST is not redirected (a 301 would drop the body).

## Render steps

Do this on **`haulage-finance`** only. Do not create a service. Do not
change `go-taxation-suite`.

1. Render Dashboard → **haulage-finance** → **Settings → Custom Domains**.
2. **Add Custom Domain** and type `gotaxationhub.com` only. Do not type `www`.
3. Render adds `www.gotaxationhub.com` itself and 301s it to the apex.
   If you add `www` as its own domain, remove it and add the apex, or the
   edge will 301 apex → www and loop with this app.
4. Copy the DNS records the dashboard shows. They should match the table
   below. If they differ, use the dashboard and do not invent records.
5. Do **not** set `APP_BASE_URL` to this domain. Leave it
   `https://godriverhub.com` (Driver Hub recovery, Stripe, and webhooks).
6. No new environment variables. Store buttons stay “Coming soon” until
   `DRIVERHUB_PLAY_STORE_URL` / `DRIVERHUB_APP_STORE_URL` are set. Those
   are the Driver Hub listings (the app that contains Taxation Hub). There
   is no separate Taxation Hub package.
7. Click **Verify** after public DNS matches. Health check stays
   `/haulage/` on the service.

## DNS (cPanel)

Edit the zone the **nameservers** actually serve (Ace Host / cPanel Zone
Editor — the same place as `godriverhub.com`). Records added only at the
registrar do nothing while those NS stay in place.

| Host | Type | Value |
|------|------|--------|
| `@` / `gotaxationhub.com` | `A` | `216.24.57.1` (Render’s apex IP for this service, unless the dashboard shows a different one) |
| `www` | `CNAME` | `haulage-finance.onrender.com` |

Confirm both values in the Render custom-domain panel. One hostname can
belong to only one service.

Remove, and do not add:

- An apex `A` record pointing at Ace Host (`162.247.78.68` or any other
  parking IP). Render needs only its own `A`.
- `www` CNAME → `gotaxationhub.com` (that stays on the old host).
- Any **AAAA** on `@` or `www`. Render is IPv4-only.
- URL redirects, parked-domain forwarding, or an apex → www rule in cPanel.
- This name on `go-taxation-suite`.

**CAA:** do not add CAA unless the zone already has it. If it does, also
add `issue "letsencrypt.org"` and `issue "pki.goog"`.

**Mail:** leave any existing MX / SPF alone. The contact address on this
site is `support@godriverhub.com` (Driver Hub mail). Do not move that
mailbox. You do not need MX on `gotaxationhub.com` for the website.

TTL 1–5 minutes while testing. Verify when:

```bash
dig +short A gotaxationhub.com
dig +short AAAA gotaxationhub.com
dig +short CNAME www.gotaxationhub.com
```

`A` is only Render’s IP, `AAAA` is empty, `www` is the onrender hostname.

After Verify is green and the certificate is Issued:

```bash
curl -sI --max-redirs 0 https://gotaxationhub.com/
curl -sI --max-redirs 0 https://www.gotaxationhub.com/
curl -sI --max-redirs 0 https://gotaxationhub.com/privacy
curl -sI --max-redirs 0 https://gotaxationhub.com/haulage/
```

Expect apex `/` and `/privacy` **200** with `x-powered-by: Express`.
Expect `www` a single **301** to `https://gotaxationhub.com/…` (not back
to www). Expect `/haulage/` a **302** to
`https://godriverhub.com/haulage/?app=taxationhub`.

Until Verify is green, keep using the service’s onrender URL. Pointing
the `A` record at Render before the certificate is issued serves HTTPS
with no cert for this name.

## Missing images

Used (real files already in the repo):

- `mobile/store/screenshots/play-1080x1920/02-dashboard.png`
- `mobile/store/screenshots/play-1080x1920/03-expenses.png`
- `mobile/store/screenshots/play-1080x1920/04-income.png`
- `mobile/store/screenshots/play-1080x1920/05-report.png`
- `public/truck.svg` (same mark as the Driver Hub overview; there is no
  separate Go Taxation Hub logo file)

Not used, because they are the wrong brand or show Fuel Hub:

- `mobile/store/screenshots/play-1080x1920/01-login.png` — Driver Hub
  picker with a Fuel Hub tile. Requesting it on this site is 404.
- `public/welcome-hub-shots/01-login.png` — login screen branded Driver Hub.
- `mobile/store/feature-graphic-1024x500.png` — wordmark plus “Fuel Hub”.
- `mobile-suite/store/screenshots/` — Go Taxation Suite, a different product.

Still missing if you want them later (do not invent stand-ins):

- A sign-in screenshot whose wordmark is Go Taxation Hub and which does
  not show Fuel Hub.
- An app-picker screenshot with only Taxation Hub.
- A landscape marketing graphic with no Fuel Hub line.
- A dedicated logo, if `truck.svg` should not be the mark.
