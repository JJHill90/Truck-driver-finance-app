const fs = require("fs");
const os = require("os");
const path = require("path");
const dataDir = require("./lib/data-dir");

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("data-dir binds writers to the persistent disk", () => {
  let tmp;
  let prevDataDir;

  beforeEach(() => {
    tmp = tmpDir("haulage-datadir-");
    prevDataDir = process.env.DATA_DIR;
    delete process.env.DATA_DIR;
    dataDir.setDataDirForTests(null);
  });

  afterEach(() => {
    dataDir.setDataDirForTests(null);
    if (prevDataDir == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("prefers DATA_DIR over the repo-relative data folder", () => {
    const disk = path.join(tmp, "disk");
    process.env.DATA_DIR = disk;
    expect(dataDir.getDataDir()).toBe(path.resolve(disk));
    expect(fs.existsSync(disk)).toBe(true);
    const info = dataDir.describeStorage();
    expect(info.source).toBe("env");
    expect(info.dataDir).toBe(path.resolve(disk));
    expect(info.envDataDir).toBe(path.resolve(disk));
  });

  it("lets tests override the resolved directory", () => {
    dataDir.setDataDirForTests(tmp);
    expect(dataDir.getDataDir()).toBe(path.resolve(tmp));
    expect(dataDir.describeStorage().source).toBe("test");
  });

  it("adopts users.json from a stray ephemeral folder onto the disk", () => {
    const ephemeral = path.join(tmp, "app-data");
    const disk = path.join(tmp, "disk");
    fs.mkdirSync(path.join(ephemeral, "suite", "users"), { recursive: true });
    fs.mkdirSync(disk, { recursive: true });
    fs.writeFileSync(
      path.join(ephemeral, "users.json"),
      JSON.stringify({ users: { pat: { username: "pat" } } }, null, 2)
    );
    fs.writeFileSync(
      path.join(ephemeral, "suite", "users", "pat.json"),
      JSON.stringify({ profile: { name: "Pat Suite" } }, null, 2)
    );

    const adopted = dataDir.adoptFrom(ephemeral, disk);
    expect(adopted.accounts).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(disk, "users.json"), "utf8")).users.pat.username).toBe(
      "pat"
    );
    expect(JSON.parse(fs.readFileSync(path.join(disk, "suite", "users", "pat.json"), "utf8")).profile.name).toBe(
      "Pat Suite"
    );
  });

  it("does not overwrite a richer disk with an empty ephemeral folder", () => {
    const ephemeral = path.join(tmp, "app-data");
    const disk = path.join(tmp, "disk");
    fs.mkdirSync(ephemeral, { recursive: true });
    fs.mkdirSync(disk, { recursive: true });
    fs.writeFileSync(path.join(ephemeral, "users.json"), JSON.stringify({ users: {} }, null, 2));
    fs.writeFileSync(
      path.join(disk, "users.json"),
      JSON.stringify({
        users: {
          pat: { username: "pat" },
          demo: { username: "demo" },
        },
      }, null, 2)
    );

    fs.mkdirSync(path.join(ephemeral, "receipts"), { recursive: true });
    fs.mkdirSync(path.join(disk, "receipts"), { recursive: true });
    fs.writeFileSync(path.join(ephemeral, "receipts", "old-invoice.jpg"), "photo-bytes");
    fs.writeFileSync(path.join(disk, "receipts", "already.jpg"), "keep");

    const adopted = dataDir.adoptFrom(ephemeral, disk);
    expect(adopted.copied).toBe("skipped-dest-richer");
    expect(adopted.receiptsMerged).toBe(1);
    const users = JSON.parse(fs.readFileSync(path.join(disk, "users.json"), "utf8"));
    expect(users.users.pat).toBeTruthy();
    expect(users.users.demo).toBeTruthy();
    expect(fs.readFileSync(path.join(disk, "receipts", "old-invoice.jpg"), "utf8")).toBe("photo-bytes");
    expect(fs.readFileSync(path.join(disk, "receipts", "already.jpg"), "utf8")).toBe("keep");
    expect(adopted.suiteReceiptsMerged).toBe(0);
    expect(fs.existsSync(path.join(disk, "suite", "receipts", "old-invoice.jpg"))).toBe(false);
  });

  it("keeps Suite photos under suite/receipts when the disk already has the accounts", () => {
    const prev = process.env.APP_PRODUCT;
    process.env.APP_PRODUCT = "suite";
    try {
      const ephemeral = path.join(tmp, "app-data");
      const disk = path.join(tmp, "disk");
      fs.mkdirSync(path.join(ephemeral, "receipts"), { recursive: true });
      fs.mkdirSync(path.join(ephemeral, "suite", "receipts"), { recursive: true });
      fs.mkdirSync(path.join(disk, "receipts"), { recursive: true });
      fs.writeFileSync(path.join(ephemeral, "users.json"), JSON.stringify({ users: {} }, null, 2));
      fs.writeFileSync(
        path.join(disk, "users.json"),
        JSON.stringify({ users: { pat: { username: "pat" }, demo: { username: "demo" } } }, null, 2)
      );
      fs.writeFileSync(path.join(ephemeral, "receipts", "wiped-folder.jpg"), "from-receipts");
      fs.writeFileSync(path.join(ephemeral, "suite", "receipts", "already-durable.jpg"), "from-suite");

      const adopted = dataDir.adoptFrom(ephemeral, disk);
      expect(adopted.copied).toBe("skipped-dest-richer");
      expect(fs.readFileSync(path.join(disk, "suite", "receipts", "wiped-folder.jpg"), "utf8")).toBe(
        "from-receipts"
      );
      expect(fs.readFileSync(path.join(disk, "suite", "receipts", "already-durable.jpg"), "utf8")).toBe(
        "from-suite"
      );
      expect(fs.readFileSync(path.join(disk, "receipts", "wiped-folder.jpg"), "utf8")).toBe("from-receipts");
      expect(fs.readFileSync(path.join(disk, "receipts", "already-durable.jpg"), "utf8")).toBe("from-suite");
    } finally {
      if (prev === undefined) delete process.env.APP_PRODUCT;
      else process.env.APP_PRODUCT = prev;
    }
  });

  it("counts accounts for /version storage diagnostics", () => {
    dataDir.setDataDirForTests(tmp);
    fs.writeFileSync(
      path.join(tmp, "users.json"),
      JSON.stringify({ users: { pat: { username: "pat" }, demo: { username: "demo" } } }, null, 2)
    );
    const info = dataDir.describeStorage();
    expect(info.usersFile).toBe(true);
    expect(info.accountCount).toBe(2);
    fs.mkdirSync(path.join(tmp, "receipts"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "receipts", "one.jpg"), "abcdef");
    const withPhoto = dataDir.describeStorage();
    expect(withPhoto.receiptBytes).toBe(6);
    expect(withPhoto.receiptFiles).toBe(1);
  });

  it("does not declare a Docker volume that hides the Render disk", () => {
    const dockerfile = fs.readFileSync(path.join(__dirname, "Dockerfile"), "utf8");
    expect(dockerfile).not.toMatch(/^\s*VOLUME\b/m);
  });
});
