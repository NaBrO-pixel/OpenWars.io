import {
  GameMode,
  MessageType,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { InfrastructureKind } from "@openfront/engine-api/game/Infrastructure";
import { ECONOMY_STEP_TICKS } from "@openfront/engine-lib/configuration/EconomyConfig";
import {
  defencePermille,
  supplyPermille,
} from "@openfront/engine-lib/configuration/MilitaryConfig";
import {
  TECH_BRANCHES,
  TECHS,
} from "@openfront/engine-lib/configuration/TechConfig";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { projectCost } from "../game/Infrastructure";
import type { EconomyInput } from "../game/NationState";
import { evaluateVictory } from "../game/Victory";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord, SnapshotReader } from "../snapshot/SnapshotContext";
import { startResearch } from "./ResearchExecution";

/**
 * The OpenWars national economy (docs/OpenWars2.md, milestone 2): once a
 * second, every nation's tax, industry, research, upkeep and stability.
 * Only added under ruleset "openwars" (GameRunner). Tribes (PlayerType.Bot)
 * have no economy.
 */
export class NationalEconomyExecution implements Execution {
  private mg: Game | null = null;
  /** Economy steps run (game-wide; drives reputation recovery). */
  private steps = 0;

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
    this.steps++;
    this.mg.diplomacy().advance(this.mg, this.steps);
    this.mg.worldEvents().advance(this.mg);
    const events = this.mg.worldEvents().views();
    this.checkVictory();
    const eventHistory = this.mg.worldEvents().historyViews();
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
      const researched = nation.advanceResearch();
      if (researched !== null) {
        this.mg.displayMessage(
          RESEARCH_MESSAGE[researched] ?? "events_display.research_completed",
          MessageType.NATIONAL_DEVELOPMENT,
          player.id(),
        );
      }
      if (
        player.type() === PlayerType.Nation &&
        nation.researching === null &&
        nation.steps % NATION_DEVELOP_EVERY === 0
      ) {
        researchForNation(this.mg, player);
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
      const totals = infra.totalsFor(player);
      nation.supply = supplyPermille({
        roads: totals.roads,
        railways: totals.railways,
        tiles: player.numTilesOwned(),
      });
      nation.defence = defencePermille(
        totals.roads + totals.railways + totals.industry + totals.research,
      );
      nation.setInfrastructure(
        infra.siteViews(player),
        infra.projectViews(player),
      );
      nation.setDiplomacy(this.mg.diplomacy().view(player));
      nation.setEvents(events, eventHistory);
      nation.setNeighbours(
        player
          .nearby()
          .filter((n): n is Player => n.isPlayer())
          .map((n) => n.id())
          .sort(),
      );
    }
  }

  /** Alternative victories (milestone 6); the territorial one is WinCheck's. */
  private checkVictory(): void {
    const mg = this.mg!;
    if (mg.getWinner() !== null) return;
    const result = evaluateVictory(mg);
    if (result === null) return;
    const team = result.player.team();
    mg.setWinner(
      mg.config().gameConfig().gameMode === GameMode.Team && team !== null
        ? team
        : result.player,
      mg.stats().stats(),
      result.kind,
    );
  }

  snapshot(): ExecRecord {
    return NationalEconomyExecutionSnapshot.write({
      initialized: this.mg !== null,
      steps: this.steps,
    });
  }

  restoreSnapshot(s: NationalEconomyState, r: SnapshotReader): void {
    this.mg = s.initialized ? r.game : null;
    this.steps = s.steps;
  }
}

const COMPLETED_MESSAGE: Record<InfrastructureKind, string> = {
  roads: "events_display.infrastructure_completed_roads",
  railways: "events_display.infrastructure_completed_railways",
  industry: "events_display.infrastructure_completed_industry",
  research: "events_display.infrastructure_completed_research",
};

const RESEARCH_MESSAGE: Readonly<Record<string, string>> = {
  assembly_lines: "events_display.research_completed_assembly_lines",
  standardised_parts: "events_display.research_completed_standardised_parts",
  logistics_networks: "events_display.research_completed_logistics_networks",
  heavy_industry: "events_display.research_completed_heavy_industry",
  automation: "events_display.research_completed_automation",
  research_labs: "events_display.research_completed_research_labs",
  information_systems: "events_display.research_completed_information_systems",
  project_management: "events_display.research_completed_project_management",
  advanced_computing: "events_display.research_completed_advanced_computing",
  scientific_revolution:
    "events_display.research_completed_scientific_revolution",
  civil_administration:
    "events_display.research_completed_civil_administration",
  public_services: "events_display.research_completed_public_services",
  social_cohesion: "events_display.research_completed_social_cohesion",
  economic_resilience: "events_display.research_completed_economic_resilience",
  national_unity: "events_display.research_completed_national_unity",
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

/**
 * AI nations research: the first technology they can start, taking the
 * branches in turn (starting from one that depends on the nation, so
 * nations specialise differently).
 */
export function researchForNation(mg: Game, player: Player): void {
  const nation = player.ensureNation();
  const start = player.smallID() % TECH_BRANCHES.length;
  for (let i = 0; i < TECH_BRANCHES.length; i++) {
    const branch = TECH_BRANCHES[(start + i) % TECH_BRANCHES.length];
    const next = TECHS.find(
      (t) => t.branch === branch && !nation.hasTech(t.id),
    );
    if (next === undefined) continue;
    // Keep money for the military: research only from a comfortable surplus.
    if (player.gold() < BigInt(next.money * 2)) continue;
    if (startResearch(mg, player, next.id) === null) return;
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
    tradeAgreements: mg.diplomacy().count("trade", player),
    alliances: player.alliances().length,
    events: mg.worldEvents().modifiersFor(player),
    mobilisation: player.nation()?.mobilisation,
  };
}

const NationalEconomyStateSchema = z.object({
  initialized: z.boolean(),
  steps: z.number(),
});
type NationalEconomyState = z.infer<typeof NationalEconomyStateSchema>;

export const NationalEconomyExecutionSnapshot = execSnapshotType({
  name: "NationalEconomy",
  version: 2,
  migrations: { 1: (d) => ({ ...d, steps: 0 }) },
  schema: NationalEconomyStateSchema,
  cls: () => NationalEconomyExecution,
});
