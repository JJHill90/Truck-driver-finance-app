(function () {
  "use strict";

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

  async function hydrate() {
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrate);
  } else {
    hydrate();
  }
})();
