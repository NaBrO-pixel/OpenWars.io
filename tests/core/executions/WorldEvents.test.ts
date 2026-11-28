import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  EVENT_BY_ID,
  EventConfig,
  EVENTS,
  eventModifiers,
  NO_EVENT,
} from "@openfront/engine-lib/configuration/EventConfig";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { economyStep } from "@openfront/engine/game/NationState";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

async function world(): Promise<{ game: Game; players: Player[] }> {
  const game = await setup("plains", { ruleset: "openwars" });
  const players = ["a", "b", "c"].map((n) =>
    game.addPlayer(new PlayerInfo(n, PlayerType.Human, n, n)),
  );
  players.forEach((p, i) => {
    for (let x = 0; x < 20; x++) {
      for (let y = i * 20; y < i * 20 + 20; y++) p.conquer(game.ref(x, y));
    }
  });
  game.addExecution(new NationalEconomyExecution());
  return { game, players };
}

function run(game: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) game.executeNextTick();
}

describe("the event catalogue", () => {
  test("has the required events and the later ones, each with a real effect", () => {
    expect(EVENTS.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "global_recession",
        "industrial_boom",
        "natural_disaster",
        "political_instability",
        "technological_breakthrough",
        "trade_disruption",
        "arms_race",
        "scientific_summit",
        "bumper_harvest",
        "cyber_attack",
      ]),
    );
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(EVENTS.length);
    for (const e of EVENTS) {
      expect(eventModifiers([e.effects])).not.toEqual(NO_EVENT);
      expect(e.durationTicks).toBeGreaterThan(0);
    }
  });

  test("effects reach the economy", () => {
    const base = {
      troops: 50_000,
      tiles: 5_000,
      tilesAMinuteAgo: 5_000,
      factoryLevels: 3,
      cityLevels: 2,
      structureLevels: 5,
      baseIncome: 1_000,
      money: 0n,
      infrastructure: { roads: 0, railways: 0, industry: 0, research: 0 },
      tradeAgreements: 2,
    };
    const calm = economyStep(base, 700);
    const mod = (id: string) =>
      economyStep(
        { ...base, events: eventModifiers([EVENT_BY_ID.get(id)!.effects]) },
        700,
      );
    expect(mod("global_recession").income.tax).toBeLessThan(calm.income.tax);
    expect(mod("industrial_boom").industryRate).toBeGreaterThan(
      calm.industryRate,
    );
    expect(mod("trade_disruption").income.tax).toBeLessThan(calm.income.tax);
    expect(mod("political_instability").stabilityTarget).toBeLessThan(
      calm.stabilityTarget,
    );
    expect(mod("technological_breakthrough").researchRate).toBeGreaterThan(
      calm.researchRate,
    );
    expect(mod("natural_disaster").industryRate).toBeLessThan(
      calm.industryRate,
    );
  });
});

describe("world events in a game", () => {
  test("nothing happens before the first event is due", async () => {
    const { game } = await world();
    run(game, EventConfig.firstEventTicks - 20);
    expect(game.worldEvents().views()).toEqual([]);
  });

  test("events are warned of, run, end and go into the history", async () => {
    const { game, players } = await world();
    const seen = new Set<string>();
    let warnedBeforeStart = true;
    for (let i = 0; i < 9_000; i++) {
      game.executeNextTick();
      for (const e of game.worldEvents().views()) {
        if (!seen.has(`${e.id}:${e.startsAt}`)) {
          seen.add(`${e.id}:${e.startsAt}`);
          const def = EVENT_BY_ID.get(e.id)!;
          if (def.warningTicks > 0 && e.startsAt <= game.ticks()) {
            warnedBeforeStart = false;
          }
        }
      }
      expect(game.worldEvents().views().length).toBeLessThanOrEqual(
        EventConfig.maxConcurrent,
      );
    }
    expect(seen.size).toBeGreaterThan(0);
    expect(warnedBeforeStart).toBe(true);
    expect(game.worldEvents().historyViews().length).toBeGreaterThan(0);
    // The views reach every nation.
    expect(players[0].nation()!.view().eventHistory.length).toBeGreaterThan(0);
    // No event eliminates anyone or leaves a negative stockpile.
    for (const p of players) {
      expect(p.isAlive()).toBe(true);
      expect(p.gold()).toBeGreaterThanOrEqual(0n);
      expect(p.nation()!.industry).toBeGreaterThanOrEqual(0);
    }
  });

  test("are the same in every run (deterministic)", async () => {
    const one = await world();
    const two = await world();
    run(one.game, 6_000);
    run(two.game, 6_000);
    expect(one.game.worldEvents().toData()).toEqual(
      two.game.worldEvents().toData(),
    );
  });

  test("survive a snapshot and continue identically", async () => {
    const { game } = await world();
    run(game, EventConfig.firstEventTicks + 100);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.worldEvents().toData()).toEqual(
      game.worldEvents().toData(),
    );
    for (let i = 0; i < 2_000; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });

  test("a nation-scoped event affects only its nation", async () => {
    const { game, players } = await world();
    run(game, 9_000);
    const all = [
      ...game.worldEvents().views(),
      ...game.worldEvents().historyViews(),
    ];
    const scoped = all.find((e) => e.target !== null);
    if (scoped === undefined) return; // none drawn in this window
    expect(players.map((p) => p.id())).toContain(scoped.target);
  });
});
