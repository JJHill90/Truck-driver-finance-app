/**
 * Single data-root resolver so every writer hits the same persistent disk.
 *
 * Render native Node mounts the disk at /opt/render/project/src/data.
 * Docker images use WORKDIR /app, so a naive __dirname/../data is /app/data —
 * an ephemeral path that is wiped on each new container / Manual Deploy.
 *
 * Resolution order:
 *   1. setDataDirForTests() override
 *   2. DATA_DIR env (absolute or relative)
 *   3. A known mount that actually appears in /proc/mounts (or a different
 *      device from its parent): Render native, then Docker /app/data
 *   4. A known candidate that already has users.json
 *   5. Repo-relative data/ (local / tests)
 */
const fs = require("fs");
const path = require("path");

const REPO_DATA_DIR = path.resolve(__dirname, "..", "data");
const RENDER_NATIVE_DATA_DIR = "/opt/render/project/src/data";
const DOCKER_DATA_DIR = "/app/data";

const STORE_ENTRIES = [
  "users.json",
  "sessions.json",
  "support-messages.json",
  "driver-records.json",
  "users",
  "suite",
  "receipts",
  "history",
];

let overrideDir = null;

function envDataDir() {
  const raw = String(process.env.DATA_DIR || "").trim();
  return raw ? path.resolve(raw) : "";
}

function isDirectory(absPath) {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function readMounts() {
  try {
    return fs.readFileSync("/proc/mounts", "utf8");
  } catch {
    return "";
  }
}

function isMountPoint(absPath) {
  const target = path.resolve(absPath);
  const mounts = readMounts();
  if (mounts) {
    const hit = mounts.split("\n").some((line) => {
      const parts = line.split(/\s+/);
      return parts[1] === target;
    });
    if (hit) return true;
  }
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) {
      return isMountPoint(fs.realpathSync(target));
    }
    const parent = fs.statSync(path.dirname(target));
    return st.dev !== parent.dev;
  } catch {
    return false;
  }
}

function countAccountsIn(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8"));
    return Object.keys((raw && raw.users) || {}).length;
  } catch {
    return 0;
  }
}

function hasUsersFile(dir) {
  try {
    return fs.existsSync(path.join(dir, "users.json"));
  } catch {
    return false;
  }
}

function copyEntry(src, dest) {
  if (!fs.existsSync(src)) return false;
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return false;
  if (st.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, force: true });
    return true;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Copy receipt bytes that exist only on `sourceDir` into `destDir`.
 * Never overwrites a file already on the destination, and never follows a
 * symlink. Account JSON can live on the persistent disk while the photos
 * were written to an ephemeral folder — those photos must be merged in
 * before that folder is removed.
 */
