/**
 * Crash-safer JSON persistence: write to a sibling temp file, then rename.
 * rename is atomic on the same filesystem (Render disk / local data/).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function writeFileAtomic(filePath, contents, encoding = "utf8") {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(tmp, contents, encoding);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function writeJsonAtomic(filePath, value, space = 2) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, space)}\n`, "utf8");
}

module.exports = {
  writeFileAtomic,
  writeJsonAtomic,
};
