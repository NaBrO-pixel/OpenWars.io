import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player, Unit } from "../../game/Game";
import { isHostileTo } from "../air/AirCombat";
import { ConstructionExecution } from "../ConstructionExecution";
import { MoveWarshipExecution } from "../MoveWarshipExecution";

/** Distance from its structures within which a nation answers enemy tanks. */
const ARMOUR_THREAT_RADIUS = 40;
/** Tanks a nation buys over the whole game, per two city levels. */
const TANKS_PER_TWO_CITY_LEVELS = 1;

/** Enemy structures worth driving at, best first on a tie. */
const ARMOUR_OBJECTIVES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.Airbase,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
];

function tankCap(difficulty: Difficulty): number {
  switch (difficulty) {
    case Difficulty.Easy:
      return 0;
    case Difficulty.Medium:
      return 1;
    case Difficulty.Hard:
      return 2;
    case Difficulty.Impossible:
      return 3;
  }
}

/**
 * Armour update: how nations use tanks (docs/Armour.md).
 *
 * Stateless, like NationAirBehavior: every decision is a pure function of
 * the game state, so it adds nothing to snapshots and draws nothing from the
 * nation's PRNG. It acts at most once per call:
 *
 *  1. Send a tank (an idle one, or a new one) at hostile tanks near its
 *     structures.
 *  2. Re-order tanks that reached their objective, or whose objective is
 *     no longer the enemy's, onto the enemy's nearest valuable structure.
 *  3. Buy a tank toward that structure while at war, within its cap.
 *
 * Purchases need three times their cost in the treasury and are limited
 * over the game to one per two city levels, so tanks do not crowd out the
 * economy. Easy nations and the tutorial do not use tanks.
 */
export class NationArmourBehavior {
  constructor(
    private game: Game,
    private player: Player,
  ) {}

  handleArmour(): boolean {
    const config = this.game.config();
    const difficulty = config.gameConfig().difficulty;
    if (difficulty === Difficulty.Easy || config.gameConfig().tutorial) {
      return false;
    }
    if (!this.player.isAlive() || config.isUnitDisabled(UnitType.Tank)) {
      return false;
    }
    const cap = tankCap(difficulty);
    return this.defend(cap) || this.advance(cap);
  }

  private tanks(): Unit[] {
    return this.player.units(UnitType.Tank).filter((t) => t.isActive());
  }

  private defend(cap: number): boolean {
    const intruder = this.game
      .units(UnitType.Tank)
      .find(
        (t) =>
          isHostileTo(this.player, t) &&
          this.game.anyUnitNearby(
            t.tile(),
            ARMOUR_THREAT_RADIUS,
            Structures.types,
            (u) => u.owner() === this.player,
          ),
      );
    if (intruder === undefined) return false;
    const tanks = this.tanks();
    const free = tanks.find(
      (t) => t.warshipState().patrolTile !== intruder.tile(),
    );
    if (free !== undefined) return this.order(free, intruder.tile());
    return tanks.length < cap && this.buy(intruder.tile());
  }

  private advance(cap: number): boolean {
    const enemy = this.warTarget();
    if (enemy === undefined) return false;
    const objective = this.objective(enemy);
    if (objective === undefined) return false;
    const tanks = this.tanks();
    for (const tank of tanks) {
      const aim = tank.warshipState().patrolTile;
      const spent =
        aim === undefined ||
        tank.tile() === aim ||
        this.game.owner(aim) === this.player;
      if (spent && aim !== objective) return this.order(tank, objective);
    }
    return tanks.length < cap && this.buy(objective);
  }

  /** The player this nation is attacking with the most troops, if any. */
  private warTarget(): Player | undefined {
    let best: Player | undefined;
    let bestTroops = 0;
    for (const attack of this.player.outgoingAttacks()) {
      const target = attack.target();
      if (!target.isPlayer()) continue;
      const enemy = target as Player;
      if (!this.player.canAttackPlayer(enemy)) continue;
      if (attack.troops() > bestTroops) {
        bestTroops = attack.troops();
        best = enemy;
      }
    }
    return best;
  }

  /**
   * The enemy's valuable structure nearest to one of this nation's
   * factories (where tanks roll out). Ties go to the lowest unit id.
   */
  private objective(enemy: Player): TileRef | undefined {
    const factories = this.player
      .units(UnitType.Factory)
      .filter((f) => f.isActive() && !f.isUnderConstruction());
    if (factories.length === 0) return undefined;
    let best: Unit | undefined;
    let bestDist = Infinity;
    for (const s of enemy.units(ARMOUR_OBJECTIVES)) {
      if (!s.isActive()) continue;
      for (const f of factories) {
        const d = this.game.euclideanDistSquared(f.tile(), s.tile());
        if (
          d < bestDist ||
          (d === bestDist && best !== undefined && s.id() < best.id())
        ) {
          bestDist = d;
          best = s;
        }
      }
    }
    return best?.tile();
  }

  private buy(tile: TileRef): boolean {
    const allowed = Math.floor(
      (this.player.unitsOwned(UnitType.City) * TANKS_PER_TWO_CITY_LEVELS) / 2,
    );
    if (this.player.unitsConstructed(UnitType.Tank) >= allowed) return false;
    const cost = this.game.unitInfo(UnitType.Tank).cost(this.game, this.player);
    if (this.player.gold() < cost * 3n) return false;
    if (this.player.canBuild(UnitType.Tank, tile) === false) return false;
    this.game.addExecution(
      new ConstructionExecution(this.player, UnitType.Tank, tile),
    );
    return true;
  }

  private order(tank: Unit, tile: TileRef): boolean {
    this.game.addExecution(
      new MoveWarshipExecution(this.player, [tank.id()], tile),
    );
    return true;
  }
}
