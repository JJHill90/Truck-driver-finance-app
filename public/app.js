const API = `${window.location.origin}/api/haulage`;
const SCAN_TIMEOUT_MS = 90000;
const PERIOD_STORAGE_KEY = "haulage-expense-total-period";

const state = {
  standards: null,
  records: null,
  summary: null,
  report: null,
  forecast: null,
  financialYear: null, // set to current AU FY on init
  fyUserSelected: false,
  forecastMode: "realtime",
  expenseTotalPeriod: loadSavedPeriod(),
};

function loadSavedPeriod() {
  try {
    const saved = localStorage.getItem(PERIOD_STORAGE_KEY);
    if (["daily", "weekly", "monthly", "yearly"].includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  return "monthly";
}

function savePeriod(period) {
  state.expenseTotalPeriod = period;
  try {
    localStorage.setItem(PERIOD_STORAGE_KEY, period);
  } catch {
    /* ignore */
  }
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const fmt = (n) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n || 0);

const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json", ...opts.headers },
      ...opts,
    });
  } catch (err) {
    if (window.location.protocol === "file:") {
      throw new Error("Open the app at http://localhost:3000/haulage/ — not as a local file.");
    }
    throw new Error(
      `Network error — start the server (npm start) and use http://localhost:${window.location.port || 3000}/haulage/`
    );
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 413) {
    throw new Error("Photo too large — try a smaller image or use manual entry.");
  }
  if (!res.ok) throw new Error(data.error || data.detail || "Request failed");
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function compressImage(file, maxDim = 1024, quality = 0.72, mime = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (mime === "image/png") {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(mime, mime === "image/jpeg" ? quality : undefined));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not process image — try JPG or PNG."));
    };
    img.src = url;
  });
}

async function prepareImageForUpload(file) {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error(`${file.name} exceeds 25 MB. Use a smaller file or manual entry.`);
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isPdf = file.type === "application/pdf" || ext === "pdf";

  if (isPdf) {
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl.length > 12_000_000) {
      throw new Error("PDF too large (max ~9 MB). Use manual entry.");
    }
    return { dataUrl, mimeType: "application/pdf", kind: "pdf" };
  }

  const imageExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif"];
  const isImage = file.type.startsWith("image/") || imageExts.includes(ext);
  if (!isImage) {
    throw new Error(`Unsupported file: ${file.name}. Use JPG, PNG, WEBP, or PDF.`);
  }

  const isPng = file.type === "image/png" || ext === "png";
  const outputMime = isPng ? "image/png" : "image/jpeg";
  const raw = await readFileAsDataUrl(file);
  const mimeType = file.type || outputMime;

  // Keep original file when small enough — critical for PNG receipt screenshots/OCR
  if (raw.length <= 3_500_000) {
    return { dataUrl: raw, mimeType, kind: "image" };
  }

  const steps = isPng
    ? [
        [2200, 1],
        [1800, 1],
        [1600, 1],
        [1400, 1],
        [1200, 1],
        [1024, 1],
      ]
    : [
        [1400, 0.8],
        [1200, 0.72],
        [1024, 0.65],
        [900, 0.55],
        [768, 0.45],
        [640, 0.38],
      ];

  for (const [dim, q] of steps) {
    try {
      const dataUrl = await compressImage(file, dim, q, outputMime);
      if (dataUrl.length <= 3_500_000) {
        return { dataUrl, mimeType: outputMime, kind: "image" };
      }
    } catch {
      break;
    }
  }

  if (raw.length <= 8_000_000) {
    return { dataUrl: raw, mimeType, kind: "image" };
  }

  throw new Error(
    `${file.name} is too large. Try a smaller screenshot, crop the image, or use manual entry.`
  );
}

function showReceiptPreview(prepared, filename) {
  const preview = document.getElementById("receipt-preview");
  preview.classList.remove("hidden");
  if (prepared.kind === "pdf") {
    preview.innerHTML = `
      <div class="file-preview-pill">PDF saved: ${filename}</div>
      <p class="muted">PDFs are stored for your records. Enter the amount and details manually.</p>
    `;
  } else {
    preview.innerHTML = `<img src="${prepared.dataUrl}" alt="Receipt preview" />`;
  }
}

async function uploadReceiptFile(file) {
  pickBtn.disabled = true;
  pickBtn.textContent = "Preparing…";
  const box = document.getElementById("scan-result");
  box.classList.add("hidden");
  pendingReceiptConfirm = null;
  clearManualReceiptFields();

  try {
    const prepared = await prepareImageForUpload(file);
    showReceiptPreview(prepared, file.name);
    pickBtn.textContent = "Scanning dollar totals…";

    const result = await apiWithTimeout("/receipts/scan", {
      method: "POST",
      body: JSON.stringify({
        imageBase64: prepared.dataUrl,
        mimeType: prepared.mimeType,
        filename: file.name,
      }),
    });

    box.classList.remove("hidden");
    const o = result.ocrResult || {};
    const totals = result.detectedTotals || getDetectedTotalsClient(o);

    pendingReceiptConfirm = {
      receiptId: result.receipt.id,
      ocrResult: o,
      detectedTotals: totals,
      filename: file.name,
      kind: prepared.kind,
      step: "review",
      awaitingApproval: true,
    };
    prefillManualReceiptForm(o, {
      amount: totals.find((t) => t.primary)?.amount ?? o.amount,
      pendingApproval: true,
    });
    setManualFormApprovalState(true);
    renderReceiptTotalConfirm(box);
    toast(
      totals.length
        ? "Fields filled from scan — approve totals before saving"
        : "Enter the total from your receipt, then approve to save"
    );
    await refreshAll();
  } catch (err) {
    box.classList.remove("hidden");
    box.innerHTML = `
      <h3>Could not upload file</h3>
      <p class="muted">${escapeHtml(err.message)}</p>
      <p>Try a JPG/PNG instead, or use <strong>Add receipt manually</strong> (no photo required).</p>
    `;
    toast(err.message);
  } finally {
    pickBtn.disabled = false;
    pickBtn.textContent = "Choose file from PC";
    fileInput.value = "";
  }
}

function getDetectedTotalsClient(ocr) {
  if (!ocr) return [];
  const totals = [];
  const used = new Set();
  const isIncome = ocr.documentType === "income";
  const push = (label, amount, primary = false) => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const key = `${label}:${value.toFixed(2)}`;
    if (used.has(key) && !primary) return;
    used.add(key);
    totals.push({ label, amount: value, primary: Boolean(primary) });
  };
  if (isIncome) {
    push("Gross total", ocr.grossTotal || ocr.amount, true);
    push("Taxable income", ocr.taxableIncome);
    push("GST", ocr.gstAmount || ocr.gst);
    push("Net pay", ocr.netPay);
  } else {
    push("Grand total", ocr.amount, true);
    push("GST", ocr.gst);
  }
  for (const item of ocr.lineItems || []) push(item.description || "Line item", item.amount);
  for (const amount of ocr.candidateAmounts || []) {
    push(`Detected $${Number(amount).toFixed(2)}`, amount);
  }
  if (totals.length && !totals.some((t) => t.primary)) totals[0].primary = true;
  return totals;
}

function clearManualReceiptFields() {
  const form = document.getElementById("manual-receipt-form");
  if (!form) return;
  const date = form.elements.date?.value || localToday();
  form.reset();
  resetCategorySelect("manual-receipt-category");
  form.elements.date.value = date;
  form.elements.workUsePercent.value = 100;
  if (form.elements.vendorAbn) form.elements.vendorAbn.value = "";
  document.getElementById("manual-receipt-preview")?.classList.add("hidden");
  setManualFormApprovalState(false);
}

function setManualFormApprovalState(pending) {
  const form = document.getElementById("manual-receipt-form");
  const saveBtn = form?.querySelector('button[type="submit"], button[data-approve-scan]');
  const banner = document.getElementById("manual-approval-banner");

  if (saveBtn) {
    // Replace confusing disabled "Approve…" control with a working approve action
    if (pending) {
      saveBtn.disabled = false;
      saveBtn.type = "button";
      saveBtn.dataset.approveScan = "1";
      saveBtn.textContent = "Approve & save totals";
      saveBtn.onclick = (e) => {
        e.preventDefault();
        void finalizeScannedTotals({ confirmed: true, showDetails: false });
      };
    } else {
      saveBtn.disabled = false;
      saveBtn.type = "submit";
      delete saveBtn.dataset.approveScan;
      saveBtn.onclick = null;
      saveBtn.textContent = "Save manual receipt";
    }
  }

  if (banner) {
    banner.classList.toggle("hidden", !pending);
    if (pending) {
      banner.textContent =
        "Scanned values are filled in. Tap Approve & save totals (here or on the left) after checking the amount.";
    }
  }
  form?.classList.toggle("awaiting-approval", Boolean(pending));
}

function syncAmountToManualForm(amount) {
  const form = document.getElementById("manual-receipt-form");
  if (!form || amount == null || amount === "") return;
  form.elements.amount.value = amount;
  renderExpenseTotals();
  renderExpenseList();
}

function applyTotalsToManualFields({
  amount,
  date,
  category,
  vendor,
  vendorAbn,
  description,
  workUsePercent,
}) {
  const form = document.getElementById("manual-receipt-form");
  if (!form) return;
  if (date) form.elements.date.value = date;
  if (category) setCategorySelectValue("manual-receipt-category", category);
  if (vendor) form.elements.vendor.value = vendor;
  if (form.elements.vendorAbn) {
    form.elements.vendorAbn.value = vendorAbn || "";
  }
  if (description) form.elements.description.value = description;
  if (amount != null && amount !== "") form.elements.amount.value = amount;
  if (workUsePercent != null) form.elements.workUsePercent.value = workUsePercent;
  renderExpenseTotals();
}

function readManualFormPayload() {
  const form = document.getElementById("manual-receipt-form");
  if (!form) return null;
  const nameInput = document.getElementById("manual-vendor-input");
  const abnInput = document.getElementById("manual-vendor-abn");
  const resolved = resolveVendorFromInput(nameInput, abnInput);
  const confirmAmount = document.getElementById("scan-confirm-amount");
  const amount = Number(confirmAmount?.value || form.elements.amount?.value);
  return {
    date: form.elements.date?.value || localToday(),
    category: form.elements.category?.value || "other_work",
    vendor: resolved.vendor || form.elements.vendor?.value || "",
    vendorAbn: resolved.vendorAbn || form.elements.vendorAbn?.value || "",
    vendorId: resolved.vendorId,
    description: form.elements.description?.value || "",
    amount,
    workUsePercent: Number(form.elements.workUsePercent?.value ?? 100),
    reimbursed: Boolean(form.elements.reimbursed?.checked),
  };
}

