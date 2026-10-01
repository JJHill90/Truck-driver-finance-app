/**
 * Public store-listing URLs for the marketing site.
 * Empty until Play / App Store pages exist — then set the env vars.
 */
function cleanHttpsUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https:\/\//i.test(raw)) return "";
  return raw.replace(/\/+$/, "");
}

function linksForProduct(product, env = process.env) {
  const suite = product === "suite";
  const play = cleanHttpsUrl(
    suite ? env.SUITE_PLAY_STORE_URL || env.PLAY_STORE_URL : env.DRIVERHUB_PLAY_STORE_URL
  );
  const appStore = cleanHttpsUrl(
    suite ? env.SUITE_APP_STORE_URL || env.APP_STORE_URL : env.DRIVERHUB_APP_STORE_URL
  );
  return {
    product: suite ? "suite" : "haulage",
    appUrl: suite ? "/suite/" : "/haulage/",
    playStoreUrl: play,
    appStoreUrl: appStore,
  };
}

module.exports = {
  cleanHttpsUrl,
  linksForProduct,
};
