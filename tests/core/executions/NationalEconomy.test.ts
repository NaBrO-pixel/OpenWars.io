import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { diffPlayerUpdate } from "@openfront/engine/game/GameUpdateUtils";
import {
  type EconomyInput,
  economyStep,
  NationState,
  stepStability,
} from "@openfront/engine/game/NationState";
import type { PlayerImpl } from "@openfront/engine/game/PlayerImpl";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

const cfg = EconomyConfig;

function input(over: Partial<EconomyInput> = {}): EconomyInput {
  return {
    troops: 50_000,
    tiles: 1_000,
    tilesAMinuteAgo: 1_000,
    factoryLevels: 0,
    cityLevels: 0,
    structureLevels: 0,
    baseIncome: 1_000,
    money: 0n,
    infrastructure: { roads: 0, railways: 0, industry: 0, research: 0 },
    ...over,
  };
}

describe("economy rules", () => {
  test("tax follows population and stability", () => {
    const full = economyStep(input(), 1000);
    expect(full.income.tax).toBe(1_000); // 50k troops × 20 per 1k
    const none = economyStep(input(), 0);
    expect(none.income.tax).toBe(400); // taxAtZeroStabilityPermille
    expect(economyStep(input({ troops: 100_000 }), 1000).income.tax).toBe(
      2_000,
    );
  });

  test("land beyond the free allowance costs upkeep", () => {
    expect(
      economyStep(input({ tiles: cfg.freeTiles }), 500).expenses.territory,
    ).toBe(0);
    expect(
      economyStep(input({ tiles: cfg.freeTiles + 10_000 }), 500).expenses
        .territory,
    ).toBe(800);
  });

  test("factories and land produce industry; cities produce research", () => {
    const r = economyStep(
      input({ factoryLevels: 3, cityLevels: 2, tiles: 2_000 }),
      500,
    );
    expect(r.industryRate).toBe(3 * 4 + 4);
    expect(r.researchRate).toBe(1 + 2);
    expect(r.income.industry).toBe(r.industryRate * cfg.moneyPerIndustry);
  });

  test("development raises stability; fast growth and deficits lower it", () => {
    const calm = economyStep(input(), 500).stabilityTarget;
    expect(calm).toBe(cfg.stabilityBase);
    expect(
      economyStep(input({ structureLevels: 10 }), 500).stabilityTarget,
    ).toBe(cfg.stabilityBase + 80);
    // Doubled in a minute: the growth penalty, capped.
    expect(
      economyStep(input({ tiles: 20_000, tilesAMinuteAgo: 10_000 }), 500)
        .stabilityTarget,
    ).toBe(cfg.stabilityBase - cfg.stabilityGrowthPenaltyCap);
    // Growing out of a small spawn is measured against the free heartland.
    expect(
      economyStep(input({ tiles: 500, tilesAMinuteAgo: 50 }), 500)
        .stabilityTarget,
    ).toBe(cfg.stabilityBase - Math.floor((150 * 40) / 100));
    // Upkeep the treasury can't cover.
    const broke = input({
      tiles: 100_000,
      tilesAMinuteAgo: 100_000,
      troops: 0,
      baseIncome: 0,
    });
    expect(economyStep(broke, 500).stabilityTarget).toBe(
      cfg.stabilityBase - cfg.stabilityDeficitPenalty,
    );
    // The same upkeep with savings to cover it is no deficit.
    expect(
      economyStep({ ...broke, money: 1_000_000n }, 500).stabilityTarget,
    ).toBe(cfg.stabilityBase);
  });

  test("a small, developed nation can out-earn a sprawling one", () => {
    const small = economyStep(
      input({
        tiles: 2_500,
        troops: 60_000,
        factoryLevels: 6,
        structureLevels: 10,
      }),
      900,
    );
    const sprawl = economyStep(
      input({ tiles: 40_000, troops: 90_000, tilesAMinuteAgo: 30_000 }),
      300,
    );
    const net = (r: typeof small) =>
      r.income.tax +
      r.income.industry -
      r.expenses.territory -
      r.expenses.structures;
    expect(net(small)).toBeGreaterThan(net(sprawl));
  });

  test("stability moves gradually toward its target", () => {
    expect(stepStability(500, 700)).toBe(500 + cfg.stabilityStep);
    expect(stepStability(500, 300)).toBe(500 - cfg.stabilityStep);
    expect(stepStability(500, 503)).toBe(503);
  });

  test("stockpiles are spent only when there is enough", () => {
    const n = new NationState();
    n.industry = 50;
    n.research = 5;
    expect(n.spend(60, 0)).toBe(false);
    expect(n.industry).toBe(50);
    expect(n.spend(40, 5)).toBe(true);
    expect([n.industry, n.research]).toEqual([10, 0]);
  });
});

