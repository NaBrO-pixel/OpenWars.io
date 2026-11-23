// The OpenWars accounts service: sign-in (Discord, Google, and a guest
// session for everyone else), saved progress, and public profiles. It
// answers the subset of the accounts API the game's client and server call
// (getApiBase() / ServerEnv.jwtIssuer()); anything else 404s, which the game
// already treats as "feature unavailable".
import { HumansVsNations } from "@openfront/engine-api/game/GameTypes";
import type {
  PlayerProfile,
  PlayerStatsTree,
  PublicProgress,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { PartialAnalyticsRecordSchema } from "@openfront/shared/WireSchemas";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AccountsConfig } from "./Config";
import type { AccountsDb, UserRow } from "./Database";
import { authorizeUrl, exchangeCode, type Identity, isProvider } from "./OAuth";
import { progressFor, progressionConfig } from "./Progression";
import { scoreGame } from "./Scoring";
import {
  hashSessionToken,
  JWT_LIFETIME_SECONDS,
  newSessionToken,
  SESSION_LIFETIME_MS,
  type Tokens,
} from "./Tokens";

const COOKIE = "ow_session";
const OAUTH_STATE_MS = 10 * 60 * 1000;

export interface AppDeps {
  config: AccountsConfig;
  db: AccountsDb;
  tokens: Tokens;
  log?: (message: string) => void;
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      return decodeURIComponent(part.slice(i + 1).trim());
    }
  }
  return null;
}

function providerOf(user: UserRow): string | undefined {
  if (user.discord_id !== null) return "discord";
  if (user.google_sub !== null) return "google";
  return undefined;
}

export function userMeResponse(user: UserRow): UserMeResponse {
  const signedIn = providerOf(user) !== undefined;
  const me = {
    user: {
      ...(user.discord_json !== null && {
        discord: JSON.parse(user.discord_json),
      }),
      ...(user.google_email !== null && {
        google: { email: user.google_email },
      }),
    },
    ban: null,
    steamLicence: false,
    steamLicenceSince: null,
    noticesSeen: [],
    pendingMessages: [],
    player: {
      publicId: user.public_id,
      // There are no ads to remove.
      adfree: true,
      canCreatePublicLobbies: false,
      trustTier: signedIn ? "trusted" : "untrusted",
      username: null,
      flares: [],
      achievements: { singleplayerMap: [], player: [] },
      progress: progressFor(user.lifetime_xp),
      levelHidden: false,
      searchHidden: false,
      friends: [],
      subscription: null,
    },
  };
  return me as unknown as UserMeResponse;
}

function statsTree(db: AccountsDb, user: UserRow): PlayerStatsTree {
  const tree: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const row of db.playerGameCounts(user.id)) {
    const type = (tree[row.game_type] ??= {});
    const mode = (type[row.game_mode] ??= {});
    const wins = Number(row.wins ?? 0);
    mode[row.difficulty] = {
      wins: String(wins),
      losses: String(row.total - wins),
      total: String(row.total),
      stats: {},
    };
  }
  return tree as unknown as PlayerStatsTree;
}

function publicProgress(user: UserRow): PublicProgress {
  const p = progressFor(user.lifetime_xp);
  return {
    prestige: p.prestige,
    level: p.level,
    lifetimeXp: p.lifetimeXp,
    legend: p.legend,
    xpInLevel: p.xpInLevel,
    xpForNext: p.xpForNext,
  };
}

