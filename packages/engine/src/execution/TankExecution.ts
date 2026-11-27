import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DEFENCE_POST_ANTI_TANK_DAMAGE,
  DEFENCE_POST_ANTI_TANK_RANGE,
  TANK_ASSAULT_TICKS,
  TANK_CAPTURE_TROOP_LOSS,
  TANK_CAPTURE_WEAR,
  TANK_FIRE_TICKS,
  TANK_GUN_DAMAGE,
  TANK_GUN_RANGE,
  TANK_MOVE_TICKS,
  TANK_REPAIR,
  TANK_REPAIR_DELAY,
  TANK_STEPS,
} from "@openfront/engine-lib/game/TankRules";
import {
  zInt,
  zPlayerRef,
  zRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, isUnit, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { isHostileTo } from "./air/AirCombat";
import { focusRank } from "./FocusForcesExecution";

export interface TankOrder {
  owner: Player;
  /** Where to drive. */
  patrolTile: TileRef;
}

/**
 * Armour update (docs/Armour.md). A tank rolls out of a factory and drives
 * overland, one tile at a time, toward its ordered tile (the patrol tile of
 * the warship state, so MoveWarshipIntent re-orders it like a warship or an
 * aircraft). On the way it:
 *
 * - breaks through: every hostile (attackable) or unclaimed tile it enters
 *   becomes its owner's, more slowly than driving through friendly land,
 *   wearing the tank and costing the defender troops;
 * - fights: every volley it shoots the nearest hostile tank in range, and
 *   each finished hostile defence post in range shoots it;
 * - repairs on its own land once out of combat.
 *
 * It stops where it cannot get closer (water, mountains, a nation it may
 * not attack) and holds there. A tank at zero health is destroyed.
 */
export class TankExecution implements Execution {
  private mg: Game | undefined;
  private tank: Unit | undefined;
  private active = true;
  private nextMove = 0;
  private lastCombat = -1000;

  constructor(private input: TankOrder | Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    if (isUnit(this.input)) {
      this.tank = this.input;
    } else {
      const { owner, patrolTile } = this.input;
      const spawn = owner.canBuild(UnitType.Tank, patrolTile);
      if (spawn === false) {
        this.active = false;
        return;
      }
      this.tank = owner.buildUnit(UnitType.Tank, spawn, { patrolTile });
    }
    this.nextMove = ticks + TANK_MOVE_TICKS;
  }

  tick(ticks: number): void {
    const mg = this.mg!;
    const tank = this.tank!;
    if (!tank.isActive()) {
      this.active = false;
      return;
    }
    if (ticks % TANK_FIRE_TICKS === 0) this.volley(ticks);
    // A tank shot to zero health is deleted by modifyHealth.
    if (!tank.isActive()) {
      this.active = false;
      return;
    }
    if (ticks < this.nextMove) return;
    const next = this.nextStep(mg, tank);
    if (next === null) {
      this.nextMove = ticks + TANK_MOVE_TICKS;
      return;
    }
    const owner = tank.owner();
    const holder = mg.owner(next);
    if (holder !== owner && !(holder.isPlayer() && owner.isFriendly(holder))) {
      // Break through: the tile becomes the tank owner's.
      if (holder.isPlayer()) {
        holder.removeTroops(Math.min(holder.troops(), TANK_CAPTURE_TROOP_LOSS));
      }
      owner.conquer(next);
      tank.modifyHealth(-TANK_CAPTURE_WEAR);
      if (!tank.isActive()) {
        this.active = false;
        return;
      }
      this.lastCombat = ticks;
      this.nextMove = ticks + TANK_ASSAULT_TICKS;
    } else {
      this.nextMove = ticks + TANK_MOVE_TICKS;
    }
    tank.move(next);
  }

  /**
   * The neighbour that gets closest to the patrol tile, if it is closer than
   * where the tank is: land, passable, and either friendly or a tile the
   * owner may take.
   */
  private nextStep(mg: Game, tank: Unit): TileRef | null {
    const target = tank.warshipState().patrolTile;
    const here = tank.tile();
    if (target === undefined || here === target) return null;
    const tx = mg.x(target);
    const ty = mg.y(target);
    const dist = (x: number, y: number) =>
      (x - tx) * (x - tx) + (y - ty) * (y - ty);
    let best: TileRef | null = null;
    let bestDist = dist(mg.x(here), mg.y(here));
    const owner = tank.owner();
    for (const [dx, dy] of TANK_STEPS) {
      const x = mg.x(here) + dx;
      const y = mg.y(here) + dy;
      if (!mg.isValidCoord(x, y)) continue;
      const d = dist(x, y);
      if (d >= bestDist) continue;
      const tile = mg.ref(x, y);
      if (!mg.isLand(tile) || mg.isImpassable(tile)) continue;
      const holder = mg.owner(tile);
      if (
        holder.isPlayer() &&
        holder !== owner &&
        !owner.isFriendly(holder) &&
        !owner.canAttackPlayer(holder)
      ) {
        continue;
      }
      best = tile;
      bestDist = d;
    }
    return best;
  }

  /** Exchanges fire with hostile tanks and defence posts; repairs if calm. */
  private volley(ticks: number): void {
    const mg = this.mg!;
    const tank = this.tank!;
    const owner = tank.owner();
    const enemies = mg
      .nearbyUnits(tank.tile(), TANK_GUN_RANGE, UnitType.Tank, ({ unit }) =>
        isHostileTo(owner, unit as Unit),
      )
      .sort(
        (a, b) =>
          focusRank(owner, a.unit as Unit) - focusRank(owner, b.unit as Unit) ||
          a.distSquared - b.distSquared ||
          a.unit.id() - b.unit.id(),
      );
    if (enemies.length > 0) {
      enemies[0].unit.modifyHealth(-TANK_GUN_DAMAGE, owner);
      this.lastCombat = ticks;
    }
    for (const { unit: post } of mg.nearbyUnits(
      tank.tile(),
      DEFENCE_POST_ANTI_TANK_RANGE,
      UnitType.DefensePost,
      ({ unit }) =>
        isHostileTo(owner, unit as Unit) && !unit.isUnderConstruction(),
    )) {
      tank.modifyHealth(
        -DEFENCE_POST_ANTI_TANK_DAMAGE * post.level(),
        post.owner(),
      );
      this.lastCombat = ticks;
    }
    if (
      ticks - this.lastCombat >= TANK_REPAIR_DELAY &&
      mg.owner(tank.tile()) === owner &&
      tank.health() < tank.maxHealth()
    ) {
      tank.modifyHealth(TANK_REPAIR);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TankExecutionSnapshot.write({
      input: isUnit(this.input)
        ? { unit: w.unit(this.input) }
        : {
            owner: w.player(this.input.owner),
            patrolTile: this.input.patrolTile,
          },
      active: this.active,
      initialized: this.mg !== undefined,
      tank: this.tank === undefined ? null : w.unit(this.tank),
      nextMove: this.nextMove,
      lastCombat: this.lastCombat,
    });
  }

  restoreSnapshot(s: TankState, r: SnapshotReader): void {
    this.input =
      "unit" in s.input
        ? r.unit(s.input.unit)
        : { owner: r.player(s.input.owner), patrolTile: s.input.patrolTile };
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    if (s.tank !== null) this.tank = r.unit(s.tank);
    this.nextMove = s.nextMove;
    this.lastCombat = s.lastCombat;
  }
}

const TankStateSchema = z.object({
  input: z.union([
    z.object({ unit: zRef() }),
    z.object({ owner: zPlayerRef(), patrolTile: zTile() }),
  ]),
  active: z.boolean(),
  initialized: z.boolean(),
  tank: zRef().nullable(),
  nextMove: zInt(),
  lastCombat: zInt(),
});
type TankState = z.infer<typeof TankStateSchema>;

export const TankExecutionSnapshot = execSnapshotType({
  name: "Tank",
  version: 1,
  schema: TankStateSchema,
  cls: () => TankExecution,
});
