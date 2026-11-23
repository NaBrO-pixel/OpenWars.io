// Settings for the OpenWars accounts service, read from the environment.
// See docs/Accounts.md for what each one is for.

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

// Where each provider's OAuth endpoints live. Real values by default; tests
// point them at a fake provider.
export interface OAuthEndpoints {
  discordAuthorize: string;
  discordToken: string;
  discordUser: string;
  googleAuthorize: string;
  googleToken: string;
  googleUser: string;
}

export const REAL_OAUTH_ENDPOINTS: OAuthEndpoints = {
  discordAuthorize: "https://discord.com/oauth2/authorize",
  discordToken: "https://discord.com/api/oauth2/token",
  discordUser: "https://discord.com/api/users/@me",
  googleAuthorize: "https://accounts.google.com/o/oauth2/v2/auth",
  googleToken: "https://oauth2.googleapis.com/token",
  googleUser: "https://openidconnect.googleapis.com/v1/userinfo",
};

export interface AccountsConfig {
  port: number;
  // This service's public origin. It is the JWT issuer, and the game's
  // client and server both derive it from DOMAIN the same way
  // (ClientEnv.jwtIssuer / ServerEnv.jwtIssuer), so it must match.
  issuer: string;
  // The game's DOMAIN: the JWT audience.
  audience: string;
  // Page origins allowed to call this service with the session cookie, and
  // to be sent back to after signing in.
  allowedOrigins: string[];
  // Shared secret the game server sends as x-api-key (its API_KEY).
  apiKey: string;
  // Folder for the database and the signing key.
  dataDir: string;
  discord: OAuthProviderConfig | null;
  google: OAuthProviderConfig | null;
  // Cloudflare Turnstile secret. Unset: joins are not Turnstile-checked.
  turnstileSecret: string | null;
  oauth: OAuthEndpoints;
}

function provider(id?: string, secret?: string): OAuthProviderConfig | null {
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export function issuerFor(audience: string): string {
  return audience === "localhost"
    ? "http://localhost:8787"
    : `https://api.${audience}`;
}

export function configFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AccountsConfig {
  const audience = env.DOMAIN ?? "localhost";
  const origins =
    audience === "localhost"
      ? ["http://localhost:9000"]
      : [`https://${audience}`, `https://www.${audience}`];
  for (const extra of (env.EXTRA_PAGE_ORIGINS ?? "").split(",")) {
    if (extra.trim()) origins.push(extra.trim());
  }
  const apiKey = env.API_KEY ?? "";
  if (audience !== "localhost" && apiKey.length < 16) {
    throw new Error("API_KEY must be set (16+ characters) outside localhost");
  }
  return {
    port: Number(env.ACCOUNTS_PORT ?? 8787),
    issuer: env.ACCOUNTS_ISSUER ?? issuerFor(audience),
    audience,
    allowedOrigins: origins,
    apiKey,
    dataDir: env.ACCOUNTS_DATA_DIR ?? "data/accounts",
    discord: provider(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET),
    google: provider(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    turnstileSecret: env.TURNSTILE_SECRET_KEY?.trim() ?? null,
    oauth: REAL_OAUTH_ENDPOINTS,
  };
}
