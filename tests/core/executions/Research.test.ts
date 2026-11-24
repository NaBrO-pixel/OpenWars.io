import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import { projectCost } from "@openfront/engine-lib/configuration/InfrastructureRules";
import {
  NO_TECH,
  TECH_BRANCHES,
  TECH_BY_ID,
  TECHS,
  techModifiers,
} from "@openfront/engine-lib/configuration/TechConfig";
import {
  NationalEconomyExecution,
  researchForNation,
} from "@openfront/engine/execution/NationalEconomyExecution";
import { ResearchExecution } from "@openfront/engine/execution/ResearchExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { economyStep } from "@openfront/engine/game/NationState";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

let game: Game;
let me: Player;

function seconds(n: number) {
  const target = (me.nation()?.steps ?? 0) + n;
  for (let i = 0; i < 20 * n + 20 && (me.nation()?.steps ?? 0) < target; i++) {
    game.executeNextTick();
  }
}

function research(action: "start" | "cancel", tech: string, who = me) {
  game.addExecution(new ResearchExecution(who, action, tech));
  game.executeNextTick();
}

beforeEach(async () => {
  game = await setup("plains", { ruleset: "openwars", instantBuild: true });
  me = game.addPlayer(new PlayerInfo("me", PlayerType.Human, "me", "me"));
  for (let x = 5; x < 25; x++) {
    for (let y = 5; y < 25; y++) me.conquer(game.ref(x, y));
  }
  game.addExecution(new NationalEconomyExecution());
  seconds(1);
  me.addGold(10_000_000n);
  me.nation()!.research = 5_000;
});

describe("the tech tree", () => {
  test("has three branches of five, each a chain from basic to advanced", () => {
    for (const branch of TECH_BRANCHES) {
      const techs = TECHS.filter((t) => t.branch === branch);
      expect(techs.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5]);
      for (const t of techs.slice(1)) {
        expect(t.requires).toEqual([techs[t.tier - 2].id]);
      }
      // Later technologies cost more and take longer.
      for (let i = 1; i < techs.length; i++) {
        expect(techs[i].research).toBeGreaterThan(techs[i - 1].research);
        expect(techs[i].steps).toBeGreaterThan(techs[i - 1].steps);
      }
    }
  });

  test("every technology has a real effect", () => {
    for (const t of TECHS) {
      expect(techModifiers([t.id])).not.toEqual(NO_TECH);
    }
  });

  test("effects change the economy", () => {
    const base = {
      troops: 50_000,
      tiles: 10_000,
      tilesAMinuteAgo: 10_000,
      factoryLevels: 4,
      cityLevels: 3,
      structureLevels: 7,
      baseIncome: 1_000,
      money: 0n,
      infrastructure: { roads: 0, railways: 0, industry: 2, research: 2 },
    };
    const none = economyStep(base, 700);
    const all = economyStep(base, 700, techModifiers(TECHS.map((t) => t.id)));
    expect(all.industryRate).toBeGreaterThan(none.industryRate);
    expect(all.researchRate).toBeGreaterThan(none.researchRate);
    expect(all.income.tax).toBeGreaterThan(none.income.tax);
    expect(all.income.industry).toBeGreaterThan(none.income.industry);
    expect(all.expenses.territory).toBeLessThan(none.expenses.territory);
    expect(all.stabilityTarget).toBeGreaterThan(none.stabilityTarget);
  });
});

describe("researching", () => {
  test("costs research and money, takes time, then applies its effect", () => {
    for (const x of [6, 10, 14, 18, 22]) {
      me.buildUnit(UnitType.City, game.ref(x, 8), {});
    }
    seconds(1);
    const t = TECH_BY_ID.get("research_labs")!;
    const points = me.nation()!.research;
    const gold = me.gold();
    research("start", t.id);
    expect(me.nation()!.researching?.id).toBe(t.id);
    expect(points - me.nation()!.research).toBeGreaterThanOrEqual(
      t.research - 50,
    );
    expect(gold - me.gold()).toBeGreaterThanOrEqual(BigInt(t.money) - 20_000n);
    const before = me.nation()!.view().researchRate;
    seconds(t.steps + 1);
    expect(me.nation()!.hasTech(t.id)).toBe(true);
    expect(me.nation()!.researching).toBeNull();
    expect(me.nation()!.view().researchRate).toBeGreaterThan(before);
  });

  test("refuses what can't be researched", () => {
    research("start", "heavy_industry"); // locked
    research("start", "no_such_tech"); // unknown
    expect(me.nation()!.researching).toBeNull();
    research("start", "assembly_lines");
    research("start", "civil_administration"); // busy
    expect(me.nation()!.researching?.id).toBe("assembly_lines");
  });

  test("refuses what can't be afforded", () => {
    me.nation()!.research = 0;
    research("start", "assembly_lines");
    expect(me.nation()!.researching).toBeNull();
  });

  test("cancelling refunds most of the cost", () => {
    const points = me.nation()!.research;
    research("start", "civil_administration");
    research("cancel", "civil_administration");
    expect(me.nation()!.researching).toBeNull();
    const t = TECH_BY_ID.get("civil_administration")!;
    expect(points - me.nation()!.research).toBeLessThanOrEqual(
      t.research - Math.floor((t.research * 750) / 1000) + 50,
    );
  });

  test("is off under the classic rules", async () => {
    const classic = await setup("plains");
    const p = classic.addPlayer(
      new PlayerInfo("p", PlayerType.Human, "p", "p"),
    );
    p.ensureNation().research = 1_000;
    classic.addExecution(new ResearchExecution(p, "start", "assembly_lines"));
    classic.executeNextTick();
    expect(p.nation()!.researching).toBeNull();
  });

  test("research changes infrastructure: more projects, cheaper industry", () => {
    const n = me.nation()!;
    n.techs.push("standardised_parts", "project_management");
    n.invalidate();
    // Recompute modifiers.
    (n as unknown as { modifiers: null }).modifiers = null;
    n.industry = 10_000;
    const cities = [5, 10, 15, 20].map((x) =>
      me.buildUnit(UnitType.City, game.ref(x, 20), {}),
    );
    for (const c of cities) {
      expect(game.infrastructure().start(game, me, c.id(), "research")).toBe(
        null,
      );
    }
    expect(game.infrastructure().projectsOf(me)).toHaveLength(
      EconomyConfig.infrastructure.maxProjects + 1,
    );
    expect(projectCost("roads", 1, 250).industry).toBe(45);
  });
});

describe("research snapshots", () => {
  test("restore research in progress and keep going identically", async () => {
    research("start", "assembly_lines");
    seconds(10);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player(me.id()).nation()?.toData()).toEqual(
      me.nation()?.toData(),
    );
    for (let i = 0; i < 400; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
    expect(restored.player(me.id()).nation()?.hasTech("assembly_lines")).toBe(
      true,
    );
  });
});

describe("AI nations research", () => {
  test("the first technology they can afford", () => {
    const nation = game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "n"),
    );
    nation.conquer(game.ref(40, 40));
    nation.ensureNation().research = 1_000;
    nation.addGold(1_000_000n);
    researchForNation(game, nation);
    expect(nation.nation()!.researching).not.toBeNull();
  });
});