function renderReceiptTotalConfirm(box) {
  const pending = pendingReceiptConfirm;
  if (!pending) return;

  const o = pending.ocrResult || {};
  const primary =
    pending.detectedTotals.find((t) => t.primary)?.amount ??
    pending.detectedTotals[0]?.amount ??
    o.amount ??
    "";

  const hasTotals = pending.detectedTotals.length > 0;
  const totalsList = hasTotals
    ? pending.detectedTotals
        .map(
          (t, idx) =>
            `<li>
              <button type="button" class="detected-total-btn ${t.primary ? "detected-total-primary" : ""}" data-total-idx="${idx}">
                <span>${escapeHtml(t.label)}</span>
                <strong>${fmt(t.amount)}</strong>
              </button>
            </li>`
        )
        .join("")
    : `<li class="detected-total-empty"><span>No dollar amounts detected automatically</span><span class="muted">Check the receipt preview and enter the total below</span></li>`;

  const scanNote =
    o.ocrSource === "pdf"
      ? `<p class="tag warn">PDF uploaded — enter the dollar total from the document, then confirm.</p>`
      : o.ocrSource === "fallback" || o.ocrError
        ? `<p class="tag warn">${escapeHtml(o.notes || "Automatic scan unavailable — enter the total from your receipt image.")}</p>`
        : o.confidence
          ? `<p class="muted">Scan confidence: ${escapeHtml(o.confidence)}</p>`
          : "";

  const metaBits = [
    o.vendor ? `<span><strong>Vendor:</strong> ${escapeHtml(o.vendor)}</span>` : "",
    o.vendorAbn ? `<span><strong>ABN:</strong> ${escapeHtml(o.vendorAbn)}</span>` : "",
    o.date ? `<span><strong>Date:</strong> ${fmtDate(o.date)}</span>` : "",
    o.suggestedCategory
      ? `<span><strong>Category:</strong> ${escapeHtml(categoryLabel(o.suggestedCategory))}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  box.innerHTML = `
    <div class="scan-confirm">
      <h3>Approve scanned totals?</h3>
      <p class="muted">
        <strong>${escapeHtml(pending.filename)}</strong> filled the <strong>Add receipt manually</strong> fields
        (category, vendor${o.vendorAbn ? ", ABN" : ""}, amount). Approve the dollar total before saving.
      </p>
      ${scanNote}
      <ul class="detected-totals">${totalsList}</ul>
      ${metaBits ? `<div class="scan-confirm-meta">${metaBits}</div>` : ""}
      <p class="muted select-total-hint">${hasTotals ? "Tap a detected amount to use it, or type a correction — the manual form updates live." : "Type the total shown on your receipt."}</p>
      <label class="scan-confirm-amount-label">Total amount ($)
        <input type="number" id="scan-confirm-amount" step="0.01" min="0" value="${primary}" required />
      </label>
      <div class="scan-confirm-actions" id="scan-confirm-actions">
        <button type="button" class="btn primary" id="scan-confirm-yes">Yes — approve &amp; save</button>
        <button type="button" class="btn secondary" id="scan-confirm-edit">Edit details first</button>
        <button type="button" class="btn secondary" id="scan-confirm-discard">Discard</button>
      </div>
      <div id="scan-confirm-details" class="scan-confirm-details hidden"></div>
    </div>
  `;

  box.querySelectorAll("[data-total-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const total = pending.detectedTotals[Number(btn.dataset.totalIdx)];
      if (!total) return;
      pending.detectedTotals = pending.detectedTotals.map((t, i) => ({
        ...t,
        primary: i === Number(btn.dataset.totalIdx),
      }));
      const amountInput = document.getElementById("scan-confirm-amount");
      if (amountInput) amountInput.value = total.amount;
      syncAmountToManualForm(total.amount);
      box.querySelectorAll(".detected-total-btn").forEach((el) => el.classList.remove("detected-total-primary"));
      btn.classList.add("detected-total-primary");
      toast(`Using ${fmt(total.amount)} as total`);
    });
  });

  document.getElementById("scan-confirm-amount")?.addEventListener("input", (e) => {
    syncAmountToManualForm(e.target.value);
  });

  document.getElementById("scan-confirm-yes")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: true, showDetails: false });
  });
  document.getElementById("scan-confirm-edit")?.addEventListener("click", () => {
    showScanConfirmDetails(box);
  });
  document.getElementById("scan-confirm-discard")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: false, showDetails: false });
  });

  renderExpenseTotals();
  renderExpenseList();
}

function showScanConfirmDetails(box) {
  const pending = pendingReceiptConfirm;
  if (!pending) return;
  const o = pending.ocrResult || {};
  const details = document.getElementById("scan-confirm-details");
  if (!details) return;

  const categoryOptions = buildCategorySelectOptions(
    state.standards?.categories || [],
    state.standards?.categoryGroups
  );

  details.classList.remove("hidden");
  details.innerHTML = `
    <h4>Edit details before saving</h4>
    <p class="muted">Changes also update the manual form on the right.</p>
    <div class="form-grid scan-confirm-form">
      <label>Date<input type="date" id="scan-confirm-date" value="${escapeHtml(o.date || localToday())}" required /></label>
      <label>Category
        <select id="scan-confirm-category" class="category-select">
          <option value="">Choose category…</option>
          ${categoryOptions}
        </select>
      </label>
      <label>Vendor<input type="text" id="scan-confirm-vendor" value="${escapeHtml(o.vendor || "")}" placeholder="BP Truck Stop" /></label>
      <label>ABN (optional)<input type="text" id="scan-confirm-abn" value="${escapeHtml(o.vendorAbn || "")}" placeholder="12 345 678 901" /></label>
      <label>Description<input type="text" id="scan-confirm-description" value="${escapeHtml(o.description || "")}" placeholder="Diesel / meal / accommodation" /></label>
      <label>Work use %<input type="number" id="scan-confirm-work" value="100" min="0" max="100" /></label>
      <label class="checkbox"><input type="checkbox" id="scan-confirm-reimbursed" /> Reimbursed by employer</label>
    </div>
    <div class="scan-confirm-actions">
      <button type="button" class="btn primary" id="scan-confirm-apply">Approve &amp; save</button>
      <button type="button" class="btn secondary" id="scan-confirm-cancel">Discard totals</button>
    </div>
  `;

  if (o.suggestedCategory) {
    const catSelect = document.getElementById("scan-confirm-category");
    if (catSelect) catSelect.value = o.suggestedCategory;
  }

  const syncDetailsToForm = () => {
    applyTotalsToManualFields({
      amount: document.getElementById("scan-confirm-amount")?.value,
      date: document.getElementById("scan-confirm-date")?.value,
      category: document.getElementById("scan-confirm-category")?.value,
      vendor: document.getElementById("scan-confirm-vendor")?.value,
      vendorAbn: document.getElementById("scan-confirm-abn")?.value,
      description: document.getElementById("scan-confirm-description")?.value,
      workUsePercent: document.getElementById("scan-confirm-work")?.value,
    });
  };

  [
    "scan-confirm-date",
    "scan-confirm-category",
    "scan-confirm-vendor",
    "scan-confirm-abn",
    "scan-confirm-description",
    "scan-confirm-work",
    "scan-confirm-reimbursed",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", syncDetailsToForm);
    document.getElementById(id)?.addEventListener("change", syncDetailsToForm);
  });

  document.getElementById("scan-confirm-apply")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: true, showDetails: true });
  });
  document.getElementById("scan-confirm-cancel")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: false, showDetails: true });
  });

  box.querySelector("#scan-confirm-yes")?.classList.add("hidden");
  box.querySelector("#scan-confirm-edit")?.classList.add("hidden");
  box.querySelector("#scan-confirm-discard")?.classList.add("hidden");
}

function readScanConfirmPayload(showDetails) {
  const formPayload = readManualFormPayload();
  const pending = pendingReceiptConfirm;
  const o = pending?.ocrResult || {};
  const amount = Number(
    document.getElementById("scan-confirm-amount")?.value || formPayload?.amount
  );

  if (showDetails) {
    return {
      amount,
      date: document.getElementById("scan-confirm-date")?.value || formPayload?.date || o.date || localToday(),
      category:
        document.getElementById("scan-confirm-category")?.value ||
        formPayload?.category ||
        o.suggestedCategory ||
        "other_work",
      vendor:
        document.getElementById("scan-confirm-vendor")?.value ||
        formPayload?.vendor ||
        o.vendor ||
        "",
      vendorAbn:
        document.getElementById("scan-confirm-abn")?.value ||
        formPayload?.vendorAbn ||
        o.vendorAbn ||
        "",
      description:
        document.getElementById("scan-confirm-description")?.value ||
        formPayload?.description ||
        o.description ||
        "",
      workUsePercent: Number(
        document.getElementById("scan-confirm-work")?.value ?? formPayload?.workUsePercent ?? 100
      ),
      reimbursed: Boolean(document.getElementById("scan-confirm-reimbursed")?.checked),
    };
  }

  return {
    amount,
    date: formPayload?.date || o.date || localToday(),
    category: formPayload?.category || o.suggestedCategory || "other_work",
    vendor: formPayload?.vendor || o.vendor || "",
    vendorAbn: formPayload?.vendorAbn || o.vendorAbn || "",
    description: formPayload?.description || o.description || "",
    workUsePercent: Number(formPayload?.workUsePercent ?? 100),
    reimbursed: Boolean(formPayload?.reimbursed),
  };
}

async function finalizeScannedTotals({ confirmed, showDetails }) {
  const pending = pendingReceiptConfirm;
  if (!pending) return;

  const isIncomeScan = pending.purpose === "income";
  const box = document.getElementById(isIncomeScan ? "income-scan-result" : "scan-result");
  const payload = isIncomeScan
    ? readIncomeScanConfirmPayload()
    : readScanConfirmPayload(showDetails);

  if (confirmed && (!Number.isFinite(payload.amount) || payload.amount <= 0)) {
    toast("Enter a valid total amount from the document");
    document.getElementById(isIncomeScan ? "income-confirm-amount" : "scan-confirm-amount")?.focus();
    return;
  }

  // Never block approve just because category select was cleared — fall back to OCR/default
  if (confirmed && !isIncomeScan && !payload.category) {
    payload.category = pending.ocrResult?.suggestedCategory || "other_work";
    const catSel = document.getElementById("manual-receipt-category");
    if (catSel) catSel.value = payload.category;
  }

  box?.querySelectorAll(".scan-confirm-actions").forEach((el) => el.classList.add("hidden"));
  box?.insertAdjacentHTML("beforeend", `<p class="muted saving-note">Saving approved totals…</p>`);

  try {
    if (confirmed && !isIncomeScan) {
      applyTotalsToManualFields(payload);
    }
    if (confirmed && isIncomeScan) {
      prefillIncomeForm(pending.ocrResult, payload);
    }

    const result = await api(`/receipts/${pending.receiptId}/confirm`, {
      method: "POST",
      body: JSON.stringify({
        confirmed,
        purpose: isIncomeScan ? "income" : "expense",
        ...payload,
      }),
    });

    pendingReceiptConfirm = null;
    if (isIncomeScan) {
      setIncomeFormApprovalState(false);
    } else {
      setManualFormApprovalState(false);
    }

    if (confirmed && result.entry) {
      if (isIncomeScan) {
        const e = result.entry;
        box.innerHTML = `
          <h3>Payslip / remittance saved</h3>
          <div class="income-mini-summary saved">
            <div class="income-mini-title">${escapeHtml(e.entity || e.payer || "Income document")}</div>
            <div class="income-mini-row"><span>Gross</span><strong>${fmt(e.grossTotal ?? e.amount)}</strong></div>
            <div class="income-mini-row"><span>Taxable income</span><strong>${fmt(e.taxableIncome ?? e.amount)}</strong></div>
            <div class="income-mini-row"><span>GST</span><strong>${fmt(e.gstAmount || 0)}</strong></div>
            ${e.netPay != null ? `<div class="income-mini-row"><span>Net</span><strong>${fmt(e.netPay)}</strong></div>` : ""}
          </div>
          <p class="tag green">${fmt(e.amount)} added to income list</p>
        `;
        clearIncomeFormFields();
        await afterIncomeSaved(e, `${fmt(e.amount)} added to Income`);
        return;
      }

      box.innerHTML = `
        <h3>Totals approved &amp; saved</h3>
        <p class="tag green">${fmt(result.entry.amount)} added to expense list</p>
        ${result.analysis ? `<p>Deductible: <span class="tag green">${fmt(result.analysis.deductibleAmount)}</span></p>` : ""}
        <p class="muted">${escapeHtml(payload.vendor || "Receipt")}${payload.vendorAbn ? ` · ABN ${escapeHtml(payload.vendorAbn)}` : ""} · ${fmtDate(result.entry.date)} · ${escapeHtml(categoryLabel(result.entry.category || payload.category))}</p>
      `;
      clearManualReceiptFields();
      await afterExpenseSaved(result.entry, `${fmt(result.entry.amount)} added to Expenses`);
      return;
    } else {
      if (isIncomeScan) {
        clearIncomeFormFields();
        box.innerHTML = `
          <h3>Totals discarded</h3>
          <p class="muted">Document file is saved. Enter details manually when ready.</p>
        `;
      } else {
        clearManualReceiptFields();
        box.innerHTML = `
          <h3>Totals discarded</h3>
          <p class="muted">Receipt photo is saved. Enter details manually when ready.</p>
        `;
      }
      toast("Totals discarded — enter manually if needed");
      await refreshAll();
    }
  } catch (err) {
    if (isIncomeScan) setIncomeFormApprovalState(true);
    else setManualFormApprovalState(true);
    box?.querySelector(".saving-note")?.remove();
    box?.querySelectorAll(".scan-confirm-actions").forEach((el) => el.classList.remove("hidden"));
    toast(err.message || "Could not save totals");
  }
}

async function apiWithTimeout(path, opts = {}, timeoutMs = SCAN_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api(path, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Scan timed out — photo may be saved; complete details manually.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function renderVendorList() {
  const vendors = state.records?.vendors || [];
  const datalist = document.getElementById("vendor-list");
  if (!datalist) return;
  datalist.innerHTML = vendors
    .map((v) => {
      const label = v.abn ? `${v.name} (ABN ${v.abn})` : v.name;
      return `<option value="${v.name}" label="${label}" data-id="${v.id}" data-abn="${v.abn || ""}"></option>`;
    })
    .join("");
}

function resolveVendorFromInput(nameInput, abnInput) {
  const name = nameInput.value.trim();
  const vendors = state.records?.vendors || [];
  const abnClean = abnInput.value.replace(/\s/g, "").replace(/[^\d]/g, "");

  if (abnClean) {
    const byAbn = vendors.find((v) => (v.abn || "").replace(/\s/g, "") === abnClean);
    if (byAbn) return { vendorId: byAbn.id, vendor: byAbn.name, vendorAbn: byAbn.abn };
  }
  const byName = vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
  if (byName) return { vendorId: byName.id, vendor: byName.name, vendorAbn: byName.abn || abnClean };
  return { vendorId: null, vendor: name, vendorAbn: abnClean };
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

const receiptImageCache = new Map();
let activeReceiptId = null;
let pendingReceiptConfirm = null;

function findReceipt(id) {
  return (state.records?.receipts || []).find((r) => r.id === id);
}

function getReceiptsWithImages() {
  return (state.records?.receipts || []).filter((r) => r.hasImage || r.imagePath);
}

function receiptSummary(receipt) {
  const expense = (state.records?.expenses || []).find(
    (e) => e.receiptId === receipt.id || e.id === receipt.linkedExpenseId
  );
  const manual = receipt.manual;
  const ocr = receipt.ocrResult || {};
  return {
    date: manual?.date || expense?.date || ocr.date || receipt.createdAt?.slice(0, 10),
    vendor: manual?.vendor || expense?.vendor || ocr.vendor || receipt.filename || "Receipt",
    amount: manual?.amount ?? expense?.amount ?? ocr.amount ?? null,
  };
}

function isReceiptPdf(receipt) {
  return (
    receipt.mimeType?.includes("pdf") ||
    receipt.filename?.toLowerCase().endsWith(".pdf") ||
    receipt.imagePath?.toLowerCase().endsWith(".pdf")
  );
}

async function fetchReceiptImageDataUrl(receiptId) {
  if (receiptImageCache.has(receiptId)) return receiptImageCache.get(receiptId);
  const { dataUrl } = await api(`/receipts/${receiptId}/image`);
  receiptImageCache.set(receiptId, dataUrl);
  return dataUrl;
}

async function loadReceiptThumbnail(receiptId, imgEl) {
  try {
    imgEl.src = await fetchReceiptImageDataUrl(receiptId);
  } catch {
    imgEl.alt = "Could not load thumbnail";
  }
}

function receiptFileUrl(receiptId, download = false) {
  const q = download ? "?download=1" : "";
  return `${API}/receipts/${receiptId}/file${q}`;
}

function downloadReceiptFile(receiptOrId) {
  const receipt = typeof receiptOrId === "string" ? findReceipt(receiptOrId) : receiptOrId;
  if (!receipt) return;
  const a = document.createElement("a");
  a.href = receiptFileUrl(receipt.id, true);
  a.download = receipt.filename || `receipt-${receipt.id}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Download started");
}

async function shareReceiptFile(receiptOrId) {
  const receipt = typeof receiptOrId === "string" ? findReceipt(receiptOrId) : receiptOrId;
  if (!receipt) return;

  try {
    const res = await fetch(receiptFileUrl(receipt.id, true));
    if (!res.ok) throw new Error("Could not load receipt file");
    const blob = await res.blob();
    const file = new File(
      [blob],
      receipt.filename || `receipt-${receipt.id}.jpg`,
      { type: blob.type || receipt.mimeType || "image/jpeg" }
    );

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: receipt.filename || "Receipt" });
      toast("Shared");
      return;
    }
  } catch (err) {
    if (err.name === "AbortError") return;
  }

  downloadReceiptFile(receipt);
  toast("Download started — open Files, Google Drive, OneDrive, or Photos to save");
}

