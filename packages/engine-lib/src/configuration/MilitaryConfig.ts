// OpenWars military rules (docs/OpenWars2.md, milestone 6): mobilisation,
// supply and defensive development. Integers, permille.

export const MOBILISATION_LEVELS = [
  "peacetime",
  "standard",
  "mobilised",
  "total_war",
] as const;
export type MobilisationLevel = (typeof MOBILISATION_LEVELS)[number];

export const MilitaryConfig = {
  /** Default mobilisation: index into MOBILISATION_LEVELS. */
  defaultMobilisation: 1,
  /** Troop growth per level, permille of normal. */
  troopGrowthPermille: [600, 1000, 1350, 1600],
  /** Army upkeep per level: money per second per 1,000 troops. */
  upkeepPerThousandTroops: [0, 4, 12, 24],
  /** Stability target change per level. */
  stability: [0, 0, -40, -120],

  // Supply: 500 (poor) .. 1000 (full). Roads and railways supply a nation;
  // a large nation needs more of them.
  supplyBase: 500,
  supplyPerRoadLevel: 100,
  supplyPerRailLevel: 150,
  /** Supply is measured per this many tiles (bigger nations need more). */
  supplyTiles: 3_000,
  /** Attacker troop losses at supply s: (2000 - s) / 1000, i.e. x1.5 .. x1. */

  // Defence from development: infrastructure levels raise attackers' losses.
  defencePerInfrastructureLevel: 12,
  defenceCap: 250,
} as const;

/** Supply efficiency, permille, from roads, railways and territory size. */
export function supplyPermille(args: {
  roads: number;
  railways: number;
  tiles: number;
}): number {
  const c = MilitaryConfig;
  const reach =
    args.roads * c.supplyPerRoadLevel + args.railways * c.supplyPerRailLevel;
  return Math.min(
    1000,
    c.supplyBase +
      Math.floor((reach * c.supplyTiles) / Math.max(c.supplyTiles, args.tiles)),
  );
}

/** Defensive bonus, permille added to attackers' losses. */
export function defencePermille(infrastructureLevels: number): number {
  return Math.min(
    MilitaryConfig.defenceCap,
    infrastructureLevels * MilitaryConfig.defencePerInfrastructureLevel,
  );
}
