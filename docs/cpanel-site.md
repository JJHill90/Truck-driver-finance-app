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

## 2. Get the website files onto your computer

These files are **not** on your PC until you download them. They live in GitHub.

**Easiest:** download this zip (website files only, `index.html` at the top):

https://github.com/JJHill90/Truck-driver-finance-app/raw/cursor/suite-preview-website-ddf2/gotaxationsuite-website-for-cpanel.zip

Save it, then unzip. You should see `index.html`, `support.html`, `shots`, and
the other site files. Those are what you upload into cPanel `public_html`.

Or from the repo: **Code →** switch branch to `cursor/suite-preview-website-ddf2`
→ **Download ZIP**, unzip, then open the inner folder named `cpanel-site`
(ignore the rest of the repo — do not upload `server.js` or `node_modules`).

To rebuild later from a clone: `npm run cpanel-site` writes `cpanel-site/`.

## 3. WHM (root) vs cPanel (website account)

WHM and cPanel are the **same product family**, not the same screen.

| You are in | Who it is for | What you see |
|------------|----------------|--------------|
| **WHM** (root / reseller) | The whole server | List Accounts, Create a New Account, DNS Zone Manager, AutoSSL for all accounts |
| **cPanel** (one domain user) | That website only | File Manager, `public_html`, SSL/TLS Status, Zone Editor |

File Manager, `public_html`, and “Domains / Addon Domains” live in **cPanel**,
not in the WHM root home. If you are in WHM as root you will not see them
until you open the **cPanel account** for `gotaxationsuite.com`.

### From WHM root — open or create that account

1. WHM search box: type **List Accounts** (Account Information → List Accounts).
2. Look for `gotaxationsuite.com`.
3. If it **is** listed: click the **cPanel** logo (or “Login”) on that row.
   That switches you from WHM into that site’s cPanel. Then use File Manager.
4. If it is **not** listed: **Create a New Account**
   - Domain: `gotaxationsuite.com`
   - A username + password for this site only (not the WHM root password)
   - Leave package/quota at the host default
   Then click the cPanel logo on the new row.
5. SSL for the whole server is **WHM → SSL/TLS → Manage AutoSSL** (Run AutoSSL
   for that user). The per-site “SSL/TLS Status” page is inside cPanel.

The empty `Index of /` + `cgi-bin/` page means Apache is serving the
**default/parked** vhost, not a cPanel account’s `public_html`. Creating the
account (step 4) or assigning the domain to an existing account is what
fixes that.

Do **not** upload the preview files into WHM root’s home (`/root`) or into
`/usr/local/apache/htdocs`. They belong in that cPanel user’s `public_html`.

### Then upload in that cPanel File Manager

1. In **cPanel** (not WHM): **Files → File Manager**.
2. Open `public_html` for `gotaxationsuite.com`.
3. Enable **Show Hidden Files** (Settings) so `.htaccess` is visible.
4. Upload **all** files from `cpanel-site/` into `public_html`.
5. You should see `index.html` at the root, not only `cgi-bin/`.
6. **Screenshots:** File Manager’s Upload button does **not** create folders.
   Create a folder named `shots` inside `public_html`, open it, and upload
   `01-login.png` … `05-report.png`. Or upload the zip into `public_html` and
   click **Extract** so the `shots` folder is created for you. Without that
   folder the phones on “A quick look” stay blank (`/shots/01-login.png` 404).
6. If AutoSSL was not run from WHM, cPanel → **SSL/TLS Status** → Run AutoSSL.
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
