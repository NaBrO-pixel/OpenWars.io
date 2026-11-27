import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { nearestAirbase } from "./air/AirCombat";

/** The combat units an Attack order sends: not transport helicopters. */
export const FOCUS_UNITS: readonly UnitType[] = [
  UnitType.Tank,
  UnitType.Bomber,
  UnitType.Fighter,
  UnitType.AttackHelicopter,
];

/**
 * 0 for units of the enemy `owner`'s forces are focused on, 1 for any other:
 * sorted first, the focused enemy's units are engaged before the rest
 * (AA guns, fighters, helicopters and tanks).
 */
export function focusRank(owner: Player, unit: Unit): number {
  const focus = owner.nation()?.focus ?? null;
  return focus !== null && unit.owner().id() === focus ? 0 : 1;
}

/**
 * The OpenWars Attack panel ("focus_forces" intent, docs/OpenWars2.md).
 *
 * With a target: every tank drives at, every bomber strikes, and every
 * fighter and attack helicopter takes station over one of the enemy's
 * structures, spread across them (each unit takes the nearest structure that
 * the fewest units of its kind were already sent to). The focus is kept on
 * the nation, so AA guns, fighters, helicopters and tanks engage that
 * enemy's units first. Refused if the target can't be attacked (an ally, a
 * pact, Cold War) or has no structures.
 *
 * Without a target: recall. Tanks drive back to the nearest own factory,
 * aircraft stand down at the nearest own airbase, and the focus is cleared.
 */
export class FocusForcesExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private target: string | null,
  ) {}

  init(mg: Game): void {
    this.active = false;
    if (!mg.config().isOpenWars() || !this.player.isAlive()) return;
    const nation = this.player.ensureNation();
    if (this.target === null) {
      this.recall(mg);
      nation.focus = null;
      nation.invalidate();
      return;
    }
    if (!mg.hasPlayer(this.target)) return;
    const enemy = mg.player(this.target);
    if (
      enemy === this.player ||
      !enemy.isAlive() ||
      enemy.type() === PlayerType.Bot ||
      !this.player.canAttackPlayer(enemy)
    ) {
      return;
    }
    const structures = enemy
      .units(Structures.types)
      .filter((s) => s.isActive())
      .sort((a, b) => a.id() - b.id());
    if (structures.length === 0) return;
    nation.focus = enemy.id();
    nation.invalidate();
    for (const type of FOCUS_UNITS) {
      const sent = new Map<number, number>();
      for (const unit of this.forces(type)) {
        const target = this.pick(mg, unit.tile(), structures, sent);
        this.order(unit, target.tile());
      }
    }
  }

  private forces(type: UnitType): Unit[] {
    return this.player
      .units(type)
      .filter((u) => u.isActive())
      .sort((a, b) => a.id() - b.id());
  }

  /** The nearest structure among those the fewest were sent to. */
  private pick(
    mg: Game,
    from: TileRef,
    structures: Unit[],
    sent: Map<number, number>,
  ): Unit {
    let best = structures[0];
    let bestLoad = Infinity;
    let bestDist = Infinity;
    for (const s of structures) {
      const load = sent.get(s.id()) ?? 0;
      const dist = mg.euclideanDistSquared(from, s.tile());
      if (load < bestLoad || (load === bestLoad && dist < bestDist)) {
        best = s;
        bestLoad = load;
        bestDist = dist;
      }
    }
    sent.set(best.id(), bestLoad + 1);
    return best;
  }

  private recall(mg: Game): void {
    const factories = this.player
      .units(UnitType.Factory)
      .filter((f) => f.isActive());
    for (const tank of this.forces(UnitType.Tank)) {
      let home: Unit | undefined;
      let bestDist = Infinity;
      for (const f of factories) {
        const d = mg.euclideanDistSquared(tank.tile(), f.tile());
        if (d < bestDist) {
          bestDist = d;
          home = f;
        }
      }
      if (home !== undefined) this.order(tank, home.tile());
    }
    for (const type of FOCUS_UNITS) {
      if (type === UnitType.Tank) continue;
      for (const aircraft of this.forces(type)) {
        const base = nearestAirbase(mg, this.player, aircraft.tile());
        // Ordered onto its own airbase, an aircraft stands down there.
        if (base !== undefined) this.order(aircraft, base.tile());
      }
    }
  }

  private order(unit: Unit, tile: TileRef): void {
    unit.updateWarshipState({ patrolTile: tile });
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return FocusForcesExecutionSnapshot.write({
      player: w.player(this.player),
      target: this.target,
      active: this.active,
    });
  }

  restoreSnapshot(s: FocusForcesState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.target = s.target;
    this.active = s.active;
  }
}

const FocusForcesStateSchema = z.object({
  player: zPlayerRef(),
  target: z.string().nullable(),
  active: z.boolean(),
});
type FocusForcesState = z.infer<typeof FocusForcesStateSchema>;

export const FocusForcesExecutionSnapshot = execSnapshotType({
  name: "FocusForces",
  version: 1,
  schema: FocusForcesStateSchema,
  cls: () => FocusForcesExecution,
});
