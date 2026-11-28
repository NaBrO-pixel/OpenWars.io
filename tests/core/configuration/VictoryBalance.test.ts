import { influenceCap } from "@openfront/engine-lib/configuration/DiplomacyConfig";
import {
  TECHS,
  VICTORY_BRANCHES,
} from "@openfront/engine-lib/configuration/TechConfig";
import {
  diplomaticPartnersNeeded,
  economicShareNeeded,
  VictoryConfig,
} from "@openfront/engine-lib/configuration/VictoryConfig";

// Balance guard (docs/OpenWars2.md, milestone 8): every victory path should
// take 10–30 minutes. These bounds come from the configs, so a retune that
// makes a path trivially fast or unreachable fails here.
describe("victory pacing", () => {
  test("technological victory: 10–30 minutes of research", () => {
    // The military branch doesn't count toward the technological victory.
    const needed = TECHS.filter((t) => VICTORY_BRANCHES.includes(t.branch));
    const seconds = needed.reduce((s, t) => s + t.steps, 0);
    expect(seconds).toBeGreaterThanOrEqual(10 * 60);
    expect(seconds).toBeLessThanOrEqual(30 * 60);
    // The points it needs, spread over that time, are a developed
    // nation's rate (a few cities and research centres), not a fantasy.
    const points = needed.reduce((s, t) => s + t.research, 0);
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

describe("victory thresholds scale with the game", () => {
  test("economic: twice a fair share, never under 30%", () => {
    expect(economicShareNeeded(3)).toBe(667);
    expect(economicShareNeeded(4)).toBe(500);
    expect(economicShareNeeded(7)).toBe(300);
    expect(economicShareNeeded(39)).toBe(300);
  });

  test("diplomatic: 40% of the others, never under two partners", () => {
    expect(diplomaticPartnersNeeded(2)).toBe(2);
    expect(diplomaticPartnersNeeded(3)).toBe(2);
    expect(diplomaticPartnersNeeded(10)).toBe(4);
    expect(diplomaticPartnersNeeded(38)).toBe(16);
  });

  test("influence lets small games reach it from about minute 8", () => {
    expect(influenceCap(2, 0)).toBe(1);
    expect(influenceCap(2, 8 * 600)).toBe(2);
    expect(influenceCap(38, 8 * 600)).toBe(7);
    expect(influenceCap(38, 20 * 600)).toBe(16);
  });
});
