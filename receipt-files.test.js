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

  it("keeps the photo when the app folder is a symlink onto the disk", () => {
    const disk = path.join(tmp, "disk");
    const link = path.join(tmp, "app-data");
    fs.mkdirSync(path.join(disk, "receipts"), { recursive: true });
    const stored = path.join(disk, "receipts", "live.jpg");
    fs.writeFileSync(stored, "jpeg-bytes");
    fs.symlinkSync(disk, link);
    const viaLink = path.join(link, "receipts", "live.jpg");
    expect(receiptFiles.sameFile(viaLink, stored)).toBe(true);
    receiptFiles.moveSourceToDest(viaLink, stored);
    expect(fs.readFileSync(stored, "utf8")).toBe("jpeg-bytes");
    expect(fs.existsSync(viaLink)).toBe(true);
  });

  it("removes the receipt row when the photo or PDF is already missing", () => {
    const records = {
      receipts: [
        { id: "gone-jpg", filename: "01.01.26 AUD$1.00.jpg", imagePath: "receipts/gone-jpg.jpg" },
        { id: "keep", filename: "keep.jpg", imagePath: "receipts/keep.jpg" },
      ],
      expenses: [{ id: "e1", receiptId: "gone-jpg" }],
      income: [{ id: "i1", receiptId: "gone-jpg" }],
      vendors: [],
    };
    expect(storage.deleteReceipt(records, "gone-jpg")).toBe(true);
    expect(records.receipts.map((row) => row.id)).toEqual(["keep"]);
    expect(records.expenses[0].receiptId).toBeNull();
    expect(records.income[0].receiptId).toBeNull();
  });

  it("removes the receipt row when the photo path is a folder and cannot be unlinked", () => {
    const records = { receipts: [], expenses: [{ id: "e1", receiptId: null }], income: [], vendors: [] };
    const receipt = storage.addReceipt(records, {
      filename: "blocked.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64," + Buffer.from("jpeg-bytes").toString("base64"),
    });
    records.expenses[0].receiptId = receipt.id;
    const blocked = path.join(dataDir.REPO_DATA_DIR, receipt.imagePath);
    fs.rmSync(blocked, { recursive: true, force: true });
    fs.mkdirSync(blocked, { recursive: true });
    try {
      expect(storage.deleteReceipt(records, receipt.id)).toBe(true);
      expect(records.receipts).toHaveLength(0);
      expect(records.expenses[0].receiptId).toBeNull();
    } finally {
      fs.rmSync(blocked, { recursive: true, force: true });
    }
  });

  it("deletes a PDF and its thumbnail when the original PDF is already gone", () => {
    const prev = process.env.APP_PRODUCT;
    process.env.APP_PRODUCT = "suite";
    try {
      const records = { receipts: [], expenses: [], income: [], vendors: [] };
      const receipt = storage.addReceipt(records, {
        filename: "payslip.pdf",
        mimeType: "application/pdf",
        dataUrl: "data:application/pdf;base64," + Buffer.from("%PDF-1.4 payslip").toString("base64"),
      });
      const name = path.basename(receipt.imagePath);
      const pdf = path.join(tmp, receipt.imagePath);
      const thumb = path.join(tmp, "receipts", name.replace(/\.pdf$/i, ".thumb.png"));
      const suiteThumb = path.join(tmp, "suite", "receipts", name.replace(/\.pdf$/i, ".thumb.png"));
      fs.writeFileSync(thumb, "thumb");
      fs.writeFileSync(suiteThumb, "suite-thumb");
      fs.rmSync(pdf, { force: true });
      fs.rmSync(path.join(tmp, "suite", "receipts", name), { force: true });
      expect(storage.getReceiptFileInfo(receipt.imagePath)).toBeNull();
      expect(storage.deleteReceipt(records, receipt.id)).toBe(true);
      expect(records.receipts).toHaveLength(0);
      expect(fs.existsSync(thumb)).toBe(false);
      expect(fs.existsSync(suiteThumb)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.APP_PRODUCT;
      else process.env.APP_PRODUCT = prev;
    }
  });

  it("does not keep a receipt row when the upload has no photo or PDF bytes", () => {
    const records = { receipts: [], expenses: [], income: [], vendors: [] };
    expect(() =>
      storage.addReceipt(records, {
        filename: "empty.jpg",
        mimeType: "image/jpeg",
        dataUrl: "not-a-data-url",
      })
    ).toThrow(/not saved/);
    expect(records.receipts).toHaveLength(0);
    const empty = { receipts: [], expenses: [], income: [], vendors: [] };
    expect(() =>
      storage.addReceipt(empty, {
        filename: "zero.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,",
      })
    ).toThrow(/not saved/);
    expect(empty.receipts).toHaveLength(0);
  });

  it("keeps a PDF on the data directory", () => {
    const records = { receipts: [], expenses: [], income: [], vendors: [] };
    const receipt = storage.addReceipt(records, {
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      dataUrl: "data:application/pdf;base64," + Buffer.from("%PDF-1.4 invoice").toString("base64"),
    });
    expect(receipt.imagePath).toMatch(/\.pdf$/);
    expect(fs.readFileSync(path.join(tmp, receipt.imagePath), "utf8")).toBe("%PDF-1.4 invoice");
    expect(receiptFiles.storedReceiptFile(receipt.imagePath)).toBe(path.join(tmp, receipt.imagePath));
  });

  it("rejects receipt paths that leave the receipts folder", () => {
    expect(receiptFiles.safeRelative("receipts/../../package.json")).toBe("");
    expect(receiptFiles.isReceiptMember("receipts/ok.jpg")).toBe(true);
    expect(receiptFiles.isReceiptMember("users/pat.json")).toBe(false);
    expect(receiptFiles.isReceiptMember("receipts/nested/ok.jpg")).toBe(false);
  });
});
