import {
  GameMode,
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  defencePermille,
  MilitaryConfig,
  supplyPermille,
} from "@openfront/engine-lib/configuration/MilitaryConfig";
import { TECHS } from "@openfront/engine-lib/configuration/TechConfig";
import { VictoryConfig } from "@openfront/engine-lib/configuration/VictoryConfig";
import {
  type AttackLogicInput,
  EngineConfig,
} from "@openfront/engine/configuration/EngineConfig";
import { DiplomacyExecution } from "@openfront/engine/execution/DiplomacyExecution";
import { MobiliseExecution } from "@openfront/engine/execution/MobiliseExecution";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { economyStep } from "@openfront/engine/game/NationState";
import {
  evaluateVictory,
  VICTORY_CONDITIONS,
} from "@openfront/engine/game/Victory";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

async function world(n = 3, config = {}) {
  const game = await setup("plains", { ruleset: "openwars", ...config });
  const players: Player[] = [];
  for (let i = 0; i < n; i++) {
    const p = game.addPlayer(
      new PlayerInfo(`p${i}`, PlayerType.Human, `c${i}`, `p${i}`),
    );
    for (let x = 0; x < 20; x++) {
      for (let y = i * 15; y < i * 15 + 15; y++) p.conquer(game.ref(x, y));
    }
    players.push(p);
  }
  game.addExecution(new NationalEconomyExecution());
  return { game, players };
}

function seconds(game: Game, p: Player, n: number) {
  const target = (p.nation()?.steps ?? 0) + n;
  for (let i = 0; i < 20 * n + 20 && (p.nation()?.steps ?? 0) < target; i++) {
    game.executeNextTick();
  }
}

const base = {
  troops: 100_000,
  tiles: 5_000,
  tilesAMinuteAgo: 5_000,
  factoryLevels: 0,
  cityLevels: 0,
  structureLevels: 0,
  baseIncome: 1_000,
  money: 0n,
  infrastructure: { roads: 0, railways: 0, industry: 0, research: 0 },
};

describe("mobilisation", () => {
  test("costs army upkeep that grows with the level", () => {
    const upkeep = (mobilisation: number) =>
      economyStep({ ...base, mobilisation }, 700).expenses.military;
    expect(upkeep(0)).toBe(0);
    expect(upkeep(1)).toBeLessThan(upkeep(2));
    expect(upkeep(2)).toBeLessThan(upkeep(3));
    expect(upkeep(3)).toBe(
      (100_000 * MilitaryConfig.upkeepPerThousandTroops[3]) / 1000,
    );
    // Total war strains stability.
    expect(
      economyStep({ ...base, mobilisation: 3 }, 700).stabilityTarget,
    ).toBeLessThan(
      economyStep({ ...base, mobilisation: 1 }, 700).stabilityTarget,
    );
  });

  test("scales troop growth, set through an intent", async () => {
    const { game, players } = await world(1);
    const [p] = players;
    seconds(game, p, 1);
    const growth = () => {
      p.removeTroops(p.troops() - 10_000);
      const before = p.troops();
      new PlayerExecution(p).init(game, game.ticks());
      const exec = new PlayerExecution(p);
      exec.init(game, game.ticks());
      exec.tick(game.ticks());
      return p.troops() - before;
    };
    const standard = growth();
    game.addExecution(new MobiliseExecution(p, 3));
    game.executeNextTick();
    expect(p.nation()!.mobilisation).toBe(3);
    expect(growth()).toBeGreaterThan(standard);
    game.addExecution(new MobiliseExecution(p, 9)); // invalid: ignored
    game.executeNextTick();
    expect(p.nation()!.mobilisation).toBe(3);
  });
});

