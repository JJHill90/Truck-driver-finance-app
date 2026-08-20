const { formatVersionLabel, HAULAGE_PR_NUMBER } = require("./lib/version");

describe("formatVersionLabel", () => {
  it("uses .1–.50 then rounds to 1.00 and climbs 1.01…1.50 → 2.00", () => {
    expect(formatVersionLabel(1)).toBe("Version .1");
    expect(formatVersionLabel(49)).toBe("Version .49");
    expect(formatVersionLabel(50)).toBe("Version .50");
    expect(formatVersionLabel(51)).toBe("Version 1.00");
    expect(formatVersionLabel(52)).toBe("Version 1.01");
    expect(formatVersionLabel(53)).toBe("Version 1.02");
    expect(formatVersionLabel(100)).toBe("Version 1.49");
    expect(formatVersionLabel(101)).toBe("Version 1.50");
    expect(formatVersionLabel(102)).toBe("Version 2.00");
    expect(formatVersionLabel(103)).toBe("Version 2.01");
    expect(formatVersionLabel(104)).toBe("Version 2.02");
    expect(formatVersionLabel(105)).toBe("Version 2.03");
    expect(formatVersionLabel(152)).toBe("Version 2.50");
    expect(formatVersionLabel(153)).toBe("Version 3.00");
  });

  it("maps the current PR constant (this PR is #105 → Version 2.03)", () => {
    expect(HAULAGE_PR_NUMBER).toBe(105);
    expect(formatVersionLabel(105)).toBe("Version 2.03");
  });
});
