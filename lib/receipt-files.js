/**
 * Receipt photos and PDFs must live on the same persistent directory as the
 * account JSON. lib/storage.js (verbatim) writes them under the repo
 * data/ folder. On a container deploy that folder is /app/data and is wiped
 * with every new build, while DATA_DIR (the Render disk) keeps the ledger
 * rows — the gallery then says "Photo file missing".
 *
 * installPersistentReceiptStore points those reads and writes at getDataDir().
 * Go Taxation Suite also keeps a copy in suite/receipts, beside the ledger
 * that already survives a new build (data/suite/users). Driver Hub keeps a
 * single copy in receipts/ on its own disk.
 * collectMissingReceiptFiles copies any bytes still sitting in a stray
 * folder, then fills gaps from the newest backup archives. It runs before
 * the ephemeral data folder is deleted.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
  getDataDir,
  REPO_DATA_DIR,
  DOCKER_DATA_DIR,
  RENDER_NATIVE_DATA_DIR,
  mergeReceiptFiles,
  isSuiteProduct,
} = require("./data-dir");
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

function suiteReceiptsDir() {
  return path.join(getDataDir(), "suite", "receipts");
}

function storageRoots() {
  return [getDataDir(), REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR, "/var/data"];
}

function candidateFiles(relativePath) {
  const rel = safeRelative(relativePath);
  if (!rel) return [];
  const name = path.posix.basename(rel);
  const relativeForms = isSuiteProduct()
    ? [`suite/receipts/${name}`, rel]
    : [rel, `suite/receipts/${name}`];
  const seen = new Set();
  const files = [];
  for (const root of storageRoots()) {
    for (const form of relativeForms) {
      const filePath = path.resolve(root, form);
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      files.push(filePath);
    }
  }
  return files;
}

/**
 * One copy of the bytes when the two folders share a disk (hard link).
 * A different device — the usual Suite case, where receipts/ is wiped and
 * suite/ is the mounted disk — falls back to a real copy.
 */
function linkOrCopy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink() || !st.isFile()) return false;
    if (st.size > 0) return false;
    fs.rmSync(dest, { force: true });
  } catch {
    /* dest missing */
  }
  try {
    fs.linkSync(src, dest);
    return true;
  } catch (err) {
    if (err && err.code === "EEXIST") return false;
    fs.copyFileSync(src, dest);
    return true;
  }
}

function mirrorIntoSuiteLedger(relativePath) {
  if (!isSuiteProduct()) return false;
  const rel = safeRelative(relativePath);
  if (!rel) return false;
  const src = existingFile(rel);
  if (!src) return false;
  const dest = path.join(suiteReceiptsDir(), path.posix.basename(rel));
  if (path.resolve(src) === path.resolve(dest)) return false;
  return linkOrCopy(src, dest);
}

function existingFile(relativePath) {
  let empty = null;
  for (const filePath of candidateFiles(relativePath)) {
    try {
      const st = fs.lstatSync(filePath);
      if (!st.isFile() || st.isSymbolicLink()) continue;
      if (st.size === 0) {
        empty = empty || filePath;
        continue;
      }
      return filePath;
    } catch {
      /* missing */
    }
  }
  return empty;
}

