import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  DiplomacyConfig,
  influenceCap,
} from "@openfront/engine-lib/configuration/DiplomacyConfig";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import {
  type DiplomacyAction,
  DiplomacyExecution,
} from "@openfront/engine/execution/DiplomacyExecution";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { GameImpl } from "@openfront/engine/game/GameImpl";
import { economyStep } from "@openfront/engine/game/NationState";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "../../util/Setup";
import { diffSnapshots, roundTrip } from "../../util/Snapshot";

const cfg = DiplomacyConfig;
let game: Game;
let a: Player;
let b: Player;
let c: Player;

function act(
  who: Player,
  action: DiplomacyAction,
  kind: "nap" | "trade" | "ceasefire" | "intel",
  target: Player,
) {
  game.addExecution(new DiplomacyExecution(who, action, kind, target.id()));
  game.executeNextTick();
}

function ticks(n: number) {
  for (let i = 0; i < n; i++) game.executeNextTick();
}

beforeEach(async () => {
  game = await setup("plains", { ruleset: "openwars" });
  a = game.addPlayer(new PlayerInfo("a", PlayerType.Human, "a", "a"));
  b = game.addPlayer(new PlayerInfo("b", PlayerType.Human, "b", "b"));
  c = game.addPlayer(new PlayerInfo("c", PlayerType.Human, "c", "c"));
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 20; y++) a.conquer(game.ref(x, y));
    for (let y = 20; y < 40; y++) b.conquer(game.ref(x, y));
    for (let y = 40; y < 60; y++) c.conquer(game.ref(x, y));
  }
  game.addExecution(new NationalEconomyExecution());
  ticks(15);
});

describe("agreements", () => {
  test("need the other side to accept", () => {
    act(a, "propose", "trade", b);
    expect(game.diplomacy().has("trade", a, b)).toBe(false);
    expect(game.diplomacy().view(b).incoming).toEqual([
      expect.objectContaining({ kind: "trade", other: a.id() }),
    ]);
    // Only the recipient can accept.
    act(c, "accept", "trade", a);
    expect(game.diplomacy().has("trade", a, b)).toBe(false);
    act(b, "accept", "trade", a);
    expect(game.diplomacy().has("trade", a, b)).toBe(true);
    expect(game.diplomacy().view(b).incoming).toEqual([]);
  });

  test("can be rejected", () => {
    act(a, "propose", "nap", b);
    act(b, "reject", "nap", a);
    expect(game.diplomacy().has("nap", a, b)).toBe(false);
    expect(game.diplomacy().view(a).outgoing).toEqual([]);
  });

  test("simultaneous proposals agree", () => {
    act(a, "propose", "nap", b);
    act(b, "propose", "nap", a);
    expect(game.diplomacy().has("nap", a, b)).toBe(true);
  });

  test("proposals and agreements expire", () => {
    act(a, "propose", "trade", b);
    ticks(cfg.proposalTicks + 20);
    expect(game.diplomacy().view(b).incoming).toEqual([]);
    act(a, "propose", "ceasefire", b); // needs a war
    expect(game.diplomacy().view(b).incoming).toEqual([]);
    act(a, "propose", "nap", b);
    act(b, "accept", "nap", a);
    ticks(cfg.agreements.nap.ticks + 20);
    expect(game.diplomacy().has("nap", a, b)).toBe(false);
  });

  test("intelligence sharing needs an alliance", () => {
    act(a, "propose", "intel", b);
    expect(game.diplomacy().view(b).incoming).toEqual([]);
    (game as GameImpl).createAllianceRequest(a, b)?.accept();
    act(a, "propose", "intel", b);
    act(b, "accept", "intel", a);
    expect(game.diplomacy().has("intel", a, b)).toBe(true);
    // Ends with the alliance.
    a.breakAlliance(a.allianceWith(b)!);
    ticks(15);
    expect(game.diplomacy().has("intel", a, b)).toBe(false);
  });
});

describe("pacts and ceasefires", () => {
  test("a non-aggression pact stops attacks both ways", () => {
    act(a, "propose", "nap", b);
    act(b, "accept", "nap", a);
    expect(a.canAttackPlayer(b)).toBe(false);
    expect(b.canAttackPlayer(a)).toBe(false);
    expect(a.canAttackPlayer(c)).toBe(true);
  });

  test("a ceasefire ends a war in progress", () => {
    a.addTroops(100_000);
    game.addExecution(new AttackExecution(10_000, a, b.id()));
    ticks(5);
    expect(game.diplomacy().atWar(a, b)).toBe(true);
    act(b, "propose", "ceasefire", a);
    act(a, "accept", "ceasefire", b);
    expect(game.diplomacy().has("ceasefire", a, b)).toBe(true);
    expect(a.outgoingAttacks().every((x) => x.retreating())).toBe(true);
    expect(a.canAttackPlayer(b)).toBe(false);
  });
});