async function openReceiptViewer(receiptId) {
  const receipt = findReceipt(receiptId);
  if (!receipt) return;

  activeReceiptId = receiptId;
  const viewer = document.getElementById("receipt-viewer");
  const body = document.getElementById("receipt-viewer-body");
  const title = document.getElementById("receipt-viewer-title");
  const summary = receiptSummary(receipt);

  title.innerHTML = `
    <strong>${escapeHtml(summary.vendor)}</strong>
    <span class="muted">${fmtDate(summary.date)}${summary.amount != null ? ` · ${fmt(summary.amount)}` : ""}</span>
  `;
  body.innerHTML = `<p class="muted">Loading…</p>`;
  viewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  try {
    const dataUrl = await fetchReceiptImageDataUrl(receiptId);
    if (isReceiptPdf(receipt)) {
      body.innerHTML = `<iframe src="${dataUrl}" title="Receipt PDF"></iframe>`;
    } else {
      body.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(receipt.filename || "Receipt")}" />`;
    }
  } catch (err) {
    body.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

function closeReceiptViewer() {
  activeReceiptId = null;
  document.getElementById("receipt-viewer")?.classList.add("hidden");
  const body = document.getElementById("receipt-viewer-body");
  if (body) body.innerHTML = "";
  document.body.style.overflow = "";
}

function renderReceiptGallery() {
  const el = document.getElementById("receipt-gallery");
  if (!el) return;

  const receipts = getReceiptsWithImages();
  if (!receipts.length) {
    el.innerHTML = `<p class="muted">No receipt photos yet — scan or upload a receipt above.</p>`;
    return;
  }

  el.innerHTML = receipts
    .map((r) => {
      const s = receiptSummary(r);
      const pdf = isReceiptPdf(r);
      return `
        <button type="button" class="receipt-card" data-receipt-id="${r.id}" aria-label="View ${escapeHtml(s.vendor)}">
          <div class="receipt-card-thumb${pdf ? " is-pdf" : ""}">
            ${
              pdf
                ? '<span class="receipt-pdf-icon">PDF</span>'
                : `<img data-receipt-thumb="${r.id}" alt="" loading="lazy" />`
            }
          </div>
          <div class="receipt-card-meta">
            <strong>${escapeHtml(s.vendor)}</strong>
            <span>${fmtDate(s.date)}${s.amount != null ? ` · ${fmt(s.amount)}` : ""}</span>
          </div>
        </button>`;
    })
    .join("");

  el.querySelectorAll(".receipt-card").forEach((btn) => {
    btn.addEventListener("click", () => openReceiptViewer(btn.dataset.receiptId));
  });

  el.querySelectorAll("[data-receipt-thumb]").forEach((img) => {
    loadReceiptThumbnail(img.dataset.receiptThumb, img);
  });
}

function setView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(`view-${name}`)?.classList.add("active");
  document.querySelector(`.nav-btn[data-view="${name}"]`)?.classList.add("active");
  const titles = {
    dashboard: "Dashboard",
    receipts: "Scan receipt",
    expenses: "Expenses",
    income: "Income & remittances",
    report: "EOFY performance statement",
    forecast: "Financial forecast",
    profile: "Driver profile",
  };
  document.getElementById("page-title").textContent = titles[name] || name;
  if ((name === "receipts" || name === "expenses") && state.standards) {
    populateSelects();
  }
  if (name === "report") {
    void refreshEofyLive();
  }
  if (name === "forecast") loadForecast();
  if (name === "receipts") renderReceiptGallery();
  renderExpenseTotals();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});

document.getElementById("fy-select").addEventListener("change", async (e) => {
  await applyFinancialYear(e.target.value);
});

document.getElementById("profile-financial-year")?.addEventListener("change", async (e) => {
  await applyFinancialYear(e.target.value);
});

