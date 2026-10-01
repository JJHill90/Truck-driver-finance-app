(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  const isSuite = document.body.classList.contains("welcome-suite");

  const HELP_SHARED = {
    expenses: {
      title: "Expenses",
      body: [
        "Expenses is for general work receipts (meals, accommodation, tools, and similar). Before uploading, open Recommended best way to scan your receipts, or tap Scan with camera for a live amber frame so you can fit the top of the slip and the date. Upload a photo or PDF with Upload file — you must be signed in. Approve the overall total before it’s saved; other line amounts are informational only.",
        "Manual entry covers cash claims and “no receipt” ticks. The expense ledger and receipt gallery filter by financial year and week so large lists stay scannable. Vehicle & fuel / ATO car claims live under the separate Car Expenses item in the sidebar (under Income).",
      ],
    },
    "car-expenses": {
      title: "Car Expenses and Claims",
      body: [
        "Choose your ATO D1 claim method: Cents per kilometre (start → end work trips, rate × km up to 5,000 km/year) or Logbook (12-week diary with destinations, then actual expenses × business-use %). Compact work-vehicle presets still sit at the top — mark a car Active for work-use %.",
        "Cents/km ledger is your trips. Logbook lets you add destinations through the day, then Close out trip (with confirmation). Reconcile closed trips to lock them. Keep ATO written evidence for logbook running costs.",
      ],
    },
  };

  const SUITE_HELP = {
    dashboard: {
      title: "Dashboard",
      body: [
        "The Dashboard is your home screen for the selected financial year. Top stats show Net income (income in hand), Deductible expenses, Net taxable income minus expenses, and Total Spend vs Net Income as a percentage. Two large pie charts sit underneath: Snapshot (net income in hand / deductible / net taxable minus expenses with colour legend totals) and Total Spend vs Net Income (blue income, red spend).",
        "Work travel nights shows how many overnight work-travel days you’ve claimed so far versus days in the financial year — the same snapshot as Financial Forecast. Days come from payslip travel-allowance counters (or amount ÷ Tables 1–3 meals + incidentals). Living-away-from-home for sales, marketing and similar occupations uses the FBT weekly food component, not a truck daily stack. Open the payslip list on the card and use Edit nights if OCR missed days on a slip.",
        "Allowance caps use the ATO reasonable amounts for ordinary employees (TD Tables 1–3, Melbourne as the representative capital city): meals + accommodation + incidentals for the salary band. Overtime meal is listed separately. Change the financial year in the top bar and both cards refresh for that year’s Taxation Determination.",
      ],
    },
    expenses: HELP_SHARED.expenses,
    income: {
      title: "Income & remittances",
      body: [
        "Use Income to record payslips, remittances and other earnings for the selected financial year. Upload a payslip or invoice (image or PDF) the same way as expenses — OCR pulls gross, net and related fields when it can, then you approve before save. Manual entry is available when you prefer to type amounts yourself.",
        "Choose an income type from the menu, keep descriptions clear, and use the ledger to edit or remove rows. Edit on a payslip row to set Work travel nights and travel-allowance $ if a scan missed them — the Dashboard Work travel nights total updates from those fields.",
        "The income gallery only shows documents saved as income, so expense receipts won’t block a payslip upload. After a scan, tap Approve & save — photos can sit in the gallery before they appear in the ledger; if a photo says Needs approval, use Finish approval. When you scan a remittance or invoice, the approve amount prefers net income / net pay when that wording appears; otherwise it uses the largest pay figure (not GST or PAYG). Sign in before uploading so everything lands in your profile.",
      ],
    },
    "car-expenses": HELP_SHARED["car-expenses"],
    report: {
      title: "EOFY Report",
      body: [
        "The EOFY performance statement summarises income, deductions and estimated tax for the selected year. It updates as you add or change records — use it as a live working paper for you or your accountant, not as a lodged return.",
        "Pro downloads the PDF/JSON pack. Pro+ adds a read-only accountant share link, a BAS/GST activity statement worksheet (G1, 1A, G11, 1B, 9) you can download as PDF or Excel and use when lodging with the ATO, and a multi-year comparison for your agent.",
      ],
    },
    forecast: {
      title: "Financial Forecast",
      body: [
        "Financial Forecast projects where the year is heading from what you’ve already logged. Real-time mode uses your current income and deductions and extrapolates toward EOFY; Manual mode lets you type projected income and deductions and recalculate on demand.",
        "Projected totals can be viewed monthly, quarterly or yearly so you can plan cash flow and tax set-asides. Scenario cards show alternate paths (for example higher deductions or different income) without changing your ledgers.",
        "Work travel nights are snapshotted from each payslip or remittance scan when a travel allowance appears. The same card also appears on the Dashboard. Nights use ordinary-employee Tables 1–3. The bar shows nights claimed so far versus days in the financial year.",
      ],
    },
    profile: {
      title: "Profile",
      body: [
        "Taxpayer profile sets your registration type (employee, sole trader or partnership), occupation, ABN and GST. Pro+ can add one extra entity on this login (for example PAYG plus a side sole trader) and seat the other partner on a partnership ledger.",
        "New profiles start on Free (15 uploads/month + 1 on-screen EOFY report). Plan is Free, Pro ($10/month or $110/year) or Pro+ ($18/month or $190/year). Paid plans are sold on the website via Stripe — the store app does not sell in-app purchases. Cancel or manage billing from Profile → Plan.",
        "Account tools cover email on file, password changes, and Delete account (type DELETE and your password). After login or logout the page reloads so every tab shows your data only.",
      ],
    },
  };

  const HUB_HELP = {
    dashboard: {
      title: "Dashboard",
      body: [
        "The Dashboard is your home screen for the selected financial year. Top stats show Net income (income in hand), Deductible expenses, Net taxable income minus expenses, and Total Spend vs Net Income as a percentage. Two large pie charts sit underneath: Snapshot (net income in hand / deductible / net taxable minus expenses with colour legend totals) and Total Spend vs Net Income (blue income, red spend).",
        "Travel allowance days shows how many Travel / Living Away from Home (LAFHA) days you’ve claimed so far versus days in the financial year — the same snapshot as Financial Forecast. Days come from payslip Travel/LAFHA counters (or amount ÷ rate). Open the payslip list on the card and use Edit LAFHA if OCR missed days on a slip.",
        "Allowance caps track common work allowances (meals, overtime meals, and similar ATO bands) against what you’ve claimed so far for the day, week or month. Change the financial year in the top bar and both the Travel allowance days card and allowance caps refresh for that year’s Taxation Determination.",
      ],
    },
    expenses: HELP_SHARED.expenses,
    income: {
      title: "Income & remittances",
      body: [
        "Use Income to record payslips, remittances and other earnings for the selected financial year. Upload a payslip or invoice (image or PDF) the same way as expenses — OCR pulls gross, net and related fields when it can, then you approve before save. Manual entry is available when you prefer to type amounts yourself.",
        "Choose an income type from the menu, keep descriptions clear, and use the ledger to edit or remove rows. Edit on a payslip row to set Living Away from Home (LAFHA) days and Travel/LAFHA $ if a scan missed them — the Dashboard Travel allowance days total updates from those fields.",
        "The income gallery only shows documents saved as income, so expense receipts won’t block a payslip upload. After a scan, tap Approve & save — photos can sit in the gallery before they appear in the ledger; if a photo says Needs approval, use Finish approval. Sign in before uploading so everything lands in your profile.",
      ],
    },
    "car-expenses": HELP_SHARED["car-expenses"],
    report: {
      title: "EOFY Report",
      body: [
        "The EOFY performance statement rolls up the selected financial year’s income, expense deductions (by ATO-style schedules) and a tax estimate from your saved profile and ledgers. It updates as you add or change records — use it as a live working paper for you or your accountant, not as a lodged return.",
        "Download FY report builds a PDF of the current statement; Export JSON is for backups or importing elsewhere. Pro includes a BAS/GST activity statement worksheet you can download as PDF or Excel and use when lodging with the ATO. Check that your Profile salary, driver type and TFN flag look right before you share the report, and switch financial year in the top bar if you’re reviewing a prior year.",
      ],
    },
    forecast: {
      title: "Financial Forecast",
      body: [
        "Financial Forecast projects where the year is heading from what you’ve already logged. Real-time mode uses your current income and deductions and extrapolates toward EOFY; Manual mode lets you type projected income and deductions and recalculate on demand.",
        "Projected totals can be viewed monthly, quarterly or yearly so you can plan cash flow and tax set-asides. Scenario cards show alternate paths without changing your ledgers.",
        "Travel allowance days are snapshotted from each payslip or remittance scan when Travel or LAFHA appears. The same card also appears on the Dashboard.",
      ],
    },
    fuelhub: {
      title: "Fuel Hub",
      body: [
        "Fuel Hub plans diesel from load, trailers, tank and NHVR truck-access sites — not car shortcuts. Dashboard summarises the current planned or GPS run, previous saved trips, and cheapest truck-access diesel in the area from government-style public tables.",
        "Forecast uses Conservative / Baseline / Optimistic L/km from freight tonnes, diesel mass and hours on the road. Plan fills sizes a minimum vs ideal fill at a nominated town so you are not brim-filling at inflated remote diesel.",
        "Register fuel-class vehicles on Fuel Hub → Profile (samples XN93DX, YN16BQ, YN17BQ, or a custom code). Driver type plus work vehicle from the shared Driver Hub profile set combination and duty-cycle L/100 km.",
      ],
    },
    profile: {
      title: "Profile",
      body: [
        "You sign in once on Driver Hub, then open Taxation Hub or Fuel Hub from the app picker. Taxation Hub Profile is where you set your display name, employer, annual salary, licence class, driver type and work vehicle, and tick whether your TFN is with your employer. Fuel Hub has its own Profile tab that writes the same record — register fuel-class vehicles there with tank litres.",
        "New profiles start on Free (15 uploads/month + 1 on-screen EOFY report). Pro is $5/month or $60/year. Pro+ is complimentary full Pro from the primary mod. Paid plans are sold on the website via Stripe — not as in-app purchases.",
        "Account tools cover email on file, password changes, Forgot username / password on the login screen, and Delete account (type DELETE and your password).",
      ],
    },
  };

  const HELP = isSuite ? SUITE_HELP : HUB_HELP;

  function bindStore(id, url) {
    const el = document.getElementById(id);
    if (!el) return;
    const ready = Boolean(url);
    el.setAttribute("aria-disabled", ready ? "false" : "true");
    if (ready) {
      el.href = url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      const kicker = el.querySelector(".store-btn-kicker");
      if (kicker) kicker.textContent = "Available on";
    } else {
      el.removeAttribute("href");
      el.addEventListener("click", (e) => e.preventDefault());
    }
  }

  async function hydrateStore() {
    try {
      const res = await fetch("/welcome.json", { credentials: "same-origin" });
      const data = await res.json();
      document.querySelectorAll("[data-welcome-app]").forEach((a) => {
        if (data.appUrl) a.href = data.appUrl;
      });
      bindStore("welcome-appstore", data.appStoreUrl);
      bindStore("welcome-play", data.playStoreUrl);
      const note = document.getElementById("welcome-store-note");
      if (note && data.appStoreUrl && data.playStoreUrl) {
        note.textContent =
          "Get the app on the App Store or Google Play, or open it in your browser.";
      } else if (note && data.appStoreUrl) {
        note.textContent = "Get the app on the App Store, or open it in your browser.";
      } else if (note && data.playStoreUrl) {
        note.textContent = "Get the app on Google Play, or open it in your browser.";
      }
    } catch {
      /* static hrefs still work */
    }
  }

  function renderHelp(topic) {
    const entry = HELP[topic] || HELP.dashboard;
    const titleEl = document.getElementById("support-help-title");
    const bodyEl = document.getElementById("support-help-body");
    if (titleEl) titleEl.textContent = entry.title;
    if (bodyEl) {
      bodyEl.replaceChildren();
      entry.body.forEach((text) => {
        const p = document.createElement("p");
        p.textContent = text;
        bodyEl.appendChild(p);
      });
    }
    document.querySelectorAll(".support-help-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.helpTopic === topic);
    });
  }

  function setStatus(msg, { isError, isSuccess } = {}) {
    const el = document.getElementById("support-contact-status");
    if (!el) return;
    el.textContent = "";
    el.classList.remove("support-status-success", "support-status-error");
    if (isError) el.classList.add("support-status-error");
    if (isSuccess) el.classList.add("support-status-success");
    if (!msg) return;
    if (typeof msg === "string") {
      el.textContent = msg;
      return;
    }
    el.appendChild(msg);
  }

  function showDeliveryConfirmation({
    supportEmail,
    userEmail,
    confirmationSent,
    emailed,
    mailto,
  }) {
    const inbox = supportEmail || "support@godriverhub.com";
    const wrap = document.createElement("div");
    const title = document.createElement("p");
    title.className = "support-confirm-title";
    title.textContent = emailed ? "Support request sent" : "Support request received";
    wrap.appendChild(title);

    const line1 = document.createElement("p");
    line1.textContent = emailed
      ? `Your message has been sent to the developer (${inbox}).`
      : `Your message was saved. We’ll reply to ${userEmail} from ${inbox}.`;
    wrap.appendChild(line1);

    const line2 = document.createElement("p");
    line2.textContent = confirmationSent
      ? `A confirmation notice was also sent to ${userEmail}. Check your inbox (and spam).`
      : `We’ll reply to ${userEmail}. If you want a copy in your own sent mail, use the link below.`;
    wrap.appendChild(line2);

    if (mailto) {
      const line3 = document.createElement("p");
      const a = document.createElement("a");
      a.href = mailto;
      a.textContent = emailed ? "Open a copy in your email app" : `Email ${inbox} now`;
      line3.appendChild(a);
      wrap.appendChild(line3);
    }
    setStatus(wrap, { isSuccess: true });
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    const email = form.email.value.trim();
    const phone = form.phone.value.trim();
    const typed = form.message.value.trim();
    const source = isSuite ? "Go Taxation Suite website" : "Driver Hub website";
    const message = `[Sent from the ${source}]\n\n${typed}`;
    const btn = document.getElementById("support-send");
    if (btn) btn.disabled = true;
    setStatus("Sending your support request…");

    try {
      const res = await fetch(`${API}/support/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, email, phone, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Could not send your message.", { isError: true });
        return;
      }
      showDeliveryConfirmation({
        supportEmail: data.supportEmail || "support@godriverhub.com",
        userEmail: email,
        confirmationSent: Boolean(data.confirmationSent),
        emailed: Boolean(data.emailed),
        mailto: data.mailto || "mailto:support@godriverhub.com",
      });
      form.reset();
    } catch {
      setStatus("Network error — please try again or email support@godriverhub.com.", {
        isError: true,
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function startHelp() {
    const form = document.getElementById("support-contact-form");
    if (form) form.addEventListener("submit", onSubmit);
    document.querySelectorAll(".support-help-btn").forEach((btn) => {
      btn.addEventListener("click", () => renderHelp(btn.dataset.helpTopic));
    });
    if (document.getElementById("support-help-title")) renderHelp("dashboard");
  }

  function start() {
    hydrateStore();
    startHelp();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
