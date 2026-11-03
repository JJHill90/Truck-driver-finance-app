/**
 * Receipt photos and PDFs must live on the same persistent directory as the
 * account JSON. lib/storage.js (verbatim) writes them under the repo
 * data/ folder. On a container deploy that folder is /app/data and is wiped
 * with every new build, while DATA_DIR (the Render disk) keeps the ledger
 * rows — the gallery then says "Photo file missing".
 *
 * installPersistentReceiptStore points those reads and writes at getDataDir().
 * collectMissingReceiptFiles copies any bytes still sitting in a stray
 * folder, then fills gaps from the newest backup archives.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { getDataDir, REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR, mergeReceiptFiles } = require("./data-dir");
const backup = require("./backup");

const execFileAsync = promisify(execFile);

const MIME_BY_EXT = {
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  heic: "image/heic",
  heif: "image/heic",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function safeRelative(relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || !rel.startsWith("receipts/")) return "";
  const base = path.posix.basename(rel);
  if (!base || base === "." || base === ".." || base !== rel.slice("receipts/".length)) return "";
  return rel;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || "image/jpeg";
}

function receiptsDir() {
  return path.join(getDataDir(), "receipts");
}

function candidateFiles(relativePath) {
  const rel = safeRelative(relativePath);
  if (!rel) return [];
  const dirs = [getDataDir(), REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR];
  const seen = new Set();
  const files = [];
  for (const dir of dirs) {
    const filePath = path.resolve(dir, rel);
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    files.push(filePath);
  }
  return files;
}

function existingFile(relativePath) {
  for (const filePath of candidateFiles(relativePath)) {
    try {
      const st = fs.lstatSync(filePath);
      if (st.isFile() && !st.isSymbolicLink()) return filePath;
    } catch {
      /* missing */
    }
  }
  return null;
}

function relocateReceiptFile(relativePath) {
  const rel = safeRelative(relativePath);
  if (!rel) return;
  const dest = path.join(getDataDir(), rel);
  const sources = [path.join(REPO_DATA_DIR, rel), path.join(DOCKER_DATA_DIR, rel)];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (const source of sources) {
    if (path.resolve(source) === path.resolve(dest)) continue;
    try {
      const st = fs.lstatSync(source);
      if (!st.isFile() || st.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    if (!fs.existsSync(dest)) {
      try {
        fs.renameSync(source, dest);
      } catch (err) {
        if (!err || err.code !== "EXDEV") throw err;
        fs.copyFileSync(source, dest);
        fs.rmSync(source, { force: true });
      }
    } else {
      fs.rmSync(source, { force: true });
    }
  }
}

function installPersistentReceiptStore(storage) {
  if (!storage || storage.__persistentReceipts) return storage;

  const originalAddReceipt = storage.addReceipt;
  if (typeof originalAddReceipt === "function") {
    storage.addReceipt = function addReceipt(_records, _payload) {
      const receipt = originalAddReceipt.apply(this, arguments);
      if (receipt && receipt.imagePath) relocateReceiptFile(receipt.imagePath);
      return receipt;
    };
  }

  const originalDeleteReceipt = storage.deleteReceipt;
  if (typeof originalDeleteReceipt === "function") {
    storage.deleteReceipt = function deleteReceipt(records, id) {
      const receipt = ((records && records.receipts) || []).find((row) => row && row.id === id);
      const imagePath = receipt && receipt.imagePath;
      const removed = originalDeleteReceipt.apply(this, arguments);
      if (imagePath && typeof storage.deleteReceiptFile === "function") {
        storage.deleteReceiptFile(imagePath);
      }
      return removed;
    };
  }

  storage.saveReceiptImage = function saveReceiptImage(receiptId, dataUrl) {
    if (!dataUrl) return null;
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1];
    let ext = "jpg";
    if (mime.includes("png")) ext = "png";
    else if (mime.includes("webp")) ext = "webp";
    else if (mime.includes("pdf")) ext = "pdf";
    else if (mime.includes("heic") || mime.includes("heif")) ext = "heic";
    const id = String(receiptId || "").replace(/[^a-zA-Z0-9._-]/g, "");
    if (!id) return null;
    const dir = receiptsDir();
    fs.mkdirSync(dir, { recursive: true });
    const relativePath = `receipts/${id}.${ext}`;
    fs.writeFileSync(path.join(dir, `${id}.${ext}`), Buffer.from(match[2], "base64"));
    return relativePath;
  };

  storage.readReceiptImage = function readReceiptImage(relativePath) {
    const filePath = existingFile(relativePath);
    if (!filePath) return null;
    const base64 = fs.readFileSync(filePath).toString("base64");
    return `data:${mimeFor(filePath)};base64,${base64}`;
  };

  storage.getReceiptFileInfo = function getReceiptFileInfo(relativePath) {
    const filePath = existingFile(relativePath);
    if (!filePath) return null;
    return {
      filePath,
      mime: mimeFor(filePath),
      filename: path.basename(filePath),
    };
  };

  storage.deleteReceiptFile = function deleteReceiptFile(relativePath) {
    let removed = false;
    for (const filePath of candidateFiles(relativePath)) {
      try {
        const st = fs.lstatSync(filePath);
        if (!st.isFile() || st.isSymbolicLink()) continue;
        fs.unlinkSync(filePath);
        removed = true;
      } catch {
        /* already gone */
      }
    }
    return removed;
  };

  storage.__persistentReceipts = true;
  return storage;
}

function strayReceiptDirs() {
  const dest = path.resolve(receiptsDir());
  const candidates = [REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR].map((dir) =>
    path.join(dir, "receipts")
  );
  const seen = new Set();
  const dirs = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (resolved === dest || seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.statSync(resolved).isDirectory()) dirs.push(resolved);
    } catch {
      /* not on this host */
    }
  }
  return dirs;
}

