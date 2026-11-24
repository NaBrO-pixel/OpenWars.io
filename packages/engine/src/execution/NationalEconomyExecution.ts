import {
  MessageType,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { InfrastructureKind } from "@openfront/engine-api/game/Infrastructure";
import { ECONOMY_STEP_TICKS } from "@openfront/engine-lib/configuration/EconomyConfig";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { projectCost } from "../game/Infrastructure";
import type { EconomyInput } from "../game/NationState";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";

/**
 * The OpenWars national economy (docs/OpenWars2.md, milestone 2): once a
 * second, every nation's tax, industry, research, upkeep and stability.
 * Only added under ruleset "openwars" (GameRunner). Tribes (PlayerType.Bot)
 * have no economy.
 */
export class NationalEconomyExecution implements Execution {
  private mg: Game | null = null;

  init(mg: Game): void {
    this.mg = mg;
  }

  isActive(): boolean {
    return true;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  tick(ticks: number): void {
    if (this.mg === null || ticks % ECONOMY_STEP_TICKS !== 0) return;
    for (const player of this.mg.players()) {
      if (!player.isAlive() || player.type() === PlayerType.Bot) continue;
      const nation = player.ensureNation();
      const infra = this.mg.infrastructure();
      for (const done of infra.advance(this.mg, player)) {
        this.mg.displayMessage(
          COMPLETED_MESSAGE[done.kind],
          MessageType.NATIONAL_DEVELOPMENT,
          player.id(),
          undefined,
          { level: done.level },
          done.unitId,
        );
      }
      const { moneyIn, moneyOut } = nation.step(economyInput(this.mg, player));
      if (moneyIn > 0) player.addGold(BigInt(moneyIn));
      if (moneyOut > 0) player.removeGold(BigInt(moneyOut));
      if (
        player.type() === PlayerType.Nation &&
        nation.steps % NATION_DEVELOP_EVERY === 0
      ) {
        developForNation(this.mg, player);
      }
      nation.setInfrastructure(
        infra.siteViews(player),
        infra.projectViews(player),
      );
    }
  }

  snapshot(): ExecRecord {
    return NationalEconomyExecutionSnapshot.write({
      initialized: this.mg !== null,
    });
  }

  restoreSnapshot(s: NationalEconomyState, r: SnapshotReader): void {
    this.mg = s.initialized ? r.game : null;
  }
}

const COMPLETED_MESSAGE: Record<InfrastructureKind, string> = {
  roads: "events_display.infrastructure_completed_roads",
  railways: "events_display.infrastructure_completed_railways",
  industry: "events_display.infrastructure_completed_industry",
  research: "events_display.infrastructure_completed_research",
};

/** Economy steps between an AI nation's development decisions. */
const NATION_DEVELOP_EVERY = 15;
/** The order AI nations develop in. */
const NATION_PRIORITIES: readonly InfrastructureKind[] = [
  "industry",
  "research",
  "roads",
  "railways",
];

/**
 * AI nations develop their cities: the first project they can start while
 * keeping at least as much money again in reserve for their military.
 */
export function developForNation(mg: Game, player: Player): void {
  const infra = mg.infrastructure();
  for (const kind of NATION_PRIORITIES) {
    for (const site of infra.sitesOf(player)) {
      if (infra.canStart(mg, player, site.id(), kind) !== null) continue;
      const level = infra.levels(site.id())[kind] + 1;
      if (player.gold() < BigInt(projectCost(kind, level).money * 2)) continue;
      infra.start(mg, player, site.id(), kind);
      return;
    }
  }
}

/** Levels of a player's finished structures of the given types. */
function levels(player: Player, types: readonly UnitType[]): number {
  let total = 0;
  for (const unit of player.units(types)) {
    if (!unit.isUnderConstruction()) total += unit.level();
  }
  return total;
}

export function economyInput(
  mg: Game,
  player: Player,
): Omit<EconomyInput, "tilesAMinuteAgo"> & { tilesAMinuteAgo: number } {
  return {
    troops: player.troops(),
    tiles: player.numTilesOwned(),
    // Filled in by NationState from its own samples.
    tilesAMinuteAgo: 0,
    factoryLevels: levels(player, [UnitType.Factory]),
    cityLevels: levels(player, [UnitType.City]),
    structureLevels: levels(player, Structures.types),
    baseIncome:
      Number(mg.config().goldAdditionRate(player)) * ECONOMY_STEP_TICKS,
    money: player.gold(),
    infrastructure: mg.infrastructure().totalsFor(player),
  };
}

const NationalEconomyStateSchema = z.object({ initialized: z.boolean() });
type NationalEconomyState = z.infer<typeof NationalEconomyStateSchema>;

export const NationalEconomyExecutionSnapshot = execSnapshotType({
  name: "NationalEconomy",
  version: 1,
  schema: NationalEconomyStateSchema,
  cls: () => NationalEconomyExecution,
});
