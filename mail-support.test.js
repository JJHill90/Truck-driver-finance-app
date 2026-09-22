const mail = require("./lib/mail");

describe("mail support delivery helpers", () => {
  it("builds developer notification and user confirmation copy", () => {
    const notice = mail.buildSupportNotificationText({
      name: "Dave",
      email: "dave@example.com",
      phone: "0400",
      message: "Need help with scans",
      username: "dave",
    });
    expect(notice).toContain("CONTACT DETAILS");
    expect(notice).toContain("Name:     Dave");
    expect(notice).toContain("Email:    dave@example.com");
    expect(notice).toContain("Phone:    0400");
    expect(notice).toContain("Username: dave");
    const priority = mail.buildSupportNotificationText({
      name: "Dave",
      email: "dave@example.com",
      phone: "0400",
      message: "Need help with scans",
      username: "dave",
      priority: true,
    });
    expect(priority).toContain("PRIORITY");
    expect(notice).toMatch(/MESSAGE\n-------\nNeed help with scans/);

    const html = mail.buildSupportNotificationHtml({
      name: "Dave",
      email: "dave@example.com",
      phone: "",
      message: "Line one\nLine two <script>",
      username: null,
    });
    expect(html).toContain("Contact details");
    expect(html).toContain("mailto:dave@example.com");
    expect(html).toContain("Line one<br />Line two");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("(not provided)");
    expect(html).toContain("(guest / not signed in)");

    const confirm = mail.buildSupportConfirmationText({
      name: "Dave",
      supportEmail: mail.DEFAULT_SUPPORT_EMAIL,
    });
    expect(confirm).toMatch(/sent to the developer/i);
    expect(confirm).toContain(mail.DEFAULT_SUPPORT_EMAIL);

    const confirmHtml = mail.buildSupportConfirmationHtml({
      name: "Dave",
      supportEmail: mail.DEFAULT_SUPPORT_EMAIL,
    });
    expect(confirmHtml).toContain("Support request received");
    expect(confirmHtml).toContain("Hi Dave");
  });

  it("defaults support inbox to the business Gmail", () => {
    const prev = process.env.SUPPORT_EMAIL;
    delete process.env.SUPPORT_EMAIL;
    expect(mail.supportInbox()).toBe(mail.DEFAULT_SUPPORT_EMAIL);
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in test");
      })
    );
    const result = await mail.sendSupportEmail({
      name: "Sam",
      email: "sam@example.com",
      phone: "",
      message: "Hello",
      username: null,
    });
    expect(result.sent).toBe(false);
    expect(result.confirmationSent).toBe(false);
    expect(result.to).toBe(mail.DEFAULT_SUPPORT_EMAIL);
  });

  it("detects FormSubmit activation copy so the driver UI never shows it", () => {
    expect(
      mail.formSubmitActivationRequired(
        "Make sure to activate your form to start receiving emails. Confirm your email."
      )
    ).toBe(true);
    expect(mail.formSubmitActivationRequired("Your form was submitted successfully.")).toBe(false);
  });

  it("delivers via FormSubmit when SMTP and Resend are unset", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url: String(url), body: JSON.parse(options.body) });
        return {
          ok: true,
          json: async () => ({ success: true, message: "Your form was submitted" }),
        };
      })
    );
    const result = await mail.sendSupportEmail({
      name: "Sam",
      email: "sam@example.com",
      phone: "",
      message: "Hello",
      username: "sam",
    });
    expect(result.sent).toBe(true);
    expect(result.channel).toBe("formsubmit");
    expect(result.confirmationSent).toBe(true);
    expect(calls[0].url).toContain("formsubmit.co/ajax/support%40godriverhub.com");
    expect(calls[0].body.Message).toBe("Hello");
    expect(calls[0].body._replyto).toBe("sam@example.com");
  });

  it("does not treat a pending FormSubmit activation as a sent email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: false,
          message: "Make sure to activate your form. Confirm your email.",
        }),
      }))
    );
    const result = await mail.sendSupportEmail({
      name: "Sam",
      email: "sam@example.com",
      phone: "",
      message: "Hello",
    });
    expect(result.sent).toBe(false);
    expect(result.activationRequired).toBe(true);
    expect(result.channel).toBe("formsubmit");
  });

  it("sends developer + confirmation mail via Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_FROM = "Driver Hub <onboarding@resend.dev>";

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
    expect(calls[0].to).toEqual([mail.DEFAULT_SUPPORT_EMAIL]);
    expect(calls[0].reply_to).toBe("sam@example.com");
    expect(calls[0].html).toContain("Contact details");
    expect(calls[0].html).toContain("Scanner question");
    expect(calls[0].text).toContain("CONTACT DETAILS");
    expect(calls[1].to).toEqual(["sam@example.com"]);
    expect(calls[1].html).toContain("Support request received");
  });
});
