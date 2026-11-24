/**
 * Server-side HEIC/HEIF → JPEG so Render can read iPhone photos.
 * heic-convert is WASM (libheif) and does not need a system libheif.
 */
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

module.exports = { jpegFromHeic, isHeic };
