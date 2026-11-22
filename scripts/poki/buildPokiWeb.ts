// Builds a self-contained browser build of the full game for uploading to
// Poki for Developers (Poki Inspector / QA): a static directory, and a zip of
// it, with index.html at the root and every asset referenced relative to that
// index.html, so it runs from whatever path Poki's build CDN serves it under.
//
//   npm run build:poki            # vite production build + package
//   npm run build:poki -- --skip-vite   # package the existing static/ build
//
// Output: build/poki-web/ and build/poki-web.zip (both gitignored).
// See docs/PokiWebBuild.md for what works where and how to configure it.
//
// It reuses the production pipeline rather than a parallel one: the same
// `vite build`, and the same index.html template rendered by the same
// renderHtmlContent the game server uses per request (RenderHtml.ts). Only
// two things differ from the server-rendered page:
//
// 1. Asset base. The server prefixes assets with CDN_BASE (an origin). A Poki
//    build lives under an unknown path, so the page is rendered with a
//    placeholder base, then (a) static <script>/<link>/<meta> references become
//    "./..." and (b) BOOTSTRAP_CONFIG.cdnBase becomes the page's own directory,
//    computed at runtime, which every runtime assetUrl() (maps, sprites,
//    sounds, workers' fetches) is built from.
// 2. Game server. A page served by a game server talks to its own origin. This
//    page is served by Poki, so a multiplayer server must be named at build
//    time (POKI_GAME_SERVER), exactly like the desktop shell's serverHost.
//    Without one, the page is single-player only: everything that needs a
//    game server fails into the client's existing "no server" paths.
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BASE_PLACEHOLDER, transformPokiIndexHtml } from "./pokiIndexHtml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const STATIC_DIR = path.join(ROOT, "static");
const OUT_DIR = path.join(ROOT, "build", "poki-web");
const ZIP_PATH = path.join(ROOT, "build", "poki-web.zip");

// Cloudflare's documented always-passes test site key. Only used if the build
// does not name a real one; a real multiplayer deployment needs its own key
// (and Poki's approval for challenges.cloudflare.com).
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

function fail(message: string): never {
  console.error(`build:poki: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
}

function gitCommit(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT });
  return result.status === 0 ? result.stdout.toString().trim() : "unknown";
}

/** Host[:port] of the multiplayer game server, validated, or undefined. */
function gameServer(): string | undefined {
  const raw = process.env.POKI_GAME_SERVER?.trim();
  if (!raw) return undefined;
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(raw)) {
    fail(
      `POKI_GAME_SERVER must be a bare host[:port] (no scheme or path), got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function dirSize(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const s = dirSize(p);
      files += s.files;
      bytes += s.bytes;
    } else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
  return { files, bytes };
}

async function main(): Promise<void> {
  const skipVite = process.argv.includes("--skip-vite");
  const server = gameServer();
  // The client compares this with the commit the game server reports and
  // treats a mismatch as an outdated page, so a multiplayer build must come
  // from the commit its server runs. POKI_GIT_COMMIT=DEV matches the local
  // dev server (`npm run dev`), which always reports DEV.
  const commit = process.env.POKI_GIT_COMMIT ?? gitCommit();

  if (!skipVite) {
    // The regular production client build (static/), assets same-origin.
    run("npx", ["vite", "build"], { ...process.env, CDN_BASE: "" });
  }
  const template = path.join(STATIC_DIR, "index.html");
  if (!fs.existsSync(template)) {
    fail("static/index.html not found: run without --skip-vite first");
  }

  // The environment renderHtmlContent reads (ServerEnv). Set before importing
  // it: ServerEnv parses GAME_ENV when the class loads.
  process.env.GAME_ENV = process.env.POKI_GAME_ENV ?? "prod";
  process.env.GIT_COMMIT = commit;
  process.env.CDN_BASE = BASE_PLACEHOLDER;
  process.env.TURNSTILE_SITE_KEY =
    process.env.POKI_TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY;
  // The audience names the accounts API the client talks to
  // (https://api.<DOMAIN>). That API is closed-source and not part of this
  // repo; see docs/PokiWebBuild.md.
  process.env.DOMAIN = process.env.POKI_DOMAIN ?? "localhost";
  // Nothing on this page may load Stripe or ship telemetry.
  delete process.env.STRIPE_PUBLISHABLE_KEY;
  delete process.env.FARO_COLLECTOR_URL;
  delete process.env.SITE_HOST;
  delete process.env.INSTANCE_ID;
  if (server !== undefined) {
    process.env.GAME_HOST = server;
    process.env.INSTANCE_LETTER = process.env.POKI_INSTANCE_LETTER ?? "a";
    process.env.NUM_WORKERS = process.env.POKI_NUM_WORKERS ?? "2";
  }
  const { renderHtmlContent } = await import("../../src/server/RenderHtml");
  const rendered = await renderHtmlContent(template, {
    // With a game server: the cluster map, letter and serverHost a
    // server-rendered page carries. Without: none, as on the static page.
    perServer: server !== undefined,
  });
  let html: string;
  try {
    html = transformPokiIndexHtml(rendered, { offline: server === undefined });
  } catch (error) {
    fail(String(error));
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.rmSync(ZIP_PATH, { force: true });
  fs.cpSync(STATIC_DIR, OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  fs.writeFileSync(
    path.join(OUT_DIR, "poki-build.json"),
    JSON.stringify(
      {
        commit,
        gameEnv: process.env.GAME_ENV,
        gameServer: server ?? null,
        accountsApi:
          process.env.DOMAIN === "localhost"
            ? null
            : `https://api.${process.env.DOMAIN}`,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  const zip = spawnSync("zip", ["-q", "-r", ZIP_PATH, "."], { cwd: OUT_DIR });
  const { files, bytes } = dirSize(OUT_DIR);
  console.log(
    `\nPoki web build: ${OUT_DIR}\n  ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB uncompressed`,
  );
  if (zip.status === 0) {
    const zipBytes = fs.statSync(ZIP_PATH).size;
    console.log(
      `  zip: ${ZIP_PATH} (${(zipBytes / 1024 / 1024).toFixed(1)} MiB)`,
    );
  } else {
    console.log(
      "  zip: not created (no `zip` command); zip the directory's contents yourself, index.html at the root",
    );
  }
  console.log(
    server === undefined
      ? "  multiplayer: OFF (no POKI_GAME_SERVER) — single-player only"
      : `  multiplayer: wss://${server} (instance ${process.env.INSTANCE_LETTER}, ${process.env.NUM_WORKERS} workers)`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
