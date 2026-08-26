/*
 * Fuel Hub UI — second Driver Hub app (loaded after enhancements.js).
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  let state = null;
  let view = "dashboard";
  let lastPlan = null;
  let lastPlanForm = null;
  let watchId = null;
  let gpsBusy = false;
  let receiptTimer = null;
  let currentReceiptId = null;
  let receiptsHydrated = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n) || 0);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || "Request failed");
      if (data.remainingMs != null) err.remainingMs = data.remainingMs;
      throw err;
    }
    return data;
  }

  function toast(msg) {
    if (typeof window.toast === "function") window.toast(msg);
  }

  function profileBanner() {
    const p = state && state.hubProfile;
    if (!p || !p.linked) {
      return `<p class="fuelhub-profile-banner">Sign in on Driver Hub to use the same profile as Taxation Hub.</p>`;
    }
    const bits = [
      p.displayName,
      p.employer,
      p.licenceLabel,
      p.driverTypeLabel,
      p.workCombinationLabel,
      p.activeFuelVehicle && p.activeFuelVehicle.classCode,
    ].filter(Boolean);
    const seed = p.truckSeeded
      ? ` Fuel Hub follows Profile work vehicle${
          p.activeFuelVehicle
            ? ` and registered class ${esc(p.activeFuelVehicle.classCode)} (${esc(p.activeFuelVehicle.tankCapacityL)} L)`
            : ""
        } and ${esc(p.driverTypeLabel || "linehaul")} duty cycle for L/100 km — save Truck &amp; load only if you need different payload.`
      : ` Payload was saved in Fuel Hub; Profile driver type (${esc(p.driverTypeLabel || "linehaul")}) still scales planned L/100 km.${
          p.activeFuelVehicle
            ? ` Tank litres follow registered class ${esc(p.activeFuelVehicle.classCode)}.`
            : ""
        }`;
    return `<div class="fuelhub-profile-banner">Driver Hub profile · ${bits.map(esc).join(" · ")}.${seed}</div>`;
  }

  function setView(next) {
    view = next;
    const titles = {
      dashboard: "Dashboard",
      profile: "Profile",
      forecast: "Forecast",
      plan: "Plan fills",
      track: "GPS",
      truck: "Truck & load",
      cards: "Fuel cards",
      receipts: "Fuel receipts",
      prices: "Prices & tables",
    };
    const title = byId("fuelhub-page-title");
    if (title) title.textContent = titles[next] || "Fuel Hub";
    document.querySelectorAll("#fuelhub-shell [data-fuel-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-fuel-view") === next);
    });
    document.querySelectorAll("#fuelhub-shell .fuelhub-view").forEach((el) => {
      el.classList.toggle("active", el.id === `fuel-view-${next}`);
    });
    if (next !== "receipts") stopReceiptTimer();
    render();
    if (next === "dashboard") locateForDeals();
    if (next === "receipts") void refreshReceipts();
  }

  function comboOptions(selected) {
    return (state.combinations || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function schemeOptions(selected) {
    return (state.massSchemes || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function retailerOptions(selected) {
    const rows = [{ id: "any", name: "Any / company-wide" }, ...(state.retailers || [])];
    return rows
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${r.id === selected ? "selected" : ""}>${esc(r.name)}</option>`
      )
      .join("");
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
  }

  function formVal(name, fallback) {
    if (lastPlanForm && lastPlanForm[name] != null && lastPlanForm[name] !== "") return lastPlanForm[name];
    return fallback == null ? "" : fallback;
  }

  function westQldExampleFields() {
    const truck = (state && state.truck) || {};
    return {
      origin: "St George",
      destination: "Gracemere",
      via: "Longreach, Barcaldine, Emerald",
      refillAt: "Barcaldine",
      payloadT: "10",
      addedPayloadT: "8",
      hours: "18",
      currentFuelL: String(truck.currentFuelL != null ? truck.currentFuelL : 260),
      distanceKm: "",
    };
  }

  function readPlanBody(form) {
    const fd = new FormData(form);
    lastPlanForm = Object.fromEntries(fd.entries());
    const viaRaw = String(fd.get("via") || "").trim();
    return {
      origin: fd.get("origin"),
      destination: fd.get("destination"),
      via: viaRaw || undefined,
      distanceKm: fd.get("distanceKm") || undefined,
      refillAt: fd.get("refillAt") || undefined,
      payloadT: fd.get("payloadT") || undefined,
      addedPayloadT: fd.get("addedPayloadT") || undefined,
      hours: fd.get("hours") || undefined,
      currentFuelL: fd.get("currentFuelL") || undefined,
    };
  }

  function scenarioPct(scenarios, valueKey, row) {
    const max = Math.max(...(scenarios || []).map((s) => Number(s[valueKey]) || 0), 0.001);
    return Math.round(((Number(row[valueKey]) || 0) / max) * 100);
  }

  function renderScenarioChart(scenarios, { showCost } = {}) {
    const rows = scenarios || [];
    if (!rows.length) return "";
    return `<div class="fuelhub-scenarios">${rows
      .map(
        (s) => `
        <article class="fuelhub-scenario fuelhub-scenario-${esc(s.id)}">
          <div class="fuelhub-scenario-head">
            <h3>${esc(s.name)}</h3>
            <span>${esc(s.litresPerKm)} L/km · ${esc(s.litresPer100km)} L/100 km${
              showCost && s.fillL != null
                ? ` · ${esc(s.fillL)} L · ${money(s.costAud)}`
                : ""
            }</span>
          </div>
          <div class="fuelhub-scenario-bar" aria-hidden="true"><span style="width:${scenarioPct(rows, "litresPerKm", s)}%"></span></div>
          <p class="fuelhub-muted">${esc(s.note || "")}</p>
        </article>`
      )
      .join("")}</div>`;
  }

  function renderRefillAdvice(advice) {
    if (!advice) return "";
    return `<div class="fuelhub-refill">
      <h3>Minimum fill at ${esc(advice.place)}</h3>
      <p>${esc(advice.note || "")}</p>
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${esc(advice.minFillL)} L</strong><span>Minimum to the next planned town + reserve</span></div>
        <div class="fuelhub-stat"><strong>${esc(advice.idealFillL)} L</strong><span>Ideal (baseline buffer)</span></div>
        <div class="fuelhub-stat"><strong>${esc(advice.tankFillL)} L</strong><span>Fill the tank</span></div>
        <div class="fuelhub-stat"><strong>${esc(advice.extraVsMinL)} L</strong><span>Extra litres if you brim it</span></div>
      </div>
      ${
        advice.site
          ? `<p class="fuelhub-muted">${esc(advice.site.name)} · ${esc(advice.site.band)} · ${esc(advice.site.effectiveCpl)} ¢/L after cards · ${esc(advice.remainingKm)} km still to run with the loaded freight.</p>`
          : `<p class="fuelhub-muted">${esc(advice.remainingKm)} km still to run with the loaded freight.</p>`
      }
    </div>`;
  }

  function renderHopTable(hops) {
    if (!hops || !hops.length) return "";
    return `<table class="fuelhub-table"><thead><tr>
      <th>Hop</th><th>Km</th><th>Hours</th><th>Freight t</th><th>L/km</th><th>Burn L</th><th>Fill L</th><th>Min / ideal</th>
    </tr></thead><tbody>${hops
      .map(
        (h) => `<tr class="${h.refillHere ? "fuelhub-row-refill" : ""}">
          <td>${esc(h.from)} → ${esc(h.to)}${h.refillHere ? " <span class='fuelhub-muted'>refuel</span>" : ""}</td>
          <td>${esc(h.distanceKm)}</td>
          <td>${esc(h.hours)}</td>
          <td>${esc(h.payloadT)}</td>
          <td>${esc(h.litresPerKm)}</td>
          <td>${h.burnL != null ? esc(h.burnL) : "—"}</td>
          <td>${h.fillL != null ? esc(h.fillL) : "—"}</td>
          <td>${h.refillHere ? `${esc(h.minFillL)} / ${esc(h.idealFillL)}` : "—"}</td>
        </tr>`
      )
      .join("")}</tbody></table>`;
  }

  function renderRouteFields() {
    const truck = (state && state.truck) || {};
    return `
      <label>Origin<input name="origin" required placeholder="e.g. St George" value="${esc(formVal("origin"))}" /></label>
      <label>Destination<input name="destination" required placeholder="e.g. Gracemere" value="${esc(formVal("destination"))}" /></label>
      <label class="span-2">Via (comma or “to”)<input name="via" placeholder="e.g. Longreach, Barcaldine, Emerald" value="${esc(formVal("via"))}" /></label>
      <label>Refuel at<input name="refillAt" placeholder="e.g. Barcaldine" value="${esc(formVal("refillAt"))}" /></label>
      <label>Hours on the road<input name="hours" type="number" min="0.5" step="0.1" placeholder="Leave blank for 80 km/h" value="${esc(formVal("hours"))}" /></label>
      <label>Freight / haulage (t)<input name="payloadT" type="number" min="0" step="0.1" value="${esc(formVal("payloadT", truck.payloadT))}" /></label>
      <label>Added freight after refill (t)<input name="addedPayloadT" type="number" min="0" step="0.1" value="${esc(formVal("addedPayloadT", "0"))}" /></label>
      <label>Fuel on board (L)<input name="currentFuelL" type="number" min="0" step="1" value="${esc(formVal("currentFuelL", truck.currentFuelL))}" /></label>
      <label>Distance override (km)<input name="distanceKm" type="number" min="1" step="1" placeholder="Leave blank for hop distances" value="${esc(formVal("distanceKm"))}" /></label>
    `;
  }

  function dash() {
    return (state && state.dashboard) || {};
  }

  function renderDashboard() {
    const el = byId("fuel-view-dashboard");
    if (!el) return;
    const d = dash();
    const current = d.currentJourney || {};
    const plan = current.plan || lastPlan;
    const track = current.track || state.activeTrack;
    const trips = d.previousJourneys || state.trips || [];
    const stats = d.journeyStats || {};
    const deals = (d.areaDeals && d.areaDeals.deals) || [];
    const area = d.areaDeals || {};
    const hub = (state && state.hubProfile) || {};

    const forecastHint =
      plan && plan.forecast && plan.forecast.refillAdvice
        ? `<p class="fuelhub-muted">Forecast: ${esc(plan.forecast.refillAdvice.place)} min ${esc(
            plan.forecast.refillAdvice.minFillL
          )} L · ideal ${esc(plan.forecast.refillAdvice.idealFillL)} L · ${esc(
            plan.forecast.litresPerKm
          )} L/km.</p>`
        : "";
    const journeyCard = plan
      ? `<p><strong>${esc(plan.origin)}</strong> → <strong>${esc(plan.destination)}</strong>
         · ${plan.distanceKm || "—"} km
         ${plan.corridor && plan.corridor.name ? ` on ${esc(plan.corridor.name)}` : ""}</p>
         <p>${plan.consumptionLPer100km || "—"} L/100 km
         · ${money((plan.totals && plan.totals.costAud) || 0)} for ${(plan.totals && plan.totals.fillL) || 0} L</p>
         ${(plan.stops || [])
           .slice(0, 3)
           .map((s) => `<p class="fuelhub-muted">${esc(s.name)} · ${s.fillL} L · ${s.effectiveCpl} ¢/L</p>`)
           .join("")}
         ${forecastHint}
         <p class="fuelhub-muted">${plan.plannedAt ? `Planned ${esc(fmtWhen(plan.plannedAt))}` : "Latest planned run."}</p>`
      : `<p class="fuelhub-muted">No planned run yet. Open Plan fills or Forecast for a depot-to-gate corridor (NHVR, not Apple/Google).</p>`;

    const gpsCard = track
      ? `<p class="fuelhub-live">${track.km || 0} km</p>
         <p class="fuelhub-muted">${track.pointCount || 0} GPS points · about ${current.remainingKm || "—"} km of usable diesel left.
         ${track.updatedAt ? `Updated ${esc(fmtWhen(track.updatedAt))}.` : ""}</p>`
      : `<p class="fuelhub-muted">GPS is idle. Start a track to score nearby diesel against your position.</p>`;

    const tripRows = trips.length
      ? `<table class="fuelhub-table"><thead><tr><th>When</th><th>Run</th><th>Km</th><th>L/km</th><th>Fill</th><th>Cost</th></tr></thead><tbody>${trips
          .map(
            (t) => `<tr>
              <td>${esc(fmtWhen(t.createdAt))}</td>
              <td>${esc(t.origin)} → ${esc(t.destination)}${t.corridor ? ` <span class="fuelhub-muted">(${esc(t.corridor)})</span>` : ""}</td>
              <td>${t.distanceKm || "—"}</td>
              <td>${t.litresPerKm != null ? t.litresPerKm : "—"}</td>
              <td>${t.fillL != null ? `${t.fillL} L` : "—"}</td>
              <td>${t.costAud != null ? money(t.costAud) : "—"}</td>
            </tr>`
          )
          .join("")}</tbody></table>
         <p class="fuelhub-muted">${stats.tripCount || trips.length} saved · ${stats.totalKm || 0} km · ${stats.totalFillL || 0} L · ${money(stats.totalCostAud || 0)}</p>`
      : `<p class="fuelhub-muted">No saved trips yet. Plan a run, then Save trip to build this list.</p>`;

    const dealRows = deals.length
      ? `<table class="fuelhub-table"><thead><tr><th>Site</th><th>Band</th><th>¢/L</th><th>Km</th><th>Source</th></tr></thead><tbody>${deals
          .map(
            (s) => `<tr>
              <td>${esc(s.name)}${s.truckAccess ? "" : " <span class='fuelhub-muted'>car</span>"}</td>
              <td>${esc(s.band)}</td>
              <td><strong>${s.effectiveCpl}</strong>${s.discount && s.discount.cardCplOff ? ` <span class="fuelhub-muted">(-${s.discount.cardCplOff}¢ card)</span>` : ""}</td>
              <td>${s.distanceKm != null ? s.distanceKm : s.km != null ? `${s.km} along` : "—"}</td>
              <td>${s.source === "bowser" ? "Bowser" : "Gov table"}</td>
            </tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="fuelhub-muted">No truck-access sites matched this combination in the current area.</p>`;

    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${current.consumptionLPer100km || "—"}</strong><span>L / 100 km now</span></div>
        <div class="fuelhub-stat"><strong>${current.remainingKm || "—"} km</strong><span>Range before reserve</span></div>
        <div class="fuelhub-stat"><strong>${esc(current.combinationLabel || hub.workCombinationLabel || "—")}</strong><span>${esc(current.driverTypeLabel || hub.driverTypeLabel || "Duty cycle")}</span></div>
        <div class="fuelhub-stat"><strong>${
          current.fuelClassCode || (hub.activeFuelVehicle && hub.activeFuelVehicle.classCode) || "—"
        }</strong><span>${
          current.tankCapacityL
            ? `${current.tankCapacityL} L tank · ${current.currentFuelL != null ? `${current.currentFuelL} L on board` : "class"}`
            : "Registered fuel class"
        }</span></div>
        <div class="fuelhub-stat"><strong>${deals[0] ? `${deals[0].effectiveCpl} ¢` : "—"}</strong><span>Best nearby diesel</span></div>
      </div>
      <div class="fuelhub-dash-grid">
        <div class="fuelhub-card">
          <h2>Current journey</h2>
          ${journeyCard}
          <h3 class="fuelhub-subhead">Live GPS</h3>
          ${gpsCard}
          <div class="fuelhub-actions">
            <button type="button" class="btn primary" data-fuel-jump="plan">Plan fills</button>
            <button type="button" class="btn secondary" data-fuel-jump="forecast">Forecast</button>
            <button type="button" class="btn secondary" data-fuel-jump="track">GPS</button>
          </div>
        </div>
        <div class="fuelhub-card">
          <h2>Previous journeys</h2>
          ${tripRows}
        </div>
      </div>
      <div class="fuelhub-card fuelhub-deals">
        <h2>Best fuel deals in this area</h2>
        <p class="fuelhub-muted">${esc(area.areaLabel || "Government-style diesel on NHVR freight sites.")}</p>
        ${dealRows}
        <p class="fuelhub-muted">${esc(area.nhvrNote || "")}
        ${area.nhvrPlannerUrl ? ` <a href="${esc(area.nhvrPlannerUrl)}" target="_blank" rel="noopener">NHVR Route Planner</a>.` : ""}
        Sources: ${((area.sources || []).map((s) => s.name) || []).map(esc).join(" · ")}</p>
      </div>
    `;
    el.querySelectorAll("[data-fuel-jump]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-fuel-jump")));
    });
  }

  function driverTypeOptions(selected) {
    const types = (state && state.driverTypes) || {};
    return Object.entries(types)
      .map(
        ([id, meta]) =>
          `<option value="${esc(id)}" ${id === selected ? "selected" : ""}>${esc((meta && meta.label) || id)}</option>`
      )
      .join("");
  }

  function licenceOptions(selected) {
    return ((state && state.licenceClasses) || [])
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)} (${esc(c.typicalRange || "")})</option>`
      )
      .join("");
  }

  function workVehicleOptions(selected) {
    const rows = (state && state.workCombinations) || state.combinations || [];
    return rows
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`
      )
      .join("");
  }

  function classOptions(selected) {
    const rows = (state && state.fuelClasses) || [];
    const known = rows.some((c) => c.id === selected);
    const opts = rows
      .map(
        (c) =>
          `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.id)} — ${esc(c.label)} (${esc(c.tankCapacityL)} L)</option>`
      )
      .join("");
    return `${opts}<option value="custom" ${selected && !known ? "selected" : ""}>Custom class code…</option>`;
  }

  function catalogFor(code) {
    const rows = (state && state.fuelClasses) || [];
    return rows.find((c) => c.id === code) || null;
  }

  function renderFuelVehiclesCard() {
    const hub = (state && state.hubProfile) || {};
    const list = Array.isArray(hub.fuelVehicles) ? hub.fuelVehicles : [];
    const active = hub.activeFuelVehicle;
    const rows = list.length
      ? list
          .map((v) => {
            const title = v.nickname || v.registration || v.classCode;
            const detail = [
              v.registration ? `Rego ${v.registration}` : "",
              v.classCode,
              v.classLabel && v.classLabel !== v.classCode ? v.classLabel : "",
              `${v.tankCapacityL} L tank`,
              v.currentFuelL != null ? `${v.currentFuelL} L on board` : "",
              v.rangeKm != null ? `~${v.rangeKm} km range` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return `<article class="fuelhub-vehicle ${v.active ? "is-active" : ""}">
              <div>
                <strong>${esc(title)}</strong>
                <p class="fuelhub-muted">${esc(detail)}</p>
              </div>
              <div class="fuelhub-actions">
                <button type="button" class="btn secondary" data-fuel-vehicle-activate="${esc(v.id)}" ${v.active ? "disabled" : ""}>${v.active ? "Active" : "Activate"}</button>
                <button type="button" class="btn danger" data-fuel-vehicle-remove="${esc(v.id)}">Remove</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="fuelhub-muted">No registered fuel vehicles yet. These class codes are unique to the truck on this profile — not the general heavy rigid work vehicle.</p>`;
    const monitor = active
      ? `<p class="fuelhub-muted">Monitoring <strong>${esc(active.classCode)}</strong> · ${esc(active.tankCapacityL)} L tank · ${esc(active.currentFuelL)} L on board${active.rangeKm != null ? ` · ~${esc(active.rangeKm)} km before reserve` : ""}.</p>`
      : `<p class="fuelhub-muted">Mark a vehicle Active to drive Fuel Hub fill routes from that tank instead of a generic rigid default.</p>`;
    return `
      <div class="fuelhub-card fuelhub-profile-form-card">
        <h2>Registered fuel vehicles</h2>
        <p class="fuelhub-muted">Manual class codes for fuel carrying capacity on the individual vehicle (samples: XN93DX, YN16BQ, YN17BQ). Finer than work vehicle “heavy rigid”. Saving here updates the shared Driver Hub profile.</p>
        ${monitor}
        <div class="fuelhub-vehicle-list">${rows}</div>
        <form id="fuelhub-vehicle-form" class="fuelhub-profile-form">
          <label>Nickname<input name="nickname" placeholder="e.g. Local HR" /></label>
          <label>Registration<input name="registration" placeholder="e.g. ABC123" /></label>
          <label>Fuel class<select name="classCode" id="fuelhub-vehicle-class">${classOptions("YN16BQ")}</select></label>
          <label id="fuelhub-vehicle-custom-wrap" hidden>Custom class<input name="customClassCode" id="fuelhub-vehicle-custom" placeholder="e.g. AB12CD" maxlength="12" /></label>
          <label>Tank capacity (L)<input name="tankCapacityL" id="fuelhub-vehicle-tank" type="number" min="80" max="4000" step="1" value="520" /></label>
          <label>Fuel on board (L)<input name="currentFuelL" id="fuelhub-vehicle-fuel" type="number" min="0" max="4000" step="1" value="286" /></label>
          <p class="fuelhub-muted span-2" id="fuelhub-vehicle-hint">YN16BQ is a standard heavy-rigid tank. Compact XN93DX fills more often; long-range YN17BQ carries more diesel.</p>
          <label class="fuelhub-check span-2"><input type="checkbox" name="active" checked /> Active for Fuel Hub routes</label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Save vehicle to profile</button>
          </div>
        </form>
      </div>
    `;
  }

  function combinationFromProfile(licence, driverType) {
    const duty = String(driverType || "long_haul");
    if (licence === "lr_mr" || licence === "hr") return "rigid";
    if (licence === "mc") return duty === "local" ? "semi" : "b_double";
    if (licence === "hc" && (duty === "long_haul" || duty === "owner_driver")) return "b_double";
    return "semi";
  }

  function licenceFromSalary(salary) {
    const n = Number(salary);
    const amount = Number.isFinite(n) && n > 0 ? n : 0;
    if (amount >= 110000) return "mc";
    if (amount >= 79000) return "hc";
    if (amount >= 70000) return "hr";
    return "lr_mr";
  }

  function renderProfile() {
    const el = byId("fuel-view-profile");
    if (!el) return;
    const parked = document.getElementById("admin-panel");
    const home = document.getElementById("admin-panel-home");
    if (parked && el.contains(parked) && home) home.appendChild(parked);
    const hub = (state && state.hubProfile) || {};
    const recordsProfile = hub;
    el.innerHTML = `
      <div class="fuelhub-card fuelhub-profile-form-card">
        <h2>Driver Hub profile</h2>
        <p class="fuelhub-muted">Same login and profile as Taxation Hub — name, driver type and work vehicle set Fuel Hub L/100 km. Saving here updates both apps.</p>
        <form id="fuelhub-profile-form" class="fuelhub-profile-form">
          <label>Name<input name="name" value="${esc(recordsProfile.name || "")}" placeholder="Full name" /></label>
          <label>Driver type<select name="driverType" id="fuel-profile-driver-type">${driverTypeOptions(hub.driverType || "long_haul")}</select></label>
          <label>Employer<input name="employer" value="${esc(hub.employer || "")}" placeholder="Fleet or company" /></label>
          <label>Annual salary ($)<input name="annualSalary" id="fuel-profile-salary" type="number" min="0" step="0.01" value="${esc(hub.annualSalary != null ? hub.annualSalary : "")}" /></label>
          <label>Licence class<select name="licenceClass" id="fuel-profile-licence">${licenceOptions(hub.licenceClass || "hc")}</select></label>
          <label>Work vehicle<select name="workCombination" id="fuel-profile-work-combination">${workVehicleOptions(hub.workCombination || "semi")}</select></label>
          <p class="fuelhub-muted span-2" id="fuel-work-combination-hint">Fuel Hub uses this vehicle plus your driver type for diesel L/100 km on planned runs.</p>
          <label>Financial year<input name="financialYear" value="${esc(hub.financialYear || "")}" placeholder="2025-26" /></label>
          <label class="fuelhub-check"><input type="checkbox" name="tfnSupplied" ${hub.tfnSupplied ? "checked" : ""} /> TFN supplied to employer</label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Save profile</button>
          </div>
        </form>
      </div>
      ${renderFuelVehiclesCard()}
      <div id="fuelhub-admin-slot"></div>
    `;
    if (typeof window.__haulagePlaceAdminPanel === "function") {
      window.__haulagePlaceAdminPanel();
    }
    const form = el.querySelector("#fuelhub-profile-form");
    const typeSelect = el.querySelector("#fuel-profile-driver-type");
    const licenceSelect = el.querySelector("#fuel-profile-licence");
    const comboSelect = el.querySelector("#fuel-profile-work-combination");
    const salaryInput = el.querySelector("#fuel-profile-salary");
    const hint = el.querySelector("#fuel-work-combination-hint");

    function syncCombo() {
      if (!comboSelect || comboSelect.dataset.userSet === "1") return;
      const next = combinationFromProfile(licenceSelect && licenceSelect.value, typeSelect && typeSelect.value);
      if (comboSelect.value !== next) comboSelect.value = next;
      if (hint) {
        const label = comboSelect.options[comboSelect.selectedIndex]
          ? comboSelect.options[comboSelect.selectedIndex].text
          : next;
        hint.textContent = `Fuel Hub uses ${label} with your driver type to set L/100 km. Save to apply.`;
      }
    }
    typeSelect?.addEventListener("change", syncCombo);
    licenceSelect?.addEventListener("change", syncCombo);
    comboSelect?.addEventListener("change", () => {
      comboSelect.dataset.userSet = "1";
    });
    salaryInput?.addEventListener("input", () => {
      if (!licenceSelect) return;
      licenceSelect.value = licenceFromSalary(salaryInput.value);
      syncCombo();
    });
    form?.addEventListener("submit", onSaveProfile);
    wireFuelVehicles(el);
  }

  function wireFuelVehicles(root) {
    const classSelect = root.querySelector("#fuelhub-vehicle-class");
    const customWrap = root.querySelector("#fuelhub-vehicle-custom-wrap");
    const customInput = root.querySelector("#fuelhub-vehicle-custom");
    const tankInput = root.querySelector("#fuelhub-vehicle-tank");
    const fuelInput = root.querySelector("#fuelhub-vehicle-fuel");
    const hint = root.querySelector("#fuelhub-vehicle-hint");
    function syncClass() {
      const value = classSelect && classSelect.value;
      const isCustom = value === "custom";
      if (customWrap) customWrap.hidden = !isCustom;
      const code = isCustom
        ? String(customInput && customInput.value ? customInput.value : "")
            .trim()
            .toUpperCase()
        : value;
      const meta = catalogFor(code);
      if (hint) {
        hint.textContent = meta
          ? `${meta.id} · ${meta.label} · ${meta.tankCapacityL} L. ${meta.notes || ""}`
          : "Custom class — type the code for this truck and the tank litres you monitor.";
      }
      if (meta && tankInput && tankInput.dataset.userSet !== "1") {
        tankInput.value = String(meta.tankCapacityL);
        if (fuelInput && fuelInput.dataset.userSet !== "1") {
          fuelInput.value = String(Math.round(meta.tankCapacityL * 0.55));
        }
      }
    }
    classSelect?.addEventListener("change", () => {
      if (tankInput) tankInput.dataset.userSet = "";
      if (fuelInput) fuelInput.dataset.userSet = "";
      syncClass();
    });
    customInput?.addEventListener("input", syncClass);
    tankInput?.addEventListener("input", () => {
      if (tankInput) tankInput.dataset.userSet = "1";
    });
    fuelInput?.addEventListener("input", () => {
      if (fuelInput) fuelInput.dataset.userSet = "1";
    });
    syncClass();
    root.querySelector("#fuelhub-vehicle-form")?.addEventListener("submit", onSaveFuelVehicle);
    root.querySelectorAll("[data-fuel-vehicle-activate]").forEach((btn) => {
      btn.addEventListener("click", () => onActivateFuelVehicle(btn.getAttribute("data-fuel-vehicle-activate")));
    });
    root.querySelectorAll("[data-fuel-vehicle-remove]").forEach((btn) => {
      btn.addEventListener("click", () => onRemoveFuelVehicle(btn.getAttribute("data-fuel-vehicle-remove")));
    });
  }

  async function onSaveFuelVehicle(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    let classCode = String(fd.get("classCode") || "");
    if (classCode === "custom") classCode = String(fd.get("customClassCode") || "");
    const data = await api("/fuelhub/vehicles", {
      method: "POST",
      body: {
        nickname: fd.get("nickname"),
        registration: fd.get("registration"),
        classCode,
        tankCapacityL: fd.get("tankCapacityL"),
        currentFuelL: fd.get("currentFuelL"),
        active: fd.get("active") === "on",
      },
    });
    if (state) {
      if (data.hubProfile) state.hubProfile = data.hubProfile;
      if (data.truck) state.truck = data.truck;
      if (data.efficiency) state.efficiency = data.efficiency;
    }
    toast("Registered fuel vehicle saved");
    await load();
    setView("profile");
  }

  async function onActivateFuelVehicle(id) {
    await api(`/fuelhub/vehicles/${encodeURIComponent(id)}/activate`, { method: "POST" });
    toast("Active fuel class applied to Fuel Hub routes");
    await load();
    setView("profile");
  }

  async function onRemoveFuelVehicle(id) {
    await api(`/fuelhub/vehicles/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("Registered fuel vehicle removed");
    await load();
    setView("profile");
  }

  async function onSaveProfile(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      name: fd.get("name"),
      driverType: fd.get("driverType"),
      employer: fd.get("employer"),
      annualSalary: fd.get("annualSalary"),
      licenceClass: fd.get("licenceClass"),
      workCombination: fd.get("workCombination"),
      financialYear: fd.get("financialYear"),
      tfnSupplied: fd.get("tfnSupplied") === "on",
    };
    await api("/profile", { method: "PUT", body });
    const taxForm = document.getElementById("profile-form");
    if (taxForm) {
      Object.entries(body).forEach(([k, v]) => {
        const input = taxForm.elements[k];
        if (!input) return;
        if (input.type === "checkbox") input.checked = Boolean(v);
        else input.value = v ?? "";
      });
    }
    toast("Profile saved — Fuel Hub rates will follow this vehicle and driver type");
    await load();
    setView("profile");
  }

  function renderForecast() {
    const el = byId("fuel-view-forecast");
    if (!el) return;
    const forecast = (state && state.forecast) || {};
    const avg = forecast.average || {};
    const prediction = forecast.prediction || (lastPlan && lastPlan.forecast) || null;
    const trips = avg.trips || forecast.trips || [];
    el.innerHTML = `
      ${profileBanner()}
      <p class="fuelhub-muted">Same idea as Taxation Hub Forecast — Conservative, Baseline and Optimistic. Litres/km move with freight tonnes, diesel already in the tanks, and hours on the road. Use this to size a minimum fill so you are not buying extra west-QLD diesel.</p>
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${avg.tripCount || 0}</strong><span>Saved trips in the average</span></div>
        <div class="fuelhub-stat"><strong>${avg.totalKm || 0} km</strong><span>Sample distance</span></div>
        <div class="fuelhub-stat"><strong>${avg.litresPerKm || "—"}</strong><span>Average L / km</span></div>
        <div class="fuelhub-stat"><strong>${avg.litresPer100km || "—"}</strong><span>Average L / 100 km</span></div>
        <div class="fuelhub-stat"><strong>${avg.avgPayloadT || "—"} t</strong><span>Km-weighted freight</span></div>
        <div class="fuelhub-stat"><strong>${avg.avgSpeedKmh || "—"} km/h</strong><span>Average speed (time factor)</span></div>
      </div>
      <div class="fuelhub-stack">
      <div class="fuelhub-card">
        <h2>Usage scenarios</h2>
        <p class="fuelhub-muted">From saved trips when you have history, otherwise from the current truck, fuel load and freight.</p>
        ${renderScenarioChart(forecast.scenarios || [])}
      </div>
      <div class="fuelhub-grid">
        <form id="fuel-forecast-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Predict a run</h2>
          <p class="fuelhub-muted span-2">Example: St George → Longreach → Barcaldine (refuel) → Emerald → Gracemere. After Barcaldine you pick up extra freight — take only the litres needed to Gracemere instead of filling the tank at an inflated bowser.</p>
          ${renderRouteFields()}
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Forecast fills</button>
            <button type="button" class="btn secondary" id="fuel-forecast-example">West QLD example</button>
            <button type="button" class="btn secondary" data-fuel-jump="plan">Open in Plan fills</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>This prediction</h2>
          ${
            prediction
              ? `<p><strong>${esc(prediction.origin)}</strong> → <strong>${esc(prediction.destination)}</strong>
                 · ${esc(prediction.distanceKm)} km · ${esc(prediction.hours)} h · time factor ${esc(prediction.timeFactor)}
                 · freight ${esc(prediction.payloadT)} t${prediction.addedPayloadT ? ` + ${esc(prediction.addedPayloadT)} t after ${esc(prediction.refillAt || "refuel")}` : ""}</p>
                 ${renderScenarioChart(prediction.scenarios || [], { showCost: true })}
                 ${renderRefillAdvice(prediction.refillAdvice)}
                 ${renderHopTable(prediction.hops)}
                 <p class="fuelhub-muted">${esc(prediction.note || "")}</p>`
              : `<p class="fuelhub-muted">Enter a corridor to see Conservative / Baseline / Optimistic L/km and a minimum fill at the refuel town.</p>`
          }
        </div>
      </div>
      <div class="fuelhub-card">
        <h2>Per trip</h2>
        ${
          trips.length
            ? `<table class="fuelhub-table"><thead><tr><th>When</th><th>Run</th><th>Km</th><th>Hours</th><th>Freight t</th><th>Fuel L</th><th>L/km</th><th>L/100</th></tr></thead><tbody>${trips
                .map(
                  (t) => `<tr>
                    <td>${esc(fmtWhen(t.createdAt))}</td>
                    <td>${esc(t.origin)} → ${esc(t.destination)}</td>
                    <td>${esc(t.distanceKm)}</td>
                    <td>${esc(t.hours)}</td>
                    <td>${esc(t.payloadT)}</td>
                    <td>${esc(t.fuelLoadL)}</td>
                    <td>${esc(t.litresPerKm)}</td>
                    <td>${esc(t.litresPer100km)}</td>
                  </tr>`
                )
                .join("")}</tbody></table>`
            : `<p class="fuelhub-muted">No saved trips yet. Plan a run and Save trip — each row’s L/km uses fill litres, freight and hours.</p>`
        }
      </div>
      </div>
    `;
    el.querySelector("#fuel-forecast-form")?.addEventListener("submit", onPlan);
    el.querySelector("#fuel-forecast-example")?.addEventListener("click", onWestQldExample);
    el.querySelectorAll("[data-fuel-jump]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-fuel-jump")));
    });
  }

  function renderPlan() {
    const el = byId("fuel-view-plan");
    if (!el) return;
    const plan = lastPlan;
    const eff = (state && state.efficiency) || {};
    const hub = (state && state.hubProfile) || {};
    const prediction = (plan && plan.forecast) || (state && state.forecast && state.forecast.prediction);
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-stats">
        <div class="fuelhub-stat"><strong>${eff.consumptionLPer100km || "—"}</strong><span>L / 100 km</span></div>
        <div class="fuelhub-stat"><strong>${eff.litresPerKm || "—"}</strong><span>L / km</span></div>
        <div class="fuelhub-stat"><strong>${eff.rangeKm || "—"} km</strong><span>Range before reserve</span></div>
        <div class="fuelhub-stat"><strong>${eff.fuelMassKg || "—"} kg</strong><span>Diesel mass in tanks</span></div>
      </div>
      <p class="fuelhub-muted">${esc(hub.workCombinationLabel || "Work vehicle")} · ${esc(
        hub.driverTypeLabel || "linehaul"
      )} duty cycle sets L/100 km.${
        hub.activeFuelVehicle
          ? ` Registered class ${esc(hub.activeFuelVehicle.classCode)} (${esc(hub.activeFuelVehicle.tankCapacityL)} L) sets tank and fill spacing.`
          : " Add a registered fuel class on Profile to set tank litres instead of a generic rigid default."
      }</p>
      <div class="fuelhub-grid">
        <form id="fuel-plan-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Route</h2>
          <p class="fuelhub-muted span-2">Type towns or a depot-to-gate run. Fuel Hub matches NHVR freight corridors (Hume, Pacific, Newell, Warrego, Capricorn, Stuart, Eyre…) instead of Apple/Google car shortcuts. Freight, hours and fuel on board change L/km; refuel-at sizes a minimum fill.</p>
          ${renderRouteFields()}
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Plan fuel stops</button>
            <button type="button" class="btn secondary" id="fuel-plan-example">West QLD example</button>
            <button type="button" class="btn secondary" id="fuel-plan-save">Save trip</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Recommended fills</h2>
          ${
            plan
              ? renderPlanResult(plan)
              : `<p class="fuelhub-muted">Enter a run to rank truck-access diesel stops by effective ¢/L (table or bowser, minus cards), then rest/refresh windows on NHVR-style hours.</p>`
          }
        </div>
      </div>
      ${
        prediction
          ? `<div class="fuelhub-card">
              <h2>Real-time fueling forecast</h2>
              <p class="fuelhub-muted">Conservative / Baseline / Optimistic — same categories as Taxation Hub Forecast.</p>
              ${renderScenarioChart(prediction.scenarios || [], { showCost: true })}
              ${renderRefillAdvice(prediction.refillAdvice)}
              ${renderHopTable(prediction.hops)}
            </div>`
          : ""
      }
    `;
    el.querySelector("#fuel-plan-form")?.addEventListener("submit", onPlan);
    el.querySelector("#fuel-plan-save")?.addEventListener("click", onSaveTrip);
    el.querySelector("#fuel-plan-example")?.addEventListener("click", onWestQldExample);
  }

  function renderPlanResult(plan) {
    const warnings = (plan.warnings || []).map((w) => `<p class="fuelhub-warn">${esc(w)}</p>`).join("");
    const stops = (plan.stops || [])
      .map(
        (s) => `
        <article class="fuelhub-stop">
          <h3>${esc(s.name)}</h3>
          <p class="fuelhub-muted">${esc(s.reason)} · ${s.km} km · ${esc(s.band)} · ${s.effectiveCpl} ¢/L after cards</p>
          <p>Fill <strong>${s.fillL} L</strong> · ${money(s.costAud)} · depart with ${s.fuelOnDepartureL} L (~${s.rangeAfterKm} km)</p>
          ${s.refresh ? `<p class="fuelhub-muted">Refresh: food / parking / shower on site.</p>` : ""}
        </article>`
      )
      .join("");
    const refresh = (plan.refreshStops || [])
      .map((r) => `<li><strong>${esc(r.name)}</strong> at ${r.km} km — ${esc(r.note)}</li>`)
      .join("");
    return `
      ${warnings}
      <p><strong>${esc(plan.origin)}</strong> → <strong>${esc(plan.destination)}</strong>
      · ${plan.distanceKm} km on ${esc(plan.corridor.name)}
      · ${plan.consumptionLPer100km} L/100 km
      · ${money(plan.totals.costAud)} for ${plan.totals.fillL} L
      ${plan.totals.averageEffectiveCpl != null ? ` · avg ${plan.totals.averageEffectiveCpl} ¢/L` : ""}</p>
      ${stops || `<p class="fuelhub-muted">No fill required on this hop with current fuel.</p>`}
      ${refresh ? `<h2>Refuel &amp; refresh</h2><ul class="fuelhub-muted">${refresh}</ul>` : ""}
      <p class="fuelhub-muted">${esc(plan.sourcesNote)}</p>
    `;
  }

  function renderTrack() {
    const el = byId("fuel-view-track");
    if (!el) return;
    const track = state.activeTrack;
    const eff = state.efficiency || {};
    const km = track ? track.km : 0;
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-card">
        <h2>Live GPS</h2>
        <p class="fuelhub-muted">Uses this device’s location to accumulate kilometres. Offline you can still type a route on Plan fills. Remaining range uses current tank, load and fuel mass.</p>
        <p class="fuelhub-live">${km} km</p>
        <p class="fuelhub-muted">${track ? `${track.pointCount || 0} points` : "Not tracking"} · about ${eff.rangeKm || "—"} km of usable diesel from the saved tank.</p>
        <div class="fuelhub-actions">
          <button type="button" class="btn primary" id="fuel-gps-start">${watchId ? "GPS running" : "Start GPS"}</button>
          <button type="button" class="btn secondary" id="fuel-gps-stop">Stop</button>
          <button type="button" class="btn danger" id="fuel-gps-reset">Reset track</button>
        </div>
        <p id="fuel-gps-msg" class="fuelhub-muted"></p>
      </div>
    `;
    el.querySelector("#fuel-gps-start")?.addEventListener("click", startGps);
    el.querySelector("#fuel-gps-stop")?.addEventListener("click", stopGps);
    el.querySelector("#fuel-gps-reset")?.addEventListener("click", resetGps);
  }

  function readTruckForm(form) {
    const fd = new FormData(form);
    return {
      combinationId: fd.get("combinationId"),
      massSchemeId: fd.get("massSchemeId"),
      trailers: fd.get("trailers"),
      payloadT: fd.get("payloadT"),
      gcmT: fd.get("gcmT"),
      tareT: fd.get("tareT"),
      tankCapacityL: fd.get("tankCapacityL"),
      currentFuelL: fd.get("currentFuelL"),
      lengthM: fd.get("lengthM"),
      heightM: fd.get("heightM"),
    };
  }

  function renderTruck() {
    const el = byId("fuel-view-truck");
    if (!el) return;
    const t = (state && state.truck) || {};
    const eff = (state && state.efficiency) || {};
    const hub = (state && state.hubProfile) || {};
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-grid">
        <form id="fuel-truck-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Combination &amp; tanks</h2>
          <p class="fuelhub-muted">${
            hub.linked
              ? `Profile: ${esc(hub.licenceLabel || hub.licenceClass)} · ${esc(hub.driverTypeLabel || "")} · ${esc(hub.workCombinationLabel || hub.workCombination || "")}${
                  hub.activeFuelVehicle
                    ? ` · class ${esc(hub.activeFuelVehicle.classCode)} (${esc(hub.activeFuelVehicle.tankCapacityL)} L tank)`
                    : ""
                }. Work vehicle + driver type set L/100 km. Registered fuel class sets tank litres for fill routes. Work cars on Car Expenses stay separate.`
              : "Save a Driver Hub profile (driver type + work vehicle + optional fuel class) to prefill combination, duty-cycle rates and tank."
          }</p>
          <label>Combination<select name="combinationId">${comboOptions(t.combinationId)}</select></label>
          <label>Mass scheme<select name="massSchemeId">${schemeOptions(t.massSchemeId)}</select></label>
          <label>Trailers<input name="trailers" type="number" min="0" max="4" value="${esc(t.trailers)}" /></label>
          <label>Payload / load (t)<input name="payloadT" type="number" min="0" step="0.1" value="${esc(t.payloadT)}" /></label>
          <label>GCM (t)<input name="gcmT" type="number" min="4" step="0.1" value="${esc(t.gcmT)}" /></label>
          <label>Tare (t)<input name="tareT" type="number" min="2" step="0.1" value="${esc(t.tareT)}" /></label>
          <label>Total tank capacity (L)<input name="tankCapacityL" type="number" min="80" step="1" value="${esc(t.tankCapacityL)}" ${
            hub.activeFuelVehicle ? "readonly" : ""
          } /></label>
          <label>Fuel on board (L)<input name="currentFuelL" type="number" min="0" step="1" value="${esc(t.currentFuelL)}" /></label>
          <label>Length (m)<input name="lengthM" type="number" min="4" step="0.1" value="${esc(t.lengthM)}" /></label>
          <label>Height (m)<input name="heightM" type="number" min="2" step="0.01" value="${esc(t.heightM)}" /></label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Save truck spec</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Efficiency snapshot</h2>
          <p>Operating mass <strong>${eff.operatingMassT || "—"} t</strong> (payload + diesel at ${eff.dieselKgPerLitre || 0.84} kg/L).</p>
          <p>${(eff.notes || []).map((n) => esc(n)).join("<br>")}</p>
          <p class="fuelhub-muted">Heavier loads, extra trailers and a full tank all lift L/100 km. Out-west / remote bands add a terrain factor so you do not plan a Hume-style range into the Nullarbor.</p>
        </div>
      </div>
    `;
    el.querySelector("#fuel-truck-form")?.addEventListener("submit", onSaveTruck);
  }

  function renderCards() {
    const el = byId("fuel-view-cards");
    if (!el) return;
    const cards = (state && state.cards) || [];
    const hub = (state && state.hubProfile) || {};
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-grid">
        <form id="fuel-card-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Add fuel card / agreement</h2>
          <p class="fuelhub-muted">BP, Mobil, Shell, Ampol, Liberty, 7-Eleven and Pearl are the main barometers. Company cents-off stacks on top of the card.</p>
          <label>Name<input name="name" required placeholder="e.g. BP Plus" /></label>
          <label>Retailer<select name="retailerId">${retailerOptions("bp")}</select></label>
          <label>Card cents off (¢/L)<input name="cplOff" type="number" min="0" max="40" step="0.1" value="6" /></label>
          <label>Percent off<input name="percentOff" type="number" min="0" max="25" step="0.1" value="0" /></label>
          <label>Company / industry extra ¢/L<input name="companyCplOff" type="number" min="0" max="20" step="0.1" value="0" /></label>
          <label>Company name<input name="company" placeholder="Fleet or employer" value="${esc(hub.employer || "")}" /></label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Save card</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>On this profile</h2>
          ${
            cards.length
              ? cards
                  .map(
                    (c) => `
            <div class="fuelhub-card-row">
              <div>
                <strong>${esc(c.name)}</strong>
                <div class="fuelhub-muted">${esc(c.retailerId)} · ${c.cplOff} ¢/L${c.companyCplOff ? ` + ${c.companyCplOff} ¢ company` : ""} ${c.company ? `· ${esc(c.company)}` : ""}</div>
              </div>
              <button type="button" class="btn danger" data-del-card="${esc(c.id)}">Remove</button>
            </div>`
                  )
                  .join("")
              : `<p class="fuelhub-muted">No cards yet — fills will use table diesel only.</p>`
          }
        </div>
      </div>
    `;
    el.querySelector("#fuel-card-form")?.addEventListener("submit", onSaveCard);
    el.querySelectorAll("[data-del-card]").forEach((btn) => {
      btn.addEventListener("click", () => onDeleteCard(btn.getAttribute("data-del-card")));
    });
  }

  function stopReceiptTimer() {
    if (receiptTimer) {
      clearInterval(receiptTimer);
      receiptTimer = null;
    }
  }

  function applyReceiptPayload(data) {
    if (!state || !data) return;
    if (data.employerContacts) state.employerContacts = data.employerContacts;
    if (data.fuelReceipts) state.fuelReceipts = data.fuelReceipts;
    if (data.confirmMs) state.confirmMs = data.confirmMs;
    if (data.receipt) {
      currentReceiptId = data.receipt.id;
      const rest = (state.fuelReceipts || []).filter((r) => r.id !== data.receipt.id);
      state.fuelReceipts = [data.receipt, ...rest];
    }
  }

  async function refreshReceipts() {
    try {
      const data = await api("/fuelhub");
      applyReceiptPayload(data);
      if (!receiptsHydrated) {
        receiptsHydrated = true;
        if (!currentReceiptId) {
          const open = ((data && data.fuelReceipts) || []).find((r) =>
            ["scanned", "confirmed", "awaiting_send"].includes(r.status)
          );
          if (open) currentReceiptId = open.id;
        }
      }
      if (view === "receipts") renderReceipts();
    } catch {
      /* keep last receipts */
    }
  }

  function currentReceipt() {
    const list = (state && state.fuelReceipts) || [];
    if (!currentReceiptId) return null;
    return list.find((r) => r.id === currentReceiptId) || null;
  }

  function receiptStep(row) {
    if (!row || row.status === "cancelled") return 1;
    if (row.status === "scanned") return 2;
    if (row.status === "confirmed") return 3;
    if (row.status === "awaiting_send") return 4;
    if (row.status === "sent" || row.status === "failed") return 4;
    return 1;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  function renderReceipts() {
    const el = byId("fuel-view-receipts");
    if (!el) return;
    const row = currentReceipt();
    const step = receiptStep(row);
    const contacts = (state && state.employerContacts) || [];
    const receipts = (state && state.fuelReceipts) || [];
    const hub = (state && state.hubProfile) || {};
    const remaining = row && row.status === "awaiting_send" ? Math.ceil((row.remainingMs || 0) / 1000) : 0;

    const steps = ["Scan", "Confirm", "Nominate", "Send"]
      .map(
        (label, i) =>
          `<span class="fuelhub-step ${step === i + 1 ? "is-active" : ""} ${step > i + 1 ? "is-done" : ""}">${i + 1}. ${label}</span>`
      )
      .join("");

    const contactOptions = contacts.length
      ? contacts
          .map(
            (c) => `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.email)}${c.company ? ` (${esc(c.company)})` : ""}</option>`
          )
          .join("")
      : `<option value="">No saved contacts yet</option>`;

    let panel = "";
    if (step === 1) {
      panel = `
        <form id="fuel-receipt-scan-card" class="fuelhub-card">
          <h2>Step 1 — Submit a fuel receipt</h2>
          <p class="fuelhub-muted">Scan a bowser docket or upload a photo/PDF. Fuel Hub reads vendor, date, dollars and litres so you can send it to a nominated employer — this does not go on the Taxation Hub ledger.</p>
          <input id="fuel-receipt-file" type="file" accept="image/*,application/pdf" hidden />
          <input id="fuel-receipt-camera" type="file" accept="image/*" capture="environment" hidden />
          <div class="fuelhub-actions">
            <button type="button" class="btn primary" id="fuel-receipt-scan-btn">Scan with camera</button>
            <button type="button" class="btn secondary" id="fuel-receipt-upload-btn">Upload file</button>
          </div>
          <p id="fuel-receipt-scan-msg" class="fuelhub-muted"></p>
        </form>`;
    } else if (step === 2) {
      panel = `
        <form id="fuel-receipt-confirm-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Step 2 — Confirm the docket</h2>
          <p class="fuelhub-muted span-2">Check this matches the slip. You can correct OCR before it is sent.</p>
          ${
            row.hasImage
              ? `<p class="span-2"><img class="fuelhub-receipt-preview" alt="Scanned receipt" src="${API}/fuelhub/receipts/${esc(row.id)}/file" /></p>`
              : ""
          }
          <label>Vendor<input name="vendor" value="${esc(row.vendor || "")}" required /></label>
          <label>Date<input name="date" value="${esc(row.date || "")}" placeholder="YYYY-MM-DD" /></label>
          <label>Amount (AUD)<input name="amount" type="number" min="0" step="0.01" value="${esc(row.amount != null ? row.amount : "")}" required /></label>
          <label>Litres<input name="litres" type="number" min="0" step="0.01" value="${esc(row.litres != null ? row.litres : "")}" /></label>
          <label class="span-2">Site / location<input name="site" value="${esc(row.site || "")}" /></label>
          <label class="span-2">Notes<textarea name="notes" rows="2">${esc(row.notes || "")}</textarea></label>
          ${row.ocrPreview ? `<p class="fuelhub-muted span-2">OCR: ${esc(row.ocrPreview)}</p>` : ""}
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Details are correct</button>
            <button type="button" class="btn secondary" id="fuel-receipt-restart">Scan a different slip</button>
          </div>
        </form>`;
    } else if (step === 3) {
      panel = `
        <form id="fuel-receipt-nominate-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Step 3 — Nominate who receives it</h2>
          <p class="fuelhub-muted span-2">Pick a saved employer contact or add one. Fuel Hub remembers emails and contact details you use regularly.</p>
          <label class="span-2">Saved contacts
            <select name="contactId" id="fuel-receipt-contact-select">
              <option value="">Add a new contact…</option>
              ${contactOptions}
            </select>
          </label>
          <label>Name<input name="name" id="fuel-receipt-contact-name" value="${esc((contacts[0] && contacts[0].name) || hub.displayName || "")}" /></label>
          <label>Email<input name="email" id="fuel-receipt-contact-email" type="email" required placeholder="accounts@employer.com" value="${esc((contacts[0] && contacts[0].email) || "")}" /></label>
          <label>Company<input name="company" id="fuel-receipt-contact-company" value="${esc((contacts[0] && contacts[0].company) || hub.employer || "")}" /></label>
          <label>Role<input name="role" id="fuel-receipt-contact-role" placeholder="e.g. Fleet pay desk" value="${esc((contacts[0] && contacts[0].role) || "")}" /></label>
          <div class="fuelhub-actions span-2">
            <button type="submit" class="btn primary">Start 30s confirmation</button>
            <button type="button" class="btn secondary" id="fuel-receipt-back-confirm">Back to details</button>
          </div>
        </form>`;
    } else {
      const sent = row.status === "sent";
      const failed = row.status === "failed";
      panel = `
        <div class="fuelhub-card">
          <h2>Step 4 — ${sent ? "Report sent" : failed ? "Send failed" : "Connecting &amp; sending"}</h2>
          ${
            sent
              ? `<p>Sent <strong>${esc(row.vendor || "receipt")}</strong> to <strong>${esc(row.contactEmail)}</strong>${
                  row.mail && row.mail.channel === "dev" ? " (saved locally — email is not configured on this server)" : ""
                }.</p>`
              : failed
                ? `<p class="fuelhub-warn">${esc((row.mail && row.mail.error) || "Could not send.")}</p>`
                : `<p class="fuelhub-muted">Sending <strong>${esc(row.vendor || "this docket")}</strong> (${esc(
                    row.amount != null ? money(row.amount) : "—"
                  )}) to <strong>${esc(row.contactName || row.contactEmail)}</strong> at ${esc(row.contactEmail)} after a 30 second confirmation window. Cancel if anything is wrong.</p>
                   <p class="fuelhub-countdown" id="fuel-receipt-countdown">${remaining}</p>
                   <p class="fuelhub-muted">seconds remaining</p>`
          }
          <div class="fuelhub-actions">
            ${
              sent || failed
                ? `<button type="button" class="btn primary" id="fuel-receipt-another">Scan another receipt</button>`
                : `<button type="button" class="btn primary" id="fuel-receipt-send-now">Send now</button>
                   <button type="button" class="btn danger" id="fuel-receipt-cancel">Cancel</button>`
            }
          </div>
        </div>`;
    }

    const saved = contacts.length
      ? contacts
          .map(
            (c) => `<div class="fuelhub-card-row">
              <div>
                <strong>${esc(c.name)}</strong>
                <div class="fuelhub-muted">${esc(c.email)}${c.company ? ` · ${esc(c.company)}` : ""}${c.role ? ` · ${esc(c.role)}` : ""}</div>
              </div>
              <button type="button" class="btn danger" data-del-contact="${esc(c.id)}">Remove</button>
            </div>`
          )
          .join("")
      : `<p class="fuelhub-muted">No saved contacts yet. Nominating an email on a scan stores it here for next time.</p>`;

    const history = receipts.length
      ? `<table class="fuelhub-table"><thead><tr><th>When</th><th>Vendor</th><th>To</th><th>Status</th></tr></thead><tbody>${receipts
          .slice(0, 12)
          .map(
            (r) => `<tr data-open-receipt="${esc(r.id)}" class="${r.id === (row && row.id) ? "fuelhub-row-refill" : ""}">
              <td>${esc(fmtWhen(r.createdAt))}</td>
              <td>${esc(r.vendor || "—")} ${r.amount != null ? money(r.amount) : ""}</td>
              <td>${esc(r.contactEmail || "—")}</td>
              <td>${esc(r.status.replace("_", " "))}</td>
            </tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="fuelhub-muted">Sent reports will appear here.</p>`;

    el.innerHTML = `
      ${profileBanner()}
      <p class="fuelhub-muted">Scan a fuel docket, confirm the figures, nominate an employer email, then Fuel Hub sends the report after a 30 second confirmation period.</p>
      <div class="fuelhub-steps">${steps}</div>
      <div class="fuelhub-stack">
        ${panel}
        <div class="fuelhub-grid">
          <div class="fuelhub-card">
            <h2>Saved employer contacts</h2>
            ${saved}
          </div>
          <div class="fuelhub-card">
            <h2>Recent submissions</h2>
            ${history}
          </div>
        </div>
      </div>
    `;

    el.querySelector("#fuel-receipt-scan-btn")?.addEventListener("click", () => {
      byId("fuel-receipt-camera")?.click();
    });
    el.querySelector("#fuel-receipt-upload-btn")?.addEventListener("click", () => {
      byId("fuel-receipt-file")?.click();
    });
    el.querySelector("#fuel-receipt-file")?.addEventListener("change", onReceiptFile);
    el.querySelector("#fuel-receipt-camera")?.addEventListener("change", onReceiptFile);
    el.querySelector("#fuel-receipt-confirm-form")?.addEventListener("submit", onConfirmReceipt);
    el.querySelector("#fuel-receipt-nominate-form")?.addEventListener("submit", onNominateReceipt);
    el.querySelector("#fuel-receipt-restart")?.addEventListener("click", () => {
      currentReceiptId = null;
      renderReceipts();
    });
    el.querySelector("#fuel-receipt-another")?.addEventListener("click", () => {
      currentReceiptId = null;
      renderReceipts();
    });
    el.querySelector("#fuel-receipt-back-confirm")?.addEventListener("click", async () => {
      if (!row) return;
      try {
        const data = await api(`/fuelhub/receipts/${row.id}/confirm`, {
          method: "POST",
          body: { vendor: row.vendor, date: row.date, amount: row.amount, litres: row.litres, site: row.site, notes: row.notes },
        });
        applyReceiptPayload(data);
        renderReceipts();
      } catch (err) {
        toast(err.message);
      }
    });
    el.querySelector("#fuel-receipt-send-now")?.addEventListener("click", () => sendReceipt(true));
    el.querySelector("#fuel-receipt-cancel")?.addEventListener("click", onCancelReceipt);
    el.querySelector("#fuel-receipt-contact-select")?.addEventListener("change", onPickSavedContact);
    el.querySelectorAll("[data-del-contact]").forEach((btn) => {
      btn.addEventListener("click", () => onDeleteContact(btn.getAttribute("data-del-contact")));
    });
    el.querySelectorAll("[data-open-receipt]").forEach((tr) => {
      tr.addEventListener("click", () => {
        currentReceiptId = tr.getAttribute("data-open-receipt");
        renderReceipts();
      });
    });

    if (row && row.status === "awaiting_send") startReceiptCountdown(row);
  }

  function onPickSavedContact(e) {
    const id = e.target.value;
    const c = ((state && state.employerContacts) || []).find((row) => row.id === id);
    if (!c) return;
    const name = byId("fuel-receipt-contact-name");
    const email = byId("fuel-receipt-contact-email");
    const company = byId("fuel-receipt-contact-company");
    const role = byId("fuel-receipt-contact-role");
    if (name) name.value = c.name || "";
    if (email) email.value = c.email || "";
    if (company) company.value = c.company || "";
    if (role) role.value = c.role || "";
  }

  async function onReceiptFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const msg = byId("fuel-receipt-scan-msg");
    if (msg) msg.textContent = "Reading receipt…";
    try {
      const imageBase64 = await fileToDataUrl(file);
      const data = await api("/fuelhub/receipts/scan", {
        method: "POST",
        body: { imageBase64, mimeType: file.type || "image/jpeg", filename: file.name },
      });
      applyReceiptPayload(data);
      toast("Receipt scanned — confirm the details");
      renderReceipts();
    } catch (err) {
      if (msg) msg.textContent = err.message || "Scan failed";
      toast(err.message || "Scan failed");
    }
  }

  async function onConfirmReceipt(e) {
    e.preventDefault();
    const row = currentReceipt();
    if (!row) return;
    const fd = new FormData(e.target);
    try {
      const data = await api(`/fuelhub/receipts/${row.id}/confirm`, {
        method: "POST",
        body: {
          vendor: fd.get("vendor"),
          date: fd.get("date"),
          amount: fd.get("amount"),
          litres: fd.get("litres"),
          site: fd.get("site"),
          notes: fd.get("notes"),
        },
      });
      applyReceiptPayload(data);
      toast("Details confirmed — nominate an employer");
      renderReceipts();
    } catch (err) {
      toast(err.message);
    }
  }

  async function onNominateReceipt(e) {
    e.preventDefault();
    const row = currentReceipt();
    if (!row) return;
    const fd = new FormData(e.target);
    const contactId = fd.get("contactId");
    const body = contactId
      ? { contactId }
      : {
          name: fd.get("name"),
          email: fd.get("email"),
          company: fd.get("company"),
          role: fd.get("role"),
        };
    try {
      const data = await api(`/fuelhub/receipts/${row.id}/nominate`, { method: "POST", body });
      applyReceiptPayload(data);
      toast("30 second confirmation started");
      renderReceipts();
    } catch (err) {
      toast(err.message);
    }
  }

  function startReceiptCountdown(row) {
    stopReceiptTimer();
    const tick = () => {
      const live = currentReceipt();
      if (!live || live.id !== row.id || live.status !== "awaiting_send") {
        stopReceiptTimer();
        return;
      }
      const left = Math.max(0, Math.ceil((live.remainingMs || 0) / 1000));
      const clock = byId("fuel-receipt-countdown");
      if (clock) clock.textContent = String(left);
      live.remainingMs = Math.max(0, (live.remainingMs || 0) - 250);
      if (left <= 0) {
        stopReceiptTimer();
        void sendReceipt(false);
      }
    };
    receiptTimer = setInterval(tick, 250);
    tick();
  }

  async function sendReceipt(force) {
    const row = currentReceipt();
    if (!row) return;
    try {
      const data = await api(`/fuelhub/receipts/${row.id}/send`, {
        method: "POST",
        body: { force: Boolean(force) },
      });
      applyReceiptPayload(data);
      stopReceiptTimer();
      toast(data.mail && data.mail.channel === "dev" ? "Report saved (email not configured)" : "Fuel receipt sent");
      renderReceipts();
    } catch (err) {
      if (err.message && /Confirmation period/.test(err.message)) return;
      toast(err.message);
    }
  }

  async function onCancelReceipt() {
    const row = currentReceipt();
    if (!row) return;
    try {
      const data = await api(`/fuelhub/receipts/${row.id}/cancel`, { method: "POST", body: {} });
      applyReceiptPayload(data);
      stopReceiptTimer();
      currentReceiptId = null;
      toast("Send cancelled");
      renderReceipts();
    } catch (err) {
      toast(err.message);
    }
  }

  async function onDeleteContact(id) {
    try {
      const data = await api(`/fuelhub/contacts/${id}`, { method: "DELETE" });
      applyReceiptPayload(data);
      renderReceipts();
      toast("Contact removed");
    } catch (err) {
      toast(err.message);
    }
  }

  function renderPrices() {
    const el = byId("fuel-view-prices");
    if (!el) return;
    const tables = (state && state.tables) || { cities: [], loadings: [], sources: [] };
    const stations = ((state && state.stations) || [])
      .slice()
      .sort((a, b) => a.pumpCpl - b.pumpCpl)
      .slice(0, 12);
    el.innerHTML = `
      ${profileBanner()}
      <div class="fuelhub-stack">
      <div class="fuelhub-card">
        <h2>Government-style diesel bands</h2>
        <p class="fuelhub-muted">${esc(tables.asOfNote || "")}</p>
        <table class="fuelhub-table">
          <thead><tr><th>Capital</th><th>Metro diesel ¢/L</th></tr></thead>
          <tbody>
            ${(tables.cities || [])
              .map((c) => `<tr><td>${esc(c.city)}</td><td>${c.dieselCpl}</td></tr>`)
              .join("")}
          </tbody>
        </table>
        <table class="fuelhub-table">
          <thead><tr><th>Band</th><th>Loading ¢/L</th><th>Sydney example</th></tr></thead>
          <tbody>
            ${(tables.loadings || [])
              .map(
                (r) =>
                  `<tr><td>${esc(r.band)}</td><td>+${r.loadingCpl}</td><td>${r.exampleSydneyCpl}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
        <p class="fuelhub-muted">Sources: ${(tables.sources || []).map((s) => esc(s.name)).join(" · ")}</p>
      </div>
      <div class="fuelhub-grid">
        <form id="fuel-price-form" class="fuelhub-card fuelhub-profile-form">
          <h2>Log a bowser price</h2>
          <label>Station
            <select name="stationId">
              ${((state && state.stations) || [])
                .map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.pumpCpl} ¢)</option>`)
                .join("")}
            </select>
          </label>
          <label>Diesel ¢/L<input name="cpl" type="number" min="80" max="400" step="0.1" required /></label>
          <div class="fuelhub-actions">
            <button type="submit" class="btn primary">Save observed price</button>
          </div>
        </form>
        <div class="fuelhub-card">
          <h2>Cheapest table / bowser sites</h2>
          <table class="fuelhub-table">
            <thead><tr><th>Site</th><th>Band</th><th>¢/L</th><th>Truck</th></tr></thead>
            <tbody>
              ${stations
                .map(
                  (s) =>
                    `<tr><td>${esc(s.name)}</td><td>${esc(s.band)}</td><td>${s.pumpCpl}${s.observedCpl != null ? " *" : ""}</td><td>${s.truckAccess ? "Yes" : "No"}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <p class="fuelhub-muted">* overlay from a driver-logged bowser. Out-west / remote sites sit higher on purpose.</p>
        </div>
      </div>
      </div>
    `;
    el.querySelector("#fuel-price-form")?.addEventListener("submit", onSavePrice);
  }

  function render() {
    if (!state) return;
    if (view === "dashboard") renderDashboard();
    else if (view === "forecast") renderForecast();
    else if (view === "profile") renderProfile();
    else if (view === "plan") renderPlan();
    else if (view === "track") renderTrack();
    else if (view === "truck") renderTruck();
    else if (view === "cards") renderCards();
    else if (view === "receipts") renderReceipts();
    else renderPrices();
  }

  async function load() {
    state = await api("/fuelhub");
    if (!lastPlan && state.lastPlan) lastPlan = state.lastPlan;
    render();
  }

  async function onPlan(e) {
    e.preventDefault();
    const body = readPlanBody(e.target);
    const data = await api("/fuelhub/plan", {
      method: "POST",
      body,
    });
    lastPlan = data.plan;
    if (data.lastPlan) state.lastPlan = data.lastPlan;
    if (data.forecast) state.forecast = data.forecast;
    render();
    toast("Fuel plan ready");
    void refreshDashboard();
  }

  async function onWestQldExample() {
    lastPlanForm = westQldExampleFields();
    render();
    const form = byId("fuel-plan-form") || byId("fuel-forecast-form");
    if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    else if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }

  async function onSaveTrip() {
    if (!lastPlan) {
      toast("Plan a run first");
      return;
    }
    const prediction = lastPlan.forecast || (state.forecast && state.forecast.prediction);
    const data = await api("/fuelhub/trips", {
      method: "POST",
      body: {
        origin: lastPlan.origin,
        destination: lastPlan.destination,
        via: lastPlan.via || (prediction && prediction.via) || [],
        distanceKm: lastPlan.distanceKm,
        mode: "offline",
        payloadT: prediction && prediction.payloadT,
        fuelLoadL: (state.truck && state.truck.currentFuelL) || null,
        hours: prediction && prediction.hours,
        litresPerKm: prediction && prediction.averageLitresPerKm,
        planSummary: {
          fillL: lastPlan.totals && lastPlan.totals.fillL,
          costAud: lastPlan.totals && lastPlan.totals.costAud,
          corridor: lastPlan.corridor && lastPlan.corridor.id,
        },
      },
    });
    if (data.trips) state.trips = data.trips;
    try {
      const next = await api("/fuelhub/forecast");
      state.forecast = next;
    } catch {
      /* keep last forecast */
    }
    toast("Trip saved");
    void refreshDashboard();
    if (view === "forecast") renderForecast();
  }

  async function onSaveTruck(e) {
    e.preventDefault();
    const data = await api("/fuelhub/truck", { method: "PUT", body: readTruckForm(e.target) });
    state.truck = data.truck;
    state.efficiency = data.efficiency;
    toast("Truck spec saved");
    renderTruck();
  }

  async function onSaveCard(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = await api("/fuelhub/cards", {
      method: "POST",
      body: {
        name: fd.get("name"),
        retailerId: fd.get("retailerId"),
        cplOff: fd.get("cplOff"),
        percentOff: fd.get("percentOff"),
        companyCplOff: fd.get("companyCplOff"),
        company: fd.get("company"),
        companyWide: Number(fd.get("companyCplOff")) > 0,
      },
    });
    state.cards = data.cards;
    toast("Fuel card saved");
    renderCards();
  }

  async function onDeleteCard(id) {
    const data = await api(`/fuelhub/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.cards = data.cards;
    renderCards();
  }

  async function onSavePrice(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = await api("/fuelhub/prices/observed", {
      method: "POST",
      body: { stationId: fd.get("stationId"), cpl: fd.get("cpl") },
    });
    state.stations = data.stations;
    toast("Bowser price saved");
    renderPrices();
  }

  function gpsMessage(text) {
    const el = byId("fuel-gps-msg");
    if (el) el.textContent = text;
  }

  function startGps() {
    if (!navigator.geolocation) {
      gpsMessage("This device has no geolocation API — use an offline route on Plan fills.");
      return;
    }
    if (watchId != null) return;
    gpsMessage("Waiting for GPS…");
    watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        if (gpsBusy) return;
        gpsBusy = true;
        try {
          const data = await api("/fuelhub/track", {
            method: "POST",
            body: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          });
          state.activeTrack = data.track;
          state.efficiency = data.efficiency;
          if (view === "track") renderTrack();
          if (view === "dashboard") void refreshDashboard();
          gpsMessage(`Range remaining ~${data.remainingKm} km after this track.`);
        } catch (err) {
          gpsMessage(err.message || "Could not save GPS point.");
        } finally {
          gpsBusy = false;
        }
      },
      (err) => {
        gpsMessage(err.message || "GPS denied.");
        watchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
    );
  }

  function stopGps() {
    if (watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
    gpsMessage("GPS stopped.");
    if (view === "track") renderTrack();
  }

  async function resetGps() {
    stopGps();
    await api("/fuelhub/track", { method: "DELETE" });
    state.activeTrack = null;
    renderTrack();
    toast("Track reset");
  }

  function wire() {
    document.querySelectorAll("#fuelhub-shell [data-fuel-view]").forEach((btn) => {
      btn.addEventListener("click", () => setView(btn.getAttribute("data-fuel-view")));
    });
    byId("fuelhub-nav-driverhub")?.addEventListener("click", () => {
      stopGps();
      byId("nav-driverhub")?.click();
    });
  }

  async function refreshDashboard(point) {
    try {
      const qs =
        point && Number.isFinite(point.lat)
          ? `?lat=${encodeURIComponent(point.lat)}&lng=${encodeURIComponent(point.lng)}`
          : "";
      const dash = await api(`/fuelhub/dashboard${qs}`);
      if (state) {
        state.dashboard = dash;
        if (dash.forecast) state.forecast = dash.forecast;
      }
      if (view === "dashboard") renderDashboard();
      else if (view === "forecast" && dash.forecast) renderForecast();
    } catch {
      /* keep last dashboard */
    }
  }

  function locateForDeals() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void refreshDashboard({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 120000, timeout: 8000 }
    );
  }

  async function open() {
    document.body.classList.add("fuelhub-open");
    try {
      await load();
      setView("dashboard");
    } catch (err) {
      toast(err.message || "Could not open Fuel Hub.");
    }
  }

  function close() {
    stopGps();
    stopReceiptTimer();
    document.body.classList.remove("fuelhub-open");
    const panel = document.getElementById("admin-panel");
    const home = document.getElementById("admin-panel-home");
    if (panel && home) home.appendChild(panel);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  window.FuelHub = { open, close, refresh: load };
})();