async function applyFinancialYear(fy) {
  if (!fy) return;
  state.fyUserSelected = true;
  state.financialYear = fy;
  document.getElementById("fy-label").textContent = fy.replace("-", "–");
  const topSel = document.getElementById("fy-select");
  const profileSel = document.getElementById("profile-financial-year");
  if (topSel && topSel.value !== fy) topSel.value = fy;
  if (profileSel && profileSel.value !== fy) profileSel.value = fy;
  try {
    await api("/profile", {
      method: "PUT",
      body: JSON.stringify({ financialYear: fy }),
    });
  } catch {
    /* keep UI selection even if profile save fails */
  }
  await refreshAll();
  if (state.expenseTotalPeriod === "yearly") renderExpenseTotals();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildCategorySelectOptions(categories, groups) {
  const byGroup = {};
  for (const cat of categories) {
    const g = cat.group || "Other";
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(cat);
  }

  const ordered = groups?.length
    ? groups
    : [...new Set(categories.map((c) => c.group || "Other"))];

  const parts = ['<option value="">Choose category…</option>'];
  for (const g of ordered) {
    const items = byGroup[g];
    if (!items?.length) continue;
    parts.push(`<option value="" disabled>— ${escapeHtml(g)} —</option>`);
    for (const c of items) {
      parts.push(`<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`);
    }
  }

  // Fallback: if grouping failed, list every category flat
  if (parts.length === 1) {
    for (const c of categories) {
      parts.push(`<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`);
    }
  }

  return parts.join("");
}

function populateCategorySelects() {
  if (!state.standards?.categories?.length) return;

  const html = buildCategorySelectOptions(
    state.standards.categories,
    state.standards.categoryGroups
  );

  for (const id of ["manual-receipt-category", "expense-category"]) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const prev = sel.value;
    sel.innerHTML = html;
    if (prev) {
      const match = [...sel.options].some((o) => o.value === prev);
      if (match) sel.value = prev;
    }
  }
}

function setCategorySelectValue(selectId, categoryId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.value = categoryId || "";
}

function resetCategorySelect(selectId) {
  setCategorySelectValue(selectId, "");
}

function categoryLabel(id) {
  const cat = state.standards?.categories?.find((c) => c.id === id);
  return cat?.label || id.replace(/_/g, " ");
}

function populateSelects() {
  if (!state.standards) return;
  populateCategorySelects();

  document.getElementById("income-type").innerHTML = state.standards.incomeTypes
    .map((t) => `<option value="${t.id}">${t.label}</option>`)
    .join("");

  document.getElementById("driver-type").innerHTML = Object.entries(state.standards.driverTypes)
    .map(([id, d]) => `<option value="${id}">${d.label}</option>`)
    .join("");
}

function formatFinancialYearValue(startYear) {
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function formatFinancialYearLabel(fy) {
  return `FY ${String(fy).replace("-", "–")}`;
}

function getCurrentFinancialYear() {
  const now = new Date();
  // Australian FY starts 1 July
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return formatFinancialYearValue(startYear);
}

/** Build FY options: past years + current + up to 20 years into the future. */
function buildFinancialYearOptions(yearsBack = 15, yearsForward = 20) {
  const currentStart = Number(getCurrentFinancialYear().split("-")[0]);
  const years = [];
  for (let y = currentStart + yearsForward; y >= currentStart - yearsBack; y -= 1) {
    years.push(formatFinancialYearValue(y));
  }
  return years;
}

function populateFinancialYearSelect(selectedFy) {
  const sel = document.getElementById("fy-select");
  const profileSel = document.getElementById("profile-financial-year");
  const targets = [sel, profileSel].filter(Boolean);
  if (!targets.length) return;

  const currentFy = getCurrentFinancialYear();
  const currentStart = Number(currentFy.split("-")[0]);
  const years = buildFinancialYearOptions(15, 20);
  let fy = selectedFy || state.financialYear || currentFy;

  if (!years.includes(fy)) {
    years.push(fy);
    years.sort((a, b) => Number(b.split("-")[0]) - Number(a.split("-")[0]));
  }

  const future = years.filter((y) => Number(y.split("-")[0]) > currentStart);
  const present = years.filter((y) => y === currentFy || Number(y.split("-")[0]) === currentStart);
  const past = years.filter((y) => Number(y.split("-")[0]) < currentStart);

  const optionHtml = (list) =>
    list.map((y) => `<option value="${y}">${formatFinancialYearLabel(y)}</option>`).join("");

  const html = [
    future.length ? `<optgroup label="Future (up to +20 years)">${optionHtml(future)}</optgroup>` : "",
    present.length ? `<optgroup label="Current">${optionHtml(present)}</optgroup>` : "",
    past.length ? `<optgroup label="Past">${optionHtml(past)}</optgroup>` : "",
  ].join("");

  for (const target of targets) {
    target.innerHTML = html;
    target.value = fy;
    // Optgroup options can fail to select on the same tick in some browsers
    if (target.value !== fy) {
      requestAnimationFrame(() => {
        target.value = fy;
      });
    }
  }

  state.financialYear = fy;
  const fyLabel = document.getElementById("fy-label");
  if (fyLabel) fyLabel.textContent = fy.replace("-", "–");
}

function parseFinancialYear(fy) {
  const m = String(fy).match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  return {
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`,
    label: `FY ${fy.replace("-", "–")}`,
  };
}

function getExpensePeriodRange(period) {
  const today = localToday();
  const now = new Date();

  if (period === "daily") {
    return { start: today, end: today, label: "Today" };
  }

  if (period === "weekly") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return {
      start: toLocalDateString(d),
      end: today,
      label: "This week (Mon–today)",
    };
  }

  if (period === "monthly") {
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    return { start, end: today, label: "This month" };
  }

  const fy = parseFinancialYear(state.financialYear);
  if (fy) {
    const end = today < fy.start ? fy.start : today > fy.end ? fy.end : today;
    return { start: fy.start, end, label: fy.label };
  }

  const yearStart = `${now.getFullYear()}-01-01`;
  return { start: yearStart, end: today, label: "This year" };
}

function getDraftExpenseFromForms() {
  if (pendingReceiptConfirm) {
    const amount = Number(document.getElementById("scan-confirm-amount")?.value);
    const date =
      document.getElementById("scan-confirm-date")?.value ||
      pendingReceiptConfirm.ocrResult?.date ||
      localToday();
    if (amount > 0 && date) {
      return {
        date,
        amount,
        workUsePercent: Number(document.getElementById("scan-confirm-work")?.value ?? 100),
        reimbursed: Boolean(document.getElementById("scan-confirm-reimbursed")?.checked),
        draft: true,
      };
    }
  }

  let draft = null;

  const expenseForm = document.getElementById("expense-form");
  if (expenseForm && document.getElementById("view-expenses")?.classList.contains("active")) {
    const amount = Number(expenseForm.elements.amount?.value);
    const date = expenseForm.elements.date?.value;
    if (amount > 0 && date) {
      draft = {
        date,
        amount,
        workUsePercent: Number(expenseForm.elements.workUsePercent?.value ?? 100),
        reimbursed: expenseForm.elements.reimbursed?.checked,
        draft: true,
      };
    }
  }

  const manualForm = document.getElementById("manual-receipt-form");
  if (manualForm && document.getElementById("view-receipts")?.classList.contains("active")) {
    const amount = Number(manualForm.elements.amount?.value);
    const date = manualForm.elements.date?.value;
    if (amount > 0 && date) {
      draft = {
        date,
        amount,
        workUsePercent: Number(manualForm.elements.workUsePercent?.value ?? 100),
        reimbursed: manualForm.elements.reimbursed?.checked,
        draft: true,
      };
    }
  }

  return draft;
}

function calcExpenseTotals(period = state.expenseTotalPeriod) {
  const range = getExpensePeriodRange(period);
  const expenses = [...(state.records?.expenses || [])];
  const draft = getDraftExpenseFromForms();
  if (draft) expenses.push(draft);

  const inRange = expenses.filter((e) => e.date >= range.start && e.date <= range.end);
  let gross = 0;
  let deductible = 0;

  for (const e of inRange) {
    const amount = Number(e.amount) || 0;
    gross += amount;
    if (!e.reimbursed) {
      deductible += amount * ((e.workUsePercent ?? 100) / 100);
    }
  }

  return {
    ...range,
    gross,
    deductible,
    count: inRange.length,
    hasDraft: Boolean(draft),
  };
}

function renderExpenseTotals() {
  const period = state.expenseTotalPeriod || "monthly";
  const t = calcExpenseTotals(period);
  const draftNote = t.hasDraft
    ? `<p class="muted totals-draft-note">Includes unsaved amount from the form / scan</p>`
    : "";

  const html = `
    <div class="stat-card expense">
      <div class="label">Gross total</div>
      <div class="value">${fmt(t.gross)}</div>
      <div class="sub">${t.count} item${t.count === 1 ? "" : "s"} · ${t.label}</div>
    </div>
    <div class="stat-card expense">
      <div class="label">Est. deductible</div>
      <div class="value">${fmt(t.deductible)}</div>
      <div class="sub">Before ATO caps</div>
    </div>
    ${draftNote}
  `;

  const targets = ["expense-totals", "dashboard-expense-totals"];
  for (const id of targets) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  const receiptTotalsEl = document.getElementById("receipt-expense-totals");
  if (receiptTotalsEl) {
    receiptTotalsEl.innerHTML = `
      <div class="expense-totals-panel compact">
        <div class="panel-header expense-totals-header">
          <div>
            <h2>Total expenses</h2>
            <p class="muted">${t.label}</p>
          </div>
          <select class="period-select receipt-period-select" aria-label="Expense total period">
            <option value="daily"${period === "daily" ? " selected" : ""}>Daily</option>
            <option value="weekly"${period === "weekly" ? " selected" : ""}>Weekly</option>
            <option value="monthly"${period === "monthly" ? " selected" : ""}>Monthly</option>
            <option value="yearly"${period === "yearly" ? " selected" : ""}>Yearly</option>
          </select>
        </div>
        <div class="expense-totals-grid">${html}</div>
      </div>
    `;
    receiptTotalsEl.querySelector(".receipt-period-select")?.addEventListener("change", (e) => {
      setExpenseTotalPeriod(e.target.value);
    });
  }

  for (const id of ["expense-total-range-label", "dashboard-expense-total-range-label"]) {
    const rangeLabel = document.getElementById(id);
    if (rangeLabel) rangeLabel.textContent = t.label;
  }

  const periodSelect = document.getElementById("expense-total-period");
  if (periodSelect && periodSelect.value !== period) periodSelect.value = period;
}

function setExpenseTotalPeriod(period) {
  if (!["daily", "weekly", "monthly", "yearly"].includes(period)) return;
  savePeriod(period);
  renderExpenseTotals();
  renderExpenseList();
}

function renderStats() {
  const s = state.summary;
  if (!s) return;
  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card income"><div class="label">Assessable income</div><div class="value">${fmt(s.income.assessableTotal)}</div><div class="sub">${s.income.breakdown.length} income types</div></div>
    <div class="stat-card expense"><div class="label">Deductible expenses</div><div class="value">${fmt(s.expenses.deductibleTotal)}</div><div class="sub">Gross spend ${fmt(s.expenses.grossTotal)}</div></div>
    <div class="stat-card tax"><div class="label">Est. taxable income</div><div class="value">${fmt(s.taxEstimate.taxableIncome)}</div><div class="sub">Effective rate ${s.taxEstimate.effectiveRate}%</div></div>
    <div class="stat-card tax"><div class="label">Est. tax (inc. Medicare)</div><div class="value">${fmt(s.taxEstimate.totalTax)}</div><div class="sub">Income tax ${fmt(s.taxEstimate.incomeTax)}</div></div>
  `;

  document.getElementById("snapshot-content").innerHTML = `
    <p><strong>Net position (before private expenses):</strong> ${fmt(s.income.assessableTotal - s.taxEstimate.totalTax)} after estimated tax</p>
    <p class="muted">${s.substantiation.message}</p>
    ${s.warnings.length ? `<ul class="warning-list">${s.warnings.slice(0, 5).map((w) => `<li>${w.message}</li>`).join("")}</ul>` : ""}
  `;

  const caps = s.allowances.domesticTravelCaps;
  document.getElementById("allowance-caps").innerHTML = `
    <div class="cap-list">
      <div class="cap-row"><span>Salary band</span><span>${s.profile.salaryBand.replace("band", "Band ")}</span></div>
      <div class="cap-row"><span>Breakfast cap</span><span>${fmt(s.allowances.truckDriverMealsDaily.breakfast.cap)}</span></div>
      <div class="cap-row"><span>Lunch cap</span><span>${fmt(s.allowances.truckDriverMealsDaily.lunch.cap)}</span></div>
      <div class="cap-row"><span>Dinner cap</span><span>${fmt(s.allowances.truckDriverMealsDaily.dinner.cap)}</span></div>
      <div class="cap-row"><span>Overtime meal cap</span><span>${fmt(s.allowances.overtimeMealCap)}</span></div>
      <div class="cap-row"><span>Accommodation (daily ref.)</span><span>${fmt(caps.accommodation)}</span></div>
      <div class="cap-row"><span>Incidentals (daily ref.)</span><span>${fmt(caps.incidentals)}</span></div>
    </div>
  `;
}

function renderRecentActivity() {
  const expenses = (state.records?.expenses || []).slice(0, 8);
  const income = (state.records?.income || []).slice(0, 5);
  const rows = [
    ...expenses.map((e) => ({
      date: e.date,
      type: "Expense",
      desc: e.description || e.vendor || e.category,
      amount: -e.amount,
    })),
    ...income.map((i) => ({
      date: i.date,
      type: "Income",
      desc: i.description || i.payer || i.type,
      amount: i.amount,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  if (!rows.length) {
    document.getElementById("recent-activity").innerHTML = `<p class="muted">No transactions yet — add an expense or scan a receipt.</p>`;
    return;
  }

  document.getElementById("recent-activity").innerHTML = `
    <table class="data">
      <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${fmtDate(r.date)}</td><td><span class="tag ${r.type === "Income" ? "green" : ""}">${r.type}</span></td><td>${r.desc}</td><td class="amount">${fmt(Math.abs(r.amount))}${r.amount < 0 ? " DR" : " CR"}</td></tr>`
        )
        .join("")}</tbody>
    </table>
  `;
}

function renderExpenseList() {
  const saved = [...(state.records?.expenses || [])].sort((a, b) => {
    const byDate = String(b.date || "").localeCompare(String(a.date || ""));
    if (byDate) return byDate;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  const draft = getDraftExpenseFromForms();
  const rows = [...saved];
  if (draft) {
    rows.unshift({
      ...draft,
      id: "__draft__",
      category:
        document.getElementById("scan-confirm-category")?.value ||
        document.getElementById("expense-category")?.value ||
        document.querySelector("#manual-receipt-form [name=category]")?.value ||
        "other_work",
      description:
        document.getElementById("scan-confirm-description")?.value ||
        document.querySelector("#expense-form [name=description]")?.value ||
        document.querySelector("#manual-receipt-form [name=description]")?.value ||
        "Pending save",
      vendor:
        document.getElementById("scan-confirm-vendor")?.value ||
        document.querySelector("#expense-form [name=vendor]")?.value ||
        document.querySelector("#manual-receipt-form [name=vendor]")?.value ||
        "",
    });
  }

  const range = getExpensePeriodRange(state.expenseTotalPeriod);
  const periodTotals = calcExpenseTotals();
  const allGross = saved.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const el = document.getElementById("expense-list");
  const summary = document.getElementById("expense-list-summary");
  if (summary) {
    summary.textContent = `${saved.length} saved · running total ${fmt(allGross)} · ${range.label} ${fmt(periodTotals.gross)}`;
  }

  if (!rows.length) {
    el.innerHTML = `<p class="muted">No expenses yet — save from Scan receipt, Add expense, or Approve totals.</p>`;
    return;
  }

  el.innerHTML = `
    <table class="data expense-ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th>Category</th>
          <th>Vendor / details</th>
          <th>Amount</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows
        .map((e) => {
          const isDraft = e.id === "__draft__" || e.draft;
          const inPeriod = e.date >= range.start && e.date <= range.end;
          const detail = [e.vendor, e.description].filter(Boolean).join(" · ") || "—";
          return `<tr class="${isDraft ? "draft-row" : ""} ${inPeriod ? "in-period" : "out-of-period"}" data-expense-id="${e.id}">
            <td>${fmtDate(e.date)}</td>
            <td>${escapeHtml(categoryLabel(e.category))}</td>
            <td>${escapeHtml(detail)}${isDraft ? ' <span class="tag">unsaved</span>' : ""}${
              !isDraft && !inPeriod ? ' <span class="tag">outside period</span>' : ""
            }</td>
            <td class="amount">${fmt(e.amount)}</td>
            <td><div class="row-actions">${
              isDraft
                ? ""
                : `${
                    e.receiptId
                      ? `<button type="button" class="btn secondary small" data-view-receipt="${e.receiptId}">Photo</button>`
                      : ""
                  }<button type="button" class="btn danger" data-del-expense="${e.id}">Delete</button>`
            }</div></td>
          </tr>`;
        })
        .join("")}</tbody>
      <tfoot>
        <tr>
          <td colspan="3"><strong>Period total (${escapeHtml(range.label)})</strong></td>
          <td class="amount"><strong>${fmt(periodTotals.gross)}</strong></td>
          <td></td>
        </tr>
        <tr class="running-total-row">
          <td colspan="3"><strong>Running total (all expenses)</strong></td>
          <td class="amount"><strong>${fmt(allGross + (draft ? Number(draft.amount) || 0 : 0))}</strong></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  `;

  el.querySelectorAll("[data-del-expense]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/expenses/${btn.dataset.delExpense}`, { method: "DELETE" });
      toast("Expense deleted");
      await refreshAll();
    });
  });
  el.querySelectorAll("[data-view-receipt]").forEach((btn) => {
    btn.addEventListener("click", () => openReceiptViewer(btn.dataset.viewReceipt));
  });
}

