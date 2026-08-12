/**
 * Full-store backups for Driver Hub / Taxation Hub.
 *
 * Creates gzipped tar archives of accounts, per-user records, receipt files,
 * history snapshots and support messages under data/backups/ (excluded from
 * the archive itself). Optional off-site copy (BACKUP_OFFSITE_DIR) and S3
 * upload (BACKUP_S3_BUCKET + AWS credentials).
 *
 * Env:
 *   BACKUP_ENABLED          default "1" (set "0" to disable scheduler)
 *   BACKUP_INTERVAL_HOURS   default 24
 *   BACKUP_KEEP             default 14 local archives retained
 *   BACKUP_OFFSITE_DIR      optional second directory to copy each archive
 *   BACKUP_S3_BUCKET        optional S3 bucket for off-site upload
 *   BACKUP_S3_PREFIX        optional key prefix (default "haulage-backups/")
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
 *     (or BACKUP_S3_ACCESS_KEY / BACKUP_S3_SECRET_KEY / BACKUP_S3_REGION)
 *   BACKUP_NOTIFY_EMAIL     optional; falls back to SUPPORT_EMAIL
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");
let dataDir = DEFAULT_DATA_DIR;

const INCLUDE_ENTRIES = [
  "users.json",
  "driver-records.json",
  "support-messages.json",
  "users",
  "receipts",
  "history",
];

const BACKUP_NAME_RE = /^haulage-backup-\d{8}T\d{6}Z-[a-f0-9]{6}\.tar\.gz$/;

let busy = null;
let schedulerTimer = null;

function getDataDir() {
  return dataDir;
}

function getBackupDir() {
  return path.join(dataDir, "backups");
}

/** Test helper — point backups at an isolated temp directory. */
function setDataDirForTests(dir) {
  dataDir = dir || DEFAULT_DATA_DIR;
}

function envFlag(name, defaultOn = true) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultOn;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}

function keepCount() {
  const n = Number(process.env.BACKUP_KEEP);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 14;
}

function intervalMs() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS);
  const h = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return Math.max(1, h) * 60 * 60 * 1000;
}

function ensureBackupDir() {
  fs.mkdirSync(getBackupDir(), { recursive: true });
}

function stampId(date = new Date()) {
  const iso = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const rand = crypto.randomBytes(3).toString("hex");
  return `haulage-backup-${iso}-${rand}`;
}

