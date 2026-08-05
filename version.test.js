const { formatVersionLabel, HAULAGE_PR_NUMBER } = require("./lib/version");

describe("formatVersionLabel", () => {
  it("maps current PR constant into the .N form before 50", () => {
    expect(HAULAGE_PR_NUMBER).toBe(48);
    expect(formatVersionLabel(47)).toBe("Version .47");
    expect(formatVersionLabel(48)).toBe("Version .48");
  });

  it("uses Version X.0 on every 50th PR, then restarts .1", () => {
    expect(formatVersionLabel(50)).toBe("Version 1.0");
    expect(formatVersionLabel(51)).toBe("Version .1");
    expect(formatVersionLabel(99)).toBe("Version .49");
    expect(formatVersionLabel(100)).toBe("Version 2.0");
    expect(formatVersionLabel(101)).toBe("Version .1");
  });
});
