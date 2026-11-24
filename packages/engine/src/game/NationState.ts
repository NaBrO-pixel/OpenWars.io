// A nation's economy under the OpenWars ruleset (docs/OpenWars2.md,
// milestone 2): industry and research stockpiles, stability, and the last
// step's income and expenses. Updated once a second by
// NationalEconomyExecution; integer arithmetic only, so every client agrees.
import type {
  NationExpenses,
  NationIncome,
  NationView,
} from "@openfront/engine-api/game/GameUpdates";
import type {
  InfrastructureProjectView,
  InfrastructureSiteView,
  SiteLevels,
} from "@openfront/engine-api/game/Infrastructure";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import { z } from "zod";

/** What one economy step reads about a nation. */
export interface EconomyInput {
  troops: number;
  tiles: number;
  /** Tiles owned a minute ago (or at the start of the nation's economy). */
  tilesAMinuteAgo: number;
  factoryLevels: number;
  cityLevels: number;
  /** Levels of every structure (cities, factories, ports, posts...). */
  structureLevels: number;
  /** Base (worker) income per second, already paid by PlayerExecution. */
  baseIncome: number;
  money: bigint;
  /** Infrastructure levels summed over the nation's cities. */
  infrastructure: SiteLevels;
}

/** What one economy step decides. */
export interface EconomyResult {
  income: NationIncome;
  expenses: NationExpenses;
  /** Money to add (income other than base) and to remove (expenses). */
  moneyIn: number;
  moneyOut: number;
  industryRate: number;
  researchRate: number;
  development: number;
  stabilityTarget: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/** The pure economy rules: inputs and current stability in, a step out. */
export function economyStep(
  input: EconomyInput,
  stability: number,
  cfg = EconomyConfig,
): EconomyResult {
  const infra = input.infrastructure;
  const ic = cfg.infrastructure;
  // Production: factories, land, and industrial and research centres.
  const industryRate =
    input.factoryLevels * cfg.industryPerFactoryLevel +
    Math.floor(input.tiles / cfg.tilesPerIndustry) +
    infra.industry * ic.industryPerIndustrialLevel;
  const researchRate =
    cfg.researchBase +
    input.cityLevels * cfg.researchPerCityLevel +
    infra.research * ic.researchPerResearchLevel;

  // Income: tax on the population, scaled by stability, and industry.
  const fullTax = Math.floor((input.troops * cfg.taxPerThousandTroops) / 1000);
  const taxPermille =
    cfg.taxAtZeroStabilityPermille +
    Math.floor(((1000 - cfg.taxAtZeroStabilityPermille) * stability) / 1000);
  const tax = Math.floor((fullTax * taxPermille) / 1000);
  // Railways carry industry's goods: more money per unit of industry.
  const railPermille = Math.min(
    ic.industryMoneyCap,
    infra.railways * ic.industryMoneyPerRailLevel,
  );
  const industryMoney = Math.floor(
    (industryRate * cfg.moneyPerIndustry * (1000 + railPermille)) / 1000,
  );

  // Expenses: administering land beyond the free allowance, and upkeep of
  // what has been built.
  // Roads make land cheaper to administer.
  const roadCut = Math.min(
    ic.upkeepCutCap,
    infra.roads * ic.upkeepCutPerRoadLevel,
  );
  const territory = Math.floor(
    (Math.max(0, input.tiles - cfg.freeTiles) *
      cfg.upkeepPerHundredTiles *
      (1000 - roadCut)) /
      100_000,
  );
  const structures = input.structureLevels * cfg.upkeepPerStructureLevel;

  const moneyIn = tax + industryMoney;
  const moneyOut = territory + structures;
  const net = input.baseIncome + moneyIn - moneyOut;

  // Stability target: development raises it; fast growth and deficits
  // lower it.
  const development =
    input.structureLevels +
    infra.roads +
    infra.railways +
    infra.industry +
    infra.research;
  const devBonus = Math.min(
    cfg.stabilityDevelopmentCap,
    development * cfg.stabilityPerDevelopment,
  );
  // Growth over the last minute, relative to the nation's size but never to
  // less than the free heartland: early expansion from a spawn is the game's
  // opening, not overreach.
  const growthPermille = Math.floor(
    (Math.max(0, input.tiles - input.tilesAMinuteAgo) * 1000) /
      Math.max(input.tilesAMinuteAgo, cfg.freeTiles),
  );
  const growthPenalty = Math.min(
    cfg.stabilityGrowthPenaltyCap,
    Math.floor((growthPermille * cfg.stabilityPerTenPercentGrowth) / 100),
  );
  // A deficit that the treasury cannot cover is what hurts.
  const deficit = net < 0 && input.money < BigInt(-net);
  const stabilityTarget = clamp(
    cfg.stabilityBase +
      devBonus -
      growthPenalty -
      (deficit ? cfg.stabilityDeficitPenalty : 0),
    0,
    1000,
  );

  return {
    income: { base: input.baseIncome, tax, industry: industryMoney },
    expenses: { territory, structures },
    moneyIn,
    moneyOut,
    industryRate,
    researchRate,
    development,
    stabilityTarget,
  };
}

/** Moves stability one step toward its target. */
export function stepStability(
  stability: number,
  target: number,
  step: number = EconomyConfig.stabilityStep,
): number {
  if (stability < target) return Math.min(target, stability + step);
  if (stability > target) return Math.max(target, stability - step);
  return stability;
}

export const NationStateSchema = z.object({
  industry: z.number(),
  research: z.number(),
  stability: z.number(),
  steps: z.number(),
  tileSamples: z.array(z.number()),
  netHistory: z.array(z.number()),
  last: z
    .object({
      income: z.object({
        base: z.number(),
        tax: z.number(),
        industry: z.number(),
      }),
      expenses: z.object({ territory: z.number(), structures: z.number() }),
      industryRate: z.number(),
      researchRate: z.number(),
      development: z.number(),
      stabilityTarget: z.number(),
    })
    .nullable(),
});
export type NationStateData = z.infer<typeof NationStateSchema>;

export class NationState {
  industry: number = EconomyConfig.starting.industry;
  research: number = EconomyConfig.starting.research;
  stability: number = EconomyConfig.starting.stability;
  /** Economy steps run. */
  steps = 0;
  /** Tile counts at each history sample, newest last (growth measurement). */
  tileSamples: number[] = [];
  netHistory: number[] = [];
  last: Omit<EconomyResult, "moneyIn" | "moneyOut"> | null = null;
  /** Derived from the game's InfrastructureMap; not snapshotted. */
  private sites: InfrastructureSiteView[] = [];
  private projects: InfrastructureProjectView[] = [];
  private cachedView: NationView | null = null;

