# Poki web build

A self-contained browser build of the full game for uploading to
[Poki for Developers](https://developers.poki.com/) and testing in the
[Poki Inspector](https://inspector.poki.dev/). It is the regular production
client, packaged so it runs from whatever path Poki's build CDN serves it
under. It contains every game mode, map and feature, including the AIR update.

**Monetisation is not integrated by this build, but upstream code already
contains some.** On Poki the client already calls Poki's SDK, including
`PokiSDK.commercialBreak()` before a solo game starts and when leaving a game
(`src/client/poki/PokiSDK.ts`, `SinglePlayerModal.ts`,
`GameRightSidebar.ts`). That existing behaviour is unchanged; Poki decides
whether an ad actually plays (the Inspector shows test ads). Ask if you want a
switch to turn those calls off.

## Build

```bash
npm run build:poki
```

Outputs (gitignored):

- `build/poki-web/`: the build, with `index.html` at its root;
- `build/poki-web.zip`: the same, zipped for upload;
- `build/poki-web/poki-build.json`: what it was built with (commit, game
  server, environment).

The command runs the normal production `vite build` (into `static/`), then
renders `index.html` with the same template and renderer the game server uses
for every request (`src/server/RenderHtml.ts`), and makes two changes:

1. **Asset paths.** The server prefixes assets with `CDN_BASE`, an origin. A
   Poki build lives under an unknown versioned path, so static references
   become relative (`./assets/…`, `./_assets/…`), and
   `BOOTSTRAP_CONFIG.cdnBase` becomes the page's own directory, computed at
   runtime. Every runtime asset URL (maps, sprites, sounds, translations,
   worker fetches) is built from it.
2. **Game server.** A page served by a game server talks to its own origin;
   this one is served by Poki, so a multiplayer server has to be named at
   build time (below). Without one the build is **single-player only**: it
   is marked `offline` (the homepage skips the public-lobby feed instead of
   showing a "Connection error!" dialog), and the Cloudflare Turnstile script
   is left out, since only multiplayer joins use it.

`npm run build:poki -- --skip-vite` repackages the existing `static/` build
without rebuilding.

### Configuration

| Variable                  | Default                      | Meaning                                                                                                                                             |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POKI_GAME_SERVER`        | unset: single-player only    | `host[:port]` of your multiplayer deployment. The client always uses `wss://`/`https://` to it.                                                     |
| `POKI_INSTANCE_LETTER`    | `a`                          | That deployment's `INSTANCE_LETTER`.                                                                                                                |
| `POKI_NUM_WORKERS`        | `2`                          | That deployment's `NUM_WORKERS`.                                                                                                                    |
| `POKI_GIT_COMMIT`         | the current commit           | Must equal the server's `GIT_COMMIT`: the client treats a mismatch as an outdated page and stops using the lobby feed. `DEV` matches `npm run dev`. |
| `POKI_GAME_ENV`           | `prod`                       | `dev` skips Turnstile on join, but only works against a dev-mode server. Use it for local testing.                                                  |
| `POKI_DOMAIN`             | `localhost`: no accounts API | Audience of the accounts API (`https://api.<domain>`), the closed-source service behind sign-in, cosmetics and leaderboards.                        |
| `POKI_TURNSTILE_SITE_KEY` | Cloudflare's test key        | Your Turnstile site key. A production key must list the Poki hostnames.                                                                             |

## Run it locally

Any static file server works. Serve the directory, not the repo root:

```bash
python3 -m http.server 8080 --directory build/poki-web
```

Then open <http://localhost:8080/>. Outside Poki the client is not in
"Poki mode": it does not use the Poki SDK, it does not auto-start the
onboarding tutorial, and it loads its usual third-party scripts.

## Test it as Poki would serve it

`scripts/poki/smokeTestPokiWeb.mjs` loads the build in Chromium inside an
iframe on a `*.poki.com` parent page, from a nested versioned path on a
`*.poki-gdn.com` host. Playwright answers both hosts straight from
`build/poki-web`, so the client takes its Poki code paths. **Every request to
any other origin is blocked and listed**, like Poki's default CSP. It then
plays:

1. as a first-time Poki player: the onboarding tutorial starts by itself;
2. as a returning player: home page, Solo, a game with bots, spawn, expand;
3. if the build names a game server: the public-lobby feed must arrive from
   it, then the player joins a public lobby and the match must start.

It needs Playwright and Chromium, as the `run-openfront` skill does
(`.claude/skills/run-openfront/SKILL.md`):

```bash
npm run build:poki
node scripts/poki/smokeTestPokiWeb.mjs
```

The command exits 0 when every check passes. The report and screenshots are
written to `/tmp/poki-web-smoke` (set `OUT` to change it).

### Multiplayer, locally

1. Start the dev server, allowing the emulated Poki origin:

   ```bash
   EXTRA_PAGE_ORIGINS=https://openwars-test.poki-gdn.com SKIP_BROWSER_OPEN=true npm run dev
   ```

2. Start a local TLS stand-in for nginx (a multiplayer page always uses
   `wss://`):

   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost -keyout /tmp/poki-key.pem -out /tmp/poki-cert.pem
   ```

   ```bash
   node scripts/poki/localGameServerProxy.mjs /tmp/poki-key.pem /tmp/poki-cert.pem
   ```

3. Build against it and run the smoke test:

   ```bash
   POKI_GAME_ENV=dev POKI_GIT_COMMIT=DEV POKI_GAME_SERVER=localhost:9443 npm run build:poki
   ```

   ```bash
   SMOKE_INSECURE_TLS=1 node scripts/poki/smokeTestPokiWeb.mjs
   ```

`SMOKE_INSECURE_TLS=1` accepts the self-signed certificate and lifts
Chromium's Local Network Access checks, which otherwise stop a public origin
(the emulated Poki page) from reaching `localhost`. A real deployment is a
public host and needs neither.

## Upload to Poki

1. `npm run build:poki`, with `POKI_GAME_SERVER` set if you want multiplayer.
2. Upload `build/poki-web.zip` as a new version in Poki for Developers, then
   open it in the Poki Inspector.
3. For multiplayer, request the external origins below under **Settings →
   CSP** for the game.

## What multiplayer needs (backend)

Multiplayer is server-authoritative for lobbies and relays every player's
intents, so a Poki build needs your own deployment of this repository's
server. Single-player runs entirely in the browser and needs none of this.

- **The game server**: the Docker image built from `Dockerfile`, which runs
  nginx, the master process (lobbies, `/api`, the public-lobby WebSocket) and
  `NUM_WORKERS` game workers (game WebSockets under `/wN`). It must be served
  over HTTPS/WSS on a public hostname. Set:
  - `GAME_ENV=prod`, `DOMAIN`, `INSTANCE_LETTER`, `NUM_WORKERS`,
    `TURNSTILE_SITE_KEY` and `GIT_COMMIT` (the same commit as the Poki build);
  - **`EXTRA_PAGE_ORIGINS`**, new in this branch: the Poki page origins
    allowed to call the game server's `/api` cross-origin, for example
    `https://*.poki-gdn.com`. Confirm the exact origins in the Inspector.
    Without it, lobby creation and join-by-id fail on CORS. WebSockets are not
    origin-checked.
- **The accounts API** (`https://api.<DOMAIN>`): closed-source, not in this
  repository. The server fetches its JWT keys and runs join verification
  (`join_verify`: Turnstile and name checks) through it. Without it:
  - sign-in, cosmetics, leaderboards, news, ranked play and trusted-only
    lobbies are unavailable;
  - the server fails open on join verification errors (`JoinVerify.ts`), but
    a first join must still present a Turnstile token in `prod`.
  - **Not tested here:** a `prod`-mode server running without this API was
    not run end to end. Verify joins on your deployment.
- **Cloudflare Turnstile**: a site key whose allowed hostnames include the
  Poki hosts, and Poki's approval for `challenges.cloudflare.com`. Without
  both, `prod` multiplayer joins are refused.

## External requests and Poki's policy

Poki blocks every third-party request by default; an externally hosted
multiplayer server is allowed once approved
([external resources policy](https://developers.poki.com/guide/external-resources-policy)).

| Origin                                                                                        | When                                     | Status on Poki                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `game-cdn.poki.com`                                                                           | Always on Poki: Poki's own SDK           | Poki's own script.                                                                                                                                                                                                 |
| Your game server (`POKI_GAME_SERVER`)                                                         | Multiplayer builds                       | **Needs approval** (multiplayer server).                                                                                                                                                                           |
| `challenges.cloudflare.com`                                                                   | Multiplayer builds only (Turnstile)      | **Needs approval.** Not mentioned by name in Poki's policy.                                                                                                                                                        |
| `https://api.<POKI_DOMAIN>`, or `http://localhost:8787` when unset                            | Always: cosmetics, the server list, news | Blocked unless approved; the client falls back. With `POKI_DOMAIN` unset the requests go to `localhost:8787`, which fails harmlessly but appears in the console. Accounts are also restricted by Poki (see below). |
| Google Tag Manager, Cloudflare Insights, CrazyGames SDK, ad scripts (RAMP/Playwire, AdShield) | Never on Poki                            | `index.html` skips them when it detects Poki (`window.__onPoki`). Google products cannot be approved.                                                                                                              |
| Stripe, Grafana Faro                                                                          | Never in this build                      | Their keys are not set.                                                                                                                                                                                            |

Observed in the smoke test, single-player build: only `game-cdn.poki.com` and
`localhost:8787` were requested. Multiplayer build: those two, plus
`challenges.cloudflare.com` and the game server. Nothing else.

## Known review risks (Poki requirements)

From Poki's [quality requirements](https://developers.poki.com/guide/requirements-quality),
the points to check before submitting:

- **Size**: 843 MiB uncompressed, 193 MiB zipped. Maps account for 764 MiB
  (148 maps). Players download only the map they play, but the upload is
  large; confirm the limit with Poki.
- **Accounts and purchases**: Poki forbids email or Google sign-in and in-game
  purchases. On Poki the client signs in through Poki's own accounts
  (`PokiSDK.login`), and Stripe is off in this build, but the store,
  inventory and sign-in menu screens are upstream UI. Review them in the
  Inspector.
- **Chat**: Poki does not allow chat systems. The game has quick chat
  (predefined phrases) and emojis, not free text; confirm this with Poki.
- **External links**: on Poki they already go through
  `PokiSDK.openExternalLink` (`PokiSDK.ts`).
