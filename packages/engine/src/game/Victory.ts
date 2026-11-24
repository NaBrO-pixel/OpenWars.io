// OpenWars victory conditions (docs/OpenWars2.md, milestone 6). Each
// condition is an entry in VICTORY_CONDITIONS: how far a nation is toward it
// (permille, 1000 = met) and how long it must hold. Adding a condition is
// adding an entry; the match manager (WinCheckExecution, setWinner) is
// untouched. The territorial victory stays the classic win check; it is
// listed here for its progress only.
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { VictoryProgressView } from "@openfront/engine-api/game/GameUpdates";
import { TECHS } from "@openfront/engine-lib/configuration/TechConfig";
import {
  diplomaticPartnersNeeded,
  economicShareNeeded,
  VictoryConfig,
  type VictoryKind,
} from "@openfront/engine-lib/configuration/VictoryConfig";
import type { Game, Player } from "./Game";

export interface VictoryCondition {
  kind: VictoryKind;
  /** Steps (seconds) it must stay met; null: decided elsewhere. */
  holdSteps: number | null;
  progress(game: Game, player: Player, nations: Player[]): number;
}

const permille = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.floor((part * 1000) / whole);

/** A nation's net income per second (its last economy step). */
function netIncome(p: Player): number {
  const v = p.nation()?.view();
  if (v === undefined) return 0;
  return (
    v.income.base +
    v.income.tax +
    v.income.industry -
    v.expenses.territory -
    v.expenses.structures -
    v.expenses.military
  );
}

const ADVANCED = TECHS.filter(
  (t) => t.tier === VictoryConfig.technological.tier,
).map((t) => t.id);

export const VICTORY_CONDITIONS: readonly VictoryCondition[] = [
  {
    kind: "territorial",
    holdSteps: null,
    progress: (game, player) =>
      permille(
        player.numTilesOwned() * 1000,
        game.numLandTiles() *
          Math.max(1, game.config().percentageTilesOwnedToWinTenths(0)),
      ),
  },
  {
    kind: "economic",
    holdSteps: VictoryConfig.economic.holdSteps,
    progress: (_game, player, nations) => {
      const c = VictoryConfig.economic;
      if (nations.length < c.minNations) return 0;
      const world = nations.reduce((s, p) => s + Math.max(0, netIncome(p)), 0);
      const share = permille(Math.max(0, netIncome(player)), world);
      return permille(share, economicShareNeeded(nations.length));
    },
  },
  {
    kind: "diplomatic",
    holdSteps: VictoryConfig.diplomatic.holdSteps,
    progress: (game, player, nations) => {
      const c = VictoryConfig.diplomatic;
      if (nations.length < c.minNations) return 0;
      const others = nations.filter((p) => p !== player);
      const d = game.diplomacy();
      const bound = others.filter(
        (o) =>
          player.isAlliedWith(o) ||
          d.has("nap", player, o) ||
          d.has("trade", player, o) ||
          d.has("intel", player, o),
      ).length;
      const influence = permille(
        bound,
        diplomaticPartnersNeeded(others.length),
      );
      const trust = permille(d.reputation(player), c.minReputation);
      return Math.min(influence, trust);
    },
  },
  {
    kind: "technological",
    holdSteps: VictoryConfig.technological.holdSteps,
    progress: (_game, player) => {
      const n = player.nation();
      if (n === null) return 0;
      return permille(
        ADVANCED.filter((id) => n.hasTech(id)).length,
        ADVANCED.length,
      );
    },
  },
];

/** The nations that count for victory: alive, not tribes. */
export function contenders(game: Game): Player[] {
  return game
    .players()
    .filter((p) => p.isAlive() && p.type() !== PlayerType.Bot);
}

/**
 * Once a second: update every nation's progress and holds, and return the
 * first nation (in smallID order) that has held a condition long enough,
 * with the condition.
 */
export function evaluateVictory(
  game: Game,
): { player: Player; kind: VictoryKind } | null {
  const nations = contenders(game).sort((a, b) => a.smallID() - b.smallID());
  let winner: { player: Player; kind: VictoryKind } | null = null;
  for (const player of nations) {
    const nation = player.nation();
    if (nation === null) continue;
    const views: VictoryProgressView[] = [];
    for (const c of VICTORY_CONDITIONS) {
      if (!game.config().victoryEnabled(c.kind)) continue;
      const progress = c.progress(game, player, nations);
      const needed = c.holdSteps ?? 0;
      let held = 0;
      if (c.holdSteps !== null) {
        held = progress >= 1000 ? (nation.victoryHolds[c.kind] ?? 0) + 1 : 0;
        nation.victoryHolds[c.kind] = held;
        if (progress >= 1000 && held > needed && winner === null) {
          winner = { player, kind: c.kind };
        }
      }
      views.push({ kind: c.kind, progress, held, needed });
    }
    nation.victory = views;
    nation.invalidate();
  }
  return winner;
}
