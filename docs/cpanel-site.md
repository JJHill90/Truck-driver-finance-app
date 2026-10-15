# Preview website on cPanel (app stays on Render)

`gotaxationsuite.com` is the **public preview site only**: About, screenshots,
store buttons, Support, Privacy, Terms.

The **tax application** (login, ledgers, Stripe, OCR) stays on Render:

`https://go-taxation-suite.onrender.com/suite/`

Do **not** point the apex domain at Render, and do **not** upload `server.js`
or `node_modules` to cPanel. Shared cPanel hosting cannot run this Node app.

## 1. Keep DNS on cPanel

Ace Host already serves `gotaxationsuite.com` (`A` `162.247.78.68`). **Leave
that A record.** Changing it to Render’s `216.24.57.1` would send the website
*and* every path (`/suite/`, `/api/…`) to the application host.

| Host | Type | Value | Purpose |
|------|------|--------|---------|
| `@` / `gotaxationsuite.com` | `A` | **keep** the cPanel/Ace Host IP | Preview website |
| `www` | `A` or `CNAME` | same cPanel account / `@` | Preview website |
| `app` (optional) | `CNAME` | `go-taxation-suite.onrender.com` | Application only |

Leave MX / mail records as they are.

## 2. Build (or use the committed folder)

From the repo:

```bash
npm run cpanel-site
```

That writes `cpanel-site/` (`index.html`, `support.html`, `privacy.html`,
`terms.html`, CSS/JS, screenshots, `.htaccess`).

## 3. Upload in cPanel File Manager

1. Log in to Ace Host **cPanel**.
2. **Domains** (or Addon Domains) — `gotaxationsuite.com` document root must
   be this site’s `public_html` (not a parked empty folder).
3. **File Manager** → open that `public_html`.
4. Upload **all** files from `cpanel-site/` into `public_html` (including
   `.htaccess` — enable “Show Hidden Files”).
5. Replace the empty directory listing. You should see `index.html` at the
   root, not only `cgi-bin/`.
6. SSL: **SSL/TLS Status** or AutoSSL for `gotaxationsuite.com` and `www`.
   Use **https://gotaxationsuite.com/** in Play / App Store listings.

After upload:

- `https://gotaxationsuite.com/` → preview (About, shots, store buttons)
- `https://gotaxationsuite.com/support` → contact form + FAQ
- `https://gotaxationsuite.com/privacy` and `/terms`
- **Open the app** → `https://go-taxation-suite.onrender.com/suite/`

The Support form posts to the Render API. Apex + www are already CORS
allowlisted. No Stripe webhook belongs on cPanel.

## 4. Optional prettier app URL

If you add `app.gotaxationsuite.com` as a **Render** custom domain on
`go-taxation-suite` (not on cPanel), then:

1. DNS: `app` CNAME → `go-taxation-suite.onrender.com`
2. Rebuild with `SUITE_APP_PUBLIC_URL=https://app.gotaxationsuite.com npm run cpanel-site`
3. Re-upload `cpanel-site/`
4. Set Render `APP_BASE_URL=https://app.gotaxationsuite.com` (Stripe return
   URLs). Keep the webhook on the Render host, not the cPanel apex.

Until then leave `APP_BASE_URL` as `https://go-taxation-suite.onrender.com`.

## 5. Check

```bash
curl -sI https://gotaxationsuite.com/
curl -sI https://gotaxationsuite.com/privacy
curl -sI https://gotaxationsuite.com/suite/
```

Home and Privacy should be **200** from Apache (cPanel). `/suite/` on the
apex will **not** be the app — that path is only on Render (or `app.`).
