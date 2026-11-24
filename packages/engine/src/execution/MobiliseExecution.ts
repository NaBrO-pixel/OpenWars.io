import { MOBILISATION_LEVELS } from "@openfront/engine-lib/configuration/MilitaryConfig";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** A player's "mobilise" intent: sets their nation's mobilisation level. */
export class MobiliseExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private level: number,
  ) {}

  init(mg: Game): void {
    this.active = false;
    if (!mg.config().isOpenWars()) return;
    if (
      !Number.isInteger(this.level) ||
      this.level < 0 ||
      this.level >= MOBILISATION_LEVELS.length
    ) {
      return;
    }
    const nation = this.player.ensureNation();
    nation.mobilisation = this.level;
    nation.invalidate();
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return MobiliseExecutionSnapshot.write({
      player: w.player(this.player),
      level: this.level,
      active: this.active,
    });
  }

  restoreSnapshot(s: MobiliseState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.level = s.level;
    this.active = s.active;
  }
}

const MobiliseStateSchema = z.object({
  player: zPlayerRef(),
  level: z.number(),
  active: z.boolean(),
});
type MobiliseState = z.infer<typeof MobiliseStateSchema>;

export const MobiliseExecutionSnapshot = execSnapshotType({
  name: "Mobilise",
  version: 1,
  schema: MobiliseStateSchema,
  cls: () => MobiliseExecution,
});