function sameFile(source, dest) {
  try {
    if (fs.realpathSync(source) === fs.realpathSync(dest)) return true;
  } catch {
    return false;
  }
  try {
    const a = fs.statSync(source);
    const b = fs.statSync(dest);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/**
 * Move one photo onto dest. When the app folder is a symlink onto the disk,
 * source and dest are the same file with two paths. Deleting "source" then
 * deletes the only copy, which is why a scan could save the amount and
 * immediately show "Photo file missing".
 */
function moveSourceToDest(source, dest) {
  let srcStat;
  try {
    srcStat = fs.lstatSync(source);
  } catch {
    return false;
  }
  if (!srcStat.isFile() || srcStat.isSymbolicLink()) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (sameFile(source, dest)) return true;
  let destStat = null;
  try {
    destStat = fs.lstatSync(dest);
  } catch {
    destStat = null;
  }
  if (destStat && (destStat.isSymbolicLink() || !destStat.isFile())) return false;
  if (destStat && destStat.size > 0) {
    if (destStat.size >= srcStat.size) {
      fs.rmSync(source, { force: true });
      return true;
    }
    fs.rmSync(dest, { force: true });
  } else if (destStat && destStat.size === 0) {
    fs.rmSync(dest, { force: true });
  }
  try {
    fs.renameSync(source, dest);
  } catch (err) {
    if (!err || err.code !== "EXDEV") throw err;
    fs.copyFileSync(source, dest);
    if (!sameFile(source, dest)) fs.rmSync(source, { force: true });
  }
  return true;
}

function relocateReceiptFile(relativePath) {
  const rel = safeRelative(relativePath);
  if (!rel) return;
  const dest = path.join(getDataDir(), rel);
  const sources = [path.join(REPO_DATA_DIR, rel), path.join(DOCKER_DATA_DIR, rel)];
  for (const source of sources) {
    if (path.resolve(source) === path.resolve(dest)) continue;
    moveSourceToDest(source, dest);
  }
}

function dropReceiptRow(records, id) {
  if (!records || !id) return false;
  let removed = false;
  if (Array.isArray(records.receipts)) {
    const before = records.receipts.length;
    records.receipts = records.receipts.filter((row) => row && row.id !== id);
    removed = records.receipts.length !== before;
  }
  for (const row of records.expenses || []) {
    if (row && row.receiptId === id) row.receiptId = null;
  }
  for (const row of records.income || []) {
    if (row && row.receiptId === id) row.receiptId = null;
  }
  return removed;
}

function thumbRelative(imagePath) {
  const rel = safeRelative(imagePath);
  if (!rel || /\.thumb\.png$/i.test(rel)) return "";
  return rel.replace(/\.[^.]+$/i, ".thumb.png");
}

/** A real image or PDF: non-empty file, not a symlink or an empty placeholder. */
function storedReceiptFile(relativePath) {
  const filePath = existingFile(relativePath);
  if (!filePath) return null;
  try {
    const st = fs.lstatSync(filePath);
    if (!st.isFile() || st.isSymbolicLink() || st.size <= 0) return null;
    return filePath;
  } catch {
    return null;
  }
}

function installPersistentReceiptStore(storage) {
  if (!storage || storage.__persistentReceipts) return storage;

  const originalAddReceipt = storage.addReceipt;
  if (typeof originalAddReceipt === "function") {
    storage.addReceipt = function addReceipt(records, payload) {
      const receipt = originalAddReceipt.apply(this, arguments);
      try {
        if (receipt && receipt.imagePath) {
          const rel = safeRelative(receipt.imagePath);
          let snapshot = null;
          const before = rel ? existingFile(rel) : null;
          if (before) {
            try {
              snapshot = fs.readFileSync(before);
            } catch {
              snapshot = null;
            }
          }
          relocateReceiptFile(receipt.imagePath);
          if (snapshot && snapshot.length && rel && !storedReceiptFile(rel)) {
            const restored = path.join(getDataDir(), rel);
            fs.mkdirSync(path.dirname(restored), { recursive: true });
            fs.writeFileSync(restored, snapshot);
          }
          mirrorIntoSuiteLedger(receipt.imagePath);
        }
        if (payload && payload.dataUrl && !storedReceiptFile(receipt && receipt.imagePath)) {
          const err = new Error("The photo or PDF was not saved. Please upload it again.");
          err.status = 500;
          err.code = "FILE_NOT_STORED";
          throw err;
        }
        return receipt;
      } catch (err) {
        if (receipt) dropReceiptRow(records, receipt.id);
        if (receipt && receipt.imagePath && typeof storage.deleteReceiptFile === "function") {
          try {
            storage.deleteReceiptFile(receipt.imagePath);
          } catch {
            /* nothing left to remove */
          }
        }
        throw err;
      }
    };
  }

  const originalDeleteReceipt = storage.deleteReceipt;
  if (typeof originalDeleteReceipt === "function") {
    storage.deleteReceipt = function deleteReceipt(records, id) {
      const receipt = ((records && records.receipts) || []).find((row) => row && row.id === id);
      const imagePath = receipt && receipt.imagePath;
      let removed = false;
      try {
        removed = Boolean(originalDeleteReceipt.apply(this, arguments));
      } catch (err) {
        console.warn("Receipt file delete failed:", err && err.message);
        removed = dropReceiptRow(records, id);
      }
      if (!removed && receipt) {
        const stillThere = ((records && records.receipts) || []).some((row) => row && row.id === id);
        removed = stillThere ? dropReceiptRow(records, id) : true;
      }
      const paths = [imagePath, thumbRelative(imagePath)].filter(Boolean);
      for (const rel of paths) {
        try {
          if (typeof storage.deleteReceiptFile === "function") storage.deleteReceiptFile(rel);
        } catch {
          /* a missing photo or PDF must not keep the card */
        }
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
    mirrorIntoSuiteLedger(relativePath);
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
  return strayDataRoots()
    .map((root) => path.join(root, "receipts"))
    .filter((dir) => {
      try {
        return fs.statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}

function isReceiptMember(name) {
  const norm = String(name || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return /^(?:receipts|suite\/receipts)\/[A-Za-z0-9._-]+$/.test(norm);
}

function strayDataRoots() {
  const dest = path.resolve(getDataDir());
  const candidates = [REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR, "/var/data"];
  const seen = new Set();
  const roots = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (resolved === dest || seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      if (fs.statSync(resolved).isDirectory()) roots.push(resolved);
    } catch {
      /* not on this host */
    }
  }
  return roots;
}

function mirrorReceiptNames(sourceDir, destDir) {
  if (!sourceDir || !destDir) return 0;
  const src = path.resolve(sourceDir);
  const dest = path.resolve(destDir);
  if (src === dest) return 0;
  let copied = 0;
  let names = [];
  try {
    names = fs.readdirSync(src);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) continue;
    const from = path.join(src, name);
    let st;
    try {
      st = fs.lstatSync(from);
    } catch {
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink() || st.size === 0) continue;
    if (linkOrCopy(from, path.join(dest, name))) copied += 1;
  }
  return copied;
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

function readableNames(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function hasRealFile(dir, name) {
  try {
    const st = fs.lstatSync(path.join(dir, name));
    return st.isFile() && !st.isSymbolicLink() && st.size > 0;
  } catch {
    return false;
  }
}

function presentReceiptNames(dir, suiteDir) {
  const names = new Set(readableNames(dir).filter((name) => hasRealFile(dir, name)));
  for (const name of readableNames(suiteDir)) {
    if (hasRealFile(suiteDir, name)) names.add(name);
  }
  return names;
}

function syncSuiteReceiptCopies(dir, suiteDir) {
  if (!isSuiteProduct()) return 0;
  return mirrorReceiptNames(dir, suiteDir) + mirrorReceiptNames(suiteDir, dir);
}

/**
 * Copy stray receipt files onto the persistent disk, then restore any
 * receipt member that is still missing from the newest backups first.
 * On Go Taxation Suite the durable copy lives in suite/receipts, next to
 * the ledger that already survives a new build.
 */
async function collectMissingReceiptFiles() {
  const dir = receiptsDir();
  const suiteDir = suiteReceiptsDir();
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const root of strayDataRoots()) {
    if (isSuiteProduct()) {
      // Land on suite/receipts first. receipts/ is then a hard link when
      // both folders are on the same disk, so the preview is not stored twice.
      copied += mergeReceiptFiles(path.join(root, "receipts"), suiteDir);
      copied += mergeReceiptFiles(path.join(root, "suite", "receipts"), suiteDir);
    } else {
      copied += mergeReceiptFiles(path.join(root, "receipts"), dir);
      copied += mergeReceiptFiles(path.join(root, "suite", "receipts"), dir);
    }
  }
  copied += syncSuiteReceiptCopies(dir, suiteDir);

  const present = presentReceiptNames(dir, suiteDir);
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
      let kept = false;
      for (const full of [path.join(dir, name), path.join(suiteDir, name)]) {
        try {
          const st = fs.lstatSync(full);
          if (!st.isFile() || st.isSymbolicLink() || st.size === 0) {
            fs.rmSync(full, { force: true });
            continue;
          }
          kept = true;
        } catch {
          /* this copy was not in the archive */
        }
      }
      if (kept && !present.has(name)) {
        present.add(name);
        restored += 1;
      }
    }
    syncSuiteReceiptCopies(dir, suiteDir);
  }

  return { dir: isSuiteProduct() ? suiteDir : dir, copied, restored };
}

function backupPath(row) {
  if (row && row.path) return row.path;
  return path.join(getDataDir(), "backups", row.filename);
}

module.exports = {
  safeRelative,
  sameFile,
  moveSourceToDest,
  storedReceiptFile,
  installPersistentReceiptStore,
  collectMissingReceiptFiles,
  strayReceiptDirs,
  isReceiptMember,
};