function backupPathFor(id) {
  const base = String(id || "").replace(/\.tar\.gz$/i, "");
  if (!BACKUP_NAME_RE.test(`${base}.tar.gz`)) {
    throw new Error("Invalid backup id");
  }
  return path.join(getBackupDir(), `${base}.tar.gz`);
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function existingIncludeArgs() {
  return INCLUDE_ENTRIES.filter((name) => fs.existsSync(path.join(getDataDir(), name)));
}

async function writeArchive(finalPath, includes) {
  const tmpPath = `${finalPath}.partial`;
  try {
    await execFileAsync(
      "tar",
      ["-czf", tmpPath, "-C", getDataDir(), "--exclude=backups", ...includes],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    const wrapped = new Error(`Backup archive failed: ${err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

function ensureMinimalUsersFile(includes) {
  if (includes.length) return includes;
  const next = ["users.json"];
  const usersFile = path.join(getDataDir(), "users.json");
  if (!fs.existsSync(usersFile)) {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(usersFile, JSON.stringify({ users: {} }, null, 2));
  }
  return next;
}

/**
 * Create a new backup archive. Optionally run `flushFn` first so in-memory
 * record caches are written to disk.
 */
async function createBackup({ reason = "manual", actor = null, flushFn = null } = {}) {
  if (busy) {
    const err = new Error("A backup is already running");
    err.code = "BACKUP_BUSY";
    throw err;
  }
  busy = { startedAt: new Date().toISOString(), reason };
  try {
    if (typeof flushFn === "function") {
      await flushFn();
    }
    ensureBackupDir();
    fs.mkdirSync(getDataDir(), { recursive: true });

    const includes = ensureMinimalUsersFile(existingIncludeArgs());
    const id = stampId();
    const finalPath = path.join(getBackupDir(), `${id}.tar.gz`);
    await writeArchive(finalPath, includes);

    const stat = fs.statSync(finalPath);
    const sha256 = fileSha256(finalPath);
    const meta = {
      id,
      filename: `${id}.tar.gz`,
      createdAt: new Date().toISOString(),
      reason,
      actor: actor || null,
      bytes: stat.size,
      sha256,
      includes,
      localPath: finalPath,
    };

    const offsite = await copyOffsite(finalPath, meta.filename);
    const s3 = await uploadToS3(finalPath, meta.filename);
    const pruned = pruneLocalBackups();

    return { ...meta, offsite, s3, pruned };
  } finally {
    busy = null;
  }
}

function copyOffsite(filePath, filename) {
  const dir = String(process.env.BACKUP_OFFSITE_DIR || "").trim();
  if (!dir) return Promise.resolve({ copied: false, skipped: true });
  try {
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, filename);
    fs.copyFileSync(filePath, dest);
    return Promise.resolve({ copied: true, path: dest });
  } catch (err) {
    return Promise.resolve({ copied: false, error: err.message });
  }
}

function hmac(key, data, encoding) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest(encoding);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Minimal S3 PutObject (SigV4). No AWS SDK dependency.
 */
function uploadToS3(filePath, filename) {
  const bucket = String(process.env.BACKUP_S3_BUCKET || "").trim();
  const accessKey = process.env.BACKUP_S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.BACKUP_S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const region =
    process.env.BACKUP_S3_REGION || process.env.AWS_REGION || "ap-southeast-2";
  const prefix = String(process.env.BACKUP_S3_PREFIX || "haulage-backups").replace(
    /^\/+|\/+$/g,
    ""
  );
  if (!bucket || !accessKey || !secretKey) {
    return Promise.resolve({ uploaded: false, skipped: true });
  }

  const key = prefix ? `${prefix}/${filename}` : filename;
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const body = fs.readFileSync(filePath);
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const service = "s3";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: host,
        path: canonicalUri,
        method: "PUT",
        headers: {
          Host: host,
          "Content-Length": body.length,
          "Content-Type": "application/gzip",
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": amzDate,
          Authorization: authorization,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              uploaded: true,
              bucket,
              key,
              statusCode: res.statusCode,
            });
          } else {
            resolve({
              uploaded: false,
              error: `S3 HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString("utf8").slice(0, 300)}`,
              statusCode: res.statusCode,
            });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ uploaded: false, error: err.message }));
    req.write(body);
    req.end();
  });
}

function listBackups() {
  ensureBackupDir();
  return fs
    .readdirSync(getBackupDir())
    .filter((name) => BACKUP_NAME_RE.test(name))
    .map((name) => {
      const full = path.join(getBackupDir(), name);
      const st = fs.statSync(full);
      return {
        id: name.replace(/\.tar\.gz$/i, ""),
        filename: name,
        createdAt: st.mtime.toISOString(),
        bytes: st.size,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function pruneLocalBackups(keep = keepCount()) {
  const all = listBackups();
  const removed = [];
  for (const row of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(getBackupDir(), row.filename));
      removed.push(row.id);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

function getBackupFile(id) {
  const full = backupPathFor(id);
  if (!fs.existsSync(full)) {
    const err = new Error("Backup not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  return {
    id: path.basename(full, ".tar.gz"),
    filename: path.basename(full),
    path: full,
    bytes: fs.statSync(full).size,
    sha256: fileSha256(full),
  };
}

/**
 * Restore a backup archive over the live data directory (except data/backups).
 * Takes a safety backup first. Caller should clear in-memory caches afterwards.
 */
async function restoreBackup(id, { confirm, flushFn = null } = {}) {
  if (String(confirm || "") !== "RESTORE") {
    const err = new Error('Restore requires confirm: "RESTORE"');
    err.code = "CONFIRM_REQUIRED";
    throw err;
  }
  if (busy) {
    const err = new Error("A backup operation is already running");
    err.code = "BACKUP_BUSY";
    throw err;
  }

  const file = getBackupFile(id);
  let safety = null;
  try {
    safety = await createBackup({
      reason: "pre-restore",
      actor: "system",
      flushFn,
    });
  } catch (err) {
    console.warn("pre-restore safety backup failed:", err.message);
  }

  busy = { startedAt: new Date().toISOString(), reason: "restore" };
  try {
    await execFileAsync(
      "tar",
      ["-xzf", file.path, "-C", getDataDir(), "--exclude=backups"],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return {
      restored: file.id,
      safetyBackupId: safety && safety.id ? safety.id : null,
      restoredAt: new Date().toISOString(),
    };
  } finally {
    busy = null;
  }
}

function getStatus() {
  return {
    enabled: envFlag("BACKUP_ENABLED", true),
    intervalHours: intervalMs() / (60 * 60 * 1000),
    keep: keepCount(),
    backupDir: getBackupDir(),
    offsiteDir: String(process.env.BACKUP_OFFSITE_DIR || "").trim() || null,
    s3Bucket: String(process.env.BACKUP_S3_BUCKET || "").trim() || null,
    busy,
    count: listBackups().length,
  };
}

/**
 * Start the recurring scheduler. Runs an initial backup after a short delay.
 * @param {{ flushFn?: Function, onComplete?: Function, onError?: Function }} hooks
 */
function startBackupScheduler(hooks = {}) {
  if (!envFlag("BACKUP_ENABLED", true)) {
    console.log("Backups: scheduler disabled (BACKUP_ENABLED=0)");
    return { started: false };
  }
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }

  const run = async (reason) => {
    try {
      const result = await createBackup({
        reason,
        actor: "scheduler",
        flushFn: hooks.flushFn,
      });
      if (typeof hooks.onComplete === "function") {
        await hooks.onComplete(result);
      }
      console.log(
        `Backups: created ${result.id} (${result.bytes} bytes)` +
          (result.s3 && result.s3.uploaded ? ` → s3://${result.s3.bucket}/${result.s3.key}` : "") +
          (result.offsite && result.offsite.copied ? " → offsite" : "")
      );
    } catch (err) {
      if (err && err.code === "BACKUP_BUSY") return;
      console.warn("Backups: failed:", err.message);
      if (typeof hooks.onError === "function") {
        try {
          await hooks.onError(err);
        } catch {
          /* ignore */
        }
      }
    }
  };

  const bootDelayMs = Number(process.env.BACKUP_BOOT_DELAY_MS);
  const delay = Number.isFinite(bootDelayMs) && bootDelayMs >= 0 ? bootDelayMs : 45_000;
  const bootTimer = setTimeout(() => run("boot"), delay);
  if (typeof bootTimer.unref === "function") bootTimer.unref();
  schedulerTimer = setInterval(() => run("scheduled"), intervalMs());
  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();

  console.log(
    `Backups: scheduler on (every ${intervalMs() / 3600000}h, keep ${keepCount()})`
  );
  return { started: true, intervalMs: intervalMs(), keep: keepCount() };
}

function stopBackupScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

module.exports = {
  INCLUDE_ENTRIES,
  BACKUP_NAME_RE,
  getDataDir,
  getBackupDir,
  setDataDirForTests,
  createBackup,
  listBackups,
  pruneLocalBackups,
  getBackupFile,
  restoreBackup,
  getStatus,
  startBackupScheduler,
  stopBackupScheduler,
  uploadToS3,
  copyOffsite,
};
