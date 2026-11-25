import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  formatClock,
  formatIncome,
  formatShare,
  formatStability,
  IncomeTracker,
  type NationalSummary,
  nationalSummary,
} from "../NationalSummary";

/**
 * The top resource bar: the player's national figures at a glance. Compact
 * indicators, not cards, so the map keeps the screen.
 */
@customElement("command-bar")
export class CommandBar extends LitElement implements Controller {
  public game: GameView;

  @state() private summary: NationalSummary | null = null;
  private income = new IncomeTracker();

  createRenderRoot() {
    return this;
  }

  init() {
    this.income.reset();
    this.summary = null;
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player || !player.isAlive() || this.game.inSpawnPhase()) {
      this.summary = null;
      return;
    }
    this.summary = nationalSummary(this.game, player, this.income);
  }

  private item(label: string, value: string, tone = "text-ow-text") {
    return html`<div
      class="flex flex-col items-center leading-tight px-2 sm:px-3 min-w-0"
      data-command-bar-item
    >
      <span
        class="font-display text-[9px] uppercase tracking-[0.14em] text-ow-text-2 whitespace-nowrap"
        >${label}</span
      >
      <span class="ow-readout text-sm sm:text-base tabular-nums ${tone}"
        >${value}</span
      >
    </div>`;
  }

  render() {
    const s = this.summary;
    if (s === null) return nothing;
    return html`
      <div
        class="ow-glass pointer-events-auto mt-2 flex items-stretch divide-x divide-ow-border/70 rounded-md border py-1.5"
        role="status"
        aria-label=${translateText("command_bar.label")}
      >
        ${this.item(
          translateText("command_bar.money"),
          renderNumber(s.money),
          "text-ow-accent-2",
        )}
        ${this.item(
          translateText("command_bar.income"),
          formatIncome(s.incomePerSecond, renderNumber),
          (s.incomePerSecond ?? 0) >= 0 ? "text-ow-success" : "text-ow-error",
        )}
        ${this.item(
          translateText("command_bar.population"),
          `${renderTroops(s.population)} / ${renderTroops(s.maxPopulation)}`,
        )}
        ${this.item(
          translateText("command_bar.territory"),
          formatShare(s.territoryShare),
          "text-ow-accent",
        )}
        ${
          s.nation === null
            ? nothing
            : html`${this.item(
                translateText("command_bar.industry"),
                renderNumber(s.nation.industry),
              )}
              ${this.item(
                translateText("command_bar.research"),
                renderNumber(s.nation.research),
                "text-ow-accent",
              )}
              ${this.item(
                translateText("command_bar.stability"),
                formatStability(s.nation.stability),
                stabilityTone(s.nation.stability),
              )}`
        }
        <div class="hidden sm:contents">
          ${this.item(
            translateText("command_bar.time"),
            formatClock(s.elapsedSeconds),
          )}
        </div>
      </div>
    `;
  }
}

/** Colour for a stability value: healthy, strained, or in crisis. */
export function stabilityTone(permille: number): string {
  if (permille >= 600) return "text-ow-success";
  if (permille >= 350) return "text-ow-warning";
  return "text-ow-error";
}
