# Official domain — website on cPanel, app on Render

**Website (preview):** `https://gotaxationsuite.com/` on Ace Host **cPanel**  
**Application (login, ledgers, Stripe):** `https://go-taxation-suite.onrender.com/suite/`

These are two different hosts. Full upload/DNS steps: [`cpanel-site.md`](cpanel-site.md).

| Page | Host | URL |
|------|------|-----|
| Preview / About / screenshots | cPanel | `https://gotaxationsuite.com/` |
| Support / Privacy / Terms | cPanel | `https://gotaxationsuite.com/support` (etc.) |
| Open the app | Render | `https://go-taxation-suite.onrender.com/suite/` |
| Stripe webhook | Render | `https://go-taxation-suite.onrender.com/api/haulage/billing/webhook` |

Do **not** attach `gotaxationsuite.com` as a Render custom domain. That would
steal the website off cPanel. Do **not** attach it to Driver Hub.

## DNS

Keep the apex **A** on the cPanel/Ace Host IP (today `162.247.78.68`).  
Do not change it to Render `216.24.57.1`.

Optional later: `app.gotaxationsuite.com` CNAME → `go-taxation-suite.onrender.com`
(Render custom domain on `go-taxation-suite` only).

## Stripe / Play

- Stripe Checkout and the webhook stay on the Render origin. Do not set
  `APP_BASE_URL` to the cPanel apex (there is no `/suite/` there).
- Play / App Store **Marketing / Privacy / Support** URLs can use
  `https://gotaxationsuite.com/` once `index.html` is in cPanel `public_html`.
- The Android/iOS WebView keeps loading
  `https://go-taxation-suite.onrender.com/suite/` until you add `app.` and
  ship a new AAB.
