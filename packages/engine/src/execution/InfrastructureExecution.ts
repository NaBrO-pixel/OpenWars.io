import type { InfrastructureKind } from "@openfront/engine-api/game/Infrastructure";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * A player's "infrastructure" intent: start or cancel a project on one of
 * their cities. All checks (ownership, ruleset, level, prerequisites, cost,
 * duplicates) happen in InfrastructureMap, the same way on every client, so
 * a refused intent changes nothing anywhere.
 */
export class InfrastructureExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private action: "start" | "cancel",
    private unitId: number,
    private kind: InfrastructureKind,
  ) {}

  init(mg: Game): void {
    const infra = mg.infrastructure();
    if (this.action === "start") {
      infra.start(mg, this.player, this.unitId, this.kind);
    } else {
      infra.cancel(this.player, this.unitId, this.kind);
    }
    const nation = this.player.nation();
    nation?.setInfrastructure(
      infra.siteViews(this.player),
      infra.projectViews(this.player),
    );
    this.active = false;
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return InfrastructureExecutionSnapshot.write({
      player: w.player(this.player),
      action: this.action,
      unitId: this.unitId,
      kind: this.kind,
      active: this.active,
    });
  }

  restoreSnapshot(s: InfrastructureState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.action = s.action;
    this.unitId = s.unitId;
    this.kind = s.kind;
    this.active = s.active;
  }
}

const InfrastructureStateSchema = z.object({
  player: zPlayerRef(),
  action: z.enum(["start", "cancel"]),
  unitId: z.number(),
  kind: z.enum(["roads", "railways", "industry", "research"]),
  active: z.boolean(),
});
type InfrastructureState = z.infer<typeof InfrastructureStateSchema>;

export const InfrastructureExecutionSnapshot = execSnapshotType({
  name: "Infrastructure",
  version: 1,
  schema: InfrastructureStateSchema,
  cls: () => InfrastructureExecution,
});
