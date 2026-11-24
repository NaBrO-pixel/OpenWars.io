// The national figures the command interface shows (top bar, command
// panels), read from the client's view of the simulation. One place, so the
// bar and the panels never disagree.
import type { GameView } from "../view/GameView";
import type { PlayerView } from "../view/PlayerView";

export interface NationalSummary {
  money: bigint;
  /** Money earned per second over the last INCOME_WINDOW_S; null until
   * MIN_INCOME_SAMPLE_S of history exists. */
  incomePerSecond: number | null;
  population: number;
  maxPopulation: number;
  /** Share of the map's land owned, 0..1. */
  territoryShare: number;
  tilesOwned: number;
  /** Seconds since the match started (after the spawn phase). */
  elapsedSeconds: number;
}

const INCOME_WINDOW_S = 10;
const MIN_INCOME_SAMPLE_S = 3;

/**
 * Income per second from the engine's cumulative goldEarned (every source:
 * workers, trade, trains...). Keeps a short history of samples.
 */
export class IncomeTracker {
  private samples: { t: number; earned: number }[] = [];

  sample(elapsedSeconds: number, earned: number): number | null {
    this.samples.push({ t: elapsedSeconds, earned });
    while (
      this.samples.length > 2 &&
      elapsedSeconds - this.samples[0].t > INCOME_WINDOW_S
    ) {
      this.samples.shift();
    }
    const first = this.samples[0];
    const dt = elapsedSeconds - first.t;
    if (dt < MIN_INCOME_SAMPLE_S) return null;
    return (earned - first.earned) / dt;
  }

  reset(): void {
    this.samples = [];
  }
}

export function nationalSummary(
  game: GameView,
  player: PlayerView,
  income: IncomeTracker,
): NationalSummary {
  const elapsedSeconds = Math.max(0, game.elapsedGameSeconds());
  const land = Math.max(1, game.numLandTiles());
  return {
    money: player.gold(),
    incomePerSecond: income.sample(elapsedSeconds, player.goldEarned()),
    population: player.troops(),
    maxPopulation: game.config().maxTroops(player),
    territoryShare: player.numTilesOwned() / land,
    tilesOwned: player.numTilesOwned(),
    elapsedSeconds,
  };
}

export function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

/** Territory share as a percentage, with more precision for small nations. */
export function formatShare(share: number): string {
  const pct = share * 100;
  return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

/** Income per second for display ("…" while still being measured). */
export function formatIncome(
  income: number | null,
  render: (n: number) => string,
): string {
  if (income === null) return "…";
  const n = Math.round(income);
  return `${n >= 0 ? "+" : ""}${render(n)}/s`;
}