function highlightExpenseInList(expenseId) {
  if (!expenseId) return;
  const row = document.querySelector(`[data-expense-id="${expenseId}"]`);
  if (!row) return;
  row.classList.add("just-added");
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => row.classList.remove("just-added"), 2200);
}

async function afterExpenseSaved(entry, message) {
  toast(message || "Expense saved");
  await alignFinancialYearToEntry(entry);
  await refreshAll();
  setView("expenses");
  if (entry?.id) highlightExpenseInList(entry.id);
  renderExpenseTotals();
  renderExpenseList();
  // EOFY deductions stay live even while remaining on Expenses
  await refreshEofyLive();
}

function renderIncomeList() {
  const list = state.records?.income || [];
  const el = document.getElementById("income-list");
  if (!list.length) {
    el.innerHTML = `<p class="muted">No income recorded.</p>`;
    return;
  }
  el.innerHTML = `
    <table class="data income-ledger">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Summary</th>
          <th>Amount</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${list
        .map((i) => {
          const entity = i.entity || i.payer || "—";
          const kind = i.documentKind ? i.documentKind.replace(/_/g, " ") : "";
          const mini = `
            <div class="income-mini-summary inline">
              <div class="income-mini-title">${escapeHtml(entity)}${kind ? ` · ${escapeHtml(kind)}` : ""}</div>
              <div class="income-mini-breakdown">
                <span>Gross ${fmt(i.grossTotal ?? i.amount)}</span>
                <span>Taxable ${fmt(i.taxableIncome ?? i.amount)}</span>
                <span>GST ${fmt(i.gstAmount || 0)}</span>
              </div>
              ${i.description ? `<div class="muted small">${escapeHtml(i.description)}</div>` : ""}
            </div>`;
          return `<tr data-income-id="${i.id}">
            <td>${fmtDate(i.date)}</td>
            <td>${escapeHtml((i.type || "").replace(/_/g, " "))}</td>
            <td>${mini}</td>
            <td class="amount">${fmt(i.amount)}</td>
            <td><div class="row-actions">${
              i.receiptId
                ? `<button type="button" class="btn secondary small" data-view-receipt="${i.receiptId}">Photo</button>`
                : ""
            }<button class="btn danger" data-del-income="${i.id}">Delete</button></div></td>
          </tr>`;
        })
        .join("")}</tbody>
    </table>
  `;
  el.querySelectorAll("[data-del-income]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/income/${btn.dataset.delIncome}`, { method: "DELETE" });
      toast("Income deleted");
      await refreshAll();
    });
  });
  el.querySelectorAll("[data-view-receipt]").forEach((btn) => {
    btn.addEventListener("click", () => openReceiptViewer(btn.dataset.viewReceipt));
  });
}

function highlightIncomeInList(incomeId) {
  if (!incomeId) return;
  const row = document.querySelector(`[data-income-id="${incomeId}"]`);
  if (!row) return;
  row.classList.add("just-added");
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => row.classList.remove("just-added"), 2200);
}

async function afterIncomeSaved(entry, message) {
  toast(message || "Income saved");
  await alignFinancialYearToEntry(entry);
  await refreshAll();
  setView("income");
  if (entry?.id) highlightIncomeInList(entry.id);
  renderIncomeList();
  await refreshEofyLive();
}

function clearIncomeFormFields() {
  const form = document.getElementById("income-form");
  if (!form) return;
  form.reset();
  form.querySelector('[name="date"]').value = localToday();
  document.getElementById("income-document-kind").value = "";
  document.getElementById("income-summary-notes").value = "";
  document.getElementById("income-net-pay").value = "";
  document.getElementById("income-approval-banner")?.classList.add("hidden");
}

function setIncomeFormApprovalState(pending) {
  const form = document.getElementById("income-form");
  const saveBtn = document.getElementById("income-save-btn");
  const banner = document.getElementById("income-approval-banner");

  if (saveBtn) {
    // Keep approve actionable on the form (same pattern as expense scan)
    if (pending) {
      saveBtn.disabled = false;
      saveBtn.type = "button";
      saveBtn.dataset.approveScan = "1";
      saveBtn.textContent = "Approve & save totals";
      saveBtn.onclick = (e) => {
        e.preventDefault();
        void finalizeScannedTotals({ confirmed: true, showDetails: false });
      };
    } else {
      saveBtn.disabled = false;
      saveBtn.type = "submit";
      delete saveBtn.dataset.approveScan;
      saveBtn.onclick = null;
      saveBtn.textContent = "Save income";
    }
  }

  if (banner) {
    banner.classList.toggle("hidden", !pending);
    if (pending) {
      banner.textContent =
        "Scanned values are filled in. Tap Approve & save totals (here or on the left) after checking the amounts.";
    }
  }
  form?.classList.toggle("awaiting-approval", Boolean(pending));
}

