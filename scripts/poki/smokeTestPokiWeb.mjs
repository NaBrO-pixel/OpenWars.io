// Smoke test for the Poki web build (build/poki-web, from `npm run build:poki`).
//
// Emulates how Poki serves a game, as closely as a local machine can:
//   - the build is served from a nested path on a *.poki-gdn.com host (Poki's
//     build CDN), inside a full-window iframe on a *.poki.com parent page, so
//     the client's own Poki detection (index.html __onPoki, PokiSDK.isOnPoki)
//     takes the Poki path. Both hosts are answered by Playwright request
//     interception straight from build/poki-web: nothing touches the network.
//   - every request that leaves the build's own origin is BLOCKED and listed,
//     like Poki's default CSP. The list is the set of external origins the
//     build would need Poki to approve (Settings -> CSP in Poki for
//     Developers).
// Then it plays, twice:
//   1. as a first-time Poki player, whom the client drops straight into the
//      onboarding tutorial (PortalTutorial.ts): Start it, check it runs;
//   2. as a returning player (gamesPlayed > 0): the home page, Solo, a game
//      with bots, spawn and expand, checking the territory grows;
//   3. only when the build names a game server (POKI_GAME_SERVER): the
//      homepage's public-lobby feed must arrive from that server over wss://,
//      then the player joins a public lobby and the match must start. The
//      server's /api must grant the page origin (EXTRA_PAGE_ORIGINS), so
//      start it with EXTRA_PAGE_ORIGINS=https://openwars-test.poki-gdn.com.
//      SMOKE_INSECURE_TLS=1 accepts a self-signed certificate (local test).
//
// Requires Playwright + Chromium, as for the run-openfront skill
// (.claude/skills/run-openfront/SKILL.md); run from the repo root:
//   node scripts/poki/smokeTestPokiWeb.mjs
// Exit code 0 = passed. Screenshots and a JSON report go to $OUT
// (default /tmp/poki-web-smoke).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  launch,
  openSoloModal,
} from "../../.claude/skills/run-openfront/driver.mjs";
import {
  attack,
  findExpansionTile,
  gameState,
  spawn,
  startSoloGame,
  waitForSpawnPhaseEnd,
} from "../../.claude/skills/run-openfront/game.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.resolve(__dirname, "../../build/poki-web");
const OUT = process.env.OUT ?? "/tmp/poki-web-smoke";
const PARENT_HOST = "games.poki.com";
const GAME_HOST = "openwars-test.poki-gdn.com";
const GAME_ORIGIN = `https://${GAME_HOST}`;
const GAME_PATH = "/3f9c2b1e-test-version/"; // like Poki's versioned build paths

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".bin": "application/octet-stream",
};

const PARENT_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}body{overflow:hidden}</style>
</head><body><iframe id="game" allow="fullscreen; autoplay; clipboard-write"
src="${GAME_ORIGIN}${GAME_PATH}index.html?site_id=1&game_id=test"></iframe></body></html>`;

if (!fs.existsSync(path.join(BUILD, "index.html"))) {
  console.error(`No build at ${BUILD}: run \`npm run build:poki\` first.`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const buildInfo = JSON.parse(
  fs.readFileSync(path.join(BUILD, "poki-build.json"), "utf8"),
);
const GAME_SERVER = buildInfo.gameServer; // host[:port] or null

const notFound = [];

// What the two emulated hosts answer: the parent page on the "poki.com" host,
// the build under GAME_PATH on the "poki-gdn.com" host, nothing else (no SPA
// fallback: a missing file must show up as a 404).
function serve(url) {
  if (url.hostname === PARENT_HOST && url.pathname === "/") {
    return { status: 200, contentType: MIME[".html"], body: PARENT_HTML };
  }
  if (url.hostname !== GAME_HOST || !url.pathname.startsWith(GAME_PATH)) {
    return { status: 404, body: "" };
  }
  const rel = decodeURIComponent(url.pathname.slice(GAME_PATH.length));
  const file = path.join(BUILD, rel || "index.html");
  if (
    !file.startsWith(BUILD) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    notFound.push(url.pathname);
    return { status: 404, body: "" };
  }
  return {
    status: 200,
    contentType: MIME[path.extname(file)] ?? "application/octet-stream",
    body: fs.readFileSync(file),
  };
}

