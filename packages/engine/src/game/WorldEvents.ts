// OpenWars world events (docs/OpenWars2.md, milestone 5): scheduled from the
// EventConfig catalogue, announced ahead of time, applied as temporary
// economy modifiers. Owned by GameImpl and advanced once a second by
// NationalEconomyExecution. Choices come from hashing the tick, so there is
// no random state and every client picks the same events.
import type { WorldEventView } from "@openfront/engine-api/game/Diplomacy";
import { MessageType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  EVENT_BY_ID,
  EventConfig,
  type EventDefinition,
  type EventModifiers,
  EVENTS,
  eventModifiers,
} from "@openfront/engine-lib/configuration/EventConfig";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import type { Game, Player } from "./Game";

interface WorldEvent {
  id: string;
  target: string | null;
  startsAt: number;
  endsAt: number;
  started: boolean;
}

export const WorldEventsDataSchema = z.object({
  nextAt: z.number(),
  active: z.array(
    z.object({
      id: z.string(),
      target: z.string().nullable(),
      startsAt: z.number(),
      endsAt: z.number(),
      started: z.boolean(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.string(),
      target: z.string().nullable(),
      startsAt: z.number(),
      endsAt: z.number(),
    }),
  ),
});
export type WorldEventsData = z.infer<typeof WorldEventsDataSchema>;

const PHASES = ["warning", "start", "end"] as const;
type Phase = (typeof PHASES)[number];

const MESSAGE: Record<string, Record<Phase, string>> = {
  global_recession: {
    warning: "events_display.world_event_global_recession_warning",
    start: "events_display.world_event_global_recession_start",
    end: "events_display.world_event_global_recession_end",
  },
  industrial_boom: {
    warning: "events_display.world_event_industrial_boom_warning",
    start: "events_display.world_event_industrial_boom_start",
    end: "events_display.world_event_industrial_boom_end",
  },
  trade_disruption: {
    warning: "events_display.world_event_trade_disruption_warning",
    start: "events_display.world_event_trade_disruption_start",
    end: "events_display.world_event_trade_disruption_end",
  },
  political_instability: {
    warning: "events_display.world_event_political_instability_warning",
    start: "events_display.world_event_political_instability_start",
    end: "events_display.world_event_political_instability_end",
  },
  technological_breakthrough: {
    warning: "events_display.world_event_technological_breakthrough_warning",
    start: "events_display.world_event_technological_breakthrough_start",
    end: "events_display.world_event_technological_breakthrough_end",
  },
  natural_disaster: {
    warning: "events_display.world_event_natural_disaster_warning",
    start: "events_display.world_event_natural_disaster_start",
    end: "events_display.world_event_natural_disaster_end",
  },
  arms_race: {
    warning: "events_display.world_event_arms_race_warning",
    start: "events_display.world_event_arms_race_start",
    end: "events_display.world_event_arms_race_end",
  },
  scientific_summit: {
    warning: "events_display.world_event_scientific_summit_warning",
    start: "events_display.world_event_scientific_summit_start",
    end: "events_display.world_event_scientific_summit_end",
  },
  bumper_harvest: {
    warning: "events_display.world_event_bumper_harvest_warning",
    start: "events_display.world_event_bumper_harvest_start",
    end: "events_display.world_event_bumper_harvest_end",
  },
  cyber_attack: {
    warning: "events_display.world_event_cyber_attack_warning",
    start: "events_display.world_event_cyber_attack_start",
    end: "events_display.world_event_cyber_attack_end",
  },
};

/** A number in [0, n) from the tick and a salt: the same on every client. */
function pick(tick: number, salt: string, n: number): number {
  return Math.abs(simpleHash(`${tick}:${salt}`)) % n;
}

export class WorldEvents {
  private nextAt: number = EventConfig.firstEventTicks;
  private active: WorldEvent[] = [];
  private history: Omit<WorldEvent, "started">[] = [];
  /** The events' summed effects per PlayerID; rebuilt on every change. */
  private cache = new Map<string, EventModifiers>();

  private nations(game: Game): Player[] {
    return game
      .players()
      .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot)
      .sort((a, b) => a.smallID() - b.smallID());
  }

  /** The effects of running events on this nation. */
  modifiersFor(player: Player): EventModifiers {
    let m = this.cache.get(player.id());
    if (m === undefined) {
      m = eventModifiers(
        this.active
          .filter(
            (e) => e.started && (e.target === null || e.target === player.id()),
          )
          .map((e) => EVENT_BY_ID.get(e.id)!.effects),
      );
      this.cache.set(player.id(), m);
    }
    return m;
  }

  /** Once a second: start, end and schedule events. */
  advance(game: Game, frequencyPermille = 1000): void {
    const now = game.ticks();
    for (const e of [...this.active]) {
      const def = EVENT_BY_ID.get(e.id)!;
      if (!e.started && now >= e.startsAt) {
        e.started = true;
        this.cache.clear();
        this.begin(game, e, def);
      }
      if (e.started && now >= e.endsAt) {
        this.active.splice(this.active.indexOf(e), 1);
        this.history.push({
          id: e.id,
          target: e.target,
          startsAt: e.startsAt,
          endsAt: e.endsAt,
        });
        while (this.history.length > EventConfig.historyLength) {
          this.history.shift();
        }
        this.cache.clear();
        this.announce(game, e, "end");
      }
    }
    if (frequencyPermille <= 0 || now < this.nextAt) return;
    const gap =
      EventConfig.gapMinTicks +
      pick(now, "gap", EventConfig.gapMaxTicks - EventConfig.gapMinTicks + 1);
    this.nextAt = now + Math.floor((gap * 1000) / frequencyPermille);
    if (this.active.length >= EventConfig.maxConcurrent) return;
    this.schedule(game, now);
  }

  private schedule(game: Game, now: number): void {
    const nations = this.nations(game);
    const minute = Math.floor(now / 600);
    const eligible = EVENTS.filter(
      (d) =>
        minute >= d.minMinute &&
        nations.length >= d.minNations &&
        // Never the same event twice at once.
        !this.active.some((a) => a.id === d.id),
    );
    if (eligible.length === 0 || nations.length === 0) return;
    const total = eligible.reduce((s, d) => s + d.weight, 0);
    let roll = pick(now, "event", total);
    let def: EventDefinition = eligible[0];
    for (const d of eligible) {
      if (roll < d.weight) {
        def = d;
        break;
      }
      roll -= d.weight;
    }
    const target =
      def.scope === "global"
        ? null
        : nations[pick(now, def.id, nations.length)].id();
    const e: WorldEvent = {
      id: def.id,
      target,
      startsAt: now + def.warningTicks,
      endsAt: now + def.warningTicks + def.durationTicks,
      started: false,
    };
    this.active.push(e);
    if (def.warningTicks > 0) this.announce(game, e, "warning");
    else {
      e.started = true;
      this.cache.clear();
      this.begin(game, e, def);
    }
  }

  private begin(game: Game, e: WorldEvent, def: EventDefinition): void {
    if (
      def.industryLossPermille &&
      e.target !== null &&
      game.hasPlayer(e.target)
    ) {
      const nation = game.player(e.target).nation();
      if (nation !== null) {
        nation.industry -= Math.floor(
          (nation.industry * def.industryLossPermille) / 1000,
        );
        nation.invalidate();
      }
    }
    this.announce(game, e, "start");
  }

  private announce(game: Game, e: WorldEvent, phase: Phase): void {
    const name =
      e.target !== null && game.hasPlayer(e.target)
        ? game.player(e.target).displayName()
        : "";
    const message = MESSAGE[e.id]?.[phase];
    if (message === undefined) return;
    // A global event, or one about a nation, is news for everyone.
    game.displayMessage(
      message,
      phase === "end"
        ? MessageType.NATIONAL_DEVELOPMENT
        : MessageType.ALLIANCE_EXPIRED,
      null,
      undefined,
      { name },
    );
    for (const p of game.players()) p.nation()?.invalidate();
  }

  views(): WorldEventView[] {
    return this.active.map((e) => ({
      id: e.id,
      target: e.target,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
    }));
  }

  historyViews(): WorldEventView[] {
    return this.history.map((e) => ({ ...e }));
  }

  toData(): WorldEventsData {
    return {
      nextAt: this.nextAt,
      active: this.active.map((e) => ({ ...e })),
      history: this.history.map((e) => ({ ...e })),
    };
  }

  restore(d: WorldEventsData): void {
    this.nextAt = d.nextAt;
    this.active = d.active.map((e) => ({ ...e }));
    this.history = d.history.map((e) => ({ ...e }));
    this.cache.clear();
  }
}
