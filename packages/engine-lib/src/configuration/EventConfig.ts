// OpenWars world events (docs/OpenWars2.md, milestone 5). Data only: add an
// event by adding an entry. Ticks are 1/10 s; effects are temporary
// modifiers to the economy (integers, permille), so no event can eliminate
// a nation.

export type EventScope = "global" | "nation";

export interface EventEffects {
  taxPermille?: number;
  industryPermille?: number;
  industryMoneyPermille?: number;
  researchPermille?: number;
  stabilityTarget?: number;
  /** Trade agreements pay nothing while this is set. */
  tradeSuspended?: boolean;
}

export interface EventDefinition {
  id: string;
  scope: EventScope;
  /** Relative chance of being picked when an event is due. */
  weight: number;
  /** Earliest minute of the match it can happen in. */
  minMinute: number;
  /** Fewest nations in the match for it to happen. */
  minNations: number;
  /** Warning before it starts, and how long it lasts. */
  warningTicks: number;
  durationTicks: number;
  effects: EventEffects;
  /** Taken from the affected nation's industry stockpile when it starts. */
  industryLossPermille?: number;
}

export const EventConfig = {
  /** No event before this tick (3 minutes), then one every gapMin..gapMax. */
  firstEventTicks: 3 * 60 * 10,
  gapMinTicks: 150 * 10,
  gapMaxTicks: 240 * 10,
  /** At most this many events warned of or running at once. */
  maxConcurrent: 2,
  /** Past events kept for the history list. */
  historyLength: 12,
} as const;

export const EVENTS: readonly EventDefinition[] = [
  {
    id: "global_recession",
    scope: "global",
    weight: 3,
    minMinute: 6,
    minNations: 2,
    warningTicks: 30 * 10,
    durationTicks: 120 * 10,
    effects: { taxPermille: -250, industryMoneyPermille: -200 },
  },
  {
    id: "industrial_boom",
    scope: "global",
    weight: 3,
    minMinute: 3,
    minNations: 1,
    warningTicks: 20 * 10,
    durationTicks: 120 * 10,
    effects: { industryPermille: 300 },
  },
  {
    id: "trade_disruption",
    scope: "global",
    weight: 2,
    minMinute: 5,
    minNations: 2,
    warningTicks: 20 * 10,
    durationTicks: 90 * 10,
    effects: { tradeSuspended: true, industryMoneyPermille: -150 },
  },
  {
    id: "political_instability",
    scope: "nation",
    weight: 3,
    minMinute: 4,
    minNations: 2,
    warningTicks: 20 * 10,
    durationTicks: 90 * 10,
    effects: { stabilityTarget: -150 },
  },
  {
    id: "technological_breakthrough",
    scope: "nation",
    weight: 3,
    minMinute: 3,
    minNations: 1,
    warningTicks: 0,
    durationTicks: 60 * 10,
    effects: { researchPermille: 1000 },
  },
  {
    id: "natural_disaster",
    scope: "nation",
    weight: 2,
    minMinute: 5,
    minNations: 1,
    warningTicks: 15 * 10,
    durationTicks: 60 * 10,
    effects: { stabilityTarget: -80, industryPermille: -250 },
    industryLossPermille: 200,
  },
  {
    id: "arms_race",
    scope: "global",
    weight: 2,
    minMinute: 8,
    minNations: 3,
    warningTicks: 20 * 10,
    durationTicks: 120 * 10,
    effects: { industryPermille: 200, stabilityTarget: -40 },
  },
  {
    id: "scientific_summit",
    scope: "global",
    weight: 2,
    minMinute: 6,
    minNations: 2,
    warningTicks: 20 * 10,
    durationTicks: 90 * 10,
    effects: { researchPermille: 400 },
  },
  {
    id: "bumper_harvest",
    scope: "nation",
    weight: 3,
    minMinute: 3,
    minNations: 1,
    warningTicks: 0,
    durationTicks: 90 * 10,
    effects: { taxPermille: 250, stabilityTarget: 60 },
  },
  {
    id: "cyber_attack",
    scope: "nation",
    weight: 2,
    minMinute: 7,
    minNations: 2,
    warningTicks: 10 * 10,
    durationTicks: 60 * 10,
    effects: { researchPermille: -500, industryMoneyPermille: -150 },
  },
];

export const EVENT_BY_ID: ReadonlyMap<string, EventDefinition> = new Map(
  EVENTS.map((e) => [e.id, e]),
);

export type EventModifiers = Required<Omit<EventEffects, "tradeSuspended">> & {
  tradeSuspended: boolean;
};

export const NO_EVENT: EventModifiers = {
  taxPermille: 0,
  industryPermille: 0,
  industryMoneyPermille: 0,
  researchPermille: 0,
  stabilityTarget: 0,
  tradeSuspended: false,
};

/** Sums the effects of the given running events. */
export function eventModifiers(
  effects: Iterable<EventEffects>,
): EventModifiers {
  const m: EventModifiers = { ...NO_EVENT };
  for (const e of effects) {
    m.taxPermille += e.taxPermille ?? 0;
    m.industryPermille += e.industryPermille ?? 0;
    m.industryMoneyPermille += e.industryMoneyPermille ?? 0;
    m.researchPermille += e.researchPermille ?? 0;
    m.stabilityTarget += e.stabilityTarget ?? 0;
    m.tradeSuspended ||= e.tradeSuspended === true;
  }
  return m;
}
