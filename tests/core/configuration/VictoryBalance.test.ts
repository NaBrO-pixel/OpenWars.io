import { TECHS } from "@openfront/engine-lib/configuration/TechConfig";
import { VictoryConfig } from "@openfront/engine-lib/configuration/VictoryConfig";

// Balance guard (docs/OpenWars2.md, milestone 8): every victory path should
// take 10–30 minutes. These bounds come from the configs, so a retune that
// makes a path trivially fast or unreachable fails here.
describe("victory pacing", () => {
  test("technological victory: 10–30 minutes of research", () => {
    const seconds = TECHS.reduce((s, t) => s + t.steps, 0);
    expect(seconds).toBeGreaterThanOrEqual(10 * 60);
    expect(seconds).toBeLessThanOrEqual(30 * 60);
    // The points it needs, spread over that time, are a developed
    // nation's rate (a few cities and research centres), not a fantasy.
    const points = TECHS.reduce((s, t) => s + t.research, 0);
    const perSecond = points / seconds;
    expect(perSecond).toBeGreaterThan(1);
    expect(perSecond).toBeLessThan(10);
  });

  test("economic and diplomatic victories need a sustained lead", () => {
    for (const c of [VictoryConfig.economic, VictoryConfig.diplomatic]) {
      expect(c.holdSteps).toBeGreaterThanOrEqual(60);
      expect(c.minNations).toBeGreaterThanOrEqual(3);
    }
    expect(VictoryConfig.economic.sharePermille).toBeLessThan(500);
    expect(VictoryConfig.diplomatic.influencePermille).toBeLessThan(1000);
  });
});
