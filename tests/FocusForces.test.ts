import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { AAGunExecution } from "@openfront/engine/execution/air/AAGunExecution";
import {
  FocusForcesExecution,
  focusRank,
} from "@openfront/engine/execution/FocusForcesExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "./util/Setup";
import { diffSnapshots, roundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "big_plains";
let game: Game;
let me: Player;
let red: Player;
let green: Player;

function rect(p: Player, x0: number, x1: number, y0: number, y1: number) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) p.conquer(game.ref(x, y));
  }
}

async function start(over: Record<string, unknown> = {}) {
  game = await setup(
    MAP,
    { instantBuild: true, ruleset: "openwars", ...over },
    [
      new PlayerInfo("me", PlayerType.Human, null, "me"),
      new PlayerInfo("red", PlayerType.Human, null, "red"),
      new PlayerInfo("green", PlayerType.Human, null, "green"),
    ],
  );
  me = game.player("me");
  red = game.player("red");
  green = game.player("green");
  rect(me, 0, 100, 0, 200);
  rect(red, 100, 200, 0, 100);
  rect(green, 100, 200, 100, 200);
  for (const p of [me, red, green]) p.addTroops(100_000);
}

function focus(target: Player | null) {
  game.addExecution(new FocusForcesExecution(me, target?.id() ?? null));
  executeTicks(game, 1);
}

const aim = (u: Unit) => u.warshipState().patrolTile;

describe("Attack orders (focus forces)", () => {
  test("send tanks, bombers, fighters and attack helicopters at the enemy's structures, spread out", async () => {
    await start();
    const base = me.buildUnit(UnitType.Airbase, game.ref(50, 50), {});
    const home = me.buildUnit(UnitType.Factory, game.ref(60, 60), {});
    const cityA = red.buildUnit(UnitType.City, game.ref(150, 30), {});
    const cityB = red.buildUnit(UnitType.City, game.ref(150, 70), {});
    const greenCity = green.buildUnit(UnitType.City, game.ref(150, 150), {});
    const tanks = [0, 1].map(() =>
      me.buildUnit(UnitType.Tank, home.tile(), { patrolTile: home.tile() }),
    );
    const bombers = [0, 1].map(() =>
      me.buildUnit(UnitType.Bomber, base.tile(), { patrolTile: base.tile() }),
    );
    const fighter = me.buildUnit(UnitType.Fighter, base.tile(), {
      patrolTile: base.tile(),
    });
    const heli = me.buildUnit(UnitType.AttackHelicopter, base.tile(), {
      patrolTile: base.tile(),
    });
    const transport = me.buildUnit(UnitType.TransportHelicopter, base.tile(), {
      patrolTile: base.tile(),
    });

    focus(red);
    const targets = new Set([cityA.tile(), cityB.tile()]);
    for (const u of [...tanks, ...bombers, fighter, heli]) {
      expect(targets.has(aim(u)!)).toBe(true);
    }
    // Two of a kind go to different structures.
    expect(aim(tanks[0])).not.toBe(aim(tanks[1]));
    expect(aim(bombers[0])).not.toBe(aim(bombers[1]));
    // Transport helicopters carry troops; they are left alone.
    expect(aim(transport)).toBe(base.tile());
    expect(aim(fighter)).not.toBe(greenCity.tile());
    expect(me.nation()!.view().focus).toBe("red");
  });

  test("the focused enemy's units are engaged first", async () => {
    await start();
    me.buildUnit(UnitType.Airbase, game.ref(50, 50), {});
    red.buildUnit(UnitType.City, game.ref(150, 30), {});
    const gun = me.buildUnit(UnitType.AAGun, game.ref(90, 100), {});
    game.addExecution(new AAGunExecution(gun));
    // A green bomber nearer the gun than a red one.
    const greenBomber = green.buildUnit(UnitType.Bomber, game.ref(95, 100), {
      patrolTile: game.ref(95, 100),
    });
    const redBomber = red.buildUnit(UnitType.Bomber, game.ref(110, 100), {
      patrolTile: game.ref(110, 100),
    });
    expect(focusRank(me, redBomber)).toBe(1);
    focus(red);
    expect(focusRank(me, redBomber)).toBe(0);
    expect(focusRank(me, greenBomber)).toBe(1);
    const redHealth = redBomber.health();
    const greenHealth = greenBomber.health();
    executeTicks(game, 25);
    expect(redBomber.health()).toBeLessThan(redHealth);
    expect(greenBomber.health()).toBe(greenHealth);
  });

  test("recall sends everything home and clears the focus", async () => {
    await start();
    const base = me.buildUnit(UnitType.Airbase, game.ref(50, 50), {});
    const home = me.buildUnit(UnitType.Factory, game.ref(60, 60), {});
    red.buildUnit(UnitType.City, game.ref(150, 30), {});
    const tank = me.buildUnit(UnitType.Tank, home.tile(), {
      patrolTile: home.tile(),
    });
    const bomber = me.buildUnit(UnitType.Bomber, base.tile(), {
      patrolTile: base.tile(),
    });
    focus(red);
    expect(aim(tank)).not.toBe(home.tile());
    focus(null);
    expect(aim(tank)).toBe(home.tile());
    expect(aim(bomber)).toBe(base.tile());
    expect(me.nation()!.focus).toBeNull();
  });

  test("refused for allies, pacts, Cold War and enemies without structures", async () => {
    await start({ ruleset: "coldwar" });
    const home = me.buildUnit(UnitType.Factory, game.ref(60, 60), {});
    red.buildUnit(UnitType.City, game.ref(150, 30), {});
    const tank = me.buildUnit(UnitType.Tank, home.tile(), {
      patrolTile: home.tile(),
    });
    focus(red);
    expect(aim(tank)).toBe(home.tile());
    expect(me.nation()?.focus ?? null).toBeNull();

    await start();
    const home2 = me.buildUnit(UnitType.Factory, game.ref(60, 60), {});
    const tank2 = me.buildUnit(UnitType.Tank, home2.tile(), {
      patrolTile: home2.tile(),
    });
    focus(green); // no structures
    expect(aim(tank2)).toBe(home2.tile());
  });

  test("the focus survives a snapshot", async () => {
    await start();
    red.buildUnit(UnitType.City, game.ref(150, 30), {});
    focus(red);
    executeTicks(game, 5);
    const { restored } = await roundTrip(game, MAP);
    expect(restored.player("me").nation()!.focus).toBe("red");
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });
});