export function createApp({ config, db, tokens, log }: AppDeps) {
  const say = log ?? ((m: string) => console.log(`[accounts] ${m}`));
  const secureCookie = config.issuer.startsWith("https://");
  const app = express();
  app.disable("x-powered-by");
  // Behind Caddy (or the Vite dev proxy): the client IP is X-Forwarded-For.
  app.set("trust proxy", 1);

  // CORS: the game's pages may call with the session cookie.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined && config.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Content-Encoding, Accept",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "64mb" }));

  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  const setSessionCookie = (res: Response, userId: string) => {
    const { token, hash } = newSessionToken();
    db.createSession(hash, userId, Date.now() + SESSION_LIFETIME_MS);
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_LIFETIME_MS,
    });
  };
  const clearSessionCookie = (res: Response) => {
    res.clearCookie(COOKIE, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
    });
  };
  const cookieUser = (req: Request): UserRow | null => {
    const token = readCookie(req, COOKIE);
    return token === null
      ? null
      : db.sessionUser(hashSessionToken(token), Date.now());
  };
  const bearerUser = async (req: Request): Promise<UserRow | null> => {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const id = await tokens.verify(header.slice(7));
    return id === null ? null : db.userById(id);
  };
  const requireApiKey = (req: Request, res: Response): boolean => {
    if (config.apiKey === "" || req.headers["x-api-key"] === config.apiKey) {
      return true;
    }
    res.status(401).json({ error: "bad api key" });
    return false;
  };

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/.well-known/jwks.json", (_req, res) => {
    res.json({ keys: [tokens.publicJwk] });
  });

  // --- sessions --------------------------------------------------------------

  // The client calls this to get a session token. With no session cookie it
  // starts a guest session, so players who never sign in still keep their
  // progress on this browser; signing in later keeps it too.
  app.post("/auth/refresh", authLimiter, async (req, res) => {
    let user = cookieUser(req);
    if (user === null) {
      user = db.createUser();
      setSessionCookie(res, user.id);
    }
    res.json({
      jwt: await tokens.sign(user.id, providerOf(user) ?? "guest"),
      expiresIn: JWT_LIFETIME_SECONDS,
    });
  });

  app.post("/auth/logout", (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token !== null) db.deleteSession(hashSessionToken(token));
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.post("/auth/revoke", (req, res) => {
    const user = cookieUser(req);
    if (user !== null) db.deleteUserSessions(user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- sign-in ---------------------------------------------------------------

  app.get("/auth/login/:provider", authLimiter, (req, res) => {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      res.status(404).send("Unknown sign-in method");
      return;
    }
    const redirect = String(req.query.redirect_uri ?? "");
    let origin: string;
    try {
      origin = new URL(redirect).origin;
    } catch {
      res.status(400).send("Bad redirect_uri");
      return;
    }
    if (!config.allowedOrigins.includes(origin)) {
      res.status(400).send("redirect_uri is not an OpenWars page");
      return;
    }
    const state = randomBytes(24).toString("base64url");
    const url = authorizeUrl(config, provider, state);
    if (url === null) {
      res
        .status(503)
        .send(
          `${provider === "discord" ? "Discord" : "Google"} sign-in is not set up on this server.`,
        );
      return;
    }
    db.saveOAuthState(
      state,
      provider,
      redirect,
      cookieUser(req)?.id ?? null,
      Date.now() + OAUTH_STATE_MS,
    );
    res.redirect(302, url);
  });

  app.get("/auth/callback/:provider", authLimiter, async (req, res) => {
    const provider = String(req.params.provider);
    const saved = db.takeOAuthState(String(req.query.state ?? ""), Date.now());
    if (
      !isProvider(provider) ||
      saved === null ||
      saved.provider !== provider
    ) {
      res
        .status(400)
        .send("Sign-in expired. Go back to the game and try again.");
      return;
    }
    if (typeof req.query.code !== "string") {
      // The player cancelled on the provider's page.
      res.redirect(302, saved.redirect_uri);
      return;
    }
    let identity: Identity;
    try {
      identity = await exchangeCode(config, provider, req.query.code);
    } catch (e) {
      say(`sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
      res
        .status(502)
        .send("Sign-in failed. Go back to the game and try again.");
      return;
    }
    let user = db.userByProvider(identity.provider, identity.id);
    if (user === null) {
      // A new identity. Attach it to this browser's guest account when there
      // is one, so the progress made as a guest is kept.
      const guest =
        saved.link_user_id === null ? null : db.userById(saved.link_user_id);
      user =
        guest !== null && providerOf(guest) === undefined
          ? guest
          : db.createUser();
      if (identity.provider === "discord") {
        db.setDiscord(user.id, identity.id, JSON.stringify(identity.discord));
      } else {
        db.setGoogle(user.id, identity.id, identity.email);
      }
      say(`new ${identity.provider} account ${user.public_id}`);
    }
    const oldToken = readCookie(req, COOKIE);
    if (oldToken !== null) db.deleteSession(hashSessionToken(oldToken));
    setSessionCookie(res, user.id);
    res.redirect(302, saved.redirect_uri);
  });

  // --- the player ------------------------------------------------------------

  app.get("/users/@me", async (req, res) => {
    const user = await bearerUser(req);
    if (user === null) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    res.json(userMeResponse(user));
  });

  app.get("/users/@me/xp/:gameId", async (req, res) => {
    const user = await bearerUser(req);
    if (user === null) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    const json = db.gameXp(user.id, String(req.params.gameId));
    if (json === null) {
      res.status(404).json({ error: "not scored yet" });
      return;
    }
    res.type("application/json").send(json);
  });

  app.get("/public/progression/config", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(progressionConfig());
  });

  app.get("/public/player/:publicId", (req, res) => {
    const user = db.userByPublicId(String(req.params.publicId));
    if (user === null) {
      res.status(404).json({ error: "no such player" });
      return;
    }
    const profile = {
      createdAt: user.created_at,
      ...(user.discord_json !== null && {
        user: JSON.parse(user.discord_json),
      }),
      username: null,
      stats: statsTree(db, user),
    };
    res.json(profile as PlayerProfile);
  });

  app.get("/public/player/:publicId/progress", (req, res) => {
    const user = db.userByPublicId(String(req.params.publicId));
    if (user === null) {
      res.status(404).json({ error: "no such player" });
      return;
    }
    res.json(publicProgress(user));
  });

  // --- games -----------------------------------------------------------------

  // The game server posts every finished multiplayer game (Archive.ts).
  app.post("/game/:gameId", (req, res) => {
    if (!requireApiKey(req, res)) return;
    const parsed = PartialAnalyticsRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = z.prettifyError(parsed.error);
      say(`rejected game record: ${detail}`);
      res.status(400).json({ error: "invalid game record", detail });
      return;
    }
    const credited = scoreGame(db, normalize(parsed.data));
    say(`game ${parsed.data.info.gameID}: ${credited} player(s) credited`);
    res.json({ ok: true });
  });

  // The client posts its own singleplayer games (LocalServer.ts).
  app.post("/archive_singleplayer_game", async (req, res) => {
    const user = await bearerUser(req);
    if (user === null) {
      res.status(401).json({ error: "not signed in" });
      return;
    }
    const parsed = PartialAnalyticsRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid game record" });
      return;
    }
    scoreGame(db, normalize(parsed.data), { onlyUserId: user.id });
    res.json({ ok: true });
  });

  // Join checks from the game server (JoinVerify.ts): Turnstile when it is
  // set up, and the name as given (the game server screens names itself).
  app.post("/join_verify", async (req, res) => {
    if (!requireApiKey(req, res)) return;
    const body = (req.body ?? {}) as {
      ip?: string;
      token?: string | null;
      username?: string;
      clanTag?: string | null;
      mode?: string;
    };
    const username = String(body.username ?? "");
    const clanTag = body.clanTag ?? null;
    if (
      (config.turnstileSecret ?? "") !== "" &&
      (body.mode ?? "token") === "token" &&
      body.token
    ) {
      try {
        const r = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: new URLSearchParams({
              secret: config.turnstileSecret ?? "",
              response: body.token,
              ...(body.ip ? { remoteip: body.ip } : {}),
            }),
            signal: AbortSignal.timeout(4000),
          },
        );
        const verdict = (await r.json()) as {
          success?: boolean;
          "error-codes"?: string[];
        };
        if (verdict.success !== true) {
          res.json({
            status: "rejected",
            reason: "turnstile",
            errorCodes: verdict["error-codes"] ?? [],
          });
          return;
        }
      } catch (e) {
        res.json({ status: "error", reason: String(e), username, clanTag });
        return;
      }
    }
    res.json({ status: "approved", username, clanTag });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not available on OpenWars" });
  });

  return app;
}

// Records a Humans-vs-Nations game under its own mode, as profiles list it.
function normalize<T extends { info: { config: unknown } }>(record: T): T {
  const config = record.info.config as {
    gameMode: string;
    playerTeams?: unknown;
  };
  if (config.playerTeams === HumansVsNations) {
    return {
      ...record,
      info: {
        ...record.info,
        config: { ...config, gameMode: HumansVsNations },
      },
    };
  }
  return record;
}