function prefillIncomeForm(ocr, overrides = {}) {
  const form = document.getElementById("income-form");
  if (!form || !ocr) return;
  if (ocr.date || overrides.date) form.elements.date.value = overrides.date || ocr.date;
  if (ocr.suggestedIncomeType) {
    const typeSel = document.getElementById("income-type");
    if (typeSel) typeSel.value = ocr.suggestedIncomeType;
  }
  const entity = overrides.entity || overrides.vendor || ocr.entity || ocr.vendor || ocr.payer || "";
  if (entity) form.elements.payer.value = entity;
  const gross = overrides.grossTotal ?? ocr.grossTotal ?? ocr.amount;
  const taxable = overrides.taxableIncome ?? ocr.taxableIncome ?? gross;
  const gst = overrides.gstAmount ?? ocr.gstAmount ?? ocr.gst ?? 0;
  const net = overrides.netPay ?? ocr.netPay ?? overrides.amount ?? ocr.amount;
  if (gross != null) form.elements.grossTotal.value = Number(gross);
  if (taxable != null) form.elements.taxableIncome.value = Number(taxable);
  if (gst != null) form.elements.gstAmount.value = Number(gst);
  if (net != null) form.elements.amount.value = Number(net);
  if (overrides.payPeriod || ocr.payPeriod) {
    form.elements.reference.value = overrides.payPeriod || ocr.payPeriod;
  }
  if (overrides.description || ocr.description) {
    form.elements.description.value = overrides.description || ocr.description;
  }
  document.getElementById("income-document-kind").value =
    overrides.documentKind || ocr.documentKind || "";
  document.getElementById("income-summary-notes").value =
    overrides.summaryNotes || ocr.summaryNotes || "";
  document.getElementById("income-net-pay").value = net != null ? String(net) : "";
}

function readIncomeScanConfirmPayload() {
  const form = document.getElementById("income-form");
  const o = pendingReceiptConfirm?.ocrResult || {};
  const amount = Number(
    document.getElementById("income-confirm-amount")?.value || form?.elements.amount?.value || o.amount
  );
  const grossTotal = Number(
    document.getElementById("income-confirm-gross")?.value || form?.elements.grossTotal?.value || o.grossTotal || amount
  );
  const taxableIncome = Number(
    document.getElementById("income-confirm-taxable")?.value ||
      form?.elements.taxableIncome?.value ||
      o.taxableIncome ||
      grossTotal
  );
  const gstAmount = Number(
    document.getElementById("income-confirm-gst")?.value || form?.elements.gstAmount?.value || o.gstAmount || o.gst || 0
  );
  const entity =
    document.getElementById("income-confirm-entity")?.value ||
    form?.elements.payer?.value ||
    o.entity ||
    o.vendor ||
    "";
  return {
    amount,
    date: document.getElementById("income-confirm-date")?.value || form?.elements.date?.value || o.date || localToday(),
    type: document.getElementById("income-confirm-type")?.value || form?.elements.type?.value || o.suggestedIncomeType || "salary_wages",
    vendor: entity,
    entity,
    description:
      document.getElementById("income-confirm-description")?.value ||
      form?.elements.description?.value ||
      o.description ||
      "",
    documentKind: form?.elements.documentKind?.value || o.documentKind || "payslip",
    grossTotal,
    taxableIncome,
    gstAmount,
    netPay: amount,
    payPeriod: form?.elements.reference?.value || o.payPeriod || "",
    summaryNotes: form?.elements.summaryNotes?.value || o.summaryNotes || "",
  };
}

function renderIncomeTotalConfirm(box) {
  const pending = pendingReceiptConfirm;
  if (!pending || !box) return;
  const o = pending.ocrResult || {};
  const primary =
    pending.detectedTotals.find((t) => t.primary)?.amount ??
    pending.detectedTotals[0]?.amount ??
    o.amount ??
    "";
  const entity = o.entity || o.vendor || "";
  const hasTotals = pending.detectedTotals.length > 0;
  const totalsList = hasTotals
    ? pending.detectedTotals
        .map(
          (t, idx) =>
            `<li>
              <button type="button" class="detected-total-btn ${t.primary ? "detected-total-primary" : ""}" data-total-idx="${idx}">
                <span>${escapeHtml(t.label)}</span>
                <strong>${fmt(t.amount)}</strong>
              </button>
            </li>`
        )
        .join("")
    : `<li class="detected-total-empty"><span>No dollar amounts detected automatically</span><span class="muted">Enter totals from the document below</span></li>`;

  box.innerHTML = `
    <div class="scan-confirm">
      <h3>Approve remittance / payslip?</h3>
      <p class="muted"><strong>${escapeHtml(pending.filename || "Document")}</strong> scanned for income summary</p>
      <div class="income-mini-summary">
        <div class="income-mini-title">${escapeHtml(entity || "Entity / company")}</div>
        <div class="income-mini-row"><span>Gross total</span><strong>${fmt(o.grossTotal ?? o.amount)}</strong></div>
        <div class="income-mini-row"><span>Taxable income</span><strong>${fmt(o.taxableIncome ?? o.grossTotal ?? o.amount)}</strong></div>
        <div class="income-mini-row"><span>GST</span><strong>${fmt(o.gstAmount || o.gst || 0)}</strong></div>
        ${o.netPay != null ? `<div class="income-mini-row"><span>Net pay</span><strong>${fmt(o.netPay)}</strong></div>` : ""}
        ${o.payPeriod ? `<div class="income-mini-row"><span>Period</span><strong>${escapeHtml(o.payPeriod)}</strong></div>` : ""}
      </div>
      ${o.notes ? `<p class="muted">${escapeHtml(o.notes)}</p>` : ""}
      <ul class="detected-totals">${totalsList}</ul>
      <div class="form-grid scan-confirm-form">
        <label>Entity / company<input type="text" id="income-confirm-entity" value="${escapeHtml(entity)}" /></label>
        <label>Date<input type="date" id="income-confirm-date" value="${escapeHtml(o.date || localToday())}" /></label>
        <label>Type
          <select id="income-confirm-type">
            ${(state.standards?.incomeTypes || [])
              .map(
                (t) =>
                  `<option value="${t.id}" ${
                    (o.suggestedIncomeType || "salary_wages") === t.id ? "selected" : ""
                  }>${escapeHtml(t.label)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>Gross ($)<input type="number" id="income-confirm-gross" step="0.01" min="0" value="${o.grossTotal ?? primary}" /></label>
        <label>Taxable ($)<input type="number" id="income-confirm-taxable" step="0.01" min="0" value="${o.taxableIncome ?? o.grossTotal ?? primary}" /></label>
        <label>GST ($)<input type="number" id="income-confirm-gst" step="0.01" min="0" value="${o.gstAmount ?? o.gst ?? 0}" /></label>
        <label class="scan-confirm-amount-label">Amount / net ($)
          <input type="number" id="income-confirm-amount" step="0.01" min="0" value="${primary}" required />
        </label>
        <label>Description<input type="text" id="income-confirm-description" value="${escapeHtml(o.description || "")}" /></label>
      </div>
      <div class="scan-confirm-actions">
        <button type="button" class="btn primary" id="income-confirm-yes">Approve &amp; save</button>
        <button type="button" class="btn secondary" id="income-confirm-discard">Discard</button>
      </div>
    </div>
  `;

  box.querySelectorAll("[data-total-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const total = pending.detectedTotals[Number(btn.dataset.totalIdx)];
      if (!total) return;
      pending.detectedTotals = pending.detectedTotals.map((t, i) => ({
        ...t,
        primary: i === Number(btn.dataset.totalIdx),
      }));
      const amountInput = document.getElementById("income-confirm-amount");
      if (amountInput) amountInput.value = total.amount;
      if (/gross/i.test(total.label)) {
        const g = document.getElementById("income-confirm-gross");
        if (g) g.value = total.amount;
      }
      if (/taxable/i.test(total.label)) {
        const t = document.getElementById("income-confirm-taxable");
        if (t) t.value = total.amount;
      }
      if (/gst/i.test(total.label)) {
        const g = document.getElementById("income-confirm-gst");
        if (g) g.value = total.amount;
      }
    });
  });

  document.getElementById("income-confirm-yes")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: true, showDetails: false });
  });
  document.getElementById("income-confirm-discard")?.addEventListener("click", () => {
    void finalizeScannedTotals({ confirmed: false, showDetails: false });
  });
}

function showIncomePreview(prepared, filename) {
  const preview = document.getElementById("income-preview");
  if (!preview) return;
  preview.classList.remove("hidden");
  if (prepared.kind === "pdf") {
    preview.innerHTML = `
      <div class="file-preview-pill">PDF ready: ${escapeHtml(filename)}</div>
      <p class="muted">Text will be extracted for entity, taxable income and GST where possible.</p>
    `;
  } else {
    preview.innerHTML = `<img src="${prepared.dataUrl}" alt="Income document preview" />`;
  }
}

async function uploadIncomeFile(file) {
  const pickBtn = document.getElementById("pick-income");
  const fileInput = document.getElementById("income-file");
  const box = document.getElementById("income-scan-result");
  if (pickBtn) {
    pickBtn.disabled = true;
    pickBtn.textContent = "Preparing…";
  }
  box?.classList.add("hidden");
  pendingReceiptConfirm = null;

  try {
    const prepared = await prepareImageForUpload(file);
    showIncomePreview(prepared, file.name);
    if (pickBtn) pickBtn.textContent = "Scanning remittance / payslip…";

    const result = await apiWithTimeout("/receipts/scan", {
      method: "POST",
      body: JSON.stringify({
        imageBase64: prepared.dataUrl,
        mimeType: prepared.mimeType,
        filename: file.name,
        purpose: "income",
      }),
    });

    box.classList.remove("hidden");
    const o = result.ocrResult || {};
    const totals = result.detectedTotals || getDetectedTotalsClient(o);

    pendingReceiptConfirm = {
      receiptId: result.receipt.id,
      ocrResult: o,
      detectedTotals: totals,
      filename: file.name,
      kind: prepared.kind,
      purpose: "income",
      step: "review",
      awaitingApproval: true,
    };
    prefillIncomeForm(o, {
      amount: totals.find((t) => t.primary)?.amount ?? o.amount,
    });
    setIncomeFormApprovalState(true);
    renderIncomeTotalConfirm(box);
    toast(
      totals.length
        ? "Income summary ready — approve before saving"
        : "Enter totals from the document, then approve"
    );
    await refreshAll();
  } catch (err) {
    box?.classList.remove("hidden");
    if (box) {
      box.innerHTML = `
        <h3>Could not upload file</h3>
        <p class="muted">${escapeHtml(err.message)}</p>
        <p>Try a JPG/PNG/PDF, or use <strong>Add income manually</strong>.</p>
      `;
    }
    toast(err.message);
  } finally {
    if (pickBtn) {
      pickBtn.disabled = false;
      pickBtn.textContent = "Choose file from PC";
    }
    if (fileInput) fileInput.value = "";
  }
}

function updateExpenseExtraFields() {
  const cat = document.getElementById("expense-category")?.value;
  const wrap = document.getElementById("expense-extra-fields");
  if (cat === "vehicle_car") {
    wrap.innerHTML = `
      <label>Method<select name="method"><option value="cents_per_km">Cents per km (88c, max 5,000 km)</option><option value="logbook">Logbook (enter work % above)</option></select></label>
      <label>Kilometres<input type="number" name="kilometres" min="0" max="5000" /></label>
    `;
  } else if (cat === "laundry") {
    wrap.innerHTML = `
      <label>Loads per week<input type="number" name="laundryLoads" min="0" /></label>
      <label class="checkbox"><input type="checkbox" name="laundryMixed" /> Mixed work/personal loads (50c/load)</label>
    `;
  } else {
    wrap.innerHTML = "";
  }
}

document.getElementById("expense-category")?.addEventListener("change", () => {
  updateExpenseExtraFields();
  renderExpenseTotals();
});

document.getElementById("expense-total-period")?.addEventListener("change", (e) => {
  setExpenseTotalPeriod(e.target.value);
});

document.getElementById("expense-form")?.addEventListener("input", async () => {
  renderExpenseTotals();
  renderExpenseList();
  const form = document.getElementById("expense-form");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.amount = Number(payload.amount);
  payload.workUsePercent = Number(payload.workUsePercent);
  payload.reimbursed = fd.has("reimbursed");
  payload.laundryMixed = fd.has("laundryMixed");
  if (!payload.amount) return;
  try {
    const analysis = await api("/expenses/preview", { method: "POST", body: JSON.stringify(payload) });
    const box = document.getElementById("expense-preview");
    box.classList.remove("hidden");
    box.innerHTML = `
      <strong>Deduction preview</strong>
      <p>Deductible: <span class="tag green">${fmt(analysis.deductibleAmount)}</span> of ${fmt(analysis.grossAmount)} gross · Schedule ${analysis.atoSchedule || "—"}</p>
      ${analysis.warnings?.length ? `<ul class="warning-list">${analysis.warnings.map((w) => `<li>${w}</li>`).join("")}</ul>` : ""}
    `;
  } catch {
    /* ignore preview errors while typing */
  }
});

document.getElementById("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.amount = Number(payload.amount);
  payload.workUsePercent = Number(payload.workUsePercent);
  payload.reimbursed = fd.has("reimbursed");
  payload.laundryMixed = fd.has("laundryMixed");
  const { entry, analysis } = await api("/expenses", { method: "POST", body: JSON.stringify(payload) });
  e.target.reset();
  resetCategorySelect("expense-category");
  e.target.querySelector('[name="date"]').value = localToday();
  e.target.querySelector('[name="workUsePercent"]').value = 100;
  document.getElementById("expense-preview").classList.add("hidden");
  await afterExpenseSaved(entry, `Expense saved — ${fmt(analysis.deductibleAmount)} deductible`);
});

document.getElementById("income-type").addEventListener("change", () => {
  const t = document.getElementById("income-type").value;
  const wrap = document.getElementById("claiming-wrap");
  const show = t === "allowance_travel" || t === "allowance_overtime_meal";
  wrap.classList.toggle("hidden", !show);
});

document.getElementById("income-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pendingReceiptConfirm?.purpose === "income" && pendingReceiptConfirm.awaitingApproval) {
    void finalizeScannedTotals({ confirmed: true, showDetails: false });
    return;
  }
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.amount = Number(payload.amount);
  payload.grossTotal =
    payload.grossTotal !== "" && payload.grossTotal != null
      ? Number(payload.grossTotal)
      : payload.amount;
  payload.taxableIncome =
    payload.taxableIncome !== "" && payload.taxableIncome != null
      ? Number(payload.taxableIncome)
      : payload.grossTotal;
  payload.gstAmount =
    payload.gstAmount !== "" && payload.gstAmount != null ? Number(payload.gstAmount) : 0;
  payload.netPay =
    payload.netPay !== "" && payload.netPay != null ? Number(payload.netPay) : payload.amount;
  payload.entity = payload.payer || "";
  payload.claimingDeduction = fd.has("claimingDeduction");
  payload.summaryNotes =
    payload.summaryNotes ||
    [
      payload.entity ? `Entity: ${payload.entity}` : null,
      `Gross: $${Number(payload.grossTotal).toFixed(2)}`,
      `Taxable: $${Number(payload.taxableIncome).toFixed(2)}`,
      payload.gstAmount ? `GST: $${Number(payload.gstAmount).toFixed(2)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  const { entry } = await api("/income", { method: "POST", body: JSON.stringify(payload) });
  clearIncomeFormFields();
  await afterIncomeSaved(entry, "Income saved");
});

document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  payload.annualSalary = Number(payload.annualSalary);
  payload.tfnSupplied = fd.has("tfnSupplied");
  await api("/profile", { method: "PUT", body: JSON.stringify(payload) });
  toast("Profile saved");
  await refreshAll();
});

