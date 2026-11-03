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
    "closeFocusDistance",
    "normalizePoint",
    "planFocusAttempts",
    "previewFocusAttempts",
    "shutterFocusAttempts",
    "focusPointFromCrop",
    "normalizedCropFromPixels",
    "cropRectOnSource",
    "aspectClose",
    "chooseCaptureBitmap",
    "cameraOpenConstraints",
    "lensAcceptedFocus",
  ];
  const code = `${names.map((name) => extractFunction(src, name)).join("\n")}\n${names
    .map((name) => `this.${name} = ${name};`)
    .join("\n")}`;
  const sandbox = {};
  vm.runInNewContext(code, sandbox, { filename: "camera-focus.js" });
  return sandbox;
}

describe("scan camera close focus", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const api = loadFocus();
  const main = fs.readFileSync(
    path.join(__dirname, "mobile/android/app/src/main/java/com/haulagefinance/app/MainActivity.java"),
    "utf8"
  );
  const nativeFocus = fs.readFileSync(
    path.join(__dirname, "mobile/android/app/src/main/java/com/haulagefinance/app/ScanCameraFocus.java"),
    "utf8"
  );

  it("asks for continuous focus at the centre and a native resolution without scaling up", () => {
    const constraints = api.cameraOpenConstraints();
    expect(constraints.audio).toBe(false);
    expect(constraints.video.facingMode.ideal).toBe("environment");
    expect(constraints.video.width.ideal).toBeGreaterThanOrEqual(1920);
    expect(constraints.video.height.ideal).toBe(3840);
    expect(constraints.video.width.min).toBeUndefined();
    expect(constraints.video.height.min).toBeUndefined();
    expect(constraints.video.advanced.some((set) => set.resizeMode === "none")).toBe(true);
    expect(constraints.video.advanced.some((set) => set.zoom === 1)).toBe(true);
    const focus = constraints.video.advanced.find((set) => set.focusMode === "continuous");
    expect(focus.pointsOfInterest[0]).toEqual({ x: 0.5, y: 0.5 });

    const resolution = extractFunction(src, "raiseNativeResolution");
    expect(resolution).toMatch(/resizeMode: "none"/);
    expect(resolution).toMatch(/zoom: 1/);
    expect(resolution).toMatch(/ideal: 3840/);
    expect(resolution).not.toMatch(/\.max/);
  });

  it("focuses a centered close crop from the camera buffer, not the stretched preview", () => {
    const previewCss = { width: 390, height: 844 };
    const video = { width: 2160, height: 3840 };
    const chosen = api.chooseCaptureBitmap(null, video);
    expect(chosen.from).toBe("video-buffer");
    expect(chosen.width).toBe(2160);
    expect(chosen.width).not.toBe(previewCss.width);

    const crop = { sx: 648, sy: 1152, sw: 864, sh: 1536 };
    const point = api.focusPointFromCrop(video.width, video.height, crop);
    expect(point).toEqual({ x: 0.5, y: 0.5 });
    const norm = api.normalizedCropFromPixels(video.width, video.height, crop);
    const rect = api.cropRectOnSource(chosen.width, chosen.height, norm);
    expect(rect).toEqual({ sx: 648, sy: 1152, sw: 864, sh: 1536 });
    expect(rect.sw).toBeLessThanOrEqual(video.width);
    expect(rect.sh).toBeLessThanOrEqual(video.height);
    expect(rect.sw).toBeGreaterThan(previewCss.width);

    const attempts = api.planFocusAttempts(point, {});
    const shutter = api.shutterFocusAttempts(attempts);
    expect(shutter).toHaveLength(1);
    expect(shutter[0].label).toBe("single-shot");
    expect(shutter[0].advanced[0].focusMode).toBe("single-shot");
    expect(shutter[0].advanced[0].pointsOfInterest[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(api.previewFocusAttempts(attempts)[0].advanced[0].focusMode).toBe("continuous");

    expect(api.chooseCaptureBitmap({ width: 2160, height: 3840 }, { width: 1080, height: 1920 }).from).toBe(
      "still"
    );
    expect(api.chooseCaptureBitmap({ width: 640, height: 1138 }, { width: 2160, height: 3840 }).from).toBe(
      "video-buffer"
    );
    expect(api.chooseCaptureBitmap({ width: 4000, height: 3000 }, { width: 1080, height: 1920 }).from).toBe(
      "video-buffer"
    );
  });

  it("uses a close focus distance only when the lens can focus that near", () => {
    expect(api.closeFocusDistance({ min: 0, max: 10 })).toBe(5);
    expect(api.closeFocusDistance({ min: 0, max: 1.2 })).toBe(null);
    expect(api.closeFocusDistance({ min: 6, max: 10 })).toBe(6);
    expect(api.closeFocusDistance(null)).toBe(null);

    const manual = api.planFocusAttempts(
      { x: 0.5, y: 0.5 },
      { focusMode: ["manual"], focusDistance: { min: 0, max: 8 } }
    );
    expect(api.shutterFocusAttempts(manual)[0].advanced[0]).toMatchObject({
      focusMode: "manual",
      focusDistance: 5,
    });

    const continuousOnly = api.planFocusAttempts(
      { x: 2, y: -1 },
      { focusMode: ["continuous"], focusDistance: { min: 0, max: 10 } }
    );
    expect(continuousOnly.some((attempt) => attempt.label === "close-manual")).toBe(false);
    expect(continuousOnly.find((attempt) => attempt.label === "continuous").advanced[0].pointsOfInterest[0]).toEqual({
      x: 1,
      y: 0,
    });

    expect(api.lensAcceptedFocus({ getSettings: () => ({ focusMode: "continuous" }) })).toBe(true);
    expect(api.lensAcceptedFocus({ getSettings: () => ({ focusMode: "manual", focusDistance: 5 }) })).toBe(true);
    expect(api.lensAcceptedFocus({ getSettings: () => ({ focusMode: "manual" }) })).toBe(false);
    expect(api.lensAcceptedFocus({ getSettings: () => ({ focusMode: "manual", focusDistance: 0 }) })).toBe(false);
    expect(api.lensAcceptedFocus({ getSettings: () => ({}) })).toBe(false);
    expect(api.lensAcceptedFocus(null)).toBe(false);
  });

  it("keeps the amber frame up when focus is soft and does not send the driver back to upload", () => {
    const body = extractFunction(src, "captureAndUpload");
    expect(body.indexOf("focusCenteredReceipt")).toBeGreaterThan(0);
    expect(body.indexOf('phase === "shutter"') === -1 || body.includes('"shutter"')).toBe(true);
    expect(body).toMatch(/"shutter"/);
    expect(body.indexOf("focusCenteredReceipt")).toBeLessThan(body.indexOf("closeCamera"));
    expect(body).toMatch(/Focusing/);
    expect(body).toMatch(/drawCrop/);
    expect(body).not.toMatch(/fallbackId/);
    expect(body).not.toMatch(/getBoundingClientRect/);
    expect(body).not.toMatch(/too soft|out of focus|blurry/);
    expect(src).toMatch(/id="receipt-camera-frame"/);
    expect(src).toMatch(/HubScanCamera/);
  });

  it("adds a Hub Camera2 close-focus hook without changing the permission grant", () => {
    expect(main).toMatch(/installScanCameraBridge/);
    expect(main).toMatch(/request\.grant\(new String\[\] \{ PermissionRequest\.RESOURCE_VIDEO_CAPTURE \}\)/);
    expect(main).toMatch(/does not grant or deny/);
    expect(nativeFocus).toMatch(/CONTROL_AF_MODE_CONTINUOUS_PICTURE/);
    expect(nativeFocus).toMatch(/CONTROL_AF_TRIGGER_START/);
    expect(nativeFocus).toMatch(/captureFocusedJpeg/);
    expect(nativeFocus).not.toMatch(/requestPermissions/);
    expect(nativeFocus).not.toMatch(/\.deny\(/);
  });
});
