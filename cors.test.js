const {
  buildAllowlist,
  isOriginAllowed,
  isCrossOrigin,
  sessionCookieFlags,
  applyCorsHeaders,
  CAPACITOR_ORIGINS,
} = require("./lib/cors");

function mockReq(headers = {}) {
  return { headers, secure: false, method: "GET" };
}

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(k, v) {
      headers[k] = v;
    },
  };
}

describe("cors allowlist", () => {
  it("parses CORS_ORIGINS and APP_BASE_URL", () => {
    const list = buildAllowlist({
      CORS_ORIGINS: "https://app.example.com, capacitor://localhost",
      APP_BASE_URL: "https://haulage.onrender.com/haulage/",
    });
    expect(list).toContain("https://app.example.com");
    expect(list).toContain("capacitor://localhost");
    expect(list).toContain("https://haulage.onrender.com");
  });

  it("optionally includes Capacitor defaults for Play / iOS shells", () => {
    const list = buildAllowlist({ CORS_ALLOW_CAPACITOR: "1" });
    for (const o of CAPACITOR_ORIGINS) {
      expect(list).toContain(o);
    }
  });

  it("rejects unknown origins", () => {
    const list = buildAllowlist({ CORS_ORIGINS: "https://app.example.com" });
    expect(isOriginAllowed("https://evil.example", list)).toBe(false);
    expect(isOriginAllowed("https://app.example.com", list)).toBe(true);
  });
});

describe("cors headers + cookies", () => {
  it("sets credentialed ACAO only for allowlisted Origin", () => {
    const allow = ["https://app.example.com"];
    const resOk = mockRes();
    const ok = applyCorsHeaders(
      mockReq({ origin: "https://app.example.com" }),
      resOk,
      allow
    );
    expect(ok).toBe(true);
    expect(resOk.headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(resOk.headers["Access-Control-Allow-Credentials"]).toBe("true");

    const resNo = mockRes();
    expect(applyCorsHeaders(mockReq({ origin: "https://evil.example" }), resNo, allow)).toBe(
      false
    );
    expect(resNo.headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("uses SameSite=None; Secure for cross-origin allowlisted sessions", () => {
    const env = {
      NODE_ENV: "production",
      CORS_ORIGINS: "capacitor://localhost",
    };
    const req = mockReq({
      origin: "capacitor://localhost",
      host: "haulage.onrender.com",
      "x-forwarded-proto": "https",
    });
    expect(isCrossOrigin(req)).toBe(true);
    expect(sessionCookieFlags(req, env)).toBe("HttpOnly; Path=/; SameSite=None; Secure");
  });

  it("keeps SameSite=Lax for same-origin production cookies", () => {
    const env = { NODE_ENV: "production", CORS_ORIGINS: "https://other.example" };
    const req = mockReq({
      origin: "https://haulage.onrender.com",
      host: "haulage.onrender.com",
      "x-forwarded-proto": "https",
    });
    expect(isCrossOrigin(req)).toBe(false);
    expect(sessionCookieFlags(req, env)).toBe("HttpOnly; Path=/; SameSite=Lax; Secure");
  });
});
