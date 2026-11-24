import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { EventConfig } from "@openfront/engine-lib/configuration/EventConfig";
import { TECHS } from "@openfront/engine-lib/configuration/TechConfig";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { Game } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";

async function world(config: object) {
  const game = await setup("plains", config);
  const p = (n: string, type = PlayerType.Human) =>
    game.addPlayer(
      new PlayerInfo(n, type, type === PlayerType.Human ? n : null, n),
    );
  const a = p("a");
  const b = p("b");
  const nation = p("n", PlayerType.Nation);
  const tribe = p("t", PlayerType.Bot);
  [a, b, nation, tribe].forEach((pl, i) => {
    for (let x = 0; x < 20; x++) {
      for (let y = i * 12; y < i * 12 + 12; y++) pl.conquer(game.ref(x, y));
    }
  });
  game.addExecution(new NationalEconomyExecution());
  return { game, a, b, nation, tribe };
}

function run(game: Game, n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

describe("Cold War", () => {
  test("nations can't attack each other, but can take tribes' land", async () => {
    const { game, a, b, nation, tribe } = await world({ ruleset: "coldwar" });
    expect(game.config().isOpenWars()).toBe(true);
    expect(a.canAttackPlayer(b)).toBe(false);
    expect(nation.canAttackPlayer(a)).toBe(false);
    expect(a.canAttackPlayer(tribe)).toBe(true);
  });

  test("has no territorial victory, but the other paths", async () => {
    const { game } = await world({ ruleset: "coldwar" });
    expect(game.config().victoryEnabled("territorial")).toBe(false);
    expect(game.config().victoryEnabled("technological")).toBe(true);
  });
});

describe("World Conquest", () => {
  test("allows war and every victory", async () => {
    const { game, a, b } = await world({ ruleset: "openwars" });
    expect(a.canAttackPlayer(b)).toBe(true);
    for (const v of [
      "territorial",
      "economic",
      "diplomatic",
      "technological",
    ]) {
      expect(game.config().victoryEnabled(v)).toBe(true);
    }
  });
});

describe("Sandbox", () => {
  test("world events can be switched off", async () => {
    const { game } = await world({
      ruleset: "sandbox",
      eventFrequencyPermille: 0,
    });
    run(game, EventConfig.firstEventTicks + 3_000);
    expect(game.worldEvents().views()).toEqual([]);
    expect(game.worldEvents().historyViews()).toEqual([]);
  });

  test("only the chosen victory conditions count", async () => {
    const { game, a } = await world({
      ruleset: "sandbox",
      victoryConditions: ["economic"],
    });
    run(game, 15);
    const n = a.nation()!;
    for (const t of TECHS.filter((x) => x.tier === 5)) n.techs.push(t.id);
    run(game, 30);
    expect(game.getWinner()).toBeNull();
    expect(n.view().victory.map((v) => v.kind)).toEqual(["economic"]);
  });

  test("classic games are not OpenWars", async () => {
    const { game, a, b } = await world({});
    expect(game.config().isOpenWars()).toBe(false);
    expect(a.canAttackPlayer(b)).toBe(true);
  });
});
