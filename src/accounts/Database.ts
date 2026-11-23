// The accounts database: one SQLite file (Node's built-in node:sqlite, so no
// database server to install). Everything players earn lives here.
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface UserRow {
  id: string; // UUID: the JWT subject and the game's persistentID
  public_id: string;
  created_at: string;
  discord_id: string | null;
  discord_json: string | null;
  google_sub: string | null;
  google_email: string | null;
  lifetime_xp: number;
  daily_day: string | null;
  daily_private: number;
  daily_singleplayer: number;
  daily_first: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  discord_id TEXT UNIQUE,
  discord_json TEXT,
  google_sub TEXT UNIQUE,
  google_email TEXT,
  lifetime_xp INTEGER NOT NULL DEFAULT 0,
  daily_day TEXT,
  daily_private INTEGER NOT NULL DEFAULT 0,
  daily_singleplayer INTEGER NOT NULL DEFAULT 0,
  daily_first INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  link_user_id TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_xp (
  user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE TABLE IF NOT EXISTS player_games (
  user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL,
  game_type TEXT NOT NULL,
  game_mode TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  won INTEGER NOT NULL,
  ended_at TEXT NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
`;

export class AccountsDb {
  readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  createUser(): UserRow {
    const id = randomUUID();
    const publicId = randomBytes(6).toString("base64url");
    this.db
      .prepare("INSERT INTO users (id, public_id, created_at) VALUES (?, ?, ?)")
      .run(id, publicId, new Date().toISOString());
    return this.userById(id)!;
  }

  userById(id: string): UserRow | null {
    return (
      (this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
        | UserRow
        | undefined) ?? null
    );
  }

  userByPublicId(publicId: string): UserRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM users WHERE public_id = ?")
        .get(publicId) as UserRow | undefined) ?? null
    );
  }

  userByProvider(provider: "discord" | "google", id: string): UserRow | null {
    const column = provider === "discord" ? "discord_id" : "google_sub";
    return (
      (this.db.prepare(`SELECT * FROM users WHERE ${column} = ?`).get(id) as
        | UserRow
        | undefined) ?? null
    );
  }

  setDiscord(userId: string, discordId: string, json: string): void {
    this.db
      .prepare("UPDATE users SET discord_id = ?, discord_json = ? WHERE id = ?")
      .run(discordId, json, userId);
  }

  setGoogle(userId: string, sub: string, email: string): void {
    this.db
      .prepare("UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?")
      .run(sub, email, userId);
  }

  // --- sessions (the refresh cookie) -------------------------------------

  createSession(tokenHash: string, userId: string, expiresAt: number): void {
    this.db
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      )
      .run(tokenHash, userId, expiresAt);
  }

  sessionUser(tokenHash: string, now: number): UserRow | null {
    const row = this.db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
      )
      .get(tokenHash, now) as { user_id: string } | undefined;
    return row ? this.userById(row.user_id) : null;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  // --- OAuth round trips ---------------------------------------------------

  saveOAuthState(
    state: string,
    provider: string,
    redirectUri: string,
    linkUserId: string | null,
    expiresAt: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO oauth_states (state, provider, redirect_uri, link_user_id, expires_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(state, provider, redirectUri, linkUserId, expiresAt);
  }

  // Single use: the row is deleted as it is read.
  takeOAuthState(
    state: string,
    now: number,
  ): {
    provider: string;
    redirect_uri: string;
    link_user_id: string | null;
  } | null {
    const row = this.db
      .prepare(
        "SELECT provider, redirect_uri, link_user_id, expires_at FROM oauth_states WHERE state = ?",
      )
      .get(state) as
      | {
          provider: string;
          redirect_uri: string;
          link_user_id: string | null;
          expires_at: number;
        }
      | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    this.db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(now);
    if (!row || row.expires_at <= now) return null;
    return row;
  }

  // --- progress ------------------------------------------------------------

  gameXp(userId: string, gameId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT result_json FROM game_xp WHERE user_id = ? AND game_id = ?",
      )
      .get(userId, gameId) as { result_json: string } | undefined;
    return row?.result_json ?? null;
  }

  hasGameXp(userId: string, gameId: string): boolean {
    return this.gameXp(userId, gameId) !== null;
  }

  // Saves one game's result for a player atomically: the XP row, the new
  // totals and the game in their history. A game is only ever counted once.
  recordGame(args: {
    userId: string;
    gameId: string;
    resultJson: string;
    xpGained: number;
    daily: {
      day: string;
      privateGames: number;
      singleplayerGames: number;
      firstGameClaimed: boolean;
    };
    gameType: string;
    gameMode: string;
    difficulty: string;
    won: boolean;
    endedAt: string;
  }): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare(
          "INSERT OR IGNORE INTO game_xp (user_id, game_id, result_json) VALUES (?, ?, ?)",
        )
        .run(args.userId, args.gameId, args.resultJson);
      if (Number(inserted.changes) === 0) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare(
          `UPDATE users SET lifetime_xp = lifetime_xp + ?, daily_day = ?,
             daily_private = ?, daily_singleplayer = ?, daily_first = ?
           WHERE id = ?`,
        )
        .run(
          args.xpGained,
          args.daily.day,
          args.daily.privateGames,
          args.daily.singleplayerGames,
          args.daily.firstGameClaimed ? 1 : 0,
          args.userId,
        );
      this.db
        .prepare(
          `INSERT OR IGNORE INTO player_games
             (user_id, game_id, game_type, game_mode, difficulty, won, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          args.userId,
          args.gameId,
          args.gameType,
          args.gameMode,
          args.difficulty,
          args.won ? 1 : 0,
          args.endedAt,
        );
      this.db.exec("COMMIT");
      return true;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  playerGameCounts(userId: string): {
    game_type: string;
    game_mode: string;
    difficulty: string;
    total: number;
    wins: number;
  }[] {
    return this.db
      .prepare(
        `SELECT game_type, game_mode, difficulty, COUNT(*) AS total,
                SUM(won) AS wins
         FROM player_games WHERE user_id = ?
         GROUP BY game_type, game_mode, difficulty`,
      )
      .all(userId) as {
      game_type: string;
      game_mode: string;
      difficulty: string;
      total: number;
      wins: number;
    }[];
  }

  close(): void {
    this.db.close();
  }
}
