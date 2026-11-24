import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import type { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { GoToUnitEvent } from "../../TransformHandler";
import {
  SendAllianceRequestIntentEvent,
  SendBreakAllianceIntentEvent,
  SendDiplomacyIntentEvent,
  SendInfrastructureIntentEvent,
  SendMobiliseIntentEvent,
  SendResearchIntentEvent,
} from "../../Transport";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";
import {
  formatClock,
  formatIncome,
  formatShare,
  formatStability,
  IncomeTracker,
  type NationalSummary,
  nationalSummary,
} from "../NationalSummary";
import { OpenCommandSectionEvent } from "./CountryBrief";
import { renderDiplomacy } from "./DiplomacyPanel";
import { renderEvents } from "./EventsPanel";
import { guideMayAutoOpen, markGuideSeen, renderGuide } from "./GuidePanel";
import { ToggleInfrastructureOverlayEvent } from "./InfrastructureOverlay";
import { renderInfrastructure } from "./InfrastructurePanel";
import { IntelHistory, renderIntelligence } from "./IntelligencePanel";
import { renderMilitary, renderVictoryProgress } from "./MilitaryPanel";
import { renderResearch } from "./ResearchPanel";

interface SectionContext {
  game: GameView;
  me: PlayerView;
  summary: NationalSummary;
  /** Sends the player's actions (intents) and UI events. */
  nav: CommandNav;
}

interface CommandSection {
  id: string;
  labelKey: string;
  icon: TemplateResult;
  render: (ctx: SectionContext) => TemplateResult;
  /** Shown only when this holds (e.g. the system it shows is on). */
  available?: (ctx: SectionContext) => boolean;
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
    ${renderVictoryProgress(
      me,
      game
        .playerViews()
        .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot).length,
    )}
  `;
}

/** A line of net income per second over time (the economy's history). */
function trend(values: number[]): TemplateResult {
  if (values.length < 2) {
    return html`<p class="text-sm text-ow-text-2">
      ${translateText("command_nav.trend_pending")}
    </p>`;
  }
  const w = 240;
  const h = 48;
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  const y = (v: number) => h / 2 - (v / max) * (h / 2 - 2);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${y(v).toFixed(1)}`)
    .join(" ");
  return html`<svg
    viewBox="0 0 ${w} ${h}"
    class="w-full h-12"
    role="img"
    aria-label=${translateText("command_nav.trend")}
    data-economy-trend
  >
    <line
      x1="0"
      x2=${w}
      y1=${h / 2}
      y2=${h / 2}
      stroke="currentColor"
      class="text-ow-border"
    />
    <polyline
      points=${points}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="text-ow-accent"
    />
  </svg>`;
}

function explained(label: string, value: string, why: string) {
  return html`<div class="py-1 border-b border-ow-border/60 last:border-0">
    <div class="flex items-baseline justify-between gap-3">
      <span class="text-ow-text-2 text-sm">${label}</span>
      <span class="text-ow-text text-sm font-semibold tabular-nums"
        >${value}</span
      >
    </div>
    <p class="text-xs text-ow-text-2/80">${why}</p>
  </div>`;
}

