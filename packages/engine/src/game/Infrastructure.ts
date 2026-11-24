// The game's infrastructure: levels per city (development site) and the
// projects under way. Owned by GameImpl, advanced once a second by
// NationalEconomyExecution, changed by InfrastructureExecution (player
// intents). A city keeps its infrastructure when it changes hands.
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  INFRASTRUCTURE_KINDS,
  type InfrastructureKind,
  InfrastructureKindSchema,
  type InfrastructureProjectView,
  type InfrastructureSiteView,
  type SiteLevels,
} from "@openfront/engine-api/game/Infrastructure";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import {
  projectCost,
  type StartRefusal,
  startRefusal,
} from "@openfront/engine-lib/configuration/InfrastructureRules";
import { z } from "zod";
import type { Game, Player, Unit } from "./Game";

const infra = EconomyConfig.infrastructure;

export function emptyLevels(): SiteLevels {
  return { roads: 0, railways: 0, industry: 0, research: 0 };
}

interface Project {
  unitId: number;
  owner: string; // PlayerID that paid
  kind: InfrastructureKind;
  level: number;
  done: number;
  total: number;
  money: number;
  industry: number;
}

export const InfrastructureDataSchema = z.object({
  sites: z.array(
    z.tuple([
      z.number(),
      z.object({
        roads: z.number(),
        railways: z.number(),
        industry: z.number(),
        research: z.number(),
      }),
    ]),
  ),
  projects: z.array(
    z.object({
      unitId: z.number(),
      owner: z.string(),
      kind: InfrastructureKindSchema,
      level: z.number(),
      done: z.number(),
      total: z.number(),
      money: z.number(),
      industry: z.number(),
    }),
  ),
});
export type InfrastructureData = z.infer<typeof InfrastructureDataSchema>;

export class InfrastructureMap {
  private sites = new Map<number, SiteLevels>();
  private projects: Project[] = [];

  levels(unitId: number): SiteLevels {
    return this.sites.get(unitId) ?? emptyLevels();
  }

  /** The player's development sites: their finished cities, in id order. */
  sitesOf(player: Player): Unit[] {
    return player
      .units(UnitType.City)
      .filter((u) => u.isActive() && !u.isUnderConstruction())
      .sort((a, b) => a.id() - b.id());
  }

  /** Every level across the player's sites, by kind. */
  totalsFor(player: Player): SiteLevels {
    const total = emptyLevels();
    for (const city of this.sitesOf(player)) {
      const l = this.levels(city.id());
      for (const k of INFRASTRUCTURE_KINDS) total[k] += l[k];
    }
    return total;
  }

  projectsOf(player: Player): Project[] {
    return this.projects.filter((p) => p.owner === player.id());
  }

  /** Why the player can't start this project now, or null if they can. */
  canStart(
    game: Game,
    player: Player,
    unitId: number,
    kind: InfrastructureKind,
  ): StartRefusal | null {
    if (!game.config().isOpenWars()) return "not_openwars";
    const city = this.sitesOf(player).find((u) => u.id() === unitId);
    if (city === undefined) return "not_a_site";
    return startRefusal({
      unitId,
      kind,
      levels: this.levels(unitId),
      projects: this.projectsOf(player),
      siteBusy: this.projects.some(
        (p) => p.unitId === unitId && p.kind === kind,
      ),
      money: player.gold(),
      industry: player.nation()?.industry ?? 0,
      freeMoney: game.config().hasInfiniteGoldFor(player),
      extraProjects: player.nation()?.tech().extraProjects ?? 0,
      industryCutPermille:
        player.nation()?.tech().infrastructureIndustryCutPermille ?? 0,
    });
  }

  /** Starts a project, paying for it; null on success, else why not. */
  start(
    game: Game,
    player: Player,
    unitId: number,
    kind: InfrastructureKind,
  ): StartRefusal | null {
    const refusal = this.canStart(game, player, unitId, kind);
    if (refusal !== null) return refusal;
    const level = this.levels(unitId)[kind] + 1;
    const nation = player.ensureNation();
    const cost = projectCost(
      kind,
      level,
      nation.tech().infrastructureIndustryCutPermille,
    );
    const money = game.config().hasInfiniteGoldFor(player) ? 0 : cost.money;
    nation.spend(cost.industry, 0);
    player.removeGold(BigInt(money));
    this.projects.push({
      unitId,
      owner: player.id(),
      kind,
      level,
      done: 0,
      total: cost.steps,
      money,
      industry: cost.industry,
    });
    nation.invalidate();
    return null;
  }

  /** Cancels the player's project, with a partial refund. */
  cancel(player: Player, unitId: number, kind: InfrastructureKind): boolean {
    const i = this.projects.findIndex(
      (p) => p.unitId === unitId && p.kind === kind && p.owner === player.id(),
    );
    if (i < 0) return false;
    const [p] = this.projects.splice(i, 1);
    const nation = player.ensureNation();
    nation.industry += p.industry;
    player.addGold(
      BigInt(Math.floor((p.money * infra.cancelMoneyRefundPermille) / 1000)),
    );
    nation.invalidate();
    return true;
  }

  /**
   * One second of building for the player's projects. Completed levels are
   * returned; a project whose city the player no longer holds is lost.
   */
  advance(
    game: Game,
    player: Player,
  ): { unitId: number; kind: InfrastructureKind; level: number }[] {
    const owned = new Set(this.sitesOf(player).map((u) => u.id()));
    const done: { unitId: number; kind: InfrastructureKind; level: number }[] =
      [];
    this.projects = this.projects.filter((p) => {
      if (p.owner !== player.id()) return true;
      if (!owned.has(p.unitId)) return false;
      p.done++;
      if (p.done < p.total) return true;
      const levels = { ...this.levels(p.unitId) };
      levels[p.kind] = p.level;
      this.sites.set(p.unitId, levels);
      done.push({ unitId: p.unitId, kind: p.kind, level: p.level });
      return false;
    });
    // Sites of destroyed cities are forgotten.
    for (const id of [...this.sites.keys()]) {
      if (!game.unit(id)?.isActive()) this.sites.delete(id);
    }
    return done;
  }

  siteViews(player: Player): InfrastructureSiteView[] {
    return this.sitesOf(player).map((u) => ({
      unitId: u.id(),
      ...this.levels(u.id()),
    }));
  }

  projectViews(player: Player): InfrastructureProjectView[] {
    return this.projectsOf(player).map((p) => ({
      unitId: p.unitId,
      kind: p.kind,
      level: p.level,
      done: p.done,
      total: p.total,
    }));
  }

  toData(): InfrastructureData {
    return {
      sites: [...this.sites.entries()].map(([id, l]) => [id, { ...l }]),
      projects: this.projects.map((p) => ({ ...p })),
    };
  }

  restore(d: InfrastructureData): void {
    this.sites = new Map(d.sites.map(([id, l]) => [id, { ...l }]));
    this.projects = d.projects.map((p) => ({ ...p }));
  }
}

export { projectCost, type StartRefusal };
