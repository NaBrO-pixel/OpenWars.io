import {
  MessageType,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import { InfrastructureExecution } from "@openfront/engine/execution/InfrastructureExecution";
import {
  developForNation,
  NationalEconomyExecution,
} from "@openfront/engine/execution/NationalEconomyExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { projectCost } from "@openfront/engine/game/Infrastructure";
import { economyStep } from "@openfront/engine/game/NationState";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

const infra = EconomyConfig.infrastructure;

let game: Game;
let me: Player;
let rival: Player;
let city: Unit;

function human(name: string): PlayerInfo {
  return new PlayerInfo(name, PlayerType.Human, name, name);
}

/** Ticks until the given number of economy steps has run. */
function seconds(n: number) {
  const target = (me.nation()?.steps ?? 0) + n;
  for (let i = 0; i < 20 * n + 20 && (me.nation()?.steps ?? 0) < target; i++) {
    game.executeNextTick();
  }
}

function intent(
  action: "start" | "cancel",
  kind: "roads" | "railways" | "industry" | "research",
  unitId = city.id(),
  who = me,
) {
  game.addExecution(new InfrastructureExecution(who, action, unitId, kind));
  game.executeNextTick();
}

beforeEach(async () => {
  game = await setup("plains", { ruleset: "openwars", instantBuild: true });
  me = game.addPlayer(human("me"));
  rival = game.addPlayer(human("rival"));
  for (let x = 5; x < 25; x++) {
    for (let y = 5; y < 25; y++) me.conquer(game.ref(x, y));
  }
  for (let x = 30; x < 40; x++) {
    for (let y = 5; y < 15; y++) rival.conquer(game.ref(x, y));
  }
  city = me.buildUnit(UnitType.City, game.ref(10, 10), {});
  game.addExecution(new NationalEconomyExecution());
  seconds(1); // the nation exists
  me.addGold(5_000_000n);
  me.nation()!.industry = 10_000;
});

describe("infrastructure costs", () => {
  test("rise with the level", () => {
    const l1 = projectCost("roads", 1);
    const l3 = projectCost("roads", 3);
    expect(l3.money).toBe(l1.money * 9);
    expect(l3.industry).toBe(l1.industry * 3);
    expect(l3.steps).toBe(l1.steps * 3);
  });
});

describe("infrastructure projects", () => {
  test("cost resources, take time, then raise the level", () => {
    const gold = me.gold();
    const industry = me.nation()!.industry;
    const cost = projectCost("research", 1);
    intent("start", "research");
    expect(gold - me.gold()).toBeGreaterThanOrEqual(
      BigInt(cost.money) - 10_000n,
    );
    expect(me.nation()!.view().projects).toEqual([
      expect.objectContaining({
        unitId: city.id(),
        kind: "research",
        level: 1,
      }),
    ]);
    expect(industry - me.nation()!.industry).toBeGreaterThanOrEqual(
      cost.industry - 100,
    );
    seconds(cost.steps - 1);
    expect(game.infrastructure().levels(city.id()).research).toBe(0);
    seconds(1);
    expect(game.infrastructure().levels(city.id()).research).toBe(1);
    expect(me.nation()!.view().sites[0].research).toBe(1);
  });

  test("announce completion to the owner", () => {
    intent("start", "roads");
    const messages: unknown[] = [];
    for (let i = 0; i < 20 * projectCost("roads", 1).steps + 40; i++) {
      const updates = game.executeNextTick();
      for (const u of updates[GameUpdateType.DisplayEvent]) messages.push(u);
      if (game.infrastructure().levels(city.id()).roads === 1) break;
    }
    expect(messages).toContainEqual(
      expect.objectContaining({
        messageType: MessageType.NATIONAL_DEVELOPMENT,
        playerID: me.smallID(),
      }),
    );
  });

  test("have real effects on the economy", () => {
    const base = {
      troops: 50_000,
      tiles: 10_000,
      tilesAMinuteAgo: 10_000,
      factoryLevels: 0,
      cityLevels: 0,
      structureLevels: 0,
      baseIncome: 1_000,
      money: 0n,
    };
    const none = economyStep(
      {
        ...base,
        infrastructure: { roads: 0, railways: 0, industry: 0, research: 0 },
      },
      600,
    );
    const built = economyStep(
      {
        ...base,
        infrastructure: { roads: 3, railways: 2, industry: 2, research: 3 },
      },
      600,
    );
    expect(built.industryRate - none.industryRate).toBe(
      2 * infra.industryPerIndustrialLevel,
    );
    expect(built.researchRate - none.researchRate).toBe(
      3 * infra.researchPerResearchLevel,
    );
    expect(built.expenses.territory).toBeLessThan(none.expenses.territory);
    expect(built.stabilityTarget).toBeGreaterThan(none.stabilityTarget);
    // Railways raise the money each unit of industry earns.
    expect(built.income.industry / built.industryRate).toBeGreaterThan(
      none.income.industry / Math.max(1, none.industryRate),
    );
  });

  test("cancelling refunds industry and most of the money", () => {
    const gold = me.gold();
    const industry = me.nation()!.industry;
    intent("start", "industry");
    intent("cancel", "industry");
    expect(me.nation()!.view().projects).toEqual([]);
    expect(me.nation()!.industry).toBeGreaterThanOrEqual(industry - 50);
    const lost = gold - me.gold();
    const cost = BigInt(projectCost("industry", 1).money);
    expect(lost).toBeLessThanOrEqual(cost / 4n + 10_000n);
  });
});

describe("infrastructure validation", () => {
  test("refuses each invalid request", () => {
    const infraMap = game.infrastructure();
    expect(infraMap.canStart(game, me, city.id(), "railways")).toBe(
      "needs_roads",
    );
    expect(infraMap.canStart(game, rival, city.id(), "roads")).toBe(
      "not_a_site",
    );
    expect(infraMap.canStart(game, me, 999_999, "roads")).toBe("not_a_site");
    intent("start", "roads");
    expect(infraMap.canStart(game, me, city.id(), "roads")).toBe(
      "already_building",
    );
    me.nation()!.industry = 0;
    expect(infraMap.canStart(game, me, city.id(), "research")).toBe(
      "cannot_afford",
    );
  });

  test("a refused intent changes nothing", () => {
    const gold = me.gold();
    intent("start", "roads", city.id(), rival); // not rival's city
    intent("start", "railways"); // needs roads first
    expect(game.infrastructure().projectsOf(me)).toHaveLength(0);
    expect(game.infrastructure().projectsOf(rival)).toHaveLength(0);
    expect(me.gold()).toBeGreaterThanOrEqual(gold);
  });

  test("limits projects at once, and levels to 3", () => {
    const cities = [city];
    for (const [x, y] of [
      [14, 14],
      [18, 18],
      [22, 22],
    ]) {
      cities.push(me.buildUnit(UnitType.City, game.ref(x, y), {}));
    }
    for (let i = 0; i < infra.maxProjects; i++) {
      intent("start", "research", cities[i].id());
    }
    expect(
      game.infrastructure().canStart(game, me, cities[3].id(), "research"),
    ).toBe("too_many_projects");
  });

  test("does nothing under the classic rules", async () => {
    const classic = await setup("plains");
    const p = classic.addPlayer(human("p"));
    for (let x = 5; x < 15; x++) p.conquer(classic.ref(x, 5));
    const c = p.buildUnit(UnitType.City, classic.ref(8, 5), {});
    expect(classic.infrastructure().canStart(classic, p, c.id(), "roads")).toBe(
      "not_openwars",
    );
  });
});

describe("infrastructure and territory", () => {
  test("a captured city keeps its infrastructure for the new owner", () => {
    intent("start", "roads");
    seconds(projectCost("roads", 1).steps + 1);
    expect(game.infrastructure().totalsFor(me).roads).toBe(1);
    rival.captureUnit(city);
    expect(game.infrastructure().totalsFor(me).roads).toBe(0);
    expect(game.infrastructure().totalsFor(rival).roads).toBe(1);
  });

  test("a project is lost when its city is lost", () => {
    intent("start", "research");
    rival.captureUnit(city);
    seconds(1);
    expect(game.infrastructure().projectsOf(me)).toHaveLength(0);
    expect(game.infrastructure().levels(city.id()).research).toBe(0);
  });
});

describe("infrastructure snapshots", () => {
  test("restore projects and levels, and keep building identically", async () => {
    intent("start", "roads");
    seconds(projectCost("roads", 1).steps + 1);
    intent("start", "industry");
    seconds(5);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.infrastructure().toData()).toEqual(
      game.infrastructure().toData(),
    );
    for (let i = 0; i < 400; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
    expect(restored.infrastructure().levels(city.id()).industry).toBe(1);
  });
});

describe("AI nations", () => {
  test("develop their cities when they can afford it", async () => {
    const g = await setup("plains", {
      ruleset: "openwars",
      instantBuild: true,
    });
    const nation = g.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "n"),
    );
    for (let x = 5; x < 25; x++) {
      for (let y = 5; y < 25; y++) nation.conquer(g.ref(x, y));
    }
    const c = nation.buildUnit(UnitType.City, g.ref(10, 10), {});
    g.addExecution(new NationalEconomyExecution());
    for (let i = 0; i < 20; i++) g.executeNextTick();
    nation.addGold(10_000_000n);
    nation.ensureNation().industry = 10_000;
    developForNation(g, nation);
    expect(g.infrastructure().projectsOf(nation)).toEqual([
      expect.objectContaining({ unitId: c.id(), kind: "industry" }),
    ]);
  });

  test("keep a reserve for their military", async () => {
    const g = await setup("plains", {
      ruleset: "openwars",
      instantBuild: true,
    });
    const nation = g.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "n"),
    );
    for (let x = 5; x < 25; x++) nation.conquer(g.ref(x, 5));
    nation.buildUnit(UnitType.City, g.ref(10, 5), {});
    nation.ensureNation().industry = 10_000;
    nation.removeGold(nation.gold());
    nation.addGold(BigInt(projectCost("industry", 1).money)); // not 2×
    developForNation(g, nation);
    expect(g.infrastructure().projectsOf(nation)).toHaveLength(0);
  });
});
