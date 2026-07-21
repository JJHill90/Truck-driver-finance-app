# Truck-driver-finance-app

**Haulage** — a finance tool for Australian truck drivers to track work expenses
and income/remittances, capture receipts, and produce a live EOFY performance
statement, tax estimate and financial forecast.

The frontend is a framework-free single-page app (`public/app.js`) served by a
small **Node.js + Express** backend that stores data in a local JSON file
(`data/driver-records.json`) and receipt files under `data/receipts/`. No
database is required.

> **Receipt/payslip OCR:** works out of the box with **local OCR** (Tesseract.js)
> plus a manual approve-totals step. If `OPENAI_API_KEY` is set, cloud OCR
> (OpenAI `gpt-4o-mini` vision) is used and merged with the local result. PDF
> income documents are parsed via `pdf-parse`. No key is required to run.

### Scan enrichment (breakdown + ATO compliance)

When a document is scanned, the total is broken down into typed components and
checked against ATO transport-industry standards:

- **Income (payslip/remittance):** components for Wages/gross, PAYG tax,
  Superannuation, Entitlements/allowances, GST and Net pay; compliance checks for
  the Super Guarantee rate (12% for 2025-26+), PAYG withholding and net
  reconciliation. Undetected components (e.g. super) are estimated and flagged.
- **Expense:** line-item breakdown plus checks for ATO reasonable-amount meal
  caps and the $300 substantiation threshold.

The scanned image is shown during review and can be clicked to enlarge (a
lightbox) so totals are easy to read before approving. This enrichment lives in
`lib/document-breakdown.js` (backend) and `public/enhancements.js` (UI layer),
leaving the provided `app.js` untouched.

## Requirements

- Node.js 20+ (developed on Node 22)
- npm 10+

## Getting started

```bash
npm install
npm start
```

Then open **http://localhost:3000/haulage/** (the root path `/` redirects there).

## Scripts

| Command          | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `npm start`      | Start the Express server + UI on port `3000`.                |
| `npm run dev`    | Same, with `node --watch` auto-restart on file changes.      |
| `npm run lint`   | Run ESLint over server/lib code.                             |
| `npm test`       | Run backend unit tests (Vitest) for the tax/analysis logic.  |

## Project structure

```
server.js               Express app: static UI + JSON API under /api/haulage
tax-calculator.test.js  Unit tests for the ATO tax/deduction logic
lib/                    Provided backend modules (verbatim):
  ato-standards.js      ATO categories, income types, caps, FY helpers
  tax-calculator.js     Tax brackets, deduction analysis, year summary/report
  forecast.js           EOFY projection + scenarios
  storage.js            JSON-file store + receipt image persistence
  receipt-ocr.js        OCR orchestration (OpenAI + local + merge)
  local-receipt-ocr.js  Tesseract.js money/text extraction
  income-document-ocr.js Payslip/remittance + PDF parsing
  receipt-ocr-money.js  Money parsing helpers
public/
  index.html            App shell / all DOM the frontend expects
  app.js                Frontend SPA (provided verbatim)
  styles.css            Styles
  truck.svg             Icon
data/                   Runtime store + receipts (git-ignored)
```

## Environment variables

- `PORT` — server port (default `3000`).
- `OPENAI_API_KEY` — optional; enables cloud OCR for receipts/payslips.

## API (base `/api/haulage`)

`GET /standards`, `GET /records`, `GET /summary`, `GET /report`, `GET /forecast`,
`PUT /profile`, `POST|DELETE /expenses`, `POST /expenses/preview`,
`POST|DELETE /income`, `POST /receipts/scan`, `POST /receipts/manual`,
`POST /receipts/:id/confirm`, `GET /receipts/:id/image`, `GET /receipts/:id/file`.
