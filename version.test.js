const { formatVersionLabel, HAULAGE_PR_NUMBER } = require("./lib/version");

describe("formatVersionLabel", () => {
  it("maps the current PR constant (this PR is #75 → Version .25)", () => {
    expect(HAULAGE_PR_NUMBER).toBe(75);
    expect(formatVersionLabel(47)).toBe("Version .47");
    expect(formatVersionLabel(48)).toBe("Version .48");
    expect(formatVersionLabel(49)).toBe("Version .49");
    expect(formatVersionLabel(50)).toBe("Version 1.0");
    expect(formatVersionLabel(51)).toBe("Version .1");
    expect(formatVersionLabel(52)).toBe("Version .2");
    expect(formatVersionLabel(53)).toBe("Version .3");
    expect(formatVersionLabel(54)).toBe("Version .4");
    expect(formatVersionLabel(55)).toBe("Version .5");
    expect(formatVersionLabel(56)).toBe("Version .6");
    expect(formatVersionLabel(57)).toBe("Version .7");
    expect(formatVersionLabel(58)).toBe("Version .8");
    expect(formatVersionLabel(59)).toBe("Version .9");
    expect(formatVersionLabel(60)).toBe("Version .10");
    expect(formatVersionLabel(61)).toBe("Version .11");
    expect(formatVersionLabel(62)).toBe("Version .12");
    expect(formatVersionLabel(63)).toBe("Version .13");
    expect(formatVersionLabel(64)).toBe("Version .14");
    expect(formatVersionLabel(65)).toBe("Version .15");
    expect(formatVersionLabel(66)).toBe("Version .16");
    expect(formatVersionLabel(67)).toBe("Version .17");
    expect(formatVersionLabel(68)).toBe("Version .18");
    expect(formatVersionLabel(69)).toBe("Version .19");
    expect(formatVersionLabel(70)).toBe("Version .20");
    expect(formatVersionLabel(71)).toBe("Version .21");
    expect(formatVersionLabel(72)).toBe("Version .22");
    expect(formatVersionLabel(73)).toBe("Version .23");
    expect(formatVersionLabel(74)).toBe("Version .24");
    expect(formatVersionLabel(75)).toBe("Version .25");
  });

  it("uses Version X.0 on every 50th PR, then restarts .1", () => {
    expect(formatVersionLabel(50)).toBe("Version 1.0");
    expect(formatVersionLabel(51)).toBe("Version .1");
    expect(formatVersionLabel(99)).toBe("Version .49");
    expect(formatVersionLabel(100)).toBe("Version 2.0");
    expect(formatVersionLabel(101)).toBe("Version .1");
  });
});
