// Turns a finished game's record into saved progress for every player in it
// who has an account (signed in or guest).
import { GameMode } from "@openfront/engine-api/game/GameTypes";
import type { Winner } from "@openfront/engine-api/Schemas";
import type { GameXpResponse } from "@openfront/shared/ApiSchemas";
import type { ClientAnalyticsRecord } from "@openfront/shared/WireSchemas";
import {
  computeXp,
  type DailyXpState,
  ffaOutlasted,
  type XpGameConfig,
} from "../client/ProvisionalXp";
import type { AccountsDb, UserRow } from "./Database";
import { progressFor, utcDay, XP_RULES } from "./Progression";

// The record's winners as client ids (the player, or a team's members). A
// nation's win, or none, has no human winners.
export function winnerClientIds(winner: Winner): string[] {
  if (winner === undefined) return [];
  if (winner[0] === "player") return winner.slice(1);
  return winner.slice(2);
}

function dailyFor(user: UserRow, day: string): DailyXpState {
  if (user.daily_day !== day) {
    return { privateGames: 0, singleplayerGames: 0, firstGameClaimed: false };
  }
  return {
    privateGames: user.daily_private,
    singleplayerGames: user.daily_singleplayer,
    firstGameClaimed: user.daily_first === 1,
  };
}

/**
 * Scores the record for each player whose persistentID is an account, or
 * only for `onlyUserId` when given (a singleplayer record the client sent,
 * which may only credit its sender). Returns how many players were credited.
 * A game already scored for a player is skipped, so a retried upload never
 * pays twice.
 */
export function scoreGame(
  db: AccountsDb,
  record: ClientAnalyticsRecord,
  opts: { onlyUserId?: string; now?: number } = {},
): number {
  const now = opts.now ?? Date.now();
  const info = record.info;
  const config = info.config as unknown as XpGameConfig & {
    difficulty?: string;
  };
  const ticks = info.num_turns;
  const winners = new Set(winnerClientIds(info.winner));
  const spawned = info.players.filter((p) => p.stats !== undefined);
  const outlasted =
    config.gameMode === GameMode.FFA
      ? ffaOutlasted(
          spawned.map((p) => ({ clientID: p.clientID, stats: p.stats })),
          ticks,
        )
      : new Map<string, number>();
  const endedAt = new Date(info.end || now).toISOString();
  const day = utcDay(now);

  let credited = 0;
  for (const player of info.players) {
    const userId = player.persistentID;
    if (userId === null || userId === undefined) continue;
    if (opts.onlyUserId !== undefined && userId !== opts.onlyUserId) continue;
    const user = db.userById(userId);
    if (user === null || db.hasGameXp(userId, info.gameID)) continue;

    const daily = dailyFor(user, day);
    const before = progressFor(user.lifetime_xp);
    const isWinner = winners.has(player.clientID);
    const result = computeXp(
      {
        config,
        stats: player.stats,
        leftAtTick: null,
        isWinner,
        ticks,
        spawnedHumans: spawned.length,
        opponentsOutlasted: outlasted.get(player.clientID) ?? 0,
        featCount: 0,
        daily,
        subscriberPermille: 1000,
      },
      XP_RULES,
    );

    let response: GameXpResponse;
    let gained = 0;
    let nextDaily = daily;
    if (result.eligible) {
      gained = result.breakdown.total;
      nextDaily = result.daily;
      const after = progressFor(user.lifetime_xp + gained);
      const levelsReached = [];
      for (let level = before.level + 1; level <= after.level; level++) {
        levelsReached.push({ prestige: 0, level });
      }
      response = {
        gameId: info.gameID,
        eligible: true,
        breakdown: result.breakdown,
        before: {
          prestige: before.prestige,
          level: before.level,
          xpInLevel: before.xpInLevel,
          xpForNext: before.xpForNext,
        },
        after,
        levelsReached,
      };
    } else {
      response = {
        gameId: info.gameID,
        eligible: false,
        reason: result.reason,
      };
    }

    const saved = db.recordGame({
      userId,
      gameId: info.gameID,
      resultJson: JSON.stringify(response),
      xpGained: gained,
      daily: { day, ...nextDaily },
      gameType: String(config.gameType),
      gameMode: String(config.gameMode),
      difficulty: String(config.difficulty ?? "Medium"),
      won: isWinner,
      endedAt,
    });
    if (saved) credited++;
  }
  return credited;
}
