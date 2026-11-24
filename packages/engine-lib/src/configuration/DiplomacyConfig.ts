// OpenWars diplomacy (docs/OpenWars2.md, milestone 4): agreements and
// reputation. Durations in ticks (10 per second); integers only.

export const DiplomacyConfig = {
  /** How long a proposal waits for an answer. */
  proposalTicks: 60 * 10,
  agreements: {
    /** No attacks between the two for its duration. */
    nap: { ticks: 5 * 60 * 10, breakPenalty: 25 },
    /** Both earn more tax and industry money while it lasts. */
    trade: { ticks: 10 * 60 * 10, breakPenalty: 10 },
    /** A short halt to an ongoing war. */
    ceasefire: { ticks: 90 * 10, breakPenalty: 30 },
    /** Each sees the other's exact figures. Needs an alliance. */
    intel: { ticks: 10 * 60 * 10, breakPenalty: 10 },
  },
  /** Reputation, 0..100; everyone starts at 100. */
  reputationStart: 100,
  /** Recovery: +1 every this many economy steps (seconds). */
  reputationRecoverySteps: 10,
  /** Breaking an alliance (becoming a traitor). */
  allianceBreakPenalty: 20,
  /** AI nations refuse proposals from nations below this reputation. */
  aiMinReputation: 50,
  /** Each trade agreement adds this to tax and industry money, permille. */
  tradePermille: 60,
  tradeCap: 300,
  /** Each alliance adds this to research, permille (shared knowledge). */
  alliancePermille: 40,
  allianceCap: 200,
} as const;

export const AGREEMENT_KINDS = ["nap", "trade", "ceasefire", "intel"] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];
