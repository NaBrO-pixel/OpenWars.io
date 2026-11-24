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
  /**
   * Influence grows with time: a nation may hold agreements (other than
   * ceasefires) with this share of the other nations per minute of play,
   * permille, and always with at least one. 20 = 2% a minute, so the 40%
   * the diplomatic victory needs takes about twenty minutes whatever the
   * size of the game.
   */
  influencePerMinutePermille: 20,
  /** Economy steps between an AI nation's trade offers. */
  aiOfferEverySteps: 30,
} as const;

/**
 * How many partners (nations it holds an agreement other than a ceasefire
 * with) a nation may have after `ticks` of play among `others` other
 * nations. Shared by the engine and the diplomacy panel.
 */
export function influenceCap(others: number, ticks: number): number {
  const minutes = Math.floor(Math.max(0, ticks) / 600);
  const share = minutes * DiplomacyConfig.influencePerMinutePermille;
  return Math.max(1, Math.ceil((others * share) / 1000));
}

export const AGREEMENT_KINDS = ["nap", "trade", "ceasefire", "intel"] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];