describe("supply and defence", () => {
  test("supply comes from roads and railways, relative to size", () => {
    expect(supplyPermille({ roads: 0, railways: 0, tiles: 3_000 })).toBe(500);
    expect(
      supplyPermille({ roads: 2, railways: 1, tiles: 3_000 }),
    ).toBeGreaterThan(supplyPermille({ roads: 2, railways: 1, tiles: 30_000 }));
    expect(supplyPermille({ roads: 30, railways: 30, tiles: 3_000 })).toBe(
      1000,
    );
  });

  test("poor supply and a developed defender cost the attacker more", async () => {
    const { game } = await world(1);
    // The test config stubs combat; use the real formula.
    const real = (i: AttackLogicInput) =>
      EngineConfig.prototype.attackLogic.call(game.config(), i);
    const input = {
      terrain: TerrainType.Plains,
      attackTroops: 50_000,
      attacker: { type: PlayerType.Human, numTiles: 1_000 },
      defender: {
        type: PlayerType.Human,
        numTiles: 1_000,
        troops: 50_000,
        isTraitor: false,
        isDisconnectedTeammate: false,
      },
      defenderHasDefensePost: false,
      falloutRatio: null,
      borderSize: 10,
    };
    const classic = real(input).attackerTroopLoss;
    const supplied = real({
      ...input,
      attackerSupplyPermille: 1000,
    }).attackerTroopLoss;
    const starved = real({
      ...input,
      attackerSupplyPermille: 500,
    }).attackerTroopLoss;
    const fortified = real({
      ...input,
      attackerSupplyPermille: 1000,
      defenderDefencePermille: defencePermille(20),
    }).attackerTroopLoss;
    expect(supplied).toBeCloseTo(classic);
    expect(starved).toBeCloseTo(classic * 1.5);
    expect(fortified).toBeGreaterThan(supplied);
  });
});

describe("victory conditions", () => {
  test("are a list: every kind has a condition", () => {
    expect(VICTORY_CONDITIONS.map((c) => c.kind)).toEqual([
      "territorial",
      "economic",
      "diplomatic",
      "technological",
    ]);
  });

  test("technological: all advanced specialisations win the match", async () => {
    const { game, players } = await world(3);
    seconds(game, players[0], 2);
    const n = players[1].nation()!;
    for (const t of TECHS.filter((x) => x.tier === 5)) n.techs.push(t.id);
    const wins: unknown[] = [];
    for (let i = 0; i < 15; i++) {
      wins.push(...game.executeNextTick()[GameUpdateType.Win]);
    }
    expect(wins).toEqual([
      expect.objectContaining({ victory: "technological" }),
    ]);
    expect(game.getWinner()).toBe(players[1]);
  });

  test("economic: must be held, so a spike doesn't win", async () => {
    const { game, players } = await world(3);
    seconds(game, players[0], 2);
    // The richest by far: industry money dwarfs the others.
    const rich = players[0];
    for (let i = 0; i < 12; i++) {
      rich.buildUnit(
        UnitType.Factory,
        game.ref(1 + (i % 6) * 3, 2 + Math.floor(i / 6) * 6),
        {},
      );
    }
    seconds(game, rich, 2);
    const progress = () =>
      rich
        .nation()!
        .view()
        .victory.find((v) => v.kind === "economic")!;
    expect(progress().progress).toBeGreaterThanOrEqual(1000);
    expect(game.getWinner()).toBeNull();
    seconds(game, rich, VictoryConfig.economic.holdSteps + 2);
    expect(game.getWinner()).toBe(rich);
  });

  test("diplomatic: influence over most nations, with a good name", async () => {
    const { game, players } = await world(4);
    seconds(game, players[0], 2);
    const [me, ...others] = players;
    // Influence grows with time: in a game of four, a second partner is
    // allowed from minute 17, and two of three is past the 40% needed.
    while (game.diplomacy().influenceCap(game, me) < 2) game.executeNextTick();
    expect(game.ticks()).toBeGreaterThanOrEqual(17 * 600);
    for (const o of others.slice(0, 2)) {
      game.addExecution(new DiplomacyExecution(me, "propose", "trade", o.id()));
      game.executeNextTick();
      game.addExecution(new DiplomacyExecution(o, "accept", "trade", me.id()));
      game.executeNextTick();
    }
    seconds(game, me, 1);
    const view = () =>
      me
        .nation()!
        .view()
        .victory.find((v) => v.kind === "diplomatic")!;
    expect(view().progress).toBeGreaterThanOrEqual(1000);
    // A bad name blocks it.
    game.diplomacy().penalize(me, 50);
    seconds(game, me, 1);
    expect(view().progress).toBeLessThan(1000);
    expect(view().held).toBe(0);
  });

  test("a team game is won by the winner's team", async () => {
    const { game, players } = await world(4, {
      gameMode: GameMode.Team,
      playerTeams: 2,
    });
    seconds(game, players[0], 2);
    const n = players[2].nation()!;
    for (const t of TECHS.filter((x) => x.tier === 5)) n.techs.push(t.id);
    seconds(game, players[0], 2);
    expect(game.getWinner()).toBe(players[2].team());
  });

  test("evaluation is the same after a snapshot", async () => {
    const { game, players } = await world(3);
    game.addExecution(new MobiliseExecution(players[0], 2));
    seconds(game, players[0], 5);
    const { restored } = await roundTrip(game, "plains");
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
    expect(evaluateVictory(restored)).toEqual(evaluateVictory(game));
  });
});
