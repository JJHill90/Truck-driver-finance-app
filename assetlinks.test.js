const fs = require("fs");
const http = require("http");
const path = require("path");

process.env.NODE_ENV = "test";

const ASSETLINKS = path.join(__dirname, "public", ".well-known", "assetlinks.json");
const MANIFEST = path.join(
  __dirname,
  "mobile-suite",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml"
);

const SUITE_FINGERPRINT =
  "6E:2A:70:1A:D0:5A:2C:47:E1:B5:BD:01:19:0E:BC:A3:F4:BB:26:18:76:E0:C5:4F:90:FC:DA:9C:E5:72:05:FD";

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("Digital Asset Links (Go Taxation Suite)", () => {
  it("stores Play Console statement for com.gotaxation.suite", () => {
    const statements = JSON.parse(fs.readFileSync(ASSETLINKS, "utf8"));
    expect(Array.isArray(statements)).toBe(true);
    expect(statements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.gotaxation.suite",
            sha256_cert_fingerprints: [SUITE_FINGERPRINT],
          },
        }),
      ])
    );
  });

  it("declares verified https hosts on the Suite Android activity", () => {
    const xml = fs.readFileSync(MANIFEST, "utf8");
    expect(xml).toMatch(/android:autoVerify="true"/);
    expect(xml).toMatch(/android:host="gotaxationsuite.com"/);
    expect(xml).toMatch(/android:host="www.gotaxationsuite.com"/);
  });
});

describe("Digital Asset Links HTTP", () => {
  let server;

  beforeAll(async () => {
    const { app } = require("./server");
    server = await listen(app);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("serves /.well-known/assetlinks.json as application/json", async () => {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/.well-known/assetlinks.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body[0].target.package_name).toBe("com.gotaxation.suite");
    expect(body[0].target.sha256_cert_fingerprints).toContain(SUITE_FINGERPRINT);
  });
});
