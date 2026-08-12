const {
  createRateLimiter,
  createAuthSupportRateLimiters,
  clientIp,
} = require("./lib/rate-limit");

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("rate-limit", () => {
  it("allows requests under the max then returns 429", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    const req = { headers: {}, ip: "1.2.3.4", body: {} };
    for (let i = 0; i < 3; i += 1) {
      const res = mockRes();
      let nextCalled = false;
      limiter(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    }
    const res = mockRes();
    let nextCalled = false;
    limiter(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeTruthy();
  });

  it("createAuthSupportRateLimiters only wraps selected POSTs", () => {
    const mw = createAuthSupportRateLimiters();
    mw.resetAll();
    const res = mockRes();
    let next = false;
    mw({ method: "GET", path: "/auth/login", headers: {}, ip: "9.9.9.9" }, res, () => {
      next = true;
    });
    expect(next).toBe(true);

    next = false;
    mw(
      { method: "POST", path: "/expenses", headers: {}, ip: "9.9.9.9", body: {} },
      res,
      () => {
        next = true;
      }
    );
    expect(next).toBe(true);
  });

  it("clientIp prefers x-forwarded-for", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": "10.0.0.8, 10.0.0.1" }, ip: "127.0.0.1" })
    ).toBe("10.0.0.8");
  });
});
