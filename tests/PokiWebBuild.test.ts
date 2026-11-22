// @vitest-environment jsdom
import ejs from "ejs";
import fs from "fs";
import path from "path";
import vm from "vm";
import { buildAssetUrl } from "../packages/shared/src/AssetPaths";
import { rewriteAssetsForCdn } from "../packages/shared/src/AssetUrls";
import {
  BASE_PLACEHOLDER,
  transformPokiIndexHtml,
} from "../scripts/poki/pokiIndexHtml";

// The real index.html template, rendered the way RenderHtml.ts renders it,
// with CDN_BASE set to the placeholder as scripts/poki/buildPokiWeb.ts does.
// Vite's emitted /assets/ bundle reference is simulated by appending one and
// passing it through the same rewriteAssetsForCdn the build plugin runs.
function renderTemplate(): string {
  const template = rewriteAssetsForCdn(
    fs
      .readFileSync(path.join(__dirname, "../index.html"), "utf8")
      .replace(
        '<script type="module" src="/src/client/Main.ts"></script>',
        '<script type="module" crossorigin src="/assets/index-abc123.js"></script>',
      ),
  );
  const manifest = {
    "manifest.json": "/_assets/manifest.111.json",
    "images/Favicon.svg": "/_assets/images/Favicon.222.svg",
    "icons/OpenWarsIcon512_maskable.png": "/_assets/icons/icon512.333.png",
    "images/KeyArt.jpg": "/_assets/images/KeyArt.444.jpg",
    "images/background.webp": "/_assets/images/background.555.webp",
    "images/OpenWars.png": "/_assets/images/OpenFront.666.png",
    "images/OW.png": "/_assets/images/OF.777.png",
  };
  const asset = (p: string) => buildAssetUrl(p, manifest, BASE_PLACEHOLDER);
  return ejs.render(template, {
    gitCommit: JSON.stringify("c0ffee"),
    assetManifest: JSON.stringify(manifest),
    cdnBase: JSON.stringify(BASE_PLACEHOLDER),
    cdnBaseRaw: BASE_PLACEHOLDER,
    gameEnv: JSON.stringify("prod"),
    turnstileSiteKey: JSON.stringify("1x00000000000000000000AA"),
    jwtAudience: JSON.stringify("localhost"),
    manifestHref: asset("manifest.json"),
    faviconHref: asset("images/Favicon.svg"),
    appleTouchIconHref: asset("icons/OpenWarsIcon512_maskable.png"),
    gameplayScreenshotUrl: asset("images/KeyArt.jpg"),
    backgroundImageUrl: asset("images/background.webp"),
    desktopLogoImageUrl: asset("images/OpenWars.png"),
    mobileLogoImageUrl: asset("images/OW.png"),
  });
}

/** Runs the page's inline BOOTSTRAP_CONFIG script as if loaded from `url`. */
function bootstrapAt(html: string, url: string): Record<string, unknown> {
  const script = html.match(
    /<script>\s*(window\.BOOTSTRAP_CONFIG = \{[\s\S]*?\};)/,
  );
  if (script === null) throw new Error("no BOOTSTRAP_CONFIG script");
  const win: { BOOTSTRAP_CONFIG?: Record<string, unknown> } = {};
  vm.runInNewContext(script[1], {
    window: win,
    document: { baseURI: url },
    URL,
  });
  return win.BOOTSTRAP_CONFIG!;
}

describe("Poki web build index.html", () => {
  const rendered = renderTemplate();

  test("assets resolve against the directory the page is served from", () => {
    const html = transformPokiIndexHtml(rendered, { offline: false });

    expect(html).not.toContain(BASE_PLACEHOLDER);
    expect(html).toContain('src="./assets/index-abc123.js"');
    expect(html).toContain('href="./_assets/images/Favicon.222.svg"');
    const config = bootstrapAt(
      html,
      "https://abc.poki-gdn.com/3f9c2b1e-version/index.html?site_id=1",
    );
    expect(config.cdnBase).toBe("https://abc.poki-gdn.com/3f9c2b1e-version");
    expect(config.offline).toBeUndefined();
  });

  test("a build without a game server is offline and drops Turnstile", () => {
    const online = transformPokiIndexHtml(rendered, { offline: false });
    const offline = transformPokiIndexHtml(rendered, { offline: true });

    expect(online).toContain("challenges.cloudflare.com/turnstile");
    expect(offline).not.toContain("challenges.cloudflare.com");
    expect(bootstrapAt(offline, "https://x.poki-gdn.com/v/").offline).toBe(
      true,
    );
  });

  test("refuses a page that still points at the site root", () => {
    const broken = rendered.replace(
      `src="${BASE_PLACEHOLDER}/assets/index-abc123.js"`,
      'src="/assets/index-abc123.js"',
    );
    expect(() => transformPokiIndexHtml(broken, { offline: false })).toThrow(
      /root-relative/,
    );
  });

  test("refuses a page rendered without the placeholder base", () => {
    expect(() =>
      transformPokiIndexHtml(rendered.split(BASE_PLACEHOLDER).join(""), {
        offline: false,
      }),
    ).toThrow(/cdnBase/);
  });
});
