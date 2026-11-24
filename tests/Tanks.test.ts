import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  TANK_CAPTURE_WEAR,
  TANK_GUN_DAMAGE,
} from "@openfront/engine-lib/game/TankRules";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { MoveWarshipExecution } from "@openfront/engine/execution/MoveWarshipExecution";
import { NationAirBehavior } from "@openfront/engine/execution/nation/NationAirBehavior";
import { NationArmourBehavior } from "@openfront/engine/execution/nation/NationArmourBehavior";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { snapshotGame } from "@openfront/engine/snapshot/GameSnapshot";
import { setup } from "./util/Setup";
import { diffSnapshots, roundTrip } from "./util/Snapshot";
import { executeTicks } from "./util/utils";

const MAP = "big_plains";

let game: Game;
let me: Player;
let enemy: Player;

function conquerRect(p: Player, x0: number, x1: number): void {
  for (let x = x0; x < x1; x++) {
    for (let y = 0; y < 200; y++) p.conquer(game.ref(x, y));
  }
}

async function start(
  over: Record<string, unknown> = {},
  difficulty = Difficulty.Hard,
) {
  game = await setup(MAP, { instantBuild: true, difficulty, ...over }, [
    new PlayerInfo("me", PlayerType.Human, null, "me"),
    new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
  ]);
  me = game.player("me");
  enemy = game.player("enemy");
  conquerRect(me, 0, 100);
  conquerRect(enemy, 100, 200);
  me.addTroops(100_000);
  enemy.addTroops(100_000);
  me.addGold(50_000_000n);
  enemy.addGold(50_000_000n);
}

function tankOf(p: Player): Unit {
  const t = p.units(UnitType.Tank);
  expect(t).toHaveLength(1);
  return t[0];
}

function order(p: Player, x: number, y: number): Unit {
  game.addExecution(
    new ConstructionExecution(p, UnitType.Tank, game.ref(x, y)),
  );
  executeTicks(game, 2);
  return tankOf(p);
}

describe("tanks", () => {
  test("need a factory and roll out of the nearest one", async () => {
    await start();
    expect(me.canBuild(UnitType.Tank, game.ref(50, 50))).toBe(false);
    const near = me.buildUnit(UnitType.Factory, game.ref(80, 50), {});
    me.buildUnit(UnitType.Factory, game.ref(10, 150), {});
    expect(me.canBuild(UnitType.Tank, game.ref(90, 40))).toBe(near.tile());
  });

  test("drive to the ordered tile across their own land", async () => {
    await start();
    me.buildUnit(UnitType.Factory, game.ref(20, 50), {});
    const tank = order(me, 40, 50);
    executeTicks(game, 120);
    expect(tank.tile()).toBe(game.ref(40, 50));
    // Re-ordered like a warship.
    game.addExecution(
      new MoveWarshipExecution(me, [tank.id()], game.ref(40, 60)),
    );
    executeTicks(game, 60);
    expect(tank.tile()).toBe(game.ref(40, 60));
  });

  test("break through hostile land, wearing down and costing troops", async () => {
    await start();
    me.buildUnit(UnitType.Factory, game.ref(95, 50), {});
    const tank = order(me, 120, 50);
    const troops = enemy.troops();
    executeTicks(game, 200);
    expect(tank.tile()).toBe(game.ref(120, 50));
    for (let x = 100; x <= 120; x++) {
      expect(game.owner(game.ref(x, 50))).toBe(me);
    }
    // Worn by the breakthrough (it repairs only once out of combat).
    expect(tank.health()).toBeLessThanOrEqual(
      tank.maxHealth() - 5 * TANK_CAPTURE_WEAR,
    );
    expect(enemy.troops()).toBeLessThan(troops);
  });

  test("stop at the border of a nation they may not attack", async () => {
    // Cold War: no attacks between nations, so it halts at the border.
    await start({ ruleset: "coldwar" });
    me.buildUnit(UnitType.Factory, game.ref(95, 50), {});
    const tank = order(me, 120, 50);
    executeTicks(game, 200);
    expect(game.x(tank.tile())).toBe(99);
    expect(game.owner(game.ref(100, 50))).toBe(enemy);
  });

  test("duel enemy tanks and take fire from defence posts", async () => {
    await start();
    me.buildUnit(UnitType.Factory, game.ref(90, 50), {});
    enemy.buildUnit(UnitType.Factory, game.ref(110, 50), {});
    const mine = order(me, 97, 50);
    const theirs = order(enemy, 103, 50);
    executeTicks(game, 30);
    expect(mine.health()).toBeLessThan(mine.maxHealth());
    expect(theirs.health()).toBeLessThanOrEqual(
      theirs.maxHealth() - TANK_GUN_DAMAGE,
    );
    // A defence post alone wears a tank down until it is destroyed.
    theirs.delete(false);
    enemy.buildUnit(UnitType.DefensePost, game.ref(104, 50), {});
    executeTicks(game, 400);
    expect(mine.isActive()).toBe(false);
  });

  test("survive a snapshot and keep driving identically", async () => {
    await start();
    me.buildUnit(UnitType.Factory, game.ref(95, 50), {});
    order(me, 130, 60);
    executeTicks(game, 20);
    const { restored } = await roundTrip(game, MAP);
    for (let i = 0; i < 80; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
      [],
    );
  });
});

