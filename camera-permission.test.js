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

function loadCameraPermission() {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const names = [
    "cameraScanPermissionDecision",
    "cameraFlowShouldCancel",
    "isCameraPermissionRejection",
    "cameraBlockedMessage",
    "cameraPermissionOutcome",
  ];
  const code = `${names.map((name) => extractFunction(src, name)).join("\n")}\n${names
    .map((name) => `this.${name} = ${name};`)
    .join("\n")}`;
  const sandbox = {};
  vm.runInNewContext(code, sandbox, { filename: "camera-permission.js" });
  return sandbox;
}

describe("scan camera permission check", () => {
  const src = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
  const api = loadCameraPermission();

  it("does not treat a prompt or a missing Permissions API as a blocked cancel", () => {
    expect(api.cameraFlowShouldCancel({ phase: "before-getUserMedia", webState: "prompt" })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "after-getUserMedia", webState: "prompt" })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "before-getUserMedia", webState: null })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "after-getUserMedia", webState: null })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "after-getUserMedia", webState: undefined })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "before-getUserMedia", webState: "unavailable" })).toBe(false);
    expect(api.cameraFlowShouldCancel({ phase: "after-getUserMedia", webState: "unavailable" })).toBe(false);
    expect(
      api.cameraPermissionOutcome({ phase: "after-getUserMedia", webState: "prompt" }).action
    ).toBe("request");
    expect(
      api.cameraPermissionOutcome({ phase: "after-getUserMedia", webState: null }).message
    ).toBe("");
  });

  it("does not cancel when Android WebView reports camera denied before or without a real refusal", () => {
    expect(
      api.cameraFlowShouldCancel({
        phase: "before-getUserMedia",
        webState: "denied",
        androidWebView: true,
      })
    ).toBe(false);
    expect(
      api.cameraFlowShouldCancel({
        phase: "after-getUserMedia",
        webState: "denied",
        androidWebView: true,
      })
    ).toBe(false);
    expect(
      api.cameraScanPermissionDecision({
        phase: "after-getUserMedia",
        webState: "denied",
        nativeState: "prompt",
        androidWebView: true,
      })
    ).toBe("request");
    expect(
      api.cameraScanPermissionDecision({
        phase: "before-getUserMedia",
        webState: "denied",
        nativeState: "prompt-with-rationale",
      })
    ).toBe("request");
    const overconstrained = { name: "OverconstrainedError", message: "Permission denied" };
    const aborted = {
      name: "AbortError",
      message: "possibly because the user denied permission",
    };
    expect(api.isCameraPermissionRejection(overconstrained)).toBe(false);
    expect(api.isCameraPermissionRejection(aborted)).toBe(false);
    expect(src).not.toMatch(/NotAllowed\|Permission\|denied/);
  });

  it("shows the blocked message only for a real denial, with how to turn the camera on", () => {
    const browser = api.cameraPermissionOutcome({
      phase: "after-getUserMedia",
      webState: "denied",
    });
    expect(browser.action).toBe("blocked");
    expect(browser.message).toMatch(/Camera permission blocked/);
    expect(browser.message).toMatch(/site settings/);
    expect(browser.message).toMatch(/Camera to Allow/);
    expect(browser.message).toMatch(/Upload file/);

    const phone = api.cameraPermissionOutcome({
      phase: "before-getUserMedia",
      webState: "prompt",
      nativeState: "denied",
      nativeShell: true,
    });
    expect(phone.action).toBe("blocked");
    expect(phone.message).toMatch(/Camera permission blocked/);
    expect(phone.message).toMatch(/Settings/);
    expect(phone.message).toMatch(/Permissions/);
    expect(phone.message).toMatch(/turn Camera on/);
    expect(phone.message).toMatch(/Upload file/);

    expect(api.isCameraPermissionRejection({ name: "NotAllowedError", message: "Permission denied" })).toBe(
      true
    );
    expect(api.isCameraPermissionRejection({ name: "PermissionDeniedError", message: "" })).toBe(true);
    expect(api.cameraFlowShouldCancel({ phase: "before-getUserMedia", webState: "denied" })).toBe(false);
  });

  it("opens the amber frame before asking, and does not click Upload file on a block", () => {
    const open = src.slice(src.indexOf("async function openCamera(purpose)"));
    const showFrame = open.indexOf("modal.hidden = false");
    const ask = open.indexOf("acquireCameraStream");
    expect(showFrame).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(showFrame);
    expect(open.indexOf('if (early.action === "blocked")')).toBeLessThan(showFrame);
    const blockedArm = open.slice(open.indexOf('outcome.action === "blocked"'), open.indexOf('outcome.action === "failed"'));
    expect(blockedArm).toMatch(/showCameraBlocked/);
    expect(blockedArm).not.toMatch(/fallbackId/);
    expect(src).toMatch(/height: \{ ideal: 2160 \}/);
    expect(src).toMatch(/width: \{ ideal: 3840 \}/);
    expect(src).not.toMatch(/max: 2560/);
  });
});