describe("reputation", () => {
  test("falls when an agreement is broken, then recovers", () => {
    act(a, "propose", "nap", b);
    act(b, "accept", "nap", a);
    act(a, "break", "nap", b);
    expect(game.diplomacy().has("nap", a, b)).toBe(false);
    const after = game.diplomacy().reputation(a);
    expect(after).toBe(100 - cfg.agreements.nap.breakPenalty);
    expect(game.diplomacy().reputation(b)).toBe(100);
    ticks(10 * cfg.reputationRecoverySteps * 3 + 20);
    expect(game.diplomacy().reputation(a)).toBeGreaterThan(after);
  });

  test("falls when an alliance is betrayed", () => {
    (game as GameImpl).createAllianceRequest(a, b)?.accept();
    a.breakAlliance(a.allianceWith(b)!);
    expect(game.diplomacy().reputation(a)).toBe(100 - cfg.allianceBreakPenalty);
  });

  test("AI nations refuse nations they don't trust", () => {
    const nation = game.addPlayer(
      new PlayerInfo("n", PlayerType.Nation, null, "n"),
    );
    nation.conquer(game.ref(30, 30));
    act(a, "propose", "trade", nation);
    ticks(15);
    expect(game.diplomacy().has("trade", a, nation)).toBe(true);
    game.diplomacy().penalize(c, 80);
    act(c, "propose", "trade", nation);
    ticks(15);
    expect(game.diplomacy().has("trade", c, nation)).toBe(false);
  });
});

describe("benefits", () => {
  const base = {
    troops: 50_000,
    tiles: 5_000,
    tilesAMinuteAgo: 5_000,
    factoryLevels: 3,
    cityLevels: 2,
    structureLevels: 5,
    baseIncome: 1_000,
    money: 0n,
    infrastructure: { roads: 0, railways: 0, industry: 0, research: 2 },
  };
  test("trade agreements raise tax and industry income", () => {
    const none = economyStep(base, 700);
    const two = economyStep({ ...base, tradeAgreements: 2 }, 700);
    expect(two.income.tax).toBeGreaterThan(none.income.tax);
    expect(two.income.industry).toBeGreaterThan(none.income.industry);
  });

  test("alliances raise research", () => {
    expect(
      economyStep({ ...base, alliances: 3 }, 700).researchRate,
    ).toBeGreaterThan(economyStep(base, 700).researchRate);
  });
});

describe("diplomacy snapshots", () => {
  test("restore agreements, proposals and reputation", async () => {
    act(a, "propose", "nap", b);
    act(b, "accept", "nap", a);
    act(a, "propose", "trade", c);
    game.diplomacy().penalize(c, 15);
    const { restored } = await roundTrip(game, "plains");
    expect(restored.diplomacy().toData()).toEqual(game.diplomacy().toData());
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });
});

describe("classic rules", () => {
  test("have no diplomacy agreements", async () => {
    const classic = await setup("plains");
    const p = classic.addPlayer(
      new PlayerInfo("p", PlayerType.Human, "p", "p"),
    );
    const q = classic.addPlayer(
      new PlayerInfo("q", PlayerType.Human, "q", "q"),
    );
    classic.addExecution(new DiplomacyExecution(p, "propose", "nap", q.id()));
    classic.executeNextTick();
    expect(classic.diplomacy().view(q).incoming).toEqual([]);
  });
});

describe("influence", () => {
  test("grows by a share of the world each minute", () => {
    expect(influenceCap(38, 0)).toBe(1);
    expect(influenceCap(38, 600 * 10)).toBe(8); // 20% of 38
    expect(influenceCap(38, 600 * 20)).toBe(16); // 40%
    // Small games: one more partner every 8 minutes.
    expect(influenceCap(3, 600 * 20)).toBe(3);
  });

  test("limits new partners, not ceasefires or deals with partners", () => {
    act(a, "propose", "trade", b);
    act(b, "accept", "trade", a);
    expect(game.diplomacy().has("trade", a, b)).toBe(true);
    // One partner allowed this early: c is refused, b can sign more.
    expect(game.diplomacy().canPropose(game, "trade", a, c)).toBe(
      "influence_limit",
    );
    expect(game.diplomacy().canPropose(game, "nap", a, b)).toBeNull();
    for (let y = 0; y < 10; y++) c.conquer(game.ref(20, y));
    game.addExecution(new AttackExecution(1_000, c, a.id()));
    ticks(2);
    expect(game.diplomacy().canPropose(game, "ceasefire", a, c)).toBeNull();
    // The view tells the panel.
    ticks(10);
    expect(a.nation()!.view().diplomacy.influence).toEqual({
      partners: 1,
      cap: 1,
    });
  });

  test("an accepted proposal is checked again", () => {
    act(a, "propose", "trade", c);
    act(b, "propose", "trade", c);
    act(c, "accept", "trade", a);
    // c reached its limit since b proposed.
    act(c, "accept", "trade", b);
    expect(game.diplomacy().has("trade", b, c)).toBe(false);
  });
});

describe("AI trade offers", () => {
  test("nations offer trade to friendly neighbours", () => {
    const nation = game.addPlayer(
      new PlayerInfo("n", PlayerType.Nation, null, "n"),
    );
    for (let x = 20; x < 30; x++) {
      for (let y = 0; y < 20; y++) nation.conquer(game.ref(x, y));
    }
    ticks(10 * (cfg.aiOfferEverySteps + 2));
    const offered =
      game
        .diplomacy()
        .view(a)
        .incoming.some((p) => p.other === "n") ||
      game.diplomacy().has("trade", a, nation);
    expect(offered).toBe(true);
    // Not to c, who doesn't border it.
    expect(game.diplomacy().view(c).incoming).toEqual([]);
  });
});
