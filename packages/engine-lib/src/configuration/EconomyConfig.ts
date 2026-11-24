// OpenWars national economy: every balance value in one place
// (docs/OpenWars2.md, milestone 2). Integers only: the economy runs inside the
// deterministic simulation, so every client must compute the same result.
// Rates are per economy step, which runs once a second (ECONOMY_STEP_TICKS).

export const ECONOMY_STEP_TICKS = 10;

export const EconomyConfig = {
  starting: {
    industry: 0,
    research: 0,
    /** Stability in permille (1000 = 100%). */
    stability: 650,
  },

  // --- income --------------------------------------------------------------
  /** Tax per second, per 1,000 troops (troops are the population), before
   * stability. 50,000 troops (shown as 5K) pay 1,000/s at full stability. */
  taxPerThousandTroops: 20,
  /** Tax at 0 stability, as permille of full tax; 1000 stability pays 100%. */
  taxAtZeroStabilityPermille: 400,
  /** Money each point of industry output adds per second. */
  moneyPerIndustry: 15,

  // --- production ----------------------------------------------------------
  /** Industry per second per factory level. */
  industryPerFactoryLevel: 4,
  /** Industry per second per this many owned tiles. */
  tilesPerIndustry: 500,
  /** Research per second: base, and per city level. */
  researchBase: 1,
  researchPerCityLevel: 1,

  // --- expenses ------------------------------------------------------------
  /** Tiles a nation administers for free. */
  freeTiles: 3_000,
  /** Upkeep per second per 100 tiles beyond freeTiles. */
  upkeepPerHundredTiles: 8,
  /** Upkeep per second per structure level (cities, factories, ports...). */
  upkeepPerStructureLevel: 10,

  // --- stability -----------------------------------------------------------
  stabilityBase: 650,
  /** Development raises the stability target, up to developmentCap. */
  stabilityPerDevelopment: 8,
  stabilityDevelopmentCap: 250,
  /** Growth over the last minute, in permille of the nation's size, that
   * costs this much stability per 100 permille (10% growth). */
  stabilityPerTenPercentGrowth: 40,
  stabilityGrowthPenaltyCap: 300,
  /** A deficit (net income below zero) lowers the target by this much. */
  stabilityDeficitPenalty: 150,
  /** How far stability moves toward its target per second. */
  stabilityStep: 8,

  // --- history (economy panel trends) -------------------------------------
  /** Economy steps between history samples, and samples kept. */
  historyEvery: 10,
  historyLength: 60,
} as const;

export type EconomyConfigType = typeof EconomyConfig;
