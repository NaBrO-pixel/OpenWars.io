import type { AgreementKind } from "@openfront/engine-lib/configuration/DiplomacyConfig";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export type DiplomacyAction = "propose" | "accept" | "reject" | "break";

/**
 * A player's "diplomacy" intent. The rules (who may propose what, which
 * proposal exists to accept, what breaking costs) live in DiplomacyMap and
 * run identically on every client; the sender is always the one acting, so
 * nobody can sign or break an agreement for someone else.
 */
export class DiplomacyExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private action: DiplomacyAction,
    private kind: AgreementKind,
    private targetID: string,
  ) {}

  init(mg: Game): void {
    this.active = false;
    if (!mg.config().isOpenWars() || !mg.hasPlayer(this.targetID)) return;
    const target = mg.player(this.targetID);
    const d = mg.diplomacy();
    switch (this.action) {
      case "propose":
        d.propose(mg, this.kind, this.player, target);
        break;
      case "accept":
        d.accept(mg, this.kind, this.player, target);
        break;
      case "reject":
        d.reject(this.kind, this.player, target);
        break;
      case "break":
        d.breakAgreement(mg, this.kind, this.player, target);
        break;
    }
    for (const p of [this.player, target]) {
      p.nation()?.setDiplomacy(d.view(p));
    }
  }

  tick(): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DiplomacyExecutionSnapshot.write({
      player: w.player(this.player),
      action: this.action,
      kind: this.kind,
      targetID: this.targetID,
      active: this.active,
    });
  }

  restoreSnapshot(s: DiplomacyState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.action = s.action;
    this.kind = s.kind;
    this.targetID = s.targetID;
    this.active = s.active;
  }
}

const DiplomacyStateSchema = z.object({
  player: zPlayerRef(),
  action: z.enum(["propose", "accept", "reject", "break"]),
  kind: z.enum(["nap", "trade", "ceasefire", "intel"]),
  targetID: z.string(),
  active: z.boolean(),
});
type DiplomacyState = z.infer<typeof DiplomacyStateSchema>;

export const DiplomacyExecutionSnapshot = execSnapshotType({
  name: "Diplomacy",
  version: 1,
  schema: DiplomacyStateSchema,
  cls: () => DiplomacyExecution,
});
