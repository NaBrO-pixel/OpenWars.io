// The OpenWars accounts service, end to end over HTTP: every response is
// checked against the schema the game's client and server parse it with.
import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import {
  GameXpResponseSchema,
  PlayerProfileSchema,
  ProgressionConfigSchema,
  PublicProgressSchema,
  TokenPayloadSchema,
  UserMeResponseSchema,
} from "@openfront/shared/ApiSchemas";
import { base64urlToUuid } from "@openfront/shared/Base64";
import { JwksSchema } from "@openfront/shared/configuration/Env";
import { CosmeticsSchema } from "@openfront/shared/CosmeticSchemas";
import {
  createPartialGameRecord,
  replacer,
} from "@openfront/shared/SharedUtil";
import type { PlayerRecord } from "@openfront/shared/WireSchemas";
import express from "express";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/accounts/App";
import {
  type AccountsConfig,
  REAL_OAUTH_ENDPOINTS,
} from "../../src/accounts/Config";
import { AccountsDb } from "../../src/accounts/Database";
import { progressFor } from "../../src/accounts/Progression";
import { Tokens } from "../../src/accounts/Tokens";
import { testGameConfig } from "../util/Wire";

const PAGE = "http://localhost:9000";
const API_KEY = "test-api-key-0123456789";

let api: Server;
let fake: Server;
let base: string;
let db: AccountsDb;

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
}
const portOf = (s: Server) => (s.address() as AddressInfo).port;

// A stand-in for Discord's and Google's OAuth servers.
function fakeProviders(): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.post("/token", (req, res) => {
    if (req.body.client_secret !== "secret") {
      res.status(401).json({});
      return;
    }
    res.json({ access_token: `at-${req.body.code}` });
  });
  app.get("/discord/me", (req, res) => {
    const who = String(req.headers.authorization).replace("Bearer at-", "");
    res.json({
      id: `d-${who}`,
      username: who,
      avatar: null,
      global_name: who.toUpperCase(),
      discriminator: "0",
    });
  });
  app.get("/google/me", (req, res) => {
    const who = String(req.headers.authorization).replace("Bearer at-", "");
    res.json({ sub: `g-${who}`, email: `${who}@example.com` });
  });
  return app;
}

beforeAll(async () => {
  fake = await listen(fakeProviders());
  const f = `http://127.0.0.1:${portOf(fake)}`;
  db = new AccountsDb(":memory:");
  const issuer = "http://localhost:8787";
  const config: AccountsConfig = {
    port: 0,
    issuer,
    audience: "localhost",
    allowedOrigins: [PAGE],
    apiKey: API_KEY,
    dataDir: "",
    discord: { clientId: "discord-app", clientSecret: "secret" },
    google: { clientId: "google-app", clientSecret: "secret" },
    turnstileSecret: null,
    oauth: {
      ...REAL_OAUTH_ENDPOINTS,
      discordAuthorize: `${f}/authorize`,
      discordToken: `${f}/token`,
      discordUser: `${f}/discord/me`,
      googleAuthorize: `${f}/authorize`,
      googleToken: `${f}/token`,
      googleUser: `${f}/google/me`,
    },
  };
  const tokens = await Tokens.load(null, issuer, "localhost");
  api = await listen(createApp({ config, db, tokens, log: () => {} }));
  base = `http://127.0.0.1:${portOf(api)}`;
});

afterAll(() => {
  api.close();
  fake.close();
  db.close();
});

// A browser: keeps the session cookie between requests.
class Browser {
  cookie = "";
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(base + path, {
      redirect: "manual",
      ...init,
      headers: {
        Origin: PAGE,
        ...(this.cookie && { Cookie: this.cookie }),
        ...(init.headers as Record<string, string>),
      },
    });
    const set = res.headers.get("set-cookie");
    if (set !== null) this.cookie = set.split(";")[0];
    return res;
  }
  async jwt(): Promise<string> {
    const res = await this.fetch("/auth/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    return ((await res.json()) as { jwt: string }).jwt;
  }
  async me() {
    const jwt = await this.jwt();
    const res = await this.fetch("/users/@me", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    return UserMeResponseSchema.parse(await res.json());
  }
  async signIn(provider: "discord" | "google", who: string) {
    const start = await this.fetch(
      `/auth/login/${provider}?redirect_uri=${encodeURIComponent(PAGE + "/#play")}`,
    );
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location")!);
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `http://localhost:8787/auth/callback/${provider}`,
    );
    const state = authorize.searchParams.get("state")!;
    const back = await this.fetch(
      `/auth/callback/${provider}?code=${who}&state=${state}`,
    );
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe(PAGE + "/#play");
  }
}

function subOf(jwt: string): string {
  const payload = JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64url").toString(),
  );
  return base64urlToUuid(payload.sub);
}

// A finished public FFA game the player won, 10 minutes long.
function wonGame(gameID: string, persistentID: string, others = 1) {
  const players: PlayerRecord[] = [
    {
      clientID: "winner01",
      username: "Winner",
      clanTag: null,
      persistentID,
      stats: { attacks: [5n], finalTiles: 900n },
    },
  ];
  for (let i = 0; i < others; i++) {
    players.push({
      clientID: `loser${String(i).padStart(3, "0")}`,
      username: `other${i}`,
      clanTag: null,
      persistentID: null,
      stats: { attacks: [1n], killedAt: 3000n },
    });
  }
  const turns = Array.from({ length: 6000 }, (_, turnNumber) => ({
    turnNumber,
    intents: [],
  }));
  const record = createPartialGameRecord(
    gameID,
    testGameConfig({ gameType: GameType.Public, gameMode: GameMode.FFA }),
    players,
    turns,
    1_700_000_000_000,
    1_700_000_600_000,
    ["player", "winner01"],
  );
  return JSON.stringify({ ...record, gitCommit: "DEV" }, replacer);
}

