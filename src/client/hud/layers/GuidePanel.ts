import { html, type TemplateResult } from "lit";
import { translateText } from "../../Utils";

/** The topics of the OpenWars guide, in reading order (spec §19). */
export const GUIDE_TOPICS = [
  "map",
  "territory",
  "resources",
  "development",
  "research",
  "diplomacy",
  "victory",
] as const;

/** localStorage key: the guide has been shown once (opened automatically). */
export const GUIDE_SEEN_KEY = "openwars.guideSeen";

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Whether the guide may open itself now: not in the onboarding tutorial game
 * (it has its own guide), and only once the step-by-step tutorial panel has
 * been finished or dismissed, so the two never overlap.
 */
export function guideMayAutoOpen(
  tutorialGame: boolean,
  tutorialDismissed: boolean,
): boolean {
  return !tutorialGame && tutorialDismissed && !guideSeen();
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
  } catch {
    // Private mode: the guide may open again next game; harmless.
  }
}

export function renderGuide(): TemplateResult {
  return html`
    <p class="text-sm text-ow-text-2">${translateText("guide.intro")}</p>
    <ol class="mt-2 space-y-2">
      ${GUIDE_TOPICS.map(
        (t, i) =>
          html`<li
            class="rounded border border-ow-border bg-ow-bg-2/60 p-2"
            data-guide=${t}
          >
            <div class="text-sm font-semibold text-ow-text">
              ${i + 1}. ${translateText(`guide.${t}_title`)}
            </div>
            <p class="text-xs text-ow-text-2">${translateText(`guide.${t}`)}</p>
          </li>`,
      )}
    </ol>
  `;
}
