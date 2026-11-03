const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractFunction(src, name) {
  const marker = `function ${name}`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
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

function loadFocus() {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const names = [
    "clamp01",
    "coverMappedRect",
    "cameraFocusPoint",
    "cameraFocusConstraints",
    "cameraClarityConstraints",
    "cameraFocusSettleMs",
  ];
  const code = `${names.map((name) => extractFunction(src, name)).join("\n")}\n${names
    .map((name) => `this.${name} = ${name};`)
    .join("\n")}`;
  const sandbox = {};
  vm.runInNewContext(code, sandbox, { filename: "camera-focus.js" });
  return sandbox;
}

describe("receipt camera focus", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "public/styles.css"), "utf8");
  const api = loadFocus();

  const stage = { left: 0, top: 0, width: 390, height: 700 };
  const centered = { left: 45, top: 138, width: 300, height: 424 };

  it("aims a centred amber frame at the middle of the camera image", () => {
    const point = api.cameraFocusPoint(1920, 2560, stage, centered);
    expect(point.x).toBeGreaterThan(0.45);
    expect(point.x).toBeLessThan(0.55);
    expect(point.y).toBeGreaterThan(0.45);
    expect(point.y).toBeLessThan(0.55);
  });

  it("moves the aim point when the frame sits to one side", () => {
    const shifted = { left: 220, top: 80, width: 160, height: 200 };
    const point = api.cameraFocusPoint(1920, 2560, stage, shifted);
    const middle = api.cameraFocusPoint(1920, 2560, stage, centered);
    expect(point.x).toBeGreaterThan(middle.x);
    expect(point.y).toBeLessThan(middle.y);
  });

  it("asks for a single-shot lock at the tapped point and never resizes the sensor", () => {
    const caps = {
      focusMode: ["continuous", "single-shot"],
      pointsOfInterest: true,
      exposureMode: ["continuous", "manual"],
      whiteBalanceMode: ["continuous"],
    };
    const plan = api.cameraFocusConstraints(caps, { x: 0.62, y: 0.4 }, "single-shot");
    expect(plan.mode).toBe("single-shot");
    expect(plan.direct).toEqual({
      focusMode: "single-shot",
      pointsOfInterest: [{ x: 0.62, y: 0.4 }],
    });
    expect(plan.direct.width).toBeUndefined();
    expect(plan.direct.height).toBeUndefined();
    expect(api.cameraClarityConstraints(caps)).toEqual({
      exposureMode: "continuous",
      whiteBalanceMode: "continuous",
    });
    expect(api.cameraFocusSettleMs("single-shot")).toBe(550);
    expect(api.cameraFocusSettleMs("continuous")).toBe(220);
  });

  it("falls back to continuous, and skips a point the camera cannot use", () => {
    expect(
      api.cameraFocusConstraints({ focusMode: ["continuous"] }, { x: 2, y: -1 }, "single-shot")
    ).toEqual({
      direct: { focusMode: "continuous" },
      mode: "continuous",
      point: { x: 1, y: 0 },
    });
    expect(api.cameraFocusConstraints({ focusMode: ["manual"] }, { x: 0.5, y: 0.5 }, "single-shot")).toBe(
      null
    );
    expect(api.cameraFocusConstraints({}, null, "continuous")).toBe(null);
    expect(api.cameraClarityConstraints({ exposureMode: ["manual"] })).toBe(null);
  });

  it("starts a focus hunt on open, on a tap, and before the shutter", () => {
    expect(src).toMatch(/focusMode: \{ ideal: "continuous" \}/);
    expect(src).toMatch(/width: \{ ideal: 1920, max: 2560 \}/);
    expect(src).toMatch(/height: \{ ideal: 2560, max: 2560 \}/);
    expect(src).not.toMatch(/ideal: 3840/);
    expect(src).not.toMatch(/caps\.width\.max/);
    expect(src).not.toMatch(/sharpenCameraTrack/);
    expect(src).toMatch(/focusCamera\("single-shot"/);
    expect(src).toMatch(/Tap the page if it looks soft/);
    expect(src).toMatch(/receipt-camera-focus-ring/);
    expect(src).toMatch(/image\/jpeg", 0\.95/);
    expect(css).toMatch(/\.receipt-camera-focus-ring/);
    expect(css).toMatch(/pointer-events:\s*none/);
  });
});
