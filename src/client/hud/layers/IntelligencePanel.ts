import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  type Estimate,
  estimate,
  type IntelLevel,
  intelLevel,
} from "@openfront/engine-lib/configuration/IntelRules";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";
import { formatClock, formatShare } from "../NationalSummary";

/** Seconds between history samples. */
const SAMPLE_EVERY_S = 15;
const MAX_SAMPLES = 120;

interface Sample {
  t: number;
  share: number;
  troops: number;
}

/**
 * Territory and strength history, sampled from what every client sees:
 * territory is public on the map; troop samples are only shown as the
 * observer's confidence allows.
 */
export class IntelHistory {
  private samples = new Map<string, Sample[]>();
  private lastT = -Infinity;

  sample(game: GameView): void {
    const t = Math.floor(game.elapsedGameSeconds());
    if (t - this.lastT < SAMPLE_EVERY_S) return;
    this.lastT = t;
    const land = Math.max(1, game.numLandTiles());
    for (const p of game.playerViews()) {
      if (!p.isAlive() || p.type() === PlayerType.Bot) continue;
      const list = this.samples.get(p.id()) ?? [];
      list.push({ t, share: p.numTilesOwned() / land, troops: p.troops() });
      while (list.length > MAX_SAMPLES) list.shift();
      this.samples.set(p.id(), list);
    }
  }

  of(id: string): readonly Sample[] {
    return this.samples.get(id) ?? [];
  }

  reset(): void {
    this.samples.clear();
    this.lastT = -Infinity;
  }
}

/** What `me` knows about `other`, by the intelligence rules. */
export function confidence(me: PlayerView, other: PlayerView): IntelLevel {
  const mine = me.nation();
  const agreements = mine?.diplomacy.agreements.filter(
    (a) => a.other === other.id(),
  );
  return intelLevel({
    self: me === other,
    sharing: agreements?.some((a) => a.kind === "intel") ?? false,
    allied: me.isAlliedWith(other),
    agreement: (agreements?.length ?? 0) > 0,
    neighbour: mine?.neighbours.includes(other.id()) ?? false,
    techLevels: mine?.intelLevels ?? 0,
  });
}

/** An estimate as text: "Unknown", "1K–10K", "~1.2K–1.8K" or exact. */
export function formatEstimate(
  e: Estimate,
  render: (n: number) => string,
): string {
  switch (e.kind) {
    case "unknown":
      return translateText("intelligence.unknown");
    case "magnitude":
      return `${render(e.low)}–${render(e.high)}`;
    case "range":
      return `~${render(e.low)}–${render(e.high)}`;
    case "exact":
      return render(e.value);
  }
}

/** Reports drawn from the history: notable changes, with their time. */
export function reports(
  samples: readonly Sample[],
  level: IntelLevel,
): { t: number; key: string; params: Record<string, string> }[] {
  const out: { t: number; key: string; params: Record<string, string> }[] = [];
  for (let i = 4; i < samples.length; i += 4) {
    const a = samples[i - 4];
    const b = samples[i];
    const dShare = b.share - a.share;
    if (dShare > 0.005) {
      out.push({
        t: b.t,
        key: "intelligence.report_expanded",
        params: { from: formatShare(a.share), to: formatShare(b.share) },
      });
    } else if (dShare < -0.005) {
      out.push({
        t: b.t,
        key: "intelligence.report_lost",
        params: { from: formatShare(a.share), to: formatShare(b.share) },
      });
    }
    // Troop alerts need at least an estimate.
    if (
      (level === "estimated" || level === "detailed") &&
      a.troops > 0 &&
      b.troops > a.troops * 1.5
    ) {
      out.push({ t: b.t, key: "intelligence.alert_buildup", params: {} });
    }
  }
  return out.reverse().slice(0, 8);
}

const LEVEL_STYLE: Record<IntelLevel, string> = {
  unknown: "text-ow-text-2 border-ow-border",
  limited: "text-ow-warning border-ow-warning/50",
  estimated: "text-ow-accent border-ow-accent/50",
  detailed: "text-ow-success border-ow-success/50",
};

function badge(level: IntelLevel) {
  return html`<span
    class="shrink-0 rounded border px-1.5 text-[11px] uppercase ${LEVEL_STYLE[level]}"
    data-confidence=${level}
    title=${translateText(`intelligence.level_${level}_why`)}
    >${translateText(`intelligence.level_${level}`)}</span
  >`;
}

function row(label: string, value: string) {
  return html`<div
    class="flex items-baseline justify-between gap-3 py-0.5 text-sm"
  >
    <span class="text-ow-text-2">${label}</span>
    <span class="tabular-nums text-ow-text">${value}</span>
  </div>`;
}

