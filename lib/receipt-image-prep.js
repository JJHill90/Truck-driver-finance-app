/**
 * Extra copies of a receipt photo for Tesseract.
 * EXIF rotate, upscale, greyscale, contrast, CLAHE and a hard threshold.
 * sharp is optional: if it cannot load, the original buffer is the only copy.
 */

async function loadSharp() {
  try {
    return require("sharp");
  } catch {
    return null;
  }
}

async function prepReceiptImages(buffer) {
  const sharp = await loadSharp();
  if (!sharp || !buffer || !buffer.length) return [buffer];
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    const srcWidth = meta.width || 800;
    const width = srcWidth < 1200 ? Math.min(2000, srcWidth * 2) : Math.min(2000, srcWidth);
    const oriented = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: false })
      .png()
      .toBuffer();
    const grey = await sharp(oriented).greyscale().normalise().png().toBuffer();
    let clahe = grey;
    try {
      clahe = await sharp(oriented).greyscale().clahe({ width: 32, height: 32 }).normalise().png().toBuffer();
    } catch {
      clahe = grey;
    }
    const threshold = await sharp(grey).threshold(150).png().toBuffer();
    const deskew = await sharp(grey).rotate(-1.2, { background: "#ffffff" }).png().toBuffer();
    return [oriented, grey, clahe, threshold, deskew];
  } catch {
    return [buffer];
  }
}

async function limitScanBuffer(buffer) {
  const sharp = await loadSharp();
  if (!sharp || !buffer || buffer.length < 200) return buffer;
  try {
    const meta = await sharp(buffer, { failOn: "none" }).metadata();
    const wide = (meta.width || 0) > 2000 || (meta.height || 0) > 2000;
    if (!wide && buffer.length < 1_500_000) return buffer;
    return sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return buffer;
  }
}

module.exports = { prepReceiptImages, limitScanBuffer };
