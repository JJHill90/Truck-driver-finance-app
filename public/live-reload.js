/**
 * Decide whether an already-open app should load the page that is now on
 * the server. The open page keeps its own build number; a deploy does not
 * replace that page until something asks it to reload.
 */
(function () {
  "use strict";

  function decideLiveReload(input) {
    const src = input || {};
    const page = Number(src.pagePr);
    const server = Number(src.serverPr);
    if (!Number.isFinite(page) || page <= 0 || !Number.isFinite(server) || server <= 0) {
      return { reload: false, reason: "unknown" };
    }
    if (page === server) return { reload: false, reason: "current" };
    if (src.busy) return { reload: false, reason: "busy" };
    if (String(src.alreadyReloadedFor || "") === String(server)) {
      return { reload: false, reason: "already-reloaded", serverPr: server };
    }
    return { reload: true, reason: "stale", serverPr: server };
  }

  globalThis.HaulageLiveReload = { decideLiveReload: decideLiveReload };
})();
