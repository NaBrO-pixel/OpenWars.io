import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { MilitaryConfig } from "@openfront/engine-lib/configuration/MilitaryConfig";
import {
  NO_TECH as techNone,
  TECH_BRANCHES,
  TECHS,
  VICTORY_BRANCHES,
} from "@openfront/engine-lib/configuration/TechConfig";
import {
  TANK_CAPTURE_WEAR,
  TANK_GUN_DAMAGE,
} from "@openfront/engine-lib/game/TankRules";
import { AAGunExecution } from "@openfront/engine/execution/air/AAGunExecution";
import { AircraftExecution } from "@openfront/engine/execution/air/AircraftExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { ShellExecution } from "@openfront/engine/execution/ShellExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { economyStep } from "@openfront/engine/game/NationState";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let me: Player;
let red: Player;

async function start() {
  game = await setup(
    "big_plains",
    { instantBuild: true, ruleset: "openwars" },
    [
      new PlayerInfo("me", PlayerType.Human, null, "me"),
      new PlayerInfo("red", PlayerType.Human, null, "red"),
    ],
  );
  me = game.player("me");
  red = game.player("red");
  for (let x = 0; x < 200; x++) {
    for (let y = 0; y < 200; y++) (x < 100 ? me : red).conquer(game.ref(x, y));
  }
  me.addTroops(100_000);
  red.addTroops(100_000);
  me.addGold(50_000_000n);
  red.addGold(50_000_000n);
}

/** Completes the given technologies for `p`. */
function learn(p: Player, ...ids: string[]) {
  const n = p.ensureNation();
  for (const id of ids) n.techs.push(id);
  // The modifiers are cached: drop them.
  (n as unknown as { modifiers: null }).modifiers = null;
}

describe("military research branch", () => {
  test("is a fourth branch of five, outside the technological victory", () => {
    expect(TECH_BRANCHES).toContain("military");
    expect(VICTORY_BRANCHES).not.toContain("military");
    const military = TECHS.filter((t) => t.branch === "military");
    expect(military.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5]);
  });

  test("combined arms and composite armour: tanks hit harder and take less", async () => {
    await start();
    learn(me, "combined_arms", "composite_armour");
    me.buildUnit(UnitType.Factory, game.ref(96, 50), {});
    red.buildUnit(UnitType.Factory, game.ref(104, 50), {});
    game.addExecution(
      new ConstructionExecution(me, UnitType.Tank, game.ref(97, 50)),
    );
    game.addExecution(
      new ConstructionExecution(red, UnitType.Tank, game.ref(103, 50)),
    );
    executeTicks(game, 2);
    const [mine] = me.units(UnitType.Tank);
    const [theirs] = red.units(UnitType.Tank);
    executeTicks(game, 12);
    const dealt = theirs.maxHealth() - theirs.health();
    const taken = mine.maxHealth() - mine.health();
    expect(dealt % Math.floor(TANK_GUN_DAMAGE * 1.25)).toBe(0);
    expect(dealt).toBeGreaterThan(0);
    // Red's plain shots, cut by 30%.
    expect(taken % Math.floor(TANK_GUN_DAMAGE * 0.7)).toBe(0);
    expect(taken).toBeLessThan(dealt);
    expect(TANK_CAPTURE_WEAR).toBeGreaterThan(0);
  });

  test("flak directors add a shell to every AA volley", async () => {
    await start();
    const gun = me.buildUnit(UnitType.AAGun, game.ref(95, 100), {});
    game.addExecution(new AAGunExecution(gun));
    red.buildUnit(UnitType.Bomber, game.ref(100, 100), {
      patrolTile: game.ref(100, 100),
    });
    // Count the shells the gun fires, volley by volley.
    const add = game.addExecution.bind(game);
    let fired = 0;
    game.addExecution = (...execs) => {
      fired += execs.filter((e) => e instanceof ShellExecution).length;
      add(...execs);
    };
    const volley = () => {
      fired = 0;
      for (let i = 0; i < 60 && fired === 0; i++) game.executeNextTick();
      return fired;
    };
    expect(volley()).toBe(1); // a level-1 gun
    learn(me, "flak_directors");
    expect(volley()).toBe(2);
  });

  test("precision bombing knocks a structure down an extra level", async () => {
    await start();
    learn(me, "precision_bombing");
    me.buildUnit(UnitType.Airbase, game.ref(80, 100), {});
    const city: Unit = red.buildUnit(UnitType.City, game.ref(130, 100), {});
    city.increaseLevel();
    city.increaseLevel();
    expect(city.level()).toBe(3);
    game.addExecution(
      new AircraftExecution({
        owner: me,
        type: UnitType.Bomber,
        patrolTile: city.tile(),
      }),
    );
    for (let i = 0; i < 300 && city.level() === 3; i++) game.executeNextTick();
    expect(city.level()).toBe(1);
  });

  test("war economy cuts army upkeep and mobilisation unrest", () => {
    const input = {
      troops: 500_000,
      tiles: 1_000,
      tilesAMinuteAgo: 1_000,
      factoryLevels: 0,
      cityLevels: 0,
      structureLevels: 0,
      baseIncome: 0,
      money: 10_000_000n,
      infrastructure: { roads: 0, railways: 0, industry: 0, research: 0 },
      mobilisation: 3,
    };
    const tech = (cut: number, unrest: number) => ({
      ...techNone,
      militaryUpkeepCutPermille: cut,
      mobilisationUnrestCutPermille: unrest,
    });
    const plain = economyStep(input, 500, techNone);
    const war = economyStep(input, 500, tech(350, 500));
    expect(plain.expenses.military).toBe(
      (500_000 * MilitaryConfig.upkeepPerThousandTroops[3]) / 1000,
    );
    expect(war.expenses.military).toBe(
      Math.floor(plain.expenses.military * 0.65),
    );
    expect(war.stabilityTarget - plain.stabilityTarget).toBe(
      -MilitaryConfig.stability[3] / 2,
    );
  });
});
