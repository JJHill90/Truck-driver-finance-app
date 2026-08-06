const mail = require("./lib/mail");

describe("mail support delivery helpers", () => {
  it("builds developer notification and user confirmation copy", () => {
    const notice = mail.buildSupportNotificationText({
      name: "Dave",
      email: "dave@example.com",
      phone: "0400",
      message: "Need help",
      username: "dave",
    });
    expect(notice).toContain("Dave");
    expect(notice).toContain("dave@example.com");
    expect(notice).toContain("Need help");

    const confirm = mail.buildSupportConfirmationText({
      name: "Dave",
      supportEmail: "hilljj1990@gmail.com",
    });
    expect(confirm).toMatch(/sent to the developer/i);
    expect(confirm).toContain("hilljj1990@gmail.com");
  });

  it("defaults support inbox to the business Gmail", () => {
    const prev = process.env.SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL;
    expect(mail.supportInbox()).toBe("hilljj1990@gmail.com");
    if (prev !== undefined) process.env.SUPPORT_EMAIL = prev;
  });
});

describe("mail.sendSupportEmail channels", () => {
  const prev = {};

  beforeEach(() => {
    for (const key of [
      "SMTP_HOST",
      "MAIL_FROM",
      "SMTP_USER",
      "SMTP_PASS",
      "RESEND_API_KEY",
      "RESEND_FROM",
      "SUPPORT_EMAIL",
    ]) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns sent:false when no mail channel is configured", async () => {
    const result = await mail.sendSupportEmail({
      name: "Sam",
      email: "sam@example.com",
      phone: "",
      message: "Hello",
      username: null,
    });
    expect(result.sent).toBe(false);
    expect(result.confirmationSent).toBe(false);
    expect(result.to).toBe("hilljj1990@gmail.com");
  });

  it("sends developer + confirmation mail via Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_FROM = "Haulage Finance <onboarding@resend.dev>";

    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return {
          ok: true,
          json: async () => ({ id: "msg_" + calls.length }),
        };
      })
    );

    const result = await mail.sendSupportEmail({
      name: "Sam",
      email: "sam@example.com",
      phone: "0411",
      message: "Scanner question",
      username: "sam.driver",
    });

    expect(result.sent).toBe(true);
    expect(result.confirmationSent).toBe(true);
    expect(result.channel).toBe("resend");
    expect(calls).toHaveLength(2);
    expect(calls[0].to).toEqual(["hilljj1990@gmail.com"]);
    expect(calls[0].reply_to).toBe("sam@example.com");
    expect(calls[1].to).toEqual(["sam@example.com"]);
  });
});
