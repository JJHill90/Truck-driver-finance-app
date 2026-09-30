const fs = require("fs");
const path = require("path");

const EXAMPLES = path.join(__dirname, "mobile-suite", "store", "examples");
const SLUGS = [
  "1-orange-fold",
  "2-orange-go",
  "3-blue-page",
  "4-orange-tile",
  "5-sky-tile",
  "6-white-tile",
];

function pngInfo(filePath) {
  const buf = fs.readFileSync(filePath);
  expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

describe("Suite Go-background icon examples", () => {
  it("keeps six colour-scheme Play 512 + App Store 1024 pairs for review", () => {
    expect(SLUGS).toHaveLength(6);
    for (const slug of SLUGS) {
      const play = pngInfo(path.join(EXAMPLES, slug, "icon-play-512.png"));
      const store = pngInfo(path.join(EXAMPLES, slug, "icon-appstore-1024.png"));
      expect(play).toMatchObject({ width: 512, height: 512, colorType: 6 });
      expect(store).toMatchObject({ width: 1024, height: 1024, colorType: 2 });
    }
  });
});