  /** Forces a new view object (the figures changed between steps). */
  invalidate(): void {
    this.cachedView = null;
  }

  setInfrastructure(
    sites: InfrastructureSiteView[],
    projects: InfrastructureProjectView[],
  ): void {
    this.sites = sites;
    this.projects = projects;
    this.cachedView = null;
  }

  /** Runs one economy step; returns the money to add and remove. */
  step(input: EconomyInput): { moneyIn: number; moneyOut: number } {
    const cfg = EconomyConfig;
    if (this.tileSamples.length === 0) this.tileSamples.push(input.tiles);
    const result = economyStep(
      { ...input, tilesAMinuteAgo: this.tileSamples[0] },
      this.stability,
    );
    this.industry += result.industryRate;
    this.research += result.researchRate;
    this.stability = stepStability(this.stability, result.stabilityTarget);
    this.steps++;
    if (this.steps % cfg.historyEvery === 0) {
      this.tileSamples.push(input.tiles);
      // One minute of samples: 60 s / historyEvery steps, plus the newest.
      while (this.tileSamples.length > 60 / cfg.historyEvery + 1) {
        this.tileSamples.shift();
      }
      this.netHistory.push(input.baseIncome + result.moneyIn - result.moneyOut);
      while (this.netHistory.length > cfg.historyLength) {
        this.netHistory.shift();
      }
    }
    const { moneyIn, moneyOut, ...rest } = result;
    this.last = rest;
    this.cachedView = null;
    return { moneyIn, moneyOut };
  }

  /** Spends from the stockpiles; false (nothing spent) when short. */
  spend(industry: number, research: number): boolean {
    if (this.industry < industry || this.research < research) return false;
    this.industry -= industry;
    this.research -= research;
    this.cachedView = null;
    return true;
  }

  view(): NationView {
    if (this.cachedView !== null) return this.cachedView;
    const last = this.last;
    this.cachedView = {
      industry: this.industry,
      research: this.research,
      stability: this.stability,
      stabilityTarget: last?.stabilityTarget ?? this.stability,
      income: last?.income ?? { base: 0, tax: 0, industry: 0 },
      expenses: last?.expenses ?? { territory: 0, structures: 0 },
      industryRate: last?.industryRate ?? 0,
      researchRate: last?.researchRate ?? 0,
      development: last?.development ?? 0,
      netHistory: [...this.netHistory],
      sites: this.sites,
      projects: this.projects,
    };
    return this.cachedView;
  }

  toData(): NationStateData {
    return {
      industry: this.industry,
      research: this.research,
      stability: this.stability,
      steps: this.steps,
      tileSamples: [...this.tileSamples],
      netHistory: [...this.netHistory],
      last: copyLast(this.last),
    };
  }

  static fromData(d: NationStateData): NationState {
    const n = new NationState();
    n.industry = d.industry;
    n.research = d.research;
    n.stability = d.stability;
    n.steps = d.steps;
    n.tileSamples = [...d.tileSamples];
    n.netHistory = [...d.netHistory];
    n.last = copyLast(d.last);
    return n;
  }
}

type LastStep = NationState["last"];

function copyLast(last: LastStep): LastStep {
  if (last === null) return null;
  return {
    ...last,
    income: { ...last.income },
    expenses: { ...last.expenses },
  };
}