describe("NationArmourBehavior", () => {
  function cities(n: number): void {
    for (let i = 0; i < n; i++) {
      me.buildUnit(UnitType.City, game.ref(15 + i * 15, 100), {});
    }
  }

  test("sends tanks at the enemy it is attacking", async () => {
    await start();
    const ai = new NationArmourBehavior(game, me);
    cities(4);
    me.buildUnit(UnitType.Factory, game.ref(90, 100), {});
    const far = enemy.buildUnit(UnitType.City, game.ref(180, 20), {});
    const near = enemy.buildUnit(UnitType.City, game.ref(120, 100), {});
    // At peace: nothing.
    expect(ai.handleArmour()).toBe(false);

    game.addExecution(new AttackExecution(5_000, me, enemy.id()));
    executeTicks(game, 2);
    expect(ai.handleArmour()).toBe(true);
    executeTicks(game, 2);
    const tank = tankOf(me);
    expect(tank.warshipState().patrolTile).toBe(near.tile());
    expect(tank.warshipState().patrolTile).not.toBe(far.tile());
  });

  test("answers enemy tanks near its structures", async () => {
    await start();
    const ai = new NationArmourBehavior(game, me);
    cities(2);
    me.buildUnit(UnitType.Factory, game.ref(60, 100), {});
    enemy.buildUnit(UnitType.Factory, game.ref(120, 100), {});
    const raider = order(enemy, 70, 100);
    executeTicks(game, 150);
    const seen = raider.tile();
    expect(ai.handleArmour()).toBe(true);
    executeTicks(game, 2);
    expect(tankOf(me).warshipState().patrolTile).toBe(seen);
  });

  test("easy nations and disabled tanks stay out", async () => {
    await start({}, Difficulty.Easy);
    cities(4);
    me.buildUnit(UnitType.Factory, game.ref(90, 100), {});
    enemy.buildUnit(UnitType.Factory, game.ref(120, 100), {});
    order(enemy, 70, 100);
    expect(new NationArmourBehavior(game, me).handleArmour()).toBe(false);

    await start({ disabledUnits: [UnitType.Tank] });
    cities(4);
    me.buildUnit(UnitType.Factory, game.ref(90, 100), {});
    enemy.buildUnit(UnitType.City, game.ref(120, 100), {});
    game.addExecution(new AttackExecution(5_000, me, enemy.id()));
    executeTicks(game, 2);
    expect(new NationArmourBehavior(game, me).handleArmour()).toBe(false);
  });
});

describe("nation AI under the OpenWars rules", () => {
  test("still builds an air arm", async () => {
    await start({ ruleset: "openwars" });
    for (let i = 0; i < 3; i++) {
      me.buildUnit(UnitType.City, game.ref(15 + i * 18, 100), {});
    }
    const ai = new NationAirBehavior(game, me);
    expect(ai.handleAir()).toBe(true);
    executeTicks(game, 3);
    expect(me.units(UnitType.Airbase)).toHaveLength(1);
  });
});
