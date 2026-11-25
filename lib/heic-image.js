/**
 * Server-side HEIC/HEIF → JPEG so Render can read iPhone photos.
 * heic-convert is WASM (libheif) and does not need a system libheif.
 */
const fs = require("fs");
const path = require("path");

let heicProbePromise = null;

function isJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8;
}

async function jpegFromHeic(buffer) {
  const errors = [];
  try {
    const convert = require("heic-convert");
    const output = await convert({ buffer, format: "JPEG", quality: 0.9 });
    const jpeg = Buffer.from(output);
    if (isJpeg(jpeg)) return jpeg;
    errors.push("heic-convert returned no JPEG");
  } catch (err) {
    errors.push(`heic-convert: ${err.message || err}`);
  }
  try {
    const sharp = require("sharp");
    const jpeg = await sharp(buffer, { failOn: "none" }).rotate().jpeg({ quality: 90 }).toBuffer();
    if (isJpeg(jpeg)) return jpeg;
    errors.push("sharp returned no JPEG");
  } catch (err) {
    errors.push(`sharp: ${err.message || err}`);
  }
  const failed = new Error(errors.join("; ") || "HEIC convert failed");
  failed.code = "HEIC_CONVERT";
  throw failed;
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