function renderReport() {
  const r = state.report;
  const el = document.getElementById("report-content");
  if (!el) return;
  if (!r) {
    el.innerHTML = `<p class="muted">Loading EOFY report…</p>`;
    return;
  }
  const s = r.summary;
  const incomeRows = s.income.breakdown.length
    ? s.income.breakdown
        .map(
          (b) =>
            `<tr><td>${escapeHtml(b.label)}</td><td class="amount">${fmt(b.grossTotal)}</td><td class="amount">${fmt(b.assessableTotal)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="3" class="muted">No income or remittances recorded for FY ${escapeHtml(s.financialYear)} yet.</td></tr>`;
  const expenseRows = s.expenses.breakdown.length
    ? s.expenses.breakdown
        .map(
          (b) =>
            `<tr><td>${escapeHtml(b.label)}</td><td>${escapeHtml(b.atoSchedule || "—")}</td><td>${b.count}</td><td class="amount">${fmt(b.deductibleTotal)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No expenses recorded for FY ${escapeHtml(s.financialYear)} yet.</td></tr>`;

  const otherFyHint = buildOtherFyActivityHint(s.financialYear);

  el.innerHTML = `
    <div class="report-section">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(r.title)}</h3>
          <p class="muted">${escapeHtml(r.subtitle)} · Live as of ${new Date(r.generatedAt).toLocaleString("en-AU")}</p>
        </div>
        <span class="tag green">Updates live</span>
      </div>
      <p><strong>Driver:</strong> ${escapeHtml(r.driver.name || "—")} · ${escapeHtml((r.driver.driverType || "").replace(/_/g, " "))} · ${escapeHtml(r.driver.employer || "—")}</p>
      ${otherFyHint}
    </div>
    <div class="report-section">
      <h3>Income &amp; remittances</h3>
      <table class="data"><thead><tr><th>Type</th><th>Gross</th><th>Assessable</th></tr></thead>
      <tbody>${incomeRows}</tbody>
      <tfoot><tr><td><strong>Total</strong></td><td class="amount">${fmt(s.income.grossTotal)}</td><td class="amount">${fmt(s.income.assessableTotal)}</td></tr></tfoot></table>
    </div>
    <div class="report-section">
      <h3>Expense deductions (ATO schedules)</h3>
      <p class="muted">Live total deductible: <strong>${fmt(s.expenses.deductibleTotal)}</strong> · Gross spend ${fmt(s.expenses.grossTotal)}</p>
      <table class="data"><thead><tr><th>Category</th><th>Schedule</th><th>Count</th><th>Deductible</th></tr></thead>
      <tbody>${expenseRows}</tbody>
      <tfoot><tr><td colspan="3"><strong>Total deductions</strong></td><td class="amount">${fmt(s.expenses.deductibleTotal)}</td></tr></tfoot></table>
    </div>
    <div class="report-section">
      <h3>Tax estimate</h3>
      <div class="cap-list">
        <div class="cap-row"><span>Taxable income</span><span>${fmt(s.taxEstimate.taxableIncome)}</span></div>
        <div class="cap-row"><span>Income tax</span><span>${fmt(s.taxEstimate.incomeTax)}</span></div>
        <div class="cap-row"><span>Medicare levy</span><span>${fmt(s.taxEstimate.medicareLevy)}</span></div>
        <div class="cap-row"><span>Total estimated tax</span><span>${fmt(s.taxEstimate.totalTax)}</span></div>
      </div>
    </div>
    <p class="muted">${escapeHtml(r.disclaimer)}</p>
  `;
}

function clientFinancialYearForDate(dateStr) {
  const raw = String(dateStr || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let year;
  let month;
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]) - 1;
  } else {
    const d = new Date(dateStr || Date.now());
    year = d.getFullYear();
    month = d.getMonth();
  }
  const startYear = month >= 6 ? year : year - 1;
  return formatFinancialYearValue(startYear);
}

function buildOtherFyActivityHint(selectedFy) {
  const income = state.records?.income || [];
  const expenses = state.records?.expenses || [];
  const counts = new Map();
  for (const row of [...income, ...expenses]) {
    const fy = clientFinancialYearForDate(row.date);
    if (!fy || fy === selectedFy) continue;
    counts.set(fy, (counts.get(fy) || 0) + 1);
  }
  if (!counts.size) return "";
  const bits = [...counts.entries()]
    .sort((a, b) => Number(b[0].split("-")[0]) - Number(a[0].split("-")[0]))
    .map(([fy, n]) => `${formatFinancialYearLabel(fy)} (${n})`)
    .join(", ");
  return `<p class="tag warn">Other financial years have activity: ${escapeHtml(bits)}. Switch the FY dropdown in the top bar to include those totals.</p>`;
}

document.getElementById("export-report").addEventListener("click", () => {
  if (!state.report) return;
  const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `haulage-report-${state.financialYear}.json`;
  a.click();
  toast("Report downloaded — share with your accountant");
});

async function loadForecast() {
  const q =
    state.forecastMode === "manual"
      ? `?mode=manual&projectedIncome=${document.querySelector('[name="projectedIncome"]')?.value || 0}&projectedDeductions=${document.querySelector('[name="projectedDeductions"]')?.value || 0}`
      : "?mode=realtime";
  state.forecast = await api(`/forecast${q}`);
  renderForecast();
}

