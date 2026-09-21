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

    const adopted = dataDir.adoptFrom(ephemeral, disk);
    expect(adopted.copied).toBe("skipped-dest-richer");
    const users = JSON.parse(fs.readFileSync(path.join(disk, "users.json"), "utf8"));
    expect(users.users.pat).toBeTruthy();
    expect(users.users.demo).toBeTruthy();
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
  });
});
