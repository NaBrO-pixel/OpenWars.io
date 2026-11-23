// Sign-in with Discord and Google: the standard OAuth 2.0 authorization-code
// flow. The provider sends the player back to /auth/callback/<provider> with a
// one-time code, which is exchanged here for who they are.
import type { DiscordUser } from "@openfront/shared/ApiSchemas";
import { z } from "zod";
import type { AccountsConfig } from "./Config";

export type ProviderName = "discord" | "google";

export type Identity =
  | { provider: "discord"; id: string; discord: DiscordUser }
  | { provider: "google"; id: string; email: string };

export function isProvider(name: string): name is ProviderName {
  return name === "discord" || name === "google";
}

export function callbackUrl(config: AccountsConfig, p: ProviderName): string {
  return `${config.issuer}/auth/callback/${p}`;
}

export function authorizeUrl(
  config: AccountsConfig,
  p: ProviderName,
  state: string,
): string | null {
  const creds = config[p];
  if (creds === null) return null;
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: callbackUrl(config, p),
    response_type: "code",
    state,
  });
  if (p === "discord") {
    params.set("scope", "identify");
    params.set("prompt", "none");
    return `${config.oauth.discordAuthorize}?${params}`;
  }
  params.set("scope", "openid email");
  params.set("prompt", "select_account");
  return `${config.oauth.googleAuthorize}?${params}`;
}

const TokenResponse = z.object({ access_token: z.string() });

const DiscordMe = z.object({
  id: z.string(),
  username: z.string(),
  avatar: z.string().nullable().optional(),
  global_name: z.string().nullable().optional(),
  discriminator: z.string().optional(),
});

const GoogleMe = z.object({
  sub: z.string(),
  email: z.string().optional(),
});

export async function exchangeCode(
  config: AccountsConfig,
  p: ProviderName,
  code: string,
): Promise<Identity> {
  const creds = config[p];
  if (creds === null) throw new Error(`${p} sign-in is not configured`);
  const tokenUrl =
    p === "discord" ? config.oauth.discordToken : config.oauth.googleToken;
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl(config, p),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) {
    throw new Error(`${p} token exchange failed: ${tokenRes.status}`);
  }
  const { access_token } = TokenResponse.parse(await tokenRes.json());
  const meUrl =
    p === "discord" ? config.oauth.discordUser : config.oauth.googleUser;
  const meRes = await fetch(meUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) throw new Error(`${p} profile fetch failed: ${meRes.status}`);
  const me: unknown = await meRes.json();
  if (p === "discord") {
    const d = DiscordMe.parse(me);
    return {
      provider: "discord",
      id: d.id,
      discord: {
        id: d.id,
        username: d.username,
        avatar: d.avatar ?? null,
        global_name: d.global_name ?? null,
        discriminator: d.discriminator ?? "0",
      },
    };
  }
  const g = GoogleMe.parse(me);
  return { provider: "google", id: g.sub, email: g.email ?? "" };
}
