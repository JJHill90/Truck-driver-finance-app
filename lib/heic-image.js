/**
 * Server-side HEIC/HEIF → JPEG so Render can read iPhone photos.
 * heic-convert is WASM (libheif) and does not need a system libheif.
 */
const fs = require("fs");
const path = require("path");

let heicProbePromise = null;

async function jpegFromHeic(buffer) {
  const convert = require("heic-convert");
  const output = await convert({
    buffer,
    format: "JPEG",
    quality: 0.9,
  });
  return Buffer.from(output);
}

function isHeic(mimeType, filename) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();
  return /heic|heif/.test(mime) || /\.hei[cf]$/.test(name);
}

/** Convert the committed receipt HEIC once and remember whether it worked. */
function probeHeicConverter() {
  if (!heicProbePromise) {
    heicProbePromise = (async () => {
      const sample = path.join(__dirname, "..", "test", "fixtures", "receipt.heic");
      const buf = fs.existsSync(sample) ? fs.readFileSync(sample) : null;
      if (!buf) {
        require("heic-convert");
        return { heic: "ready", heicError: "" };
      }
      const jpeg = await jpegFromHeic(buf);
      if (!jpeg || jpeg[0] !== 0xff || jpeg.length < 100) {
        throw new Error("HEIC converter did not return a JPEG");
      }
      return { heic: "ready", heicError: "" };
    })().catch((err) => {
      heicProbePromise = null;
      return { heic: "error", heicError: String((err && err.message) || err).slice(0, 160) };
    });
  }
  return heicProbePromise;
}

module.exports = { jpegFromHeic, isHeic, probeHeicConverter };