describe("accounts service", () => {
  it("publishes the signing key the game server expects", async () => {
    const res = await fetch(`${base}/.well-known/jwks.json`);
    expect(JwksSchema.safeParse(await res.json()).success).toBe(true);
  });

  it("serves an empty store and the bundled news and streams", async () => {
    const cosmetics = await fetch(`${base}/cosmetics.json`);
    expect(cosmetics.status).toBe(200);
    expect(CosmeticsSchema.safeParse(await cosmetics.json()).success).toBe(
      true,
    );
    for (const path of ["/news.json", "/streams.json"]) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
    }
  });

  it("gives a new visitor a guest session the game accepts", async () => {
    const b = new Browser();
    const jwt = await b.jwt();
    expect(b.cookie).toMatch(/^ow_session=/);
    const jwks = createLocalJWKSet(
      await (await fetch(`${base}/.well-known/jwks.json`)).json(),
    );
    const { payload } = await jwtVerify(jwt, jwks, {
      algorithms: ["EdDSA"],
      issuer: "http://localhost:8787",
      audience: "localhost",
    });
    const claims = TokenPayloadSchema.parse(payload);
    expect(claims.provider).toBe("guest");

    // The same browser keeps the same account.
    expect(subOf(await b.jwt())).toBe(claims.sub);
    const me = await b.me();
    expect(me.player.progress?.level).toBe(1);
    expect(me.user.discord).toBeUndefined();
  });

  it("signs in with Discord, keeping progress made as a guest", async () => {
    const b = new Browser();
    const guestId = subOf(await b.jwt());
    const post = await fetch(`${base}/game/gameAAAA01`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: wonGame("gameAAAA01", guestId),
    });
    expect(await post.text()).toBe('{"ok":true}');
    const xpAsGuest = (await b.me()).player.progress!.lifetimeXp;
    expect(xpAsGuest).toBeGreaterThan(0);

    await b.signIn("discord", "alice");
    const me = await b.me();
    expect(me.user.discord?.username).toBe("alice");
    expect(me.player.trustTier).toBe("trusted");
    expect(me.player.progress!.lifetimeXp).toBe(xpAsGuest);

    // Signing in again from another browser finds the same account.
    const other = new Browser();
    await other.signIn("discord", "alice");
    expect((await other.me()).player.publicId).toBe(me.player.publicId);
  });

  it("signs in with Google", async () => {
    const b = new Browser();
    await b.signIn("google", "bob");
    expect((await b.me()).user.google?.email).toBe("bob@example.com");
  });

  it("saves the XP of a finished game once, and reports it", async () => {
    const b = new Browser();
    await b.signIn("discord", "carol");
    const jwt = await b.jwt();
    const id = subOf(jwt);
    const send = () =>
      fetch(`${base}/game/gameBBBB02`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: wonGame("gameBBBB02", id, 5),
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200); // a retried upload pays nothing

    const xpRes = await b.fetch("/users/@me/xp/gameBBBB02", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(xpRes.status).toBe(200);
    const xp = GameXpResponseSchema.parse(await xpRes.json());
    expect(xp.eligible).toBe(true);
    if (!xp.eligible) return;
    expect(xp.breakdown.win).toBeGreaterThan(0);
    expect(xp.breakdown.firstGame).toBe(100);
    const me = await b.me();
    expect(me.player.progress!.lifetimeXp).toBe(xp.breakdown.total);
    expect(me.player.progress).toEqual(progressFor(xp.breakdown.total));

    const unknown = await b.fetch("/users/@me/xp/gameNOPE99", {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    expect(unknown.status).toBe(404);

    // The public profile shows the game and the level.
    const profile = PlayerProfileSchema.parse(
      await (await fetch(`${base}/public/player/${me.player.publicId}`)).json(),
    );
    const leaf = profile.stats.Public?.["Free For All"]?.Medium;
    expect(leaf?.wins).toBe(1n);
    expect(leaf?.total).toBe(1n);
    const progress = PublicProgressSchema.parse(
      await (
        await fetch(`${base}/public/player/${me.player.publicId}/progress`)
      ).json(),
    );
    expect(progress.lifetimeXp).toBe(xp.breakdown.total);
  });

  it("refuses game results without the server's key", async () => {
    const res = await fetch(`${base}/game/gameCCCC03`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "wrong" },
      body: wonGame("gameCCCC03", "00000000-0000-4000-8000-000000000000"),
    });
    expect(res.status).toBe(401);
  });

  it("only sends players back to OpenWars pages", async () => {
    const res = await fetch(
      `${base}/auth/login/discord?redirect_uri=${encodeURIComponent("https://evil.example/")}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });

  it("signs out", async () => {
    const b = new Browser();
    await b.signIn("discord", "dave");
    const before = (await b.me()).player.publicId;
    await b.fetch("/auth/logout", { method: "POST" });
    const old = b.cookie;
    b.cookie = old; // the browser would drop it; the server must not honour it
    const after = (await b.me()).player.publicId;
    expect(after).not.toBe(before);
  });

  it("serves a level curve the client accepts", async () => {
    const config = ProgressionConfigSchema.parse(
      await (await fetch(`${base}/public/progression/config`)).json(),
    );
    expect(config.levels).toHaveLength(100);
    expect(config.levels[1].cumulativeXp).toBe(config.levels[0].xpToNext);
  });

  it("approves joins", async () => {
    const res = await fetch(`${base}/join_verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ ip: "1.2.3.4", token: "t", username: "Eve" }),
    });
    expect(await res.json()).toEqual({
      status: "approved",
      username: "Eve",
      clanTag: null,
    });
  });
});
