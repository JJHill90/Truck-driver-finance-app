const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const dataDir = require("./lib/data-dir");
const backup = require("./lib/backup");
const storage = require("./lib/storage");
const receiptFiles = require("./lib/receipt-files");

describe("receipt files stay on the persistent data directory", () => {
  let tmp;
  let prevDataDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "haulage-receipts-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmp;
    dataDir.setDataDirForTests(tmp);
    backup.setDataDirForTests(tmp);
    receiptFiles.installPersistentReceiptStore(storage);
  });

  afterEach(() => {
    dataDir.setDataDirForTests(null);
    backup.setDataDirForTests(null);
    if (prevDataDir == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a new photo onto DATA_DIR, not a second folder", () => {
    const records = { receipts: [], vendors: [], expenses: [], income: [] };
    const receipt = storage.addReceipt(records, {
      filename: "invoice.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64," + Buffer.from("jpeg-bytes").toString("base64"),
    });
    expect(receipt.imagePath).toMatch(/^receipts\/.+\.jpg$/);
    const onDisk = path.join(tmp, receipt.imagePath);
    expect(fs.readFileSync(onDisk, "utf8")).toBe("jpeg-bytes");
    expect(fs.existsSync(path.join(dataDir.REPO_DATA_DIR, receipt.imagePath))).toBe(false);
    expect(storage.readReceiptImage(receipt.imagePath)).toMatch(/^data:image\/jpeg;base64,/);
    expect(storage.getReceiptFileInfo(receipt.imagePath).filePath).toBe(onDisk);
    expect(fs.existsSync(path.join(tmp, "suite", "receipts"))).toBe(false);
  });

  it("stores a Go Taxation Suite photo beside the suite ledger and deletes both copies", () => {
    const prev = process.env.APP_PRODUCT;
    process.env.APP_PRODUCT = "suite";
    try {
      const records = { receipts: [], vendors: [], expenses: [], income: [] };
      const receipt = storage.addReceipt(records, {
        filename: "invoice.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64," + Buffer.from("suite-bytes").toString("base64"),
      });
      const shared = path.join(tmp, receipt.imagePath);
      const durable = path.join(tmp, "suite", "receipts", path.basename(receipt.imagePath));
      expect(fs.readFileSync(shared, "utf8")).toBe("suite-bytes");
      expect(fs.readFileSync(durable, "utf8")).toBe("suite-bytes");
      expect(storage.getReceiptFileInfo(receipt.imagePath).filePath).toBe(durable);

      fs.rmSync(shared, { force: true });
      expect(storage.readReceiptImage(receipt.imagePath)).toMatch(/^data:image\/jpeg;base64,/);

      storage.deleteReceiptFile(receipt.imagePath);
      expect(fs.existsSync(shared)).toBe(false);
      expect(fs.existsSync(durable)).toBe(false);
      expect(storage.getReceiptFileInfo(receipt.imagePath)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.APP_PRODUCT;
      else process.env.APP_PRODUCT = prev;
    }
  });

  it("restores a Suite photo that a backup stored only under suite/receipts", async () => {
    const prev = process.env.APP_PRODUCT;
    process.env.APP_PRODUCT = "suite";
    try {
      const stage = path.join(tmp, "stage");
      fs.mkdirSync(path.join(stage, "suite", "receipts"), { recursive: true });
      fs.writeFileSync(path.join(stage, "suite", "receipts", "kept-on-suite.jpg"), "suite-backup");
      const archive = path.join(tmp, "backups", "haulage-backup-20261103T020000Z-def456.tar.gz");
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      execFileSync("tar", ["-czf", archive, "-C", stage, "suite/receipts/kept-on-suite.jpg"]);

      const report = await receiptFiles.collectMissingReceiptFiles();
      expect(report.restored).toBe(1);
      const durable = path.join(tmp, "suite", "receipts", "kept-on-suite.jpg");
      const shared = path.join(tmp, "receipts", "kept-on-suite.jpg");
      expect(fs.readFileSync(durable, "utf8")).toBe("suite-backup");
      expect(fs.readFileSync(shared, "utf8")).toBe("suite-backup");
      expect(receiptFiles.isReceiptMember("suite/receipts/kept-on-suite.jpg")).toBe(true);
      expect(receiptFiles.isReceiptMember("suite/users/pat.json")).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.APP_PRODUCT;
      else process.env.APP_PRODUCT = prev;
    }
  });

  it("still reads a photo that was left in the repo data folder", () => {
    const repoReceipts = path.join(dataDir.REPO_DATA_DIR, "receipts");
    fs.mkdirSync(repoReceipts, { recursive: true });
    const name = "legacy-only-test.jpg";
    const legacy = path.join(repoReceipts, name);
    fs.writeFileSync(legacy, "legacy-bytes");
    try {
      const info = storage.getReceiptFileInfo(`receipts/${name}`);
      expect(info.filePath).toBe(legacy);
      expect(storage.readReceiptImage(`receipts/${name}`)).toMatch(/^data:image\/jpeg/);
    } finally {
      fs.rmSync(legacy, { force: true });
    }
  });

  it("restores a missing photo from a backup and does not replace one that is already there", async () => {
    const receipts = path.join(tmp, "receipts");
    const stage = path.join(tmp, "stage");
    fs.mkdirSync(path.join(stage, "receipts"), { recursive: true });
    fs.mkdirSync(receipts, { recursive: true });
    fs.writeFileSync(path.join(stage, "receipts", "missing.jpg"), "from-backup");
    fs.writeFileSync(path.join(stage, "receipts", "keep.jpg"), "from-backup-should-not-win");
    fs.writeFileSync(path.join(receipts, "keep.jpg"), "already-on-disk");
    const archive = path.join(
      tmp,
      "backups",
      "haulage-backup-20261103T010000Z-abc123.tar.gz"
    );
    fs.mkdirSync(path.dirname(archive), { recursive: true });
    execFileSync("tar", ["-czf", archive, "-C", stage, "receipts/missing.jpg", "receipts/keep.jpg"]);

    const report = await receiptFiles.collectMissingReceiptFiles();
    expect(report.restored).toBeGreaterThanOrEqual(1);
    expect(fs.readFileSync(path.join(receipts, "missing.jpg"), "utf8")).toBe("from-backup");
    expect(fs.readFileSync(path.join(receipts, "keep.jpg"), "utf8")).toBe("already-on-disk");
  });

  it("rejects receipt paths that leave the receipts folder", () => {
    expect(receiptFiles.safeRelative("receipts/../../package.json")).toBe("");
    expect(receiptFiles.isReceiptMember("receipts/ok.jpg")).toBe(true);
    expect(receiptFiles.isReceiptMember("users/pat.json")).toBe(false);
    expect(receiptFiles.isReceiptMember("receipts/nested/ok.jpg")).toBe(false);
  });
});
