import type { WorldEventView } from "@openfront/engine-api/game/Diplomacy";
import { EVENT_BY_ID } from "@openfront/engine-lib/configuration/EventConfig";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";

function card(
  game: GameView,
  me: PlayerView,
  e: WorldEventView,
  past: boolean,
): TemplateResult {
  const now = game.ticks();
  const warning = !past && now < e.startsAt;
  const left = Math.max(
    0,
    Math.ceil(((warning ? e.startsAt : e.endsAt) - now) / 10),
  );
  const target =
    e.target === null
      ? translateText("world_events.everyone")
      : (game
          .playerViews()
          .find((p) => p.id() === e.target)
          ?.displayName() ?? "");
  const mine = e.target === null || e.target === me.id();
  const def = EVENT_BY_ID.get(e.id);
  return html`<div
    class="mt-2 rounded border p-2 ${
      past
        ? "border-ow-border/50 opacity-70"
        : warning
          ? "border-ow-warning/60 bg-ow-warning/10"
          : mine
            ? "border-ow-accent bg-ow-accent/10"
            : "border-ow-border"
    }"
    data-world-event=${e.id}
    data-phase=${past ? "past" : warning ? "warning" : "active"}
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-sm font-semibold text-ow-text"
        >${translateText(`world_event.${e.id}.name`)}</span
      >
      <span class="text-[11px] text-ow-text-2"
        >${
          past
            ? translateText("world_events.ended")
            : warning
              ? translateText("world_events.starts_in", { s: left })
              : translateText("world_events.ends_in", { s: left })
        }</span
      >
    </div>
    <p class="text-xs text-ow-text-2">
      ${translateText(`world_event.${e.id}.desc`)}
    </p>
    <p class="text-xs text-ow-text">
      ${translateText("world_events.affects", { target })}
      ${mine && !past ? html`<strong class="text-ow-accent">· ${translateText("world_events.you")}</strong>` : nothing}
    </p>
    <p class="text-xs ${def ? "text-ow-warning" : ""}">
      ${translateText(`world_event.${e.id}.effect`)}
    </p>
  </div>`;
}

export function renderEvents(game: GameView, me: PlayerView): TemplateResult {
  const n = me.nation()!;
  return html`
    <p class="text-sm text-ow-text-2">${translateText("world_events.intro")}</p>
    <h3
      class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
    >
      ${translateText("world_events.current")}
    </h3>
    ${
      n.events.length === 0
        ? html`<p class="text-sm text-ow-text-2" data-no-events>
            ${translateText("world_events.none")}
          </p>`
        : n.events.map((e) => card(game, me, e, false))
    }
    ${
      n.eventHistory.length === 0
        ? nothing
        : html`<h3
              class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
            >
              ${translateText("world_events.history")}
            </h3>
            ${[...n.eventHistory].reverse().map((e) => card(game, me, e, true))}`
    }
  `;
}