describe("national economy in a game", () => {
  let game: Game;
  let me: Player;
  let tribe: Player;

  /** Ticks until one economy step has run; the gold just before it. */
  function untilStep(): bigint {
    const steps = me.nation()?.steps ?? 0;
    for (let i = 0; i < 20; i++) {
      const before = me.gold();
      game.executeNextTick();
      if ((me.nation()?.steps ?? 0) > steps) return before;
    }
    throw new Error("no economy step in 20 ticks");
  }

  beforeEach(async () => {
    game = await setup("plains", { ruleset: "openwars" });
    me = game.addPlayer(new PlayerInfo("me", PlayerType.Human, "c1", "me"));
    tribe = game.addPlayer(new PlayerInfo("tribe", PlayerType.Bot, null, "t"));
    for (let x = 5; x < 25; x++) {
      for (let y = 5; y < 25; y++) me.conquer(game.ref(x, y));
    }
    tribe.conquer(game.ref(40, 40));
    game.addExecution(new NationalEconomyExecution());
  });

  test("the ruleset flag turns it on", () => {
    expect(game.config().isOpenWars()).toBe(true);
  });

  test("runs once a second for nations, not tribes", () => {
    for (let i = 0; i < 31; i++) game.executeNextTick();
    const nation = me.nation()!;
    expect(nation).not.toBeNull();
    expect(nation.steps).toBe(3);
    expect(nation.research).toBe(3 * cfg.researchBase);
    expect(tribe.nation()).toBeNull();
  });

  test("pays its net into the treasury", () => {
    me.buildUnit(UnitType.Factory, game.ref(10, 10), {});
    untilStep();
    const before = untilStep();
    const v = me.nation()!.view();
    const expected =
      v.income.tax +
      v.income.industry -
      v.expenses.territory -
      v.expenses.structures -
      v.expenses.military;
    expect(me.gold() - before).toBe(BigInt(expected));
    expect(v.industryRate).toBeGreaterThan(0);
  });

  test("the client gets the economy, and only when it changes", () => {
    untilStep();
    const sent = (me as PlayerImpl).lastSentUpdate!;
    expect(sent.nation?.research).toBe(cfg.researchBase);
    // The view is one object until the figures change, so it diffs away.
    expect(sent.nation).toBe(me.nation()!.view());
    expect(diffPlayerUpdate(sent, { ...sent })).toBeNull();
    untilStep();
    const next = (me as PlayerImpl).lastSentUpdate!;
    expect(next.nation).not.toBe(sent.nation);
    expect(diffPlayerUpdate(sent, next)?.nation?.research).toBe(
      2 * cfg.researchBase,
    );
  });

  test("survives a snapshot and keeps ticking identically", async () => {
    for (let i = 0; i < 25; i++) game.executeNextTick();
    const { restored } = await roundTrip(game, "plains");
    expect(restored.player(me.id()).nation()?.toData()).toEqual(
      me.nation()?.toData(),
    );
    for (let i = 0; i < 30; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });
});

describe("classic rules", () => {
  test("have no economy", async () => {
    const game = await setup("plains");
    expect(game.config().isOpenWars()).toBe(false);
    const p = game.addPlayer(new PlayerInfo("p", PlayerType.Human, "c", "p"));
    expect(p.nation()).toBeNull();
    expect(p.toUpdate()?.nation).toBeUndefined();
  });
});
