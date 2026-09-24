const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const STORE = path.join(ROOT, "mobile-suite", "store");
const ANDROID_RES = path.join(ROOT, "mobile-suite", "android", "app", "src", "main", "res");

function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  expect(buf.toString("ascii", 12, 16)).toBe("IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}

describe("Go Taxation Suite store / launcher icon", () => {
  it("keeps a navy document SVG source (sky fold, amber underline)", () => {
    const svg = fs.readFileSync(path.join(STORE, "icon.svg"), "utf8");
    expect(svg).toMatch(/#0B1F33/i);
    expect(svg).toMatch(/#38BDF8/i);
    expect(svg).toMatch(/#F0A202/i);
    expect(svg).not.toMatch(/truck/i);
  });

  it("ships Play 512 (32-bit) and App Store 1024 (no alpha)", () => {
    const play = pngInfo(path.join(STORE, "icon-play-512.png"));
    expect(play).toMatchObject({ width: 512, height: 512, colorType: 6 });

    const appstore = pngInfo(path.join(STORE, "icon-appstore-1024.png"));
    expect(appstore).toMatchObject({ width: 1024, height: 1024, colorType: 2 });

    const web = pngInfo(path.join(ROOT, "public", "suite", "icon-512.png"));
    expect(web).toMatchObject({ width: 512, height: 512, colorType: 6 });
  });

  it("writes Android legacy and adaptive-foreground mipmaps at density sizes", () => {
    const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    const foreground = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

    for (const [density, size] of Object.entries(legacy)) {
      const folder = path.join(ANDROID_RES, `mipmap-${density}`);
      expect(pngInfo(path.join(folder, "ic_launcher.png"))).toMatchObject({
        width: size,
        height: size,
        colorType: 2,
      });
      const round = pngInfo(path.join(folder, "ic_launcher_round.png"));
      expect(round.width).toBe(size);
      expect(round.height).toBe(size);
    }

    for (const [density, size] of Object.entries(foreground)) {
      const info = pngInfo(
        path.join(ANDROID_RES, `mipmap-${density}`, "ic_launcher_foreground.png")
      );
      expect(info).toMatchObject({ width: size, height: size, colorType: 6 });
    }
  });

  it("points adaptive launchers at the Suite document drawable, not Capacitor X", () => {
    const launcher = fs.readFileSync(
      path.join(ANDROID_RES, "mipmap-anydpi-v26", "ic_launcher.xml"),
      "utf8"
    );
    const round = fs.readFileSync(
      path.join(ANDROID_RES, "mipmap-anydpi-v26", "ic_launcher_round.xml"),
      "utf8"
    );
    const fg = fs.readFileSync(path.join(ANDROID_RES, "drawable", "ic_launcher_foreground.xml"), "utf8");
    const fgV24 = fs.readFileSync(
      path.join(ANDROID_RES, "drawable-v24", "ic_launcher_foreground.xml"),
      "utf8"
    );
    const bg = fs.readFileSync(path.join(ANDROID_RES, "values", "ic_launcher_background.xml"), "utf8");
    const html = fs.readFileSync(path.join(ROOT, "public", "suite", "index.html"), "utf8");

    expect(launcher).toMatch(/@drawable\/ic_launcher_foreground/);
    expect(round).toMatch(/@drawable\/ic_launcher_foreground/);
    expect(bg).toMatch(/#0B1F33/i);
    expect(fg).toMatch(/#E8EEF5/);
    expect(fg).toMatch(/#38BDF8/);
    expect(fg).toMatch(/#F0A202/);
    expect(fgV24).toMatch(/#38BDF8/);
    expect(fg).not.toMatch(/capacitor/i);
    expect(html).toMatch(/rel="apple-touch-icon"[^>]+href="\/suite\/icon-512\.png"/);
  });
});
