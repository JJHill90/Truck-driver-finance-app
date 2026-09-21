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

function adoptFrom(source, target) {
  const src = path.resolve(source);
  const dest = path.resolve(target);
  if (!src || !dest || src === dest) return null;
  if (!isDirectory(src)) return null;
  const srcCount = countAccountsIn(src);
  const destCount = countAccountsIn(dest);
  const sourceHasStore = srcCount > 0 || STORE_ENTRIES.some((name) => fs.existsSync(path.join(src, name)));
  if (!sourceHasStore) return null;
  if (destCount > srcCount) return { source: src, copied: "skipped-dest-richer", accounts: destCount };

  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const name of STORE_ENTRIES) {
    if (copyEntry(path.join(src, name), path.join(dest, name))) copied.push(name);
  }
  return { source: src, copied: copied.join(","), accounts: countAccountsIn(dest) };
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

function describeStorage(dir = resolveDataDir()) {
  const dataDir = path.resolve(dir);
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
      const bak = `${local}.ephemeral-${process.pid}`;
      fs.renameSync(local, bak);
      try {
        fs.symlinkSync(dest, local);
      } catch (err) {
        fs.renameSync(bak, local);
        return { bound: false, reason: err.message };
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
  adoptStrayStores,
  bindRepoDataDir,
  adoptAndBind,
};
