const support = require("./lib/support");

describe("support.validateContact", () => {
  it("accepts a complete enquiry", () => {
    const result = support.validateContact({
      name: "Dave Hill",
      email: "dave@example.com",
      phone: "0400 000 000",
      message: "How do I upload a receipt?",
    });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe("Dave Hill");
    expect(result.data.phone).toContain("0400");
  });

  it("allows phone to be omitted", () => {
    const result = support.validateContact({
      name: "Sam",
      email: "sam@example.com",
      message: "Need help with forecast.",
    });
    expect(result.ok).toBe(true);
    expect(result.data.phone).toBe("");
  });

  it("rejects missing name, email or message", () => {
    expect(support.validateContact({ email: "a@b.co", message: "hi" }).ok).toBe(false);
    expect(support.validateContact({ name: "A", message: "hi" }).ok).toBe(false);
    expect(support.validateContact({ name: "A", email: "a@b.co" }).ok).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = support.validateContact({
      name: "A",
      email: "not-an-email",
      message: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/valid email/i);
  });
});

describe("support.sessionUsername", () => {
  it("reads the session username string used by auth middleware", () => {
    expect(support.sessionUsername("JJHill90")).toBe("JJHill90");
    expect(support.sessionUsername("  dave  ")).toBe("dave");
    expect(support.sessionUsername(null)).toBe(null);
    expect(support.sessionUsername(undefined)).toBe(null);
    expect(support.sessionUsername("")).toBe(null);
  });

  it("does not treat a bare string as missing .username (the Support bug)", () => {
    const sessionUser = "JJHill90";
    // Bug pattern: req.user.username on a string is always undefined.
    expect(sessionUser.username).toBeUndefined();
    expect(support.sessionUsername(sessionUser)).toBe("JJHill90");
  });

  it("also accepts a public user object shape", () => {
    expect(support.sessionUsername({ username: "Sam" })).toBe("Sam");
    expect(support.sessionUsername({ username: "  " })).toBe(null);
  });
});

describe("support.saveContactMessage", () => {
  it("persists a message and builds a mailto link", () => {
    const saved = support.saveContactMessage({
      name: "Alex",
      email: "alex@example.com",
      phone: "",
      message: "EOFY PDF will not download",
      username: "alex.driver",
    });
    expect(saved.id).toBeTruthy();
    expect(saved.username).toBe("alex.driver");

    const list = support.loadMessages();
    expect(list.some((m) => m.id === saved.id)).toBe(true);

    const href = support.mailtoHref({
      name: "Alex",
      email: "alex@example.com",
      phone: "",
      message: "EOFY PDF will not download",
    });
    expect(href.startsWith("mailto:")).toBe(true);
    expect(href).toContain(encodeURIComponent(support.supportInbox()));
    expect(href).toContain(encodeURIComponent("Alex"));
  });

  it("defaults support inbox to the business email", () => {
    const prev = process.env.SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL;
    expect(support.supportInbox()).toBe("support@godriverhub.com");
    if (prev !== undefined) process.env.SUPPORT_EMAIL = prev;
  });
});
