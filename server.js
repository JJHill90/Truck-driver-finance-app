import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { standardsPayload } from './lib/standards.js'
import {
  getStore,
  newId,
  readReceiptDataUrl,
  readReceiptImage,
  recordsPayload,
  saveReceiptImage,
  saveStore,
  upsertVendor,
} from './lib/store.js'
import {
  analyzeExpense,
  buildForecast,
  buildReport,
  currentFinancialYear,
  summarize,
} from './lib/tax.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const PUBLIC_DIR = path.join(__dirname, 'public')

const app = express()
app.use(express.json({ limit: '30mb' }))

const api = express.Router()

// --- Reference data ------------------------------------------------------
api.get('/standards', (_req, res) => {
  res.json(standardsPayload())
})

api.get('/records', (_req, res) => {
  res.json(recordsPayload())
})

// --- Profile -------------------------------------------------------------
api.put('/profile', (req, res) => {
  const s = getStore()
  s.profile = { ...s.profile, ...req.body }
  if (req.body.annualSalary != null) s.profile.annualSalary = Number(req.body.annualSalary) || 0
  saveStore()
  res.json({ profile: s.profile })
})

// --- Summary / report / forecast ----------------------------------------
api.get('/summary', (req, res) => {
  const fy = req.query.financialYear || getStore().profile.financialYear || currentFinancialYear()
  res.json(summarize(getStore(), fy))
})

api.get('/report', (req, res) => {
  const fy = req.query.financialYear || getStore().profile.financialYear || currentFinancialYear()
  res.json(buildReport(getStore(), fy))
})

api.get('/forecast', (req, res) => {
  const { mode, projectedIncome, projectedDeductions } = req.query
  res.json(buildForecast(getStore(), { mode, projectedIncome, projectedDeductions }))
})

// --- Expenses ------------------------------------------------------------
api.post('/expenses/preview', (req, res) => {
  res.json(analyzeExpense(req.body || {}))
})

function createExpense(payload, receiptId = null) {
  const s = getStore()
  const vendor = upsertVendor(payload)
  const entry = {
    id: newId(),
    date: payload.date,
    category: payload.category || 'other_work',
    vendor: payload.vendor || '',
    vendorAbn: payload.vendorAbn || '',
    vendorId: vendor?.id || null,
    description: payload.description || '',
    amount: Number(payload.amount) || 0,
    workUsePercent: payload.workUsePercent == null ? 100 : Number(payload.workUsePercent),
    reimbursed: Boolean(payload.reimbursed),
    method: payload.method,
    kilometres: payload.kilometres != null ? Number(payload.kilometres) : undefined,
    laundryLoads: payload.laundryLoads != null ? Number(payload.laundryLoads) : undefined,
    laundryMixed: Boolean(payload.laundryMixed),
    receiptId,
    createdAt: new Date().toISOString(),
  }
  s.expenses.push(entry)
  saveStore()
  return { entry, analysis: analyzeExpense(entry) }
}

api.post('/expenses', (req, res) => {
  res.json(createExpense(req.body || {}))
})

api.delete('/expenses/:id', (req, res) => {
  const s = getStore()
  s.expenses = s.expenses.filter((e) => e.id !== req.params.id)
  saveStore()
  res.json({ ok: true })
})

// --- Income --------------------------------------------------------------
function createIncome(payload, receiptId = null) {
  const s = getStore()
  const amount = Number(payload.amount) || 0
  const grossTotal = payload.grossTotal != null && payload.grossTotal !== '' ? Number(payload.grossTotal) : amount
  const entry = {
    id: newId(),
    date: payload.date,
    type: payload.type || 'salary_wages',
    payer: payload.payer || payload.entity || '',
    entity: payload.entity || payload.payer || '',
    amount,
    grossTotal,
    taxableIncome:
      payload.taxableIncome != null && payload.taxableIncome !== '' ? Number(payload.taxableIncome) : grossTotal,
    gstAmount: payload.gstAmount != null && payload.gstAmount !== '' ? Number(payload.gstAmount) : 0,
    netPay: payload.netPay != null && payload.netPay !== '' ? Number(payload.netPay) : amount,
    description: payload.description || '',
    documentKind: payload.documentKind || '',
    reference: payload.reference || '',
    summaryNotes: payload.summaryNotes || '',
    claimingDeduction: Boolean(payload.claimingDeduction),
    receiptId,
    createdAt: new Date().toISOString(),
  }
  s.income.push(entry)
  saveStore()
  return { entry }
}

api.post('/income', (req, res) => {
  res.json(createIncome(req.body || {}))
})

