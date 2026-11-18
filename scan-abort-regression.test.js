/**
 * PR #224 aborted every scan before the request left the browser.
 * The interceptor stored a new AbortController, then aborted that same
 * controller. These tests run that interceptor with a mocked fetch.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const enhancementsSrc = fs.readFileSync(path.join(__dirname, "public/enhancements.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "public/app.js"), "utf8");

function extractAsyncFunction(src, name) {
  const marker = `async function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = start + marker.length;
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (; i < src.length; i += 1) {
    const ch = src[i];
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
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  while (src[i] !== "{") i += 1;
  let bodyDepth = 0;
  quote = null;
  escaped = false;
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
    if (ch === "{") bodyDepth += 1;
    else if (ch === "}") {
      bodyDepth -= 1;
      if (bodyDepth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function classList(initial = []) {
  const set = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => set.add(name));
    },
    remove(...names) {
      names.forEach((name) => set.delete(name));
    },
    toggle(name, force) {
      if (force === true) set.add(name);
      else if (force === false) set.delete(name);
      else if (set.has(name)) set.delete(name);
      else set.add(name);
    },
    contains(name) {
      return set.has(name);
    },
  };
}

function makeEl(tag) {
  return {
    tag,
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    style: {},
    dataset: {},
    parentNode: null,
    nextSibling: null,
    classList: classList(),
    setAttribute() {},
    getAttribute() {
      return null;
    },
    appendChild(child) {
      child.parentNode = this;
      return child;
    },
    insertBefore(node) {
      return node;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
  };
}

function scanBody(purpose) {
  return JSON.stringify({
    purpose,
    imageBase64: "abc",
    filename: "receipt.png",
    mimeType: "image/png",
  });
}

function scanResponse(id) {
  return new Response(
    JSON.stringify({
      receipt: { id, mimeType: "image/png", filename: "receipt.png" },
      ocrResult: { vendor: "BP", amount: 10 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function loadInterceptor({ pathname, hostname, suite }) {
  const body = makeEl("body");
  if (suite) body.classList.add("gotax-suite");
  const document = {
    readyState: "loading",
    body,
    documentElement: { dataset: {} },
    getElementById() {
      return null;
    },
    createElement: makeEl,
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const calls = [];
  let impl = async () => scanResponse("r1");
  const origFetch = async (url, opts) => {
    calls.push({ url, opts, signal: opts && opts.signal });
    return impl(url, opts);
  };
  const location = {
    protocol: "https:",
    hostname,
    origin: `https://${hostname}`,
    pathname,
    port: "",
  };
  const window = {
    location,
    document,
    fetch: origFetch,
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  const sandbox = {
    window,
    document,
    location,
    AbortController,
    FormData,
    Response,
    Headers,
    Request,
    URL,
    URLSearchParams,
    Blob,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    queueMicrotask,
    Intl,
    Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
    WeakMap,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  window.window = window;
  const start = enhancementsSrc.indexOf("(function () {");
  const end = enhancementsSrc.indexOf("})();");
  const code = enhancementsSrc.slice(start, end + 5);
  vm.runInNewContext(code, sandbox, { filename: "enhancements-scan.js" });
  return {
    fetch: window.fetch,
    calls,
    setImpl(next) {
      impl = next;
    },
  };
}

function waitFor(check, ms = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) resolve();
      else if (Date.now() - start > ms) reject(new Error("timed out waiting for scan fetch"));
      else setTimeout(tick, 10);
    };
    tick();
  });
}

describe("scan interceptor does not abort its own request", () => {
  const modes = [
    {
      name: "Suite",
      pathname: "/suite/",
      hostname: "suite.example.test",
      suite: true,
    },
    {
      name: "Hub",
      pathname: "/haulage/",
      hostname: "hub.example.test",
      suite: false,
    },
  ];

  it.each(modes)("$name sends the scan and leaves the signal open", async (mode) => {
    const harness = loadInterceptor(mode);
    const url = `https://${mode.hostname}/api/haulage/receipts/scan`;
    const res = await harness.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scanBody(mode.suite ? "income" : "expense"),
    });
    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].signal.aborted).toBe(false);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.receipt.id).toBe("r1");
    if (mode.suite) {
      expect(harness.calls[0].opts.headers["X-Gotax-Product"] || harness.calls[0].opts.headers["x-gotax-product"]).toBe(
        "suite"
      );
    }
  });

  it("aborts only the previous scan when a second scan starts", async () => {
    const harness = loadInterceptor({
      pathname: "/suite/",
      hostname: "suite.example.test",
      suite: true,
    });
    const url = "https://suite.example.test/api/haulage/receipts/scan";
    harness.setImpl((urlArg, opts) => {
      if (harness.calls.length === 1) {
        return new Promise((resolve, reject) => {
          const fail = () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (opts.signal.aborted) fail();
          else opts.signal.addEventListener("abort", fail, { once: true });
        });
      }
      return scanResponse("r2");
    });

    let firstErr = null;
    const first = harness
      .fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: scanBody("expense"),
      })
      .catch((err) => {
        firstErr = err;
      });
    await waitFor(() => harness.calls.length === 1);
    const second = harness.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: scanBody("income"),
    });
    await waitFor(() => harness.calls.length === 2);

    expect(harness.calls[0].signal.aborted).toBe(true);
    expect(harness.calls[1].signal.aborted).toBe(false);
    expect(harness.calls[0].signal).not.toBe(harness.calls[1].signal);

    const secondRes = await second;
    expect(secondRes.status).toBe(200);
    expect((await secondRes.json()).receipt.id).toBe("r2");
    await first;
    expect(firstErr && firstErr.name).toBe("AbortError");
    expect(harness.calls[1].signal.aborted).toBe(false);
  });
});

describe("api() network errors", () => {
  function loadApi(location) {
    const apiFn = extractAsyncFunction(appSrc, "api");
    const timeoutFn = extractAsyncFunction(appSrc, "apiWithTimeout");
    const sandbox = {
      window: { location },
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      AbortController,
      setTimeout,
      clearTimeout,
      SCAN_TIMEOUT_MS: 40,
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(
      `const API = window.location.origin + "/api/haulage";\nconst SCAN_TIMEOUT_MS = 40;\n${apiFn}\n${timeoutFn}\nthis.api = api;\nthis.apiWithTimeout = apiWithTimeout;`,
      sandbox,
      { filename: "app-api.js" }
    );
    return sandbox;
  }

  it("rethrows AbortError so the scan timeout message can replace it", async () => {
    const location = {
      protocol: "https:",
      hostname: "suite.example.test",
      origin: "https://suite.example.test",
      port: "",
    };
    const sandbox = loadApi(location);
    sandbox.fetch = async (_url, opts) =>
      new Promise((resolve, reject) => {
        const fail = () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        };
        if (opts.signal.aborted) fail();
        else opts.signal.addEventListener("abort", fail, { once: true });
      });
    await expect(sandbox.apiWithTimeout("/receipts/scan", { method: "POST", body: "{}" }, 30)).rejects.toThrow(
      /Scan timed out/
    );
  });

  it("uses the wake-up message on a hosted domain and the local hint only on localhost", async () => {
    const hosted = loadApi({
      protocol: "https:",
      hostname: "hub.example.test",
      origin: "https://hub.example.test",
      port: "",
    });
    await expect(hosted.api("/records")).rejects.toThrow(/waking up/);
    await expect(hosted.api("/records")).rejects.not.toThrow(/npm start/);

    const local = loadApi({
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:3000",
      port: "3000",
    });
    await expect(local.api("/records")).rejects.toThrow(/npm start/);
  });
});
