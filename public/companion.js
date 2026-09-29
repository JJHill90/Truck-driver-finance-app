/*
 * In-app tax companion — bottom-right chat bubble.
 * Answers come from POST /companion/ask (ATO tables already in this product).
 */
(function () {
  "use strict";

  const API = `${window.location.origin}/api/haulage`;
  const ROOT_ID = "tax-companion";

  function isSuite() {
    return Boolean(document.body && document.body.classList.contains("gotax-suite"));
  }

  function currentFy() {
    const sel = document.getElementById("fy-select");
    if (sel && sel.value) return sel.value;
    const st = typeof window !== "undefined" ? window.state : null;
    if (st && st.financialYear) return st.financialYear;
    return "";
  }

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkify(text, mailto) {
    const emailRe = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    let html = esc(text).replace(emailRe, (m) => {
      const href = mailto && mailto.indexOf(m) !== -1 ? mailto : `mailto:${m}`;
      return `<a href="${esc(href)}">${esc(m)}</a>`;
    });
    return html;
  }

  const SUITE_CHIPS = [
    "Overnight work travel meals",
    "Cents per kilometre (D1)",
    "Working from home hourly rate",
    "GST and the BAS worksheet",
    "Overtime meal allowance",
  ];
  const HUB_CHIPS = [
    "Truck driver meal amounts",
    "Cents per kilometre for my car",
    "Overtime meal allowance",
    "Work clothing and laundry",
    "Can I claim home to work travel?",
  ];

  function chipsForProduct() {
    return isSuite() ? SUITE_CHIPS : HUB_CHIPS;
  }

  function welcomeText() {
    const brand = isSuite() ? "Go Taxation Suite" : "Taxation Hub";
    return `Ask a general ${brand} question about expenses, income, or allowances. I answer from ATO rates this app already uses — not tax advice, and I do not lodge. If I cannot answer, I will link support@godriverhub.com so you can contact support for that topic.`;
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "tax-companion";
    root.innerHTML = `
      <div class="tax-companion-panel hidden" id="tax-companion-panel" role="dialog" aria-label="Tax companion" aria-modal="false">
        <div class="tax-companion-head">
          <div>
            <p class="tax-companion-title">Tax companion</p>
            <p class="tax-companion-sub">ATO rates used in this app</p>
          </div>
          <button type="button" class="tax-companion-close" id="tax-companion-close" aria-label="Close chat">×</button>
        </div>
        <div class="tax-companion-log" id="tax-companion-log" aria-live="polite"></div>
        <div class="tax-companion-chips" id="tax-companion-chips"></div>
        <form class="tax-companion-form" id="tax-companion-form">
          <label class="visually-hidden" for="tax-companion-input">Your tax question</label>
          <textarea id="tax-companion-input" rows="2" maxlength="500" placeholder="Ask about meals, cars, GST…" required></textarea>
          <button type="submit" class="btn primary tax-companion-send" id="tax-companion-send">Send</button>
        </form>
      </div>
      <button type="button" class="tax-companion-fab" id="tax-companion-fab" aria-label="Open tax companion chat" aria-expanded="false">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9.5L5 21.5V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v2h12V8H6zm0 4v2h8v-2H6z"/>
        </svg>
      </button>
    `;
    document.body.appendChild(root);
    renderChips();
    addBot(welcomeText(), { sources: [] });

    document.getElementById("tax-companion-fab").addEventListener("click", toggle);
    document.getElementById("tax-companion-close").addEventListener("click", close);
    document.getElementById("tax-companion-form").addEventListener("submit", onSubmit);
    document.getElementById("tax-companion-input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        document.getElementById("tax-companion-form").requestSubmit();
      }
    });
  }

  function renderChips(list) {
    const wrap = document.getElementById("tax-companion-chips");
    if (!wrap) return;
    const chips = Array.isArray(list) && list.length ? list : chipsForProduct();
    wrap.innerHTML = chips
      .map((c) => `<button type="button" class="tax-companion-chip" data-q="${esc(c)}">${esc(c)}</button>`)
      .join("");
    wrap.querySelectorAll("[data-q]").forEach((btn) => {
      btn.addEventListener("click", () => ask(btn.getAttribute("data-q") || ""));
    });
  }

  function isOpen() {
    const panel = document.getElementById("tax-companion-panel");
    return Boolean(panel && !panel.classList.contains("hidden"));
  }

  function open() {
    const panel = document.getElementById("tax-companion-panel");
    const fab = document.getElementById("tax-companion-fab");
    if (!panel || !fab) return;
    panel.classList.remove("hidden");
    fab.setAttribute("aria-expanded", "true");
    fab.classList.add("is-open");
    const input = document.getElementById("tax-companion-input");
    if (input) input.focus();
    scrollLog();
  }

  function close() {
    const panel = document.getElementById("tax-companion-panel");
    const fab = document.getElementById("tax-companion-fab");
    if (!panel || !fab) return;
    panel.classList.add("hidden");
    fab.setAttribute("aria-expanded", "false");
    fab.classList.remove("is-open");
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function logEl() {
    return document.getElementById("tax-companion-log");
  }

  function scrollLog() {
    const log = logEl();
    if (log) log.scrollTop = log.scrollHeight;
  }

  function addUser(text) {
    const log = logEl();
    if (!log) return;
    const row = document.createElement("div");
    row.className = "tax-companion-msg is-user";
    row.innerHTML = `<p>${esc(text)}</p>`;
    log.appendChild(row);
    scrollLog();
  }

  function addBot(text, extra) {
    const log = logEl();
    if (!log) return;
    const row = document.createElement("div");
    row.className = "tax-companion-msg is-bot";
    const sources = extra && extra.sources && extra.sources.length
      ? `<p class="tax-companion-sources">${extra.sources.map((s) => esc(s)).join(" · ")}</p>`
      : "";
    const mailto = extra && extra.mailto
      ? `<p class="tax-companion-fallback"><a href="${esc(extra.mailto)}">Contact support for this topic</a></p>`
      : "";
    const title = extra && extra.title ? `<p class="tax-companion-topic">${esc(extra.title)}</p>` : "";
    row.innerHTML = `${title}<p>${linkify(text, extra && extra.mailto)}</p>${sources}${mailto}`;
    log.appendChild(row);
    scrollLog();
  }

  function addBusy() {
    const log = logEl();
    if (!log) return null;
    const row = document.createElement("div");
    row.className = "tax-companion-msg is-bot is-busy";
    row.innerHTML = "<p>Looking up ATO rates…</p>";
    log.appendChild(row);
    scrollLog();
    return row;
  }

  async function ask(question) {
    const q = String(question || "").trim();
    if (q.length < 3) return;
    open();
    addUser(q);
    const input = document.getElementById("tax-companion-input");
    if (input) input.value = "";
    const send = document.getElementById("tax-companion-send");
    if (send) send.disabled = true;
    const busy = addBusy();
    try {
      const body = { question: q };
      const fy = currentFy();
      if (fy) body.financialYear = fy;
      const res = await fetch(`${API}/companion/ask`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (busy) busy.remove();
      if (res.status === 429) {
        addBot(data.error || "Too many questions from this network. Please wait a minute and try again.");
        return;
      }
      if (!res.ok) {
        addBot("I could not reach the companion just now. Email support@godriverhub.com if this keeps happening.", {
          mailto: "mailto:support@godriverhub.com?subject=" + encodeURIComponent("Tax companion error"),
        });
        return;
      }
      addBot(data.answer || "", {
        title: data.answered ? data.title : null,
        sources: data.sources,
        mailto: data.answered ? null : data.mailto,
      });
      if (data.suggestions && data.suggestions.length) renderChips(data.suggestions);
    } catch {
      if (busy) busy.remove();
      addBot("I could not reach the companion just now. Email support@godriverhub.com and mention this topic.", {
        mailto: "mailto:support@godriverhub.com?subject=" + encodeURIComponent("Tax companion offline"),
      });
    } finally {
      if (send) send.disabled = false;
    }
  }

  function onSubmit(ev) {
    ev.preventDefault();
    const input = document.getElementById("tax-companion-input");
    ask(input && input.value);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