const blocked = new Map(); // origin -> example URLs
const sockets = [];
const pageErrors = [];
const consoleErrors = [];
const report = { passed: false, checks: {} };
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ""}`,
  );
};

const { browser, page } = await launch({
  rafIntervalMs: 1500,
  args: [
    "--no-proxy-server",
    // A game server on this machine (local testing only): accept its
    // self-signed certificate, and lift Chromium's Local Network Access
    // checks, which block a public origin (the emulated Poki page) from
    // reaching localhost. A real deployment is a public host and needs
    // neither.
    ...(process.env.SMOKE_INSECURE_TLS === "1"
      ? [
          "--ignore-certificate-errors",
          "--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests",
        ]
      : []),
  ],
});
const context = page.context();
await context.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
  if (u.hostname === GAME_HOST || u.hostname === PARENT_HOST) {
    return route.fulfill(serve(u));
  }
  // The multiplayer server the build names: the one external origin a
  // multiplayer build needs (Poki approves it as the game's server).
  if (GAME_SERVER !== null && u.host === GAME_SERVER) return route.continue();
  const urls = blocked.get(u.origin) ?? [];
  if (urls.length < 3) urls.push(u.href.slice(0, 140));
  blocked.set(u.origin, urls);
  return route.abort("blockedbyclient");
});
page.on("websocket", (ws) => sockets.push(ws.url()));
page.on("pageerror", (e) => pageErrors.push(e.message.split("\n")[0]));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});

let exitCode = 1;
try {
  await page.goto(`https://${PARENT_HOST}/`, {
    waitUntil: "load",
    timeout: 120_000,
  });
  const frame = await (await page.waitForSelector("#game")).contentFrame();
  await frame.waitForLoadState("load");
  await page.waitForTimeout(4000); // Lit components render after load
  // The skill's helpers take a Page; the frame fills the window at (0,0), so
  // the frame's coordinates are the page's and only DOM calls need the frame.
  const g = new Proxy(page, {
    get(target, prop) {
      if (["evaluate", "waitForFunction", "locator"].includes(prop)) {
        return frame[prop].bind(frame);
      }
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  const env = await frame.evaluate(() => ({
    onPoki: window.__onPoki === true,
    cdnBase: window.BOOTSTRAP_CONFIG?.cdnBase,
    hasServerHost: window.BOOTSTRAP_CONFIG?.serverHost !== undefined,
  }));
  check("client detects Poki (third-party scripts skipped)", env.onPoki);
  check(
    "asset base is the build's own directory",
    env.cdnBase === `${GAME_ORIGIN}${GAME_PATH.replace(/\/$/, "")}`,
    env.cdnBase,
  );
  // 1. First visit: the onboarding tutorial starts by itself on Poki.
  const startButton = frame
    .locator("button:visible", { hasText: /^\s*Start\s*$/ })
    .first();
  await startButton.waitFor({ timeout: 60_000 });
  await page.screenshot({ path: `${OUT}/1-tutorial-welcome.png` });
  await startButton.click();
  const ticks = () =>
    frame.evaluate(
      () => document.querySelector("build-menu")?.game?.ticks() ?? 0,
    );
  await page.waitForTimeout(8000);
  const t0 = await ticks();
  await page.waitForTimeout(6000);
  const t1 = await ticks();
  check("first visit: onboarding tutorial starts and runs", t1 > t0 && t0 > 0, {
    ticks: [t0, t1],
  });
  await page.screenshot({ path: `${OUT}/2-tutorial-running.png` });

  // 2. Returning player: home page, then a Solo game.
  await frame.evaluate(() => localStorage.setItem("gamesPlayed", "1"));
  await frame.goto(
    `${GAME_ORIGIN}${GAME_PATH}index.html?site_id=1&game_id=test`,
    {
      waitUntil: "load",
    },
  );
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/3-home.png` });

  await openSoloModal(g);
  await page.screenshot({ path: `${OUT}/4-solo-modal.png` });
  await startSoloGame(g, { bots: 20 });
  const tile = await spawn(g);
  await waitForSpawnPhaseEnd(g);
  const before = (await gameState(g)).myPlayer.tilesOwned;
  for (let i = 0; i < 3; i++) {
    const t = await findExpansionTile(g, tile);
    if (t) await attack(g, t.x, t.y);
    await page.waitForTimeout(6000);
  }
  const state = await gameState(g);
  check(
    "returning player: solo game starts, spawns and expands",
    state.myPlayer.tilesOwned > before,
    {
      tilesAtSpawn: before,
      tilesNow: state.myPlayer.tilesOwned,
      ticks: state.ticks,
      players: state.numPlayers,
    },
  );
  await page.screenshot({ path: `${OUT}/5-in-game.png` });

  if (GAME_SERVER !== null) {
    // 3. Multiplayer, against the server the build names.
    await frame.goto(
      `${GAME_ORIGIN}${GAME_PATH}index.html?site_id=1&game_id=test`,
      { waitUntil: "load" },
    );
    const lobbies = await frame
      .waitForFunction(
        () => {
          const sel = document.querySelector("game-mode-selector");
          const games = sel?.lobbies?.games;
          return games && Object.values(games).flat().length > 0
            ? Object.values(games).flat().length
            : false;
        },
        undefined,
        { timeout: 120_000, polling: 1000 },
      )
      .then((h) => h.jsonValue())
      .catch(() => 0);
    const feed = sockets.find((u) =>
      new RegExp(`^wss://${GAME_SERVER}/w\\d+/lobbies`).test(u),
    );
    check(
      "multiplayer: public-lobby feed arrives from the game server",
      lobbies > 0 && feed !== undefined,
      {
        lobbies,
        feed,
      },
    );
    await page.screenshot({ path: `${OUT}/6-mp-home.png` });
    const joined = await frame.evaluate(() => {
      const sel = document.querySelector("game-mode-selector");
      if (!sel?.lobbies?.games) return null;
      const games = Object.values(sel.lobbies.games).flat();
      // An anonymous player may not join trusted-only lobbies (those need a
      // signed-in account, which comes from the accounts API).
      const open = (g) => g.gameConfig?.trusted !== true;
      const lobby =
        (sel.lobbies.games.ffa ?? []).find(open) ?? games.find(open);
      if (!lobby) return null;
      sel.validateAndJoin(lobby);
      return lobby.gameID;
    });
    const started = await frame
      .waitForFunction(
        () => (document.querySelector("build-menu")?.game?.ticks() ?? 0) > 0,
        undefined,
        { timeout: 240_000, polling: 1000 },
      )
      .then(() => true)
      .catch(() => false);
    const gameSocket = sockets.find(
      (u) =>
        new RegExp(`^wss://${GAME_SERVER}/w\\d+`).test(u) &&
        !u.includes("/lobbies"),
    );
    check(
      "multiplayer: joins a public lobby and the match starts",
      started && gameSocket !== undefined,
      {
        gameID: joined,
        gameSocket,
      },
    );
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/7-mp-in-game.png` });
  }

  check(
    "no missing build files (404)",
    notFound.length === 0,
    notFound.slice(0, 10),
  );
  const realErrors = pageErrors.filter(
    // Upstream background noise on the home page (run-openfront SKILL.md).
    (e) => !/reading 'inSpawnPhase'/.test(e),
  );
  check(
    "no uncaught page errors",
    realErrors.length === 0,
    realErrors.slice(0, 10),
  );
  exitCode = Object.values(report.checks).every((c) => c.ok) ? 0 : 1;
} catch (error) {
  check(
    "smoke flow completed",
    false,
    String(error).split("\n").slice(0, 12).join(" | "),
  );
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  report.passed = exitCode === 0;
  report.blockedExternalOrigins = Object.fromEntries(blocked);
  report.webSockets = sockets;
  report.consoleErrors = consoleErrors.slice(0, 30);
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    "\nExternal origins the build tried to reach (blocked, as on Poki):",
  );
  for (const [origin, urls] of blocked)
    console.log(`  ${origin}  e.g. ${urls[0]}`);
  if (blocked.size === 0) console.log("  none");
  console.log(
    `WebSockets opened: ${sockets.length ? sockets.join(", ") : "none"}`,
  );
  console.log(`\nReport: ${OUT}/report.json  Screenshots: ${OUT}/*.png`);
  await browser.close();
  process.exit(exitCode);
}
