/**
 * Keep the Tesseract `eng` model on the persistent data disk.
 *
 * tesseract.js defaults cachePath to process CWD. On Render that directory is
 * replaced on every deploy, so the next payslip/receipt scan re-downloads
 * eng.traineddata and rebuilds the worker. DATA_DIR (the haulage-data mount)
 * survives deploys.
 */
const fs = require("fs");
const path = require("path");
const { getDataDir } = require("./data-dir");

const CACHE_FOLDER = "tesseract-cache";

function tesseractCacheDir() {
  const dir = path.join(getDataDir(), CACHE_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Load the shared Tesseract worker (downloads eng into DATA_DIR on first use). */
function warmLocalOcrWorker() {
  const { warmTesseractWorker } = require("./local-receipt-ocr");
  return warmTesseractWorker();
}

module.exports = {
  CACHE_FOLDER,
  tesseractCacheDir,
  warmLocalOcrWorker,
};