api.delete('/income/:id', (req, res) => {
  const s = getStore()
  s.income = s.income.filter((i) => i.id !== req.params.id)
  saveStore()
  res.json({ ok: true })
})

// --- Receipts ------------------------------------------------------------
// OCR runs in fallback/manual mode: the image/PDF is stored and the user
// enters + approves the totals. No external AI key is required.
api.post('/receipts/scan', (req, res) => {
  const { imageBase64, mimeType, filename, purpose } = req.body || {}
  if (!imageBase64) {
    res.status(400).json({ error: 'Missing image data.' })
    return
  }
  const s = getStore()
  const id = newId()
  const isPdf = mimeType === 'application/pdf'
  let saved = { imagePath: null }
  try {
    saved = saveReceiptImage(id, imageBase64, mimeType)
  } catch {
    res.status(413).json({ error: 'Could not store file — it may be too large.' })
    return
  }

  const ocrResult = {
    documentType: purpose === 'income' ? 'income' : 'expense',
    ocrSource: isPdf ? 'pdf' : 'fallback',
    confidence: null,
    notes: isPdf
      ? 'PDF stored for your records — enter the totals from the document, then approve.'
      : 'Automatic scan is unavailable in this build — enter the total from your receipt image, then approve.',
    candidateAmounts: [],
    lineItems: [],
    date: null,
    vendor: '',
    vendorAbn: '',
    suggestedCategory: purpose === 'income' ? undefined : 'other_work',
    suggestedIncomeType: purpose === 'income' ? 'salary_wages' : undefined,
  }

  const receipt = {
    id,
    filename: filename || `receipt-${id}`,
    mimeType: mimeType || 'application/octet-stream',
    imagePath: saved.imagePath,
    ocrResult,
    manual: null,
    linkedExpenseId: null,
    purpose: purpose || 'expense',
    createdAt: new Date().toISOString(),
  }
  s.receipts.push(receipt)
  saveStore()

  res.json({
    receipt: { id: receipt.id, filename: receipt.filename, mimeType: receipt.mimeType, hasImage: true },
    ocrResult,
    detectedTotals: [],
  })
})

api.post('/receipts/manual', (req, res) => {
  res.json(createExpense(req.body || {}))
})

api.post('/receipts/:id/confirm', (req, res) => {
  const s = getStore()
  const receipt = s.receipts.find((r) => r.id === req.params.id)
  const { confirmed, purpose, ...payload } = req.body || {}

  if (!confirmed) {
    if (receipt) {
      receipt.manual = payload
      saveStore()
    }
    res.json({ ok: true, discarded: true })
    return
  }

  if (purpose === 'income') {
    const { entry } = createIncome(payload, receipt?.id || null)
    if (receipt) {
      receipt.linkedExpenseId = entry.id
      receipt.manual = payload
      saveStore()
    }
    res.json({ entry })
    return
  }

  const { entry, analysis } = createExpense(payload, receipt?.id || null)
  if (receipt) {
    receipt.linkedExpenseId = entry.id
    receipt.manual = payload
    if (payload.category && receipt.ocrResult) receipt.ocrResult.suggestedCategory = payload.category
    saveStore()
  }
  res.json({ entry, analysis })
})

api.get('/receipts/:id/image', (req, res) => {
  const receipt = getStore().receipts.find((r) => r.id === req.params.id)
  const dataUrl = receipt && readReceiptDataUrl(receipt)
  if (!dataUrl) {
    res.status(404).json({ error: 'Receipt image not found.' })
    return
  }
  res.json({ dataUrl })
})

api.get('/receipts/:id/file', (req, res) => {
  const receipt = getStore().receipts.find((r) => r.id === req.params.id)
  const img = receipt && readReceiptImage(receipt)
  if (!img) {
    res.status(404).json({ error: 'Receipt file not found.' })
    return
  }
  res.setHeader('Content-Type', img.mimeType)
  if (req.query.download) {
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.filename || 'receipt'}"`)
  }
  res.send(img.buffer)
})

app.use('/api/haulage', api)

// --- Static UI at /haulage ----------------------------------------------
app.use('/haulage', express.static(PUBLIC_DIR))
app.get('/haulage', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')))
app.get('/', (_req, res) => res.redirect('/haulage/'))

// JSON body-size / parse errors -> 413 so the client shows a friendly message.
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Upload too large.' })
    return
  }
  res.status(err.status || 500).json({ error: err.message || 'Server error' })
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Haulage finance app running at http://localhost:${PORT}/haulage/`)
  })
}

export { app }
