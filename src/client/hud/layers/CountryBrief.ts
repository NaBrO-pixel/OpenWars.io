import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { estimate } from "@openfront/engine-lib/configuration/IntelRules";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import type { GameEvent } from "@openfront/shared/EventBus";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView, PlayerView } from "../../view";
import { formatShare } from "../NationalSummary";
import { confidence, formatEstimate } from "./IntelligencePanel";

/**
 * Opens a command-nav section; with `target`, the Intelligence section
 * opens on that country.
 */
export class OpenCommandSectionEvent implements GameEvent {
  constructor(
    public readonly section: "diplomacy" | "intelligence",
    public readonly target?: string,
  ) {}
}

function row(label: string, value: string) {
  return html`<div class="flex items-baseline justify-between gap-3 text-sm">
    <span class="text-ow-text-2">${label}</span>
    <span class="tabular-nums text-ow-text">${value}</span>
  </div>`;
}

/**
 * The contextual country brief in the player panel (OpenWars): what your
 * intelligence knows about the country you clicked, your agreements with
 * it, and shortcuts to the Diplomacy and Intelligence panels. Figures are
 * exact, estimated or unknown by the same rules as the Intelligence panel.
 */
export function renderCountryBrief(
  game: GameView,
  me: PlayerView,
  target: PlayerView,
  open: (e: OpenCommandSectionEvent) => void,
): TemplateResult | typeof nothing {
  if (
    me === target ||
    me.nation() === null ||
    target.type() === PlayerType.Bot ||
    !target.isAlive()
  ) {
    return nothing;
  }
  const level = confidence(me, target);
  const n = target.nation();
  const est = (v: number, render: (n: number) => string) =>
    formatEstimate(estimate(v, level), render);
  const land = Math.max(1, game.numLandTiles());
  const agreements =
    me
      .nation()
      ?.diplomacy.agreements.filter((a) => a.other === target.id())
      .map((a) => translateText(`diplomacy.kind_${a.kind}`)) ?? [];
  return html`<section class="flex flex-col gap-1" data-country-brief>
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-ow-text-2">
        ${translateText("country_brief.title")}
      </h3>
      <span
        class="rounded border border-ow-border px-1.5 text-[11px] uppercase text-ow-text-2"
        data-confidence=${level}
        >${translateText(`intelligence.level_${level}`)}</span
      >
    </header>
    ${row(translateText("command_bar.territory"), formatShare(target.numTilesOwned() / land))}
    ${row(translateText("command_bar.population"), est(target.troops(), renderTroops))}
    ${
      n === null
        ? nothing
        : html`${row(
            translateText("command_bar.income"),
            est(n.income.base + n.income.tax + n.income.industry, renderNumber),
          )}
          ${row(
            translateText("command_bar.stability"),
            est(n.stability, (v) => `${Math.round(v / 10)}%`),
          )}
          ${row(translateText("intelligence.reputation"), String(n.diplomacy.reputation))}`
    }
    ${row(
      translateText("country_brief.agreements"),
      agreements.length === 0 ? "—" : agreements.join(", "),
    )}
    <div class="mt-1 flex gap-2">
      <button
        class="flex-1 rounded border border-ow-border px-2 py-1 text-xs text-ow-text hover:border-ow-accent"
        data-brief-open="diplomacy"
        @click=${() => open(new OpenCommandSectionEvent("diplomacy"))}
      >
        ${translateText("country_brief.open_diplomacy")}
      </button>
      <button
        class="flex-1 rounded border border-ow-border px-2 py-1 text-xs text-ow-text hover:border-ow-accent"
        data-brief-open="intelligence"
        @click=${() =>
          open(new OpenCommandSectionEvent("intelligence", target.id()))}
      >
        ${translateText("country_brief.open_intelligence")}
      </button>
    </div>
  </section>`;
}
