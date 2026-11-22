// The changes the Poki web build makes to the server-rendered index.html
// (scripts/poki/buildPokiWeb.ts). Pure, so tests/PokiWebBuild.test.ts can pin
// them.

/** Unique token the page is rendered with in place of CDN_BASE. */
export const BASE_PLACEHOLDER = "__POKI_BUILD_BASE__";

const TURNSTILE_SCRIPT =
  /\s*<!-- Cloudflare Turnstile -->\s*<script\s+src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js"[^>]*>\s*<\/script>/;

export interface PokiIndexOptions {
  /** No game server: a single-player build (ClientEnv.offline). */
  offline: boolean;
}

/**
 * Makes a page rendered with CDN_BASE = BASE_PLACEHOLDER run from any path:
 *  - BOOTSTRAP_CONFIG.cdnBase becomes the page's own directory, computed at
 *    runtime, which every runtime assetUrl() is built from;
 *  - every other occurrence (src/href attributes, inline url() values)
 *    becomes "." — relative to index.html;
 *  - offline: marks the page offline and drops Cloudflare Turnstile, which
 *    only multiplayer joins use, so the build makes one fewer external
 *    request.
 * Throws when the page does not have the expected shape or still references
 * the site root, which on Poki is Poki's own origin, not this build.
 */
export function transformPokiIndexHtml(
  html: string,
  { offline }: PokiIndexOptions,
): string {
  const bootstrapLine = `cdnBase: ${JSON.stringify(BASE_PLACEHOLDER)},`;
  if (!html.includes(bootstrapLine)) {
    throw new Error("index.html has no cdnBase line to rewrite");
  }
  html = html.replace(
    bootstrapLine,
    'cdnBase: new URL(".", document.baseURI).href.replace(/\\/$/, ""),' +
      (offline ? "\n        offline: true," : ""),
  );
  html = html.split(BASE_PLACEHOLDER).join(".");
  if (offline) {
    if (!TURNSTILE_SCRIPT.test(html)) {
      throw new Error("index.html has no Turnstile script tag to drop");
    }
    html = html.replace(TURNSTILE_SCRIPT, "");
  }
  const rootRefs = html.match(/(?:src|href)=["']\/(?:_?assets)\/[^"']*/g);
  if (rootRefs !== null) {
    throw new Error(
      `root-relative asset references remain: ${rootRefs.join(", ")}`,
    );
  }
  return html;
}
