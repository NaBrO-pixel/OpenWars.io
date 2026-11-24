import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";
import {
  formatClock,
  formatIncome,
  formatShare,
  IncomeTracker,
  type NationalSummary,
  nationalSummary,
} from "../NationalSummary";

interface SectionContext {
  game: GameView;
  me: PlayerView;
  summary: NationalSummary;
}

interface CommandSection {
  id: string;
  labelKey: string;
  icon: TemplateResult;
  render: (ctx: SectionContext) => TemplateResult;
}

const svg = (d: string) =>
  html`<svg
    viewBox="0 0 24 24"
    class="h-5 w-5"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d=${d}></path>
  </svg>`;

const STRUCTURES: readonly UnitType[] = [
  UnitType.City,
  UnitType.Factory,
  UnitType.Port,
  UnitType.DefensePost,
  UnitType.MissileSilo,
  UnitType.SAMLauncher,
];

function row(label: string, value: string | TemplateResult) {
  return html`<div
    class="flex items-baseline justify-between gap-3 py-1 border-b border-ow-border/60 last:border-0"
  >
    <span class="text-ow-text-2 text-sm">${label}</span>
    <span class="text-ow-text text-sm font-semibold tabular-nums text-right"
      >${value}</span
    >
  </div>`;
}

function heading(text: string) {
  return html`<h3
    class="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
  >
    ${text}
  </h3>`;
}

/** Players still in the match, largest territory first. */
function standings(game: GameView): PlayerView[] {
  return game
    .playerViews()
    .filter((p) => p.isAlive())
    .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
}

function renderOverview({ game, me, summary }: SectionContext) {
  const rank = standings(game).findIndex((p) => p.id() === me.id()) + 1;
  const allies = me.allies();
  return html`
    ${row(translateText("command_nav.country"), me.displayName())}
    ${row(
      translateText("command_nav.rank"),
      translateText("command_nav.rank_of", {
        rank,
        total: standings(game).length,
      }),
    )}
    ${row(
      translateText("command_bar.territory"),
      formatShare(summary.territoryShare),
    )}
    ${row(
      translateText("command_bar.population"),
      `${renderTroops(summary.population)} / ${renderTroops(summary.maxPopulation)}`,
    )}
    ${row(translateText("command_bar.money"), renderNumber(summary.money))}
    ${row(
      translateText("command_bar.income"),
      formatIncome(summary.incomePerSecond, renderNumber),
    )}
    ${heading(translateText("command_nav.structures"))}
    ${STRUCTURES.map((type) =>
      row(
        translateText(`unit_type.${type.toLowerCase().replace(/ /g, "_")}`),
        String(me.units(type).length),
      ),
    )}
    ${heading(translateText("command_nav.allies"))}
    ${
      allies.length === 0
        ? html`<p class="text-sm text-ow-text-2">
            ${translateText("command_nav.no_allies")}
          </p>`
        : allies.map((a) => row(a.displayName(), ""))
    }
  `;
}

function renderStatistics({ game, me, summary }: SectionContext) {
  const list = standings(game);
  const land = Math.max(1, game.numLandTiles());
  return html`
    ${row(translateText("command_bar.time"), formatClock(summary.elapsedSeconds))}
    ${row(translateText("command_nav.nations_left"), String(list.length))}
    ${heading(translateText("command_nav.largest"))}
    <ol class="space-y-1">
      ${list.slice(0, 10).map((p, i) => {
        const share = p.numTilesOwned() / land;
        const mine = p.id() === me.id();
        return html`<li class="text-sm" data-standing>
          <div class="flex justify-between gap-2">
            <span
              class="truncate ${mine ? "text-ow-accent font-semibold" : "text-ow-text"}"
              >${i + 1}. ${p.displayName()}</span
            >
            <span class="tabular-nums text-ow-text-2"
              >${(share * 100).toFixed(1)}%</span
            >
          </div>
          <div class="h-1 rounded bg-ow-raised overflow-hidden">
            <div
              class="h-full ${mine ? "bg-ow-accent" : "bg-ow-text-2/60"}"
              style="width:${Math.min(100, share * 100)}%"
            ></div>
          </div>
        </li>`;
      })}
    </ol>
  `;
}

/**
 * The command sections, in navigation order. Later milestones add theirs
 * (economy, infrastructure, research, diplomacy, intelligence) here; only
 * sections backed by working systems are listed.
 */
export const COMMAND_SECTIONS: readonly CommandSection[] = [
  {
    id: "overview",
    labelKey: "command_nav.overview",
    icon: svg("M4 21V4m0 0h11l-2 4 2 4H4"),
    render: renderOverview,
  },
  {
    id: "statistics",
    labelKey: "command_nav.statistics",
    icon: svg("M4 20V10m6 10V4m6 16v-7m4 7H2"),
    render: renderStatistics,
  },
];

/**
 * The collapsible left navigation: an icon rail, and the selected section's
 * panel beside it. Closed, only the rail takes screen space.
 */
@customElement("command-nav")
export class CommandNav extends LitElement implements Controller {
  public game: GameView;

  @state() private open: string | null = null;
  @state() private ctx: SectionContext | null = null;
  private income = new IncomeTracker();

  createRenderRoot() {
    return this;
  }

  init() {
    this.open = null;
    this.ctx = null;
    this.income.reset();
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    const me = this.game?.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) {
      this.ctx = null;
      return;
    }
    this.ctx = {
      game: this.game,
      me,
      summary: nationalSummary(this.game, me, this.income),
    };
  }

  /** Opens a section, or closes it when it is already open. */
  toggle(id: string) {
    this.open = this.open === id ? null : id;
  }

  render() {
    if (this.ctx === null) return nothing;
    const section = COMMAND_SECTIONS.find((s) => s.id === this.open);
    return html`
      <nav
        class="pointer-events-auto fixed left-0 z-[950] flex max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:items-start lg:bottom-4 lg:items-end"
        aria-label=${translateText("command_nav.label")}
      >
        <div
          class="flex flex-col gap-1 rounded-r-md border border-l-0 border-ow-border bg-ow-panel/92 backdrop-blur-sm p-1 shadow-lg"
        >
          ${COMMAND_SECTIONS.map(
            (s) =>
              html`<button
                class="flex h-10 w-10 items-center justify-center rounded transition-colors ${
                  this.open === s.id
                    ? "bg-ow-accent/20 text-ow-accent"
                    : "text-ow-text-2 hover:bg-ow-raised hover:text-ow-text"
                }"
                title=${translateText(s.labelKey)}
                aria-label=${translateText(s.labelKey)}
                aria-pressed=${this.open === s.id}
                data-command-section=${s.id}
                @click=${() => this.toggle(s.id)}
              >
                ${s.icon}
              </button>`,
          )}
        </div>
        ${
          section === undefined
            ? nothing
            : html`<section
                class="ml-2 w-[min(280px,calc(100vw-4rem))] max-h-[70vh] overflow-y-auto rounded-md border border-ow-border bg-ow-panel/95 backdrop-blur-sm p-4 shadow-xl"
                data-command-panel=${section.id}
              >
                <header class="mb-2 flex items-center justify-between">
                  <h2 class="text-base font-semibold text-ow-text">
                    ${translateText(section.labelKey)}
                  </h2>
                  <button
                    class="text-ow-text-2 hover:text-ow-text"
                    aria-label=${translateText("common.close")}
                    @click=${() => (this.open = null)}
                  >
                    ✕
                  </button>
                </header>
                ${section.render(this.ctx)}
              </section>`
        }
      </nav>
    `;
  }
}