function isReceiptMember(name) {
  const norm = String(name || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return /^receipts\/[A-Za-z0-9._-]+$/.test(norm);
}

async function listReceiptMembers(archivePath) {
  const { stdout } = await execFileAsync("tar", ["-tzf", archivePath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return String(stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(isReceiptMember);
}

async function extractMembers(archivePath, destRoot, members) {
  const chunk = 80;
  for (let i = 0; i < members.length; i += chunk) {
    const slice = members.slice(i, i + chunk);
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destRoot, ...slice], {
      maxBuffer: 64 * 1024 * 1024,
    });
  }
}

/**
 * Copy stray receipt files onto the persistent disk, then restore any
 * receipt member that is still missing from the newest backups first.
 */
async function collectMissingReceiptFiles() {
  const dir = receiptsDir();
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const source of strayReceiptDirs()) {
    copied += mergeReceiptFiles(source, dir);
  }

  const present = new Set(fs.readdirSync(dir));
  let restored = 0;
  let backups = [];
  try {
    backups = backup.listBackups();
  } catch {
    backups = [];
  }
  for (const row of backups) {
    let members = [];
    try {
      members = await listReceiptMembers(row.path || backupPath(row));
    } catch (err) {
      console.warn("Receipt restore skipped a backup:", err.message);
      continue;
    }
    const missing = members.filter((member) => !present.has(path.posix.basename(member)));
    if (!missing.length) continue;
    try {
      await extractMembers(row.path || backupPath(row), getDataDir(), missing);
    } catch (err) {
      console.warn("Receipt restore extract failed:", err.message);
      continue;
    }
    for (const member of missing) {
      const name = path.posix.basename(member);
      const full = path.join(dir, name);
      try {
        const st = fs.lstatSync(full);
        if (!st.isFile() || st.isSymbolicLink()) {
          fs.rmSync(full, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (!present.has(name)) {
        present.add(name);
        restored += 1;
      }
    }
  }

  return { dir, copied, restored };
}

function backupPath(row) {
  if (row && row.path) return row.path;
  return path.join(getDataDir(), "backups", row.filename);
}

module.exports = {
  safeRelative,
  installPersistentReceiptStore,
  collectMissingReceiptFiles,
  strayReceiptDirs,
  isReceiptMember,
};