function sparkline(samples: readonly Sample[]) {
  if (samples.length < 2) {
    return html`<p class="text-xs text-ow-text-2">
      ${translateText("intelligence.history_pending")}
    </p>`;
  }
  const w = 240;
  const h = 40;
  const max = Math.max(0.0001, ...samples.map((s) => s.share));
  const pts = samples
    .map(
      (s, i) =>
        `${(i / (samples.length - 1)) * w},${(h - (s.share / max) * (h - 2)).toFixed(1)}`,
    )
    .join(" ");
  return html`<svg
    viewBox="0 0 ${w} ${h}"
    class="w-full h-10"
    data-intel-history
  >
    <polyline
      points=${pts}
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      class="text-ow-accent-2"
    />
  </svg>`;
}

export function renderIntelligence(
  game: GameView,
  me: PlayerView,
  history: IntelHistory,
  selected: string | null,
  select: (id: string) => void,
): TemplateResult {
  const others = game
    .playerViews()
    .filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot)
    .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
  const target = others.find((p) => p.id() === selected) ?? others[0];
  const land = Math.max(1, game.numLandTiles());
  let detail: TemplateResult | typeof nothing = nothing;
  if (target !== undefined) {
    const level = confidence(me, target);
    const n = target.nation();
    const est = (v: number, render: (n: number) => string) =>
      formatEstimate(estimate(v, level), render);
    const allies = target.allies();
    const samples = history.of(target.id());
    detail = html`<section
      class="mt-3 rounded border border-ow-border bg-ow-bg-2/60 p-2"
      data-intel-target=${target.id()}
    >
      <header class="flex items-center justify-between gap-2">
        <h3 class="truncate text-sm font-semibold text-ow-text">
          ${target.displayName()}
        </h3>
        ${badge(level)}
      </header>
      <p class="text-xs text-ow-text-2">
        ${translateText(`intelligence.level_${level}_why`)}
      </p>
      <h4 class="mt-2 text-xs uppercase tracking-wider text-ow-text-2">
        ${translateText("intelligence.strength")}
      </h4>
      ${row(translateText("command_bar.territory"), formatShare(target.numTilesOwned() / land))}
      ${row(translateText("command_bar.population"), est(target.troops(), renderTroops))}
      <h4 class="mt-2 text-xs uppercase tracking-wider text-ow-text-2">
        ${translateText("intelligence.economy")}
      </h4>
      ${row(translateText("command_bar.money"), est(Number(target.gold()), renderNumber))}
      ${
        n === null
          ? nothing
          : html`${row(
              translateText("command_bar.income"),
              est(
                n.income.base + n.income.tax + n.income.industry,
                renderNumber,
              ),
            )}
            ${row(translateText("command_bar.industry"), est(n.industryRate, renderNumber))}
            ${row(translateText("command_bar.research"), est(n.researchRate, renderNumber))}
            ${row(
              translateText("command_bar.stability"),
              est(n.stability, (v) => `${Math.round(v / 10)}%`),
            )}`
      }
      <h4 class="mt-2 text-xs uppercase tracking-wider text-ow-text-2">
        ${translateText("intelligence.diplomacy")}
      </h4>
      ${row(translateText("intelligence.reputation"), String(n?.diplomacy.reputation ?? 100))}
      ${row(
        translateText("command_nav.allies"),
        level === "unknown"
          ? translateText("intelligence.unknown")
          : allies.length === 0
            ? "—"
            : allies.map((a) => a.displayName()).join(", "),
      )}
      ${
        level === "estimated" || level === "detailed"
          ? row(
              translateText("intelligence.agreements"),
              String(n?.diplomacy.agreements.length ?? 0),
            )
          : nothing
      }
      <h4 class="mt-2 text-xs uppercase tracking-wider text-ow-text-2">
        ${translateText("intelligence.history")}
      </h4>
      ${sparkline(samples)}
      <ul class="mt-1 space-y-0.5" data-intel-reports>
        ${reports(samples, level).map(
          (r) =>
            html`<li class="text-xs text-ow-text">
              <span class="tabular-nums text-ow-text-2"
                >${formatClock(r.t)}</span
              >
              ${translateText(r.key, r.params)}
            </li>`,
        )}
      </ul>
    </section>`;
  }
  return html`
    <p class="text-sm text-ow-text-2">${translateText("intelligence.intro")}</p>
    <div class="mt-2 flex flex-wrap gap-1" data-intel-countries>
      ${others
        .slice(0, 24)
        .map(
          (p) =>
            html`<button
              class="rounded border px-1.5 py-0.5 text-[11px] ${
                p === target
                  ? "border-ow-accent text-ow-accent"
                  : "border-ow-border text-ow-text hover:border-ow-accent"
              }"
              @click=${() => select(p.id())}
              data-intel-country=${p.id()}
            >
              ${p.displayName()}
            </button>`,
        )}
    </div>
    ${detail}
  `;
}