function mergeReceiptFiles(sourceDir, destDir) {
  if (!sourceDir || !destDir) return 0;
  const src = path.resolve(sourceDir);
  const dest = path.resolve(destDir);
  if (src === dest || !isDirectory(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    let st;
    try {
      st = fs.lstatSync(from);
    } catch {
      continue;
    }
    if (!st.isFile() || st.isSymbolicLink()) continue;
    if (fs.existsSync(to)) continue;
    fs.copyFileSync(from, to);
    copied += 1;
  }
  return copied;
}

function isSuiteProduct() {
  const product = String(process.env.APP_PRODUCT || "")
    .trim()
    .toLowerCase();
  if (product === "suite" || product === "gotax") return true;
  const standalone = String(process.env.GOTAX_STANDALONE || "")
    .trim()
    .toLowerCase();
  return standalone === "1" || standalone === "true" || standalone === "yes";
}

/**
 * Go Taxation Suite keeps its ledger under data/suite/. On the Suite Render
 * service that folder is the part of the disk that survives a new build.
 * Copy photo bytes into suite/receipts as well as the shared receipts folder
 * so a build cannot drop the previews while the ledger rows remain.
 */
function mergeDurableSuiteReceipts(srcRoot, destRoot) {
  if (!isSuiteProduct()) return 0;
  if (!srcRoot || !destRoot) return 0;
  const src = path.resolve(srcRoot);
  const dest = path.resolve(destRoot);
  if (src === dest) return 0;
  let copied = 0;
  copied += mergeReceiptFiles(path.join(src, "receipts"), path.join(dest, "suite", "receipts"));
  copied += mergeReceiptFiles(path.join(src, "suite", "receipts"), path.join(dest, "suite", "receipts"));
  copied += mergeReceiptFiles(path.join(src, "suite", "receipts"), path.join(dest, "receipts"));
  return copied;
}

function adoptFrom(source, target) {
  const src = path.resolve(source);
  const dest = path.resolve(target);
  if (!src || !dest || src === dest) return null;
  if (!isDirectory(src)) return null;
  const srcCount = countAccountsIn(src);
  const destCount = countAccountsIn(dest);
  const sourceHasStore = srcCount > 0 || STORE_ENTRIES.some((name) => fs.existsSync(path.join(src, name)));
  if (!sourceHasStore) return null;
  const receiptsMerged = mergeReceiptFiles(path.join(src, "receipts"), path.join(dest, "receipts"));
  const suiteReceiptsMerged = mergeDurableSuiteReceipts(src, dest);
  if (destCount > srcCount) {
    return {
      source: src,
      copied: "skipped-dest-richer",
      accounts: destCount,
      receiptsMerged,
      suiteReceiptsMerged,
    };
  }

  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const name of STORE_ENTRIES) {
    if (name === "receipts") {
      if (receiptsMerged > 0) copied.push(name);
      continue;
    }
    if (copyEntry(path.join(src, name), path.join(dest, name))) copied.push(name);
  }
  return {
    source: src,
    copied: copied.join(","),
    accounts: countAccountsIn(dest),
    receiptsMerged,
    suiteReceiptsMerged,
  };
}

function candidateMounts() {
  return [RENDER_NATIVE_DATA_DIR, DOCKER_DATA_DIR];
}

function resolveDataDir() {
  if (overrideDir) return overrideDir;

  const fromEnv = envDataDir();
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }

  for (const dir of candidateMounts()) {
    if (isDirectory(dir) && isMountPoint(dir)) return dir;
  }

  const withUsers = candidateMounts().filter((dir) => isDirectory(dir) && hasUsersFile(dir));
  if (withUsers.length && !hasUsersFile(REPO_DATA_DIR)) return withUsers[0];

  fs.mkdirSync(REPO_DATA_DIR, { recursive: true });
  return REPO_DATA_DIR;
}

function setDataDirForTests(dir) {
  overrideDir = dir ? path.resolve(dir) : null;
}

function getDataDir() {
  return resolveDataDir();
}

function sourceOf(dataDir) {
  const resolved = path.resolve(dataDir);
  if (overrideDir && resolved === path.resolve(overrideDir)) return "test";
  const fromEnv = envDataDir();
  if (fromEnv && resolved === fromEnv) return "env";
  if (resolved === RENDER_NATIVE_DATA_DIR) return "render-mount";
  if (resolved === DOCKER_DATA_DIR) return "docker-mount";
  if (resolved === REPO_DATA_DIR) return "repo";
  return "resolved";
}