function renderEconomy({ summary }: SectionContext) {
  const n = summary.nation!;
  const perSec = (v: number) => `${renderNumber(v)}/s`;
  const expenses = n.expenses.territory + n.expenses.structures;
  return html`
    ${row(translateText("command_bar.money"), renderNumber(summary.money))}
    ${row(
      translateText("command_nav.net_income"),
      formatIncome(summary.incomePerSecond, renderNumber),
    )}
    ${heading(translateText("command_nav.income"))}
    ${explained(
      translateText("command_nav.income_base"),
      perSec(n.income.base),
      translateText("command_nav.income_base_why"),
    )}
    ${explained(
      translateText("command_nav.income_tax"),
      perSec(n.income.tax),
      translateText("command_nav.income_tax_why"),
    )}
    ${explained(
      translateText("command_nav.income_industry"),
      perSec(n.income.industry),
      translateText("command_nav.income_industry_why"),
    )}
    ${heading(translateText("command_nav.expenses"))}
    ${explained(
      translateText("command_nav.expense_territory"),
      perSec(n.expenses.territory),
      translateText("command_nav.expense_territory_why"),
    )}
    ${explained(
      translateText("command_nav.expense_structures"),
      perSec(n.expenses.structures),
      translateText("command_nav.expense_structures_why"),
    )}
    ${row(translateText("command_nav.expenses_total"), perSec(expenses))}
    ${heading(translateText("command_nav.nation"))}
    ${row(
      translateText("command_bar.industry"),
      `${renderNumber(n.industry)} (+${n.industryRate}/s)`,
    )}
    ${row(
      translateText("command_bar.research"),
      `${renderNumber(n.research)} (+${n.researchRate}/s)`,
    )}
    ${row(
      translateText("command_bar.population"),
      `${renderTroops(summary.population)} / ${renderTroops(summary.maxPopulation)}`,
    )}
    ${explained(
      translateText("command_bar.stability"),
      `${formatStability(n.stability)} → ${formatStability(n.stabilityTarget)}`,
      translateText("command_nav.stability_why"),
    )}
    ${row(translateText("command_nav.development"), String(n.development))}
    ${heading(translateText("command_nav.trend"))} ${trend(n.netHistory)}
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
    id: "economy",
    labelKey: "command_nav.economy",
    icon: svg("M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"),
    render: renderEconomy,
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "infrastructure",
    labelKey: "command_nav.infrastructure",
    icon: svg("M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"),
    render: (ctx) =>
      renderInfrastructure(ctx.summary.nation!, ctx.summary.money, {
        start: (unitId, kind) =>
          ctx.nav.eventBus?.emit(
            new SendInfrastructureIntentEvent("start", unitId, kind),
          ),
        cancel: (unitId, kind) =>
          ctx.nav.eventBus?.emit(
            new SendInfrastructureIntentEvent("cancel", unitId, kind),
          ),
        locate: (unitId) => {
          const unit = ctx.game.unit(unitId);
          if (unit !== undefined)
            ctx.nav.eventBus?.emit(new GoToUnitEvent(unit));
        },
        toggleOverlay: () => ctx.nav.toggleOverlay(),
        overlayOn: ctx.nav.overlayOn,
        freeMoney: ctx.game.config().gameConfig().infiniteGold,
      }),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "research",
    labelKey: "command_nav.research",
    icon: svg("M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-10V3"),
    render: (ctx) =>
      renderResearch(ctx.summary.nation!, ctx.summary.money, {
        start: (id) =>
          ctx.nav.eventBus?.emit(new SendResearchIntentEvent("start", id)),
        cancel: (id) =>
          ctx.nav.eventBus?.emit(new SendResearchIntentEvent("cancel", id)),
        freeMoney: ctx.game.config().gameConfig().infiniteGold,
      }),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "diplomacy",
    labelKey: "command_nav.diplomacy",
    icon: svg("M7 11l5-5 5 5M7 11l5 5 5-5M3 12h4m10 0h4"),
    render: (ctx) =>
      renderDiplomacy(ctx.game, ctx.me, {
        act: (action, kind, target) =>
          ctx.nav.eventBus?.emit(
            new SendDiplomacyIntentEvent(action, kind, target.id()),
          ),
        requestAlliance: (target) =>
          ctx.nav.eventBus?.emit(
            new SendAllianceRequestIntentEvent(ctx.me, target),
          ),
        leaveAlliance: (target) =>
          ctx.nav.eventBus?.emit(
            new SendBreakAllianceIntentEvent(ctx.me, target),
          ),
      }),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "military",
    labelKey: "command_nav.military",
    icon: svg("M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6z"),
    render: (ctx) =>
      renderMilitary(ctx.game, ctx.me, (level) =>
        ctx.nav.eventBus?.emit(new SendMobiliseIntentEvent(level)),
      ),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "intelligence",
    labelKey: "command_nav.intelligence",
    icon: svg(
      "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    ),
    render: (ctx) =>
      renderIntelligence(
        ctx.game,
        ctx.me,
        ctx.nav.intelHistory,
        ctx.nav.intelTarget,
        (id) => ctx.nav.selectIntelTarget(id),
      ),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "events",
    labelKey: "command_nav.events",
    icon: svg(
      "M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z",
    ),
    render: (ctx) => renderEvents(ctx.game, ctx.me),
    available: (ctx) => ctx.summary.nation !== null,
  },
  {
    id: "guide",
    labelKey: "command_nav.guide",
    icon: svg(
      "M12 18h.01M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.2-1.3 2.1V15M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
    ),
    render: () => renderGuide(),
    available: (ctx) => ctx.summary.nation !== null,
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

  public eventBus: EventBus | undefined;
  @state() private open: string | null = null;
  @state() overlayOn = false;
  @state() intelTarget: string | null = null;
  readonly intelHistory = new IntelHistory();

  selectIntelTarget(id: string) {
    this.intelTarget = id;
  }

  toggleOverlay() {
    this.overlayOn = !this.overlayOn;
    this.eventBus?.emit(new ToggleInfrastructureOverlayEvent(this.overlayOn));
  }
  @state() private ctx: SectionContext | null = null;
  private income = new IncomeTracker();
  private userSettings = new UserSettings();

  createRenderRoot() {
    return this;
  }

  private subscribed = false;

  init() {
    if (!this.subscribed && this.eventBus !== undefined) {
      this.subscribed = true;
      this.eventBus.on(OpenCommandSectionEvent, (e) => {
        if (e.target !== undefined) this.intelTarget = e.target;
        this.open = e.section;
      });
    }
    this.open = null;
    this.overlayOn = false;
    this.intelTarget = null;
    this.intelHistory.reset();
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
    this.intelHistory.sample(this.game);
    // First OpenWars game: open the guide once (replayable from its button).
    // It waits for the tutorial panel, so the two never overlap.
    if (
      me.nation() !== null &&
      guideMayAutoOpen(
        this.game.config().gameConfig().tutorial === true,
        this.userSettings.tutorialDismissed(),
      )
    ) {
      markGuideSeen();
      this.open = "guide";
    }
    this.ctx = {
      game: this.game,
      me,
      summary: nationalSummary(this.game, me, this.income),
      nav: this,
    };
  }

  /** Opens a section, or closes it when it is already open. */
  toggle(id: string) {
    this.open = this.open === id ? null : id;
  }

  render() {
    if (this.ctx === null) return nothing;
    const ctx = this.ctx;
    const sections = COMMAND_SECTIONS.filter((s) => s.available?.(ctx) ?? true);
    const section = sections.find((s) => s.id === this.open);
    return html`
      <nav
        class="pointer-events-auto fixed left-0 z-[950] flex max-lg:top-1/2 max-lg:-translate-y-1/2 max-lg:items-start lg:bottom-4 lg:items-end"
        aria-label=${translateText("command_nav.label")}
      >
        <div
          class="flex flex-col gap-1 rounded-r-md border border-l-0 border-ow-border bg-ow-panel/92 backdrop-blur-sm p-1 shadow-lg"
        >
          ${sections.map(
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
                class="ml-2 w-[min(280px,calc(100vw-4rem))] lg:w-[360px] max-h-[70vh] max-lg:max-h-[60vh] overflow-y-auto rounded-md border border-ow-border bg-ow-panel/95 backdrop-blur-sm p-4 shadow-xl"
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
