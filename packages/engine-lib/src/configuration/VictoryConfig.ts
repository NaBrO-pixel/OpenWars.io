// OpenWars victory conditions (docs/OpenWars2.md, milestone 6). The
// territorial victory is the classic win check (WinCheckExecution); these are
// the other paths. Thresholds are permille; holds are economy steps (seconds)
// a condition must stay met, so a passing spike can't win.

export const VICTORY_KINDS = [
  "territorial",
  "economic",
  "diplomatic",
  "technological",
] as const;
export type VictoryKind = (typeof VICTORY_KINDS)[number];

export const VictoryConfig = {
  economic: {
    /** Share of the world's income (net, positive nations only). */
    sharePermille: 300,
    /**
     * And at least this many times a fair share (1 / nations), so a small
     * game isn't won by whoever happens to lead.
     */
    fairShareMultiple: 2,
    /** Never more than this. */
    maxSharePermille: 900,
    /** Needs at least this many nations in the match. */
    minNations: 3,
    holdSteps: 90,
  },
  diplomatic: {
    /** Share of the other nations allied or under agreement. */
    influencePermille: 400,
    /** And never fewer partners than this (or all the others, if fewer). */
    minPartners: 2,
    minReputation: 70,
    minNations: 3,
    holdSteps: 90,
  },
  technological: {
    /** All advanced specialisations (tier 5 of every branch). */
    tier: 5,
    holdSteps: 0,
  },
} as const;

/** The share of world income (permille) the economic victory needs. */
export function economicShareNeeded(nations: number): number {
  const c = VictoryConfig.economic;
  const fair = Math.ceil((1000 * c.fairShareMultiple) / Math.max(1, nations));
  return Math.min(c.maxSharePermille, Math.max(c.sharePermille, fair));
}

/** Partners (of `others` nations) the diplomatic victory needs. */
export function diplomaticPartnersNeeded(others: number): number {
  const c = VictoryConfig.diplomatic;
  const share = Math.ceil((others * c.influencePermille) / 1000);
  return Math.min(others, Math.max(c.minPartners, share));
}
