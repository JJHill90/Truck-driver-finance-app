/**
 * Car Expenses overhaul: ATO D1 claim method switcher, cents/km trips,
 * logbook multi-stop trips with close-out, and trip reconcile UI.
 * Loaded after enhancements.js — does not edit verbatim app.js.
 */
(function () {
  "use strict";
  /* global state, refreshAll */

  const API = `${window.location.origin}/api/haulage`;
  const LS_METHOD = "haulage-car-claim-method";

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    if (typeof globalThis.toast === "function") globalThis.toast(msg);
  }

  function records() {
    return (typeof state !== "undefined" && state.records) || {};
  }

  function currentMethod() {
    const fromProfile = records().profile && records().profile.carClaimMethod;
    const fromState = typeof state !== "undefined" && state.carClaimMethod;
    const fromLs = localStorage.getItem(LS_METHOD);
    const raw = fromProfile || fromState || fromLs || "cents_per_km";
    return String(raw).includes("log") ? "logbook" : "cents_per_km";
  }

  function setMethodRadios(method) {
    const cents = byId("car-method-cents");
    const log = byId("car-method-logbook");
    if (cents) cents.checked = method === "cents_per_km";
    if (log) log.checked = method === "logbook";
  }

  function applyMethodPanels(method) {
    const centsPanel = byId("car-cents-panel");
    const logPanel = byId("car-logbook-panel");
    const help = byId("car-claim-method-help");
    const preview = byId("car-cents-fy-preview");
    const expensePanel = byId("car-expense-ledger-panel");
    if (centsPanel) centsPanel.hidden = method !== "cents_per_km";
    if (logPanel) logPanel.hidden = method !== "logbook";
    if (expensePanel) expensePanel.hidden = method === "cents_per_km";

    const helpText =
      method === "logbook"
        ? "ATO logbook method (D1): keep a continuous 12-week logbook that represents your normal use. Record date, odometer, kilometres and purpose (with destinations) for each journey. Apply the resulting business-use % to actual car expenses and keep written evidence. A valid logbook can usually be relied on for up to five years if your pattern of use does not change substantially."
        : "ATO cents per kilometre (D1): claim the set rate for each work kilometre (up to 5,000 km per car per income year). Record start and end destinations so you can show how kilometres were worked out. Written evidence of each expense is not required for this method; optional receipt photos can still be stored.";
    if (help) help.textContent = helpText;

    const atoCopy = byId("car-logbook-ato-copy");
    if (atoCopy) atoCopy.textContent = helpText;

    const p = (typeof state !== "undefined" && state.carCentsPreview) || null;
    if (preview) {
      if (method === "cents_per_km" && p) {
        preview.hidden = false;
        preview.textContent = `This FY: ${p.kilometres || 0} work km recorded · claimable ${p.claimableKilometres || 0}/${p.maxKm || 5000} km · est. deduction $${Number(p.estimatedDeduction || 0).toFixed(2)} at $${Number(p.ratePerKm || 0).toFixed(2)}/km${p.overCap ? " (over 5,000 km cap — only first 5,000 count)" : ""}.`;
      } else {
        preview.hidden = true;
      }
    }
  }

  async function persistMethod(method) {
    localStorage.setItem(LS_METHOD, method);
    if (typeof state !== "undefined") state.carClaimMethod = method;
    try {
      const res = await fetch(`${API}/profile`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carClaimMethod: method }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.profile && typeof state !== "undefined" && state.records) {
        state.records.profile = data.profile;
      }
    } catch {
      /* offline / guest — local preference still applies */
    }
    applyMethodPanels(method);
    renderTrips();
  }

  function tripRoute(t) {
    if (!t) return "—";
    if (t.method === "logbook" && Array.isArray(t.destinations) && t.destinations.length) {
      const names = t.destinations.map((d) => d.name).filter(Boolean);
      return names.join(" → ") || "—";
    }
    return `${t.origin || "—"} → ${t.destination || "—"}`;
  }

  function renderTrips() {
    const host = byId("car-trips-list");
    const summary = byId("car-trips-list-summary");
    if (!host) return;
    const method = currentMethod();
    const trips = ((records().carTrips || []) || []).filter(
      (t) => t && !t.deletedAt && t.method === method
    );
    if (summary) {
      summary.textContent = `${trips.length} trip${trips.length === 1 ? "" : "s"} · ${
        method === "logbook" ? "Logbook" : "Cents/km"
      }`;
    }
    if (!trips.length) {
      host.innerHTML = `<p class="muted">No ${
        method === "logbook" ? "logbook" : "cents-per-kilometre"
      } trips yet.</p>`;
      updateReconcileBtn();
      return;
    }

    host.innerHTML = `<table class="data car-trips-table expense-ledger">
      <thead><tr>
        <th><input type="checkbox" class="ledger-select-all" id="car-trips-select-all" aria-label="Select all trips"></th>
        <th>Date</th>
        <th>Route</th>
        <th>Km</th>
        <th>Status</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${trips
          .map((t) => {
            const locked = Boolean(t.reconciled);
            const open = t.status === "open";
            const tags = [];
            if (open) tags.push('<span class="tag tag-open">Open</span>');
            if (locked) tags.push('<span class="tag tag-reconciled">Reconciled</span>');
            return `<tr data-car-trip-id="${esc(t.id)}" class="${locked ? "reconciled-row" : ""}">
              <td><input type="checkbox" class="ledger-row-check" ${locked || open ? "disabled" : ""} aria-label="Select trip"></td>
              <td>${esc(t.date || "")}</td>
              <td>${esc(tripRoute(t))}${t.purpose ? `<div class="muted small">${esc(t.purpose)}</div>` : ""} ${tags.join(" ")}</td>
              <td class="amount">${t.kilometres != null ? esc(t.kilometres) : "—"}</td>
              <td>${esc(t.status || "closed")}</td>
              <td><div class="row-actions">
                ${
                  locked
                    ? ""
                    : `<button type="button" class="btn danger small" data-del-car-trip="${esc(t.id)}">Delete</button>`
                }
              </div></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
    updateReconcileBtn();
  }

  function selectedTripIds() {
    const host = byId("car-trips-list");
    if (!host) return [];
    const ids = [];
    host.querySelectorAll("tbody tr[data-car-trip-id]").forEach((tr) => {
      const cb = tr.querySelector(".ledger-row-check");
      if (cb && cb.checked && !cb.disabled) ids.push(tr.getAttribute("data-car-trip-id"));
    });
    return ids;
  }

  function updateReconcileBtn() {
    const btn = byId("car-trips-reconcile-btn");
    if (!btn) return;
    const n = selectedTripIds().length;
    btn.hidden = n === 0;
    btn.textContent = n === 1 ? "Reconcile trips (1)" : `Reconcile trips (${n})`;
  }

  async function refreshTripsFromApi() {
    try {
      const res = await fetch(`${API}/car-trips`, { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      if (typeof state !== "undefined") {
        state.records = state.records || {};
        state.records.carTrips = data.trips || [];
        state.carCentsPreview = data.centsPreview || null;
        if (data.method) state.carClaimMethod = data.method;
      }
      applyMethodPanels(currentMethod());
      renderTrips();
      renderOpenLogbookTrip();
    } catch {
      /* ignore */
    }
  }

  function openLogbookTrip() {
    const trips = records().carTrips || [];
    return trips.find((t) => t && !t.deletedAt && t.method === "logbook" && t.status === "open") || null;
  }

  function renderOpenLogbookTrip() {
    const box = byId("car-logbook-open-trip");
    const summary = byId("car-logbook-open-summary");
    const list = byId("car-logbook-stops");
    const openForm = byId("car-trip-logbook-open-form");
    const trip = openLogbookTrip();
    if (!box) return;
    if (!trip) {
      box.hidden = true;
      if (openForm) openForm.hidden = false;
      return;
    }
    box.hidden = false;
    if (openForm) openForm.hidden = true;
    if (summary) {
      summary.textContent = `${trip.date || ""} · ${trip.purpose || "Logbook trip"} · started ${
        trip.origin || ""
      }`;
    }
    if (list) {
      const stops = trip.destinations || [];
      list.innerHTML = stops.length
        ? stops
            .map(
              (s, i) =>
                `<li><strong>${esc(s.name)}</strong>${
                  s.odometer ? ` · odo ${esc(s.odometer)}` : ""
                }${s.note ? ` · ${esc(s.note)}` : ""}${i === 0 ? " (start)" : ""}</li>`
            )
            .join("")
        : "<li class='muted'>No stops yet</li>";
    }
  }

  async function createCentsTrip(ev) {
    ev.preventDefault();
    const form = ev.target;
    const fd = new FormData(form);
    const payload = {
      method: "cents_per_km",
      date: fd.get("date"),
      origin: fd.get("origin"),
      destination: fd.get("destination"),
      kilometres: fd.get("kilometres"),
      purpose: fd.get("purpose"),
    };
    const res = await fetch(`${API}/car-trips`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not save trip.");
      return;
    }
    toast("Trip saved");
    form.reset();
    if (typeof refreshAll === "function") await refreshAll();
    else await refreshTripsFromApi();
  }

  async function startLogbookTrip(ev) {
    ev.preventDefault();
    const form = ev.target;
    const fd = new FormData(form);
    const payload = {
      method: "logbook",
      date: fd.get("date"),
      origin: fd.get("origin"),
      odometerStart: fd.get("odometerStart"),
      purpose: fd.get("purpose"),
    };
    const res = await fetch(`${API}/car-trips`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not start trip.");
      return;
    }
    toast("Logbook trip started");
    form.reset();
    await refreshTripsFromApi();
  }

  async function addLogbookStop(ev) {
    ev.preventDefault();
    const trip = openLogbookTrip();
    if (!trip) return;
    const form = ev.target;
    const fd = new FormData(form);
    const res = await fetch(`${API}/car-trips/${encodeURIComponent(trip.id)}/destinations`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        odometer: fd.get("odometer"),
        note: fd.get("note"),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not add destination.");
      return;
    }
    toast("Destination added");
    form.reset();
    await refreshTripsFromApi();
  }

  async function closeLogbookTrip(ev) {
    ev.preventDefault();
    const trip = openLogbookTrip();
    if (!trip) return;
    const ok = window.confirm("Are you sure you wish to finish this trip?");
    if (!ok) return;
    const form = ev.target;
    const fd = new FormData(form);
    const res = await fetch(`${API}/car-trips/${encodeURIComponent(trip.id)}/close`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kilometres: fd.get("kilometres"),
        odometerEnd: fd.get("odometerEnd"),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not close trip.");
      return;
    }
    toast("Trip closed");
    form.reset();
    if (typeof refreshAll === "function") await refreshAll();
    else await refreshTripsFromApi();
  }

  async function reconcileSelected() {
    const ids = selectedTripIds();
    if (!ids.length) return;
    const res = await fetch(`${API}/car-trips/reconcile`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not reconcile.");
      return;
    }
    toast(`Reconciled ${data.updated || ids.length} trip${(data.updated || ids.length) === 1 ? "" : "s"}`);
    if (typeof refreshAll === "function") await refreshAll();
    else await refreshTripsFromApi();
  }

  async function deleteTrip(id) {
    if (!window.confirm("Delete this trip?")) return;
    const res = await fetch(`${API}/car-trips/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.error || "Could not delete trip.");
      return;
    }
    toast("Trip deleted");
    if (typeof refreshAll === "function") await refreshAll();
    else await refreshTripsFromApi();
  }

  function bind() {
    if (!byId("view-car-expenses")) return;

    setMethodRadios(currentMethod());
    applyMethodPanels(currentMethod());

    document.querySelectorAll('input[name="carClaimMethod"]').forEach((el) => {
      el.addEventListener("change", () => {
        if (el.checked) void persistMethod(el.value);
      });
    });

    byId("car-trip-cents-form")?.addEventListener("submit", (ev) => void createCentsTrip(ev));
    byId("car-trip-logbook-open-form")?.addEventListener("submit", (ev) => void startLogbookTrip(ev));
    byId("car-trip-logbook-stop-form")?.addEventListener("submit", (ev) => void addLogbookStop(ev));
    byId("car-trip-logbook-close-form")?.addEventListener("submit", (ev) => void closeLogbookTrip(ev));
    byId("car-trips-reconcile-btn")?.addEventListener("click", () => void reconcileSelected());

    const list = byId("car-trips-list");
    if (list && list.dataset.carTripsBound !== "1") {
      list.dataset.carTripsBound = "1";
      list.addEventListener("change", (ev) => {
        if (ev.target.classList.contains("ledger-select-all")) {
          const on = ev.target.checked;
          list.querySelectorAll(".ledger-row-check:not(:disabled)").forEach((cb) => {
            cb.checked = on;
          });
        }
        updateReconcileBtn();
      });
      list.addEventListener("click", (ev) => {
        const del = ev.target.closest("[data-del-car-trip]");
        if (del) void deleteTrip(del.getAttribute("data-del-car-trip"));
      });
    }

    // Prefill today's date on trip forms
    const today = new Date().toISOString().slice(0, 10);
    ["car-trip-cents-form", "car-trip-logbook-open-form"].forEach((fid) => {
      const dateInput = byId(fid)?.querySelector('[name="date"]');
      if (dateInput && !dateInput.value) dateInput.value = today;
    });

    void refreshTripsFromApi();
  }

  function hookRefresh() {
    const orig = globalThis.refreshAll;
    if (typeof orig === "function" && !orig.__carTripsWrapped) {
      const wrapped = async function (...args) {
        const out = await orig.apply(this, args);
        applyMethodPanels(currentMethod());
        renderTrips();
        renderOpenLogbookTrip();
        return out;
      };
      wrapped.__carTripsWrapped = true;
      globalThis.refreshAll = wrapped;
    }
  }

  function start() {
    bind();
    hookRefresh();
    document.querySelectorAll('.nav-btn[data-view="car-expenses"]').forEach((btn) => {
      btn.addEventListener("click", () => setTimeout(() => void refreshTripsFromApi(), 150));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
