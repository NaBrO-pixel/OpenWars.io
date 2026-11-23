// Levels and XP. The XP a game pays comes from the same formula the game's
// client uses for its provisional figure (src/client/ProvisionalXp.ts), with
// the rules below, so the number a player sees at death matches the saved one.
import type {
  Progress,
  ProgressionConfig,
  XpRules,
} from "@openfront/shared/ApiSchemas";
import { PROVISIONAL_XP_FORMULA } from "../client/ProvisionalXp";

export const MAX_LEVEL = 100;

// The rules the game's reference cases are written for
// (tests/testdata/progression/xp-reference-cases.json).
export const XP_RULES: XpRules = {
  minAliveTicks: 1200,
  gameXp: 50,
  xpPerMinute: 17,
  timeCapMinutes: 30,
  ffaPlacementMax: 150,
  ffaWin: 300,
  fullLobbyHumans: 20,
  teamWin: 150,
  teamWinMinAlivePermille: 500,
  hvnWin: 100,
  firstGameOfDay: 100,
  featXp: 0,
  maxFeatsPerGame: 3,
  publicPermille: 1000,
  rankedPermille: 1250,
  privatePermille: 500,
  singleplayerPermille: 250,
  privateMinHumans: 4,
  privateGamesPerDay: 10,
  singleplayerGamesPerDay: 5,
};

// XP from `level` to the next: 300 at level 1, growing by 30 a level.
export function xpToNext(level: number): number {
  return level >= MAX_LEVEL ? 0 : 300 + 30 * (level - 1);
}

const CUMULATIVE: number[] = (() => {
  const out = [0, 0]; // out[level] = XP needed to reach `level`
  for (let level = 1; level < MAX_LEVEL; level++) {
    out.push(out[level] + xpToNext(level));
  }
  return out;
})();

export function progressFor(lifetimeXp: number): Progress {
  let level = 1;
  while (level < MAX_LEVEL && lifetimeXp >= CUMULATIVE[level + 1]) level++;
  const atMax = level >= MAX_LEVEL;
  return {
    prestige: 0,
    level,
    xpInLevel: atMax ? 0 : lifetimeXp - CUMULATIVE[level],
    xpForNext: xpToNext(level),
    lifetimeXp,
    legend: false,
    canPrestige: false,
  };
}

export function progressionConfig(): ProgressionConfig {
  const levels = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    levels.push({
      level,
      xpToNext: xpToNext(level),
      cumulativeXp: CUMULATIVE[level],
    });
  }
  return {
    version: 1,
    maxLevel: MAX_LEVEL,
    // Prestige is not offered yet.
    maxPrestige: 0,
    levels,
    formula: PROVISIONAL_XP_FORMULA,
    requireStatsAgreed: false,
    scoresSingleplayer: true,
    xp: XP_RULES,
  } as ProgressionConfig;
}

// "YYYY-MM-DD" in UTC: the per-day allowances reset at UTC midnight.
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
