const fs = require("fs");
const os = require("os");
const path = require("path");
const dataDir = require("./lib/data-dir");
const { CACHE_FOLDER, tesseractCacheDir } = require("./lib/tesseract-cache");

describe("tesseractCacheDir", () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tess-cache-"));
    dataDir.setDataDirForTests(tmp);
  });

  afterEach(() => {
    dataDir.setDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("creates tesseract-cache under the persistent DATA_DIR", () => {
    const dir = tesseractCacheDir();
    expect(dir).toBe(path.join(tmp, CACHE_FOLDER));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});
