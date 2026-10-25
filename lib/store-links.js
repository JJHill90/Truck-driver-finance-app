/**
 * Public store-listing URLs for the marketing site.
 * Empty until Play / App Store pages exist — then set the env vars.
 */
const { TAXATION_HUB_APP_URL } = require("./taxationhub-public-origin");

function cleanHttpsUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https:\/\//i.test(raw)) return "";
  return raw.replace(/\/+$/, "");
}

function linksForProduct(product, env = process.env) {
  if (product === "taxationhub") {
    return {
      product: "taxationhub",
      appUrl: TAXATION_HUB_APP_URL,
      playStoreUrl: cleanHttpsUrl(env.DRIVERHUB_PLAY_STORE_URL),
      appStoreUrl: cleanHttpsUrl(env.DRIVERHUB_APP_STORE_URL),
    };
  }
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
