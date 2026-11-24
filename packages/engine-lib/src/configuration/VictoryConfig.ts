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
    sharePermille: 400,
    /** Needs at least this many nations in the match. */
    minNations: 3,
    holdSteps: 90,
  },
  diplomatic: {
    /** Share of the other nations allied or under agreement. */
    influencePermille: 600,
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
