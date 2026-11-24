import {
  researchRefusal,
  TECH_BY_ID,
} from "@openfront/engine-lib/configuration/TechConfig";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/** Cancelling research refunds this share of its research points and money. */
const CANCEL_REFUND_PERMILLE = 750;

/** Starts researching a technology, paying for it; null on success. */
export function startResearch(game: Game, player: Player, id: string) {
  if (!game.config().isOpenWars()) return "not_openwars" as const;
  const nation = player.ensureNation();
  const freeMoney = game.config().hasInfiniteGoldFor(player);
  const refusal = researchRefusal({
    id,
    completed: new Set(nation.techs),
    active: nation.researching?.id ?? null,
    research: nation.research,
    money: player.gold(),
    freeMoney,
  });
  if (refusal !== null) return refusal;
  const tech = TECH_BY_ID.get(id)!;
  const money = freeMoney ? 0 : tech.money;
  nation.spend(0, tech.research);
  player.removeGold(BigInt(money));
  nation.researching = {
    id,
    done: 0,
    total: tech.steps,
    research: tech.research,
    money,
  };
  nation.invalidate();
  return null;
}

/** Cancels the research under way, with a partial refund. */
export function cancelResearch(player: Player): boolean {
  const nation = player.nation();
  const r = nation?.researching;
  if (!nation || !r) return false;
  nation.researching = null;
  nation.research += Math.floor((r.research * CANCEL_REFUND_PERMILLE) / 1000);
  player.addGold(BigInt(Math.floor((r.money * CANCEL_REFUND_PERMILLE) / 1000)));
  nation.invalidate();
  return true;
}

/**
 * A player's "research" intent. The checks (ruleset, prerequisites, one at a
 * time, cost) run in the engine, identically on every client.
 */
export class ResearchExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private action: "start" | "cancel",
    private tech: string,
  ) {}

  init(mg: Game): void {
    if (this.action === "start") startResearch(mg, this.player, this.tech);
    else if (this.player.nation()?.researching?.id === this.tech) {
      cancelResearch(this.player);
    }
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
    return ResearchExecutionSnapshot.write({
      player: w.player(this.player),
      action: this.action,
      tech: this.tech,
      active: this.active,
    });
  }

  restoreSnapshot(s: ResearchState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.action = s.action;
    this.tech = s.tech;
    this.active = s.active;
  }
}

const ResearchStateSchema = z.object({
  player: zPlayerRef(),
  action: z.enum(["start", "cancel"]),
  tech: z.string(),
  active: z.boolean(),
});
type ResearchState = z.infer<typeof ResearchStateSchema>;

export const ResearchExecutionSnapshot = execSnapshotType({
  name: "Research",
  version: 1,
  schema: ResearchStateSchema,
  cls: () => ResearchExecution,
});