function renderForecast() {
  const f = state.forecast;
  if (!f) return;
  document.getElementById("forecast-progress").innerHTML = `
    <p>${f.yearProgress.daysElapsed} of ${f.yearProgress.daysTotal} days (${f.yearProgress.percentComplete}%)</p>
    <div class="progress-bar"><span style="width:${f.yearProgress.percentComplete}%"></span></div>
    <p class="muted">YTD income ${fmt(f.yearToDate.income)} · YTD deductions ${fmt(f.yearToDate.deductions)}</p>
  `;
  document.getElementById("forecast-stats").innerHTML = `
    <div class="stat-card income"><div class="label">Projected income</div><div class="value">${fmt(f.projected.income)}</div></div>
    <div class="stat-card expense"><div class="label">Projected deductions</div><div class="value">${fmt(f.projected.deductions)}</div></div>
    <div class="stat-card tax"><div class="label">Projected tax</div><div class="value">${fmt(f.projected.totalTax)}</div></div>
    <div class="stat-card income"><div class="label">Projected net (after tax)</div><div class="value">${fmt(f.projected.netAfterTax)}</div><div class="sub">~${fmt(f.projected.averageMonthlyNet)}/month</div></div>
  `;
  document.getElementById("forecast-scenarios").innerHTML = `
    <table class="data"><thead><tr><th>Scenario</th><th>Income</th><th>Deductions</th><th>Tax</th><th>Net</th></tr></thead>
    <tbody>${f.scenarios.map((s) => `<tr><td>${s.name}</td><td class="amount">${fmt(s.projectedIncome)}</td><td class="amount">${fmt(s.projectedDeductions)}</td><td class="amount">${fmt(s.projectedTax)}</td><td class="amount">${fmt(s.projectedNet)}</td></tr>`).join("")}</tbody></table>
  `;
}

document.querySelectorAll("[data-forecast-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-forecast-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.forecastMode = btn.dataset.forecastMode;
    document.getElementById("manual-forecast-form").classList.toggle("hidden", state.forecastMode !== "manual");
    loadForecast();
  });
});

document.getElementById("manual-forecast-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await loadForecast();
});

const pickBtn = document.getElementById("pick-receipt");
const fileInput = document.getElementById("receipt-file");
if (pickBtn && fileInput) {
  pickBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await uploadReceiptFile(file);
  });
}

const uploadZone = document.getElementById("upload-zone");
if (uploadZone) {
  ["dragenter", "dragover"].forEach((evt) => {
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      uploadZone.classList.remove("drag-over");
    });
  });
  uploadZone.addEventListener("drop", async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadReceiptFile(file);
  });
}

const pickIncomeBtn = document.getElementById("pick-income");
const incomeFileInput = document.getElementById("income-file");
if (pickIncomeBtn && incomeFileInput) {
  pickIncomeBtn.addEventListener("click", () => incomeFileInput.click());
  incomeFileInput.addEventListener("change", async () => {
    const file = incomeFileInput.files?.[0];
    if (!file) return;
    await uploadIncomeFile(file);
  });
}

const incomeUploadZone = document.getElementById("income-upload-zone");
if (incomeUploadZone) {
  ["dragenter", "dragover"].forEach((evt) => {
    incomeUploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      incomeUploadZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    incomeUploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      incomeUploadZone.classList.remove("drag-over");
    });
  });
  incomeUploadZone.addEventListener("drop", async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadIncomeFile(file);
  });
}

function prefillManualReceiptForm(ocr, opts = {}) {
  const form = document.getElementById("manual-receipt-form");
  if (!form || !ocr) return;
  if (ocr.date) form.elements.date.value = ocr.date;
  if (ocr.suggestedCategory) {
    setCategorySelectValue("manual-receipt-category", ocr.suggestedCategory);
  }
  if (ocr.vendor) form.elements.vendor.value = ocr.vendor;
  if (form.elements.vendorAbn) {
    form.elements.vendorAbn.value = ocr.vendorAbn || "";
  }
  if (ocr.description) form.elements.description.value = ocr.description;
  const amount = opts.amount != null ? opts.amount : ocr.amount;
  if (!opts.skipAmount && amount) form.elements.amount.value = amount;
  else if (opts.skipAmount) form.elements.amount.value = "";

  // Prefer ABN from known vendors when name matches and OCR had no ABN
  if (!form.elements.vendorAbn?.value && form.elements.vendor?.value) {
    const known = (state.records?.vendors || []).find(
      (v) => v.name.toLowerCase() === form.elements.vendor.value.trim().toLowerCase()
    );
    if (known?.abn) form.elements.vendorAbn.value = known.abn;
  }

  if (opts.pendingApproval) setManualFormApprovalState(true);
  renderExpenseTotals();
}

document.getElementById("manual-vendor-input")?.addEventListener("change", () => {
  const nameInput = document.getElementById("manual-vendor-input");
  const abnInput = document.getElementById("manual-vendor-abn");
  const resolved = resolveVendorFromInput(nameInput, abnInput);
  if (resolved.vendorAbn) abnInput.value = resolved.vendorAbn;
});

document.getElementById("manual-vendor-abn")?.addEventListener("change", () => {
  const nameInput = document.getElementById("manual-vendor-input");
  const abnInput = document.getElementById("manual-vendor-abn");
  const abnClean = abnInput.value.replace(/\s/g, "").replace(/[^\d]/g, "");
  const byAbn = (state.records?.vendors || []).find(
    (v) => (v.abn || "").replace(/\s/g, "") === abnClean
  );
  if (byAbn) nameInput.value = byAbn.name;
});

document.getElementById("manual-receipt-form")?.addEventListener("input", async () => {
  renderExpenseTotals();
  renderExpenseList();
  const form = document.getElementById("manual-receipt-form");
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  payload.amount = Number(payload.amount);
  payload.workUsePercent = Number(payload.workUsePercent);
  payload.reimbursed = fd.has("reimbursed");
  if (!payload.amount || !payload.category) return;
  try {
    const analysis = await api("/expenses/preview", { method: "POST", body: JSON.stringify(payload) });
    const box = document.getElementById("manual-receipt-preview");
    box.classList.remove("hidden");
    box.innerHTML = `
      <strong>Deduction preview</strong>
      <p>Deductible: <span class="tag green">${fmt(analysis.deductibleAmount)}</span> of ${fmt(analysis.grossAmount)}</p>
    `;
  } catch {
    /* ignore while typing */
  }
});

document.getElementById("manual-receipt-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pendingReceiptConfirm?.awaitingApproval) {
    void finalizeScannedTotals({ confirmed: true, showDetails: false });
    return;
  }
  const form = e.target;
  const fd = new FormData(form);
  const nameInput = document.getElementById("manual-vendor-input");
  const abnInput = document.getElementById("manual-vendor-abn");
  const resolved = resolveVendorFromInput(nameInput, abnInput);

  const payload = {
    date: fd.get("date"),
    category: fd.get("category"),
    vendor: resolved.vendor,
    vendorAbn: resolved.vendorAbn,
    vendorId: resolved.vendorId,
    description: fd.get("description"),
    amount: Number(fd.get("amount")),
    workUsePercent: Number(fd.get("workUsePercent")),
    reimbursed: fd.has("reimbursed"),
  };

  const { entry, analysis } = await api("/receipts/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  form.reset();
  resetCategorySelect("manual-receipt-category");
  form.elements.date.value = localToday();
  form.elements.workUsePercent.value = 100;
  document.getElementById("manual-receipt-preview").classList.add("hidden");
  document.getElementById("scan-result").classList.add("hidden");
  setManualFormApprovalState(false);
  await afterExpenseSaved(entry, `Receipt saved — ${fmt(analysis.deductibleAmount)} deductible`);
});

function countClientEntriesForFy(fy) {
  const income = state.records?.income || [];
  const expenses = state.records?.expenses || [];
  return [...income, ...expenses].filter((row) => clientFinancialYearForDate(row.date) === fy).length;
}

async function alignFinancialYearToEntry(entry) {
  if (!entry?.date) return;
  const entryFy = clientFinancialYearForDate(entry.date);
  if (!entryFy || entryFy === state.financialYear) return;

  // Follow the saved entry into its Australian FY so EOFY deductions/income
  // update immediately after Expenses / Income saves.
  state.fyUserSelected = false;
  state.financialYear = entryFy;
  populateFinancialYearSelect(entryFy);
  try {
    await api("/profile", {
      method: "PUT",
      body: JSON.stringify({ financialYear: entryFy }),
    });
  } catch {
    /* non-fatal — UI year still updated */
  }
}

async function refreshEofyLive() {
  const fy = state.financialYear || getCurrentFinancialYear();
  state.summary = await api(`/summary?financialYear=${fy}`);
  state.report = await api(`/report?financialYear=${fy}`);
  renderStats();
  renderReport();
  await loadForecast().catch(() => {});
}

async function refreshAll() {
  state.records = await api("/records");

  const currentFy = getCurrentFinancialYear();
  const profileFy = state.records.profile?.financialYear || currentFy;

  if (!state.fyUserSelected) {
    // Prefer the FY that contains the newest saved activity so expenses added
    // from the Expenses tab land in the live EOFY report immediately.
    const preferCurrent = countClientEntriesForFy(currentFy) > 0;
    const newest = newestActivityFinancialYear();
    state.financialYear = newest || (preferCurrent ? currentFy : profileFy || currentFy);
    if (state.financialYear !== profileFy) {
      try {
        await api("/profile", {
          method: "PUT",
          body: JSON.stringify({ financialYear: state.financialYear }),
        });
        if (state.records.profile) state.records.profile.financialYear = state.financialYear;
      } catch {
        /* non-fatal */
      }
    }
  } else if (!state.financialYear) {
    state.financialYear = profileFy;
  }

  populateFinancialYearSelect(state.financialYear);
  document.getElementById("fy-label").textContent = String(state.financialYear).replace("-", "–");

  await refreshEofyLive();

  if (state.records.profile) {
    const p = state.records.profile;
    const form = document.getElementById("profile-form");
    Object.entries(p).forEach(([k, v]) => {
      const input = form?.elements?.[k];
      if (!input) return;
      if (input.type === "checkbox") input.checked = Boolean(v);
      else if (k === "financialYear") input.value = state.financialYear;
      else input.value = v ?? "";
    });
  }
  renderRecentActivity();
  renderExpenseList();
  renderIncomeList();
  renderVendorList();
  renderReceiptGallery();
  renderExpenseTotals();
}

function newestActivityFinancialYear() {
  const rows = [...(state.records?.income || []), ...(state.records?.expenses || [])];
  if (!rows.length) return null;
  let best = null;
  let bestTime = "";
  for (const row of rows) {
    const stamp = row.createdAt || row.date || "";
    if (stamp >= bestTime) {
      bestTime = stamp;
      best = clientFinancialYearForDate(row.date);
    }
  }
  return best;
}

async function init() {
  const today = localToday();
  document.querySelectorAll('input[type="date"]').forEach((el) => (el.value = today));
  const periodSelect = document.getElementById("expense-total-period");
  if (periodSelect) periodSelect.value = state.expenseTotalPeriod;
  state.financialYear = getCurrentFinancialYear();
  populateFinancialYearSelect(state.financialYear);
  state.standards = await api("/standards");
  populateSelects();
  updateExpenseExtraFields();
  await refreshAll();

  document.getElementById("receipt-viewer-close")?.addEventListener("click", closeReceiptViewer);
  document.getElementById("receipt-viewer-download")?.addEventListener("click", () => {
    if (activeReceiptId) downloadReceiptFile(activeReceiptId);
  });
  document.getElementById("receipt-viewer-share")?.addEventListener("click", () => {
    if (activeReceiptId) shareReceiptFile(activeReceiptId);
  });
  document.querySelectorAll("[data-close-viewer]").forEach((el) => {
    el.addEventListener("click", closeReceiptViewer);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeReceiptId) closeReceiptViewer();
  });
}

init().catch((err) => toast(err.message));
