const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeJsonAtomic, writeFileAtomic } = require("./lib/atomic-write");

describe("atomic-write", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes JSON via temp+rename with no leftover tmp files", () => {
    const file = path.join(dir, "users.json");
    writeJsonAtomic(file, { users: { a: 1 } });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ users: { a: 1 } });
    const leftovers = fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("overwrites an existing file atomically", () => {
    const file = path.join(dir, "records.json");
    writeFileAtomic(file, '{"v":1}', "utf8");
    writeJsonAtomic(file, { v: 2 });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).v).toBe(2);
  });
});
