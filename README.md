# Truck-driver-finance-app

**Haulage** — a finance tool for Australian truck drivers to track work expenses
and income/remittances, capture receipts, and produce a live EOFY performance
statement, tax estimate and financial forecast.

The frontend is a framework-free single-page app (`public/app.js`) served by a
small **Node.js + Express** backend that stores data in a local JSON file
(`data/store.json`) and receipt files under `data/uploads/`. No database or
external services are required.

> Receipt/payslip scanning runs in **manual/fallback mode**: uploaded images and
> PDFs are stored, and you enter + approve the totals. No AI/OCR API key is
> needed to run the app.

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
server.js            Express app: static UI + JSON API under /api/haulage
lib/
  standards.js       Categories, income types, driver types, ATO caps
  tax.js             Tax brackets, expense analysis, summary/report/forecast
  tax.test.js        Unit tests for the pure logic
  store.js           JSON-file store + receipt image persistence
public/
  index.html         App shell / all DOM the frontend expects
  app.js             Frontend SPA (provided verbatim)
  styles.css         Styles
  truck.svg          Icon
data/                Runtime store + uploaded receipts (git-ignored)
```

## API (base `/api/haulage`)

`GET /standards`, `GET /records`, `GET /summary`, `GET /report`, `GET /forecast`,
`PUT /profile`, `POST|DELETE /expenses`, `POST /expenses/preview`,
`POST|DELETE /income`, `POST /receipts/scan`, `POST /receipts/manual`,
`POST /receipts/:id/confirm`, `GET /receipts/:id/image`, `GET /receipts/:id/file`.
