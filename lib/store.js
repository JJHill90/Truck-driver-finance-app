import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentFinancialYear } from './tax.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads')
const STORE_FILE = path.join(DATA_DIR, 'store.json')

function ensureDirs() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

function defaultStore() {
  return {
    profile: {
      name: '',
      driverType: 'employee',
      employer: '',
      annualSalary: 0,
      salaryBand: 'band1',
      tfnSupplied: true,
      financialYear: currentFinancialYear(),
    },
    expenses: [],
    income: [],
    receipts: [],
    vendors: [],
  }
}

let store = null

export function loadStore() {
  if (store) return store
  ensureDirs()
  try {
    if (fs.existsSync(STORE_FILE)) {
      store = { ...defaultStore(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }
    } else {
      store = defaultStore()
    }
  } catch {
    store = defaultStore()
  }
  return store
}

export function saveStore() {
  ensureDirs()
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))
}

export function getStore() {
  return loadStore()
}

export function newId() {
  return randomUUID()
}

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

/** Persist a base64 data URL (or raw base64) to disk; returns { imagePath, bytes }. */
export function saveReceiptImage(id, dataUrl, mimeType) {
  ensureDirs()
  const base64 = String(dataUrl || '').includes(',')
    ? String(dataUrl).split(',')[1]
    : String(dataUrl || '')
  const buffer = Buffer.from(base64, 'base64')
  const ext = EXT_BY_MIME[mimeType] || 'bin'
  const filePath = path.join(UPLOADS_DIR, `${id}.${ext}`)
  fs.writeFileSync(filePath, buffer)
  return { imagePath: filePath, bytes: buffer.length }
}

export function readReceiptImage(receipt) {
  if (!receipt?.imagePath || !fs.existsSync(receipt.imagePath)) return null
  const buffer = fs.readFileSync(receipt.imagePath)
  return { buffer, mimeType: receipt.mimeType || 'application/octet-stream' }
}

export function readReceiptDataUrl(receipt) {
  const img = readReceiptImage(receipt)
  if (!img) return null
  return `data:${img.mimeType};base64,${img.buffer.toString('base64')}`
}

/** Upsert a vendor by ABN or name; returns the vendor record. */
export function upsertVendor({ vendor, vendorAbn, vendorId }) {
  const s = getStore()
  const name = (vendor || '').trim()
  if (!name) return null
  const abn = (vendorAbn || '').replace(/\s/g, '')
  let found =
    (vendorId && s.vendors.find((v) => v.id === vendorId)) ||
    (abn && s.vendors.find((v) => (v.abn || '').replace(/\s/g, '') === abn)) ||
    s.vendors.find((v) => v.name.toLowerCase() === name.toLowerCase())
  if (found) {
    if (abn && !found.abn) found.abn = vendorAbn
    return found
  }
  found = { id: newId(), name, abn: vendorAbn || '' }
  s.vendors.push(found)
  return found
}

/** Records payload for GET /records — receipts are returned as metadata only. */
export function recordsPayload() {
  const s = getStore()
  return {
    profile: s.profile,
    expenses: s.expenses,
    income: s.income,
    vendors: s.vendors,
    receipts: s.receipts.map((r) => ({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      hasImage: Boolean(r.imagePath),
      ocrResult: r.ocrResult,
      manual: r.manual,
      linkedExpenseId: r.linkedExpenseId,
      createdAt: r.createdAt,
    })),
  }
}