function folderUsage(dir, depth = 0) {
  if (depth > 8) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { bytes: 0, files: 0 };
  }
  for (const name of names) {
    if (!name || name === "." || name === "..") continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      const nested = folderUsage(full, depth + 1);
      bytes += nested.bytes;
      files += nested.files;
      continue;
    }
    if (st.isFile()) {
      bytes += st.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function describeStorage(dir = resolveDataDir()) {
  const dataDir = path.resolve(dir);
  const receiptUsage = folderUsage(path.join(dataDir, "receipts"));
  const suiteReceiptUsage = folderUsage(path.join(dataDir, "suite", "receipts"));
  const repoSame = path.resolve(REPO_DATA_DIR) === dataDir;
  const repoReceiptUsage = repoSame ? receiptUsage : folderUsage(path.join(REPO_DATA_DIR, "receipts"));
  return {
    dataDir,
    repoDataDir: REPO_DATA_DIR,
    envDataDir: envDataDir() || null,
    source: sourceOf(dataDir),
    mounted: isDirectory(dataDir) && isMountPoint(dataDir),
    renderNativeMount: isDirectory(RENDER_NATIVE_DATA_DIR) && isMountPoint(RENDER_NATIVE_DATA_DIR),
    dockerMount: isDirectory(DOCKER_DATA_DIR) && isMountPoint(DOCKER_DATA_DIR),
    usersFile: hasUsersFile(dataDir),
    accountCount: countAccountsIn(dataDir),
    dataBytes: folderUsage(dataDir).bytes,
    receiptBytes: receiptUsage.bytes + suiteReceiptUsage.bytes,
    receiptFiles: receiptUsage.files + suiteReceiptUsage.files,
    repoReceiptBytes: repoReceiptUsage.bytes,
    repoReceiptFiles: repoReceiptUsage.files,
  };
}

function bindRepoDataDir(target = resolveDataDir()) {
  const local = REPO_DATA_DIR;
  const dest = path.resolve(target);
  if (local === dest) return { bound: false, reason: "same-path" };
  if (process.env.NODE_ENV === "test") return { bound: false, reason: "test" };

  fs.mkdirSync(dest, { recursive: true });

  try {
    const lst = fs.lstatSync(local);
    if (lst.isSymbolicLink()) {
      const current = path.resolve(path.dirname(local), fs.readlinkSync(local));
      if (current === dest) return { bound: true, reason: "already-linked" };
    }
    if (lst.isDirectory() && !lst.isSymbolicLink()) {
      adoptFrom(local, dest);
      // /app/data is a mount on the Suite image (Dockerfile VOLUME). rename
      // fails, and that mount is not the Render disk the usage graph measures.
      // The copy above is the part that puts photos on the disk.
      if (isMountPoint(local)) {
        return { bound: false, reason: "repo-is-mount" };
      }
      const bak = `${local}.ephemeral-${process.pid}`;
      fs.renameSync(local, bak);
      try {
        fs.symlinkSync(dest, local);
      } catch (err) {
        fs.renameSync(bak, local);
        return { bound: false, reason: err.message };
      }
      try {
        mergeReceiptFiles(path.join(bak, "receipts"), path.join(dest, "receipts"));
        mergeDurableSuiteReceipts(bak, dest);
      } catch (err) {
        return { bound: true, reason: `symlinked-receipts-kept: ${err.message}` };
      }
      fs.rmSync(bak, { recursive: true, force: true });
      return { bound: true, reason: "symlinked" };
    }
  } catch (err) {
    if (err.code !== "ENOENT") return { bound: false, reason: err.message };
  }

  try {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.symlinkSync(dest, local);
    return { bound: true, reason: "created-link" };
  } catch (err) {
    return { bound: false, reason: err.message };
  }
}

function adoptStrayStores(target = resolveDataDir()) {
  const dest = path.resolve(target);
  const sources = [REPO_DATA_DIR, DOCKER_DATA_DIR, RENDER_NATIVE_DATA_DIR].filter(
    (dir, i, all) => path.resolve(dir) !== dest && all.indexOf(dir) === i
  );
  const adopted = [];
  for (const src of sources) {
    const result = adoptFrom(src, dest);
    if (result && result.copied && result.copied !== "skipped-dest-richer") adopted.push(result);
  }
  return adopted;
}

function adoptAndBind() {
  const dataDir = resolveDataDir();
  const adopted = adoptStrayStores(dataDir);
  const bound = bindRepoDataDir(dataDir);
  return { ...describeStorage(dataDir), adopted, bound };
}

module.exports = {
  REPO_DATA_DIR,
  RENDER_NATIVE_DATA_DIR,
  DOCKER_DATA_DIR,
  STORE_ENTRIES,
  getDataDir,
  setDataDirForTests,
  describeStorage,
  isMountPoint,
  countAccountsIn,
  adoptFrom,
  mergeReceiptFiles,
  mergeDurableSuiteReceipts,
  isSuiteProduct,
  adoptStrayStores,
  bindRepoDataDir,
  adoptAndBind,
};
