const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractFunction(src, name) {
  const marker = `function ${name}`;
  let start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  if (src.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  let i = src.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let j = i; j < src.length; j += 1) {
    const ch = src[j];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function loadPreview() {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const names = ["clamp01", "livePreviewConstraints", "applyLivePreviewToTrack"];
  const code = `${names.map((name) => extractFunction(src, name)).join("\n")}\n${names
    .map((name) => `this.${name} = ${name};`)
    .join("\n")}`;
  const sandbox = {};
  vm.runInNewContext(code, sandbox, { filename: "camera-preview-live.js" });
  return sandbox;
}

describe("live scan preview", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const api = loadPreview();

  it("applies resolution and the frame centre to the live track, not only the still", async () => {
    const calls = [];
    const track = {
      applyConstraints: async (constraints) => {
        calls.push(constraints);
      },
    };
    const point = { x: 0.5, y: 0.46 };
    const applied = await api.applyLivePreviewToTrack(track, point, 1080, 2400);
    expect(applied).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    const live = calls[0];
    expect(live.width.ideal).toBe(3840);
    expect(live.height.ideal).toBe(2160);
    expect(live.advanced[0].focusMode).toBe("continuous");
    expect(live.advanced[0].pointsOfInterest[0]).toEqual(point);
    expect(live.advanced.some((set) => set.resizeMode === "none")).toBe(true);
    expect(live.width.max).toBeUndefined();

    const attach = extractFunction(src, "attachCameraStream");
    expect(attach).toMatch(/applyLivePreviewToTrack/);
    expect(attach.indexOf("applyLivePreviewToTrack")).toBeLessThan(attach.indexOf("focusCamera"));
    const tapAt = src.indexOf('addEventListener("pointerdown"');
    const tap = src.slice(tapAt, tapAt + 400);
    expect(tap).toMatch(/refocusLiveView/);
    expect(src).toMatch(/function refocusLiveView/);
    expect(src).toMatch(/refocusPreview/);
    expect(src).toMatch(/startLivePreview/);
    const capture = extractFunction(src, "captureAndUpload");
    expect(capture).not.toMatch(/applyLivePreviewToTrack/);
  });

  it("keeps a Driver Hub Camera2 viewfinder for the picture on screen", () => {
    const preview = fs.readFileSync(
      path.join(__dirname, "mobile/android/app/src/main/java/com/haulagefinance/app/ScanCameraPreview.java"),
      "utf8"
    );
    const focus = fs.readFileSync(
      path.join(__dirname, "mobile/android/app/src/main/java/com/haulagefinance/app/ScanCameraFocus.java"),
      "utf8"
    );
    expect(preview).toMatch(/CONTROL_AF_MODE_CONTINUOUS_PICTURE/);
    expect(preview).toMatch(/CONTROL_AF_TRIGGER_START/);
    expect(preview).toMatch(/A4 invoice/);
    expect(preview).toMatch(/Receipt/);
    expect(preview).toMatch(/Long receipt/);
    expect(preview).toMatch(/refocus\(/);
    expect(focus).toMatch(/startLivePreview/);
    expect(focus).toMatch(/refocusPreview/);
    expect(focus).not.toMatch(/request\.deny/);
    expect(preview).not.toMatch(/server\.url/);
  });
});
