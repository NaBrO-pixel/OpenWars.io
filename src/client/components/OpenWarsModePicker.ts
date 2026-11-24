import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../Utils";

export type OpenWarsMode = "openwars" | "coldwar" | "sandbox";
export const VICTORY_OPTIONS = [
  "territorial",
  "economic",
  "diplomatic",
  "technological",
] as const;
export type VictoryOption = (typeof VICTORY_OPTIONS)[number];

/** The match settings this picker controls (GameConfig fields). */
export interface OpenWarsModeSettings {
  ruleset: OpenWarsMode;
  eventFrequencyPermille?: number;
  victoryConditions?: VictoryOption[];
}

const FREQUENCIES = [0, 500, 1000, 2000] as const;

/** The GameConfig fields for a mode: Sandbox's own settings only in Sandbox. */
export function modeConfig(
  mode: OpenWarsMode,
  frequency: number,
  victories: readonly VictoryOption[],
): OpenWarsModeSettings {
  // Every mode states its settings in full, so switching mode in a hosted
  // lobby (partial patches) never leaves another mode's settings behind.
  if (mode !== "sandbox") {
    return {
      ruleset: mode,
      eventFrequencyPermille: 1000,
      victoryConditions: VICTORY_OPTIONS.filter(
        (v) => !(mode === "coldwar" && v === "territorial"),
      ),
    };
  }
  return {
    ruleset: mode,
    eventFrequencyPermille: frequency,
    victoryConditions: [...victories],
  };
}

/**
 * OpenWars mode selection for the solo and host-lobby setup (milestone 7):
 * World Conquest, Cold War or Sandbox, and Sandbox's own settings. Emits
 * "mode-change" with OpenWarsModeSettings.
 */
@customElement("openwars-mode-picker")
export class OpenWarsModePicker extends LitElement {
  @property({ type: String }) mode: OpenWarsMode = "openwars";
  @property({ type: Number }) frequency = 1000;
  @property({ type: Array }) victories: VictoryOption[] = [...VICTORY_OPTIONS];

  createRenderRoot() {
    return this;
  }

  private emit() {
    this.dispatchEvent(
      new CustomEvent<OpenWarsModeSettings>("mode-change", {
        detail: modeConfig(this.mode, this.frequency, this.victories),
        bubbles: true,
        composed: true,
      }),
    );
  }

  private setMode(mode: OpenWarsMode) {
    this.mode = mode;
    this.emit();
  }

  private toggleVictory(v: VictoryOption) {
    const on = this.victories.includes(v);
    // At least one way to win must stay.
    if (on && this.victories.length === 1) return;
    this.victories = on
      ? this.victories.filter((x) => x !== v)
      : [...this.victories, v];
    this.emit();
  }

  render() {
    const card = (m: OpenWarsMode) =>
      html`<button
        class="flex-1 rounded border p-3 text-left transition-colors ${
          this.mode === m
            ? "border-ow-accent bg-ow-accent/15"
            : "border-ow-border bg-ow-bg-2/60 hover:border-ow-accent"
        }"
        @click=${() => this.setMode(m)}
        aria-pressed=${this.mode === m}
        data-mode=${m}
      >
        <div class="text-sm font-semibold text-ow-text">
          ${translateText(`game_modes.${m}`)}
        </div>
        <div class="text-xs text-ow-text-2">
          ${translateText(`game_modes.${m}_desc`)}
        </div>
      </button>`;
    return html`<section
      class="mb-6"
      aria-label=${translateText("game_modes.title")}
    >
      <h2
        class="mb-2 text-sm font-semibold uppercase tracking-wider text-ow-text-2"
      >
        ${translateText("game_modes.title")}
      </h2>
      <div class="flex flex-col gap-2 sm:flex-row">
        ${card("openwars")} ${card("coldwar")} ${card("sandbox")}
      </div>
      ${
        this.mode !== "sandbox"
          ? nothing
          : html`<div class="mt-3 grid gap-3 sm:grid-cols-2" data-sandbox>
              <div>
                <div class="mb-1 text-xs text-ow-text-2">
                  ${translateText("game_modes.event_frequency")}
                </div>
                <div class="flex flex-wrap gap-1">
                  ${FREQUENCIES.map(
                    (f) =>
                      html`<button
                        class="rounded border px-2 py-1 text-xs ${
                          this.frequency === f
                            ? "border-ow-accent text-ow-accent"
                            : "border-ow-border text-ow-text"
                        }"
                        @click=${() => {
                          this.frequency = f;
                          this.emit();
                        }}
                        data-frequency=${f}
                      >
                        ${translateText(`game_modes.frequency_${f}`)}
                      </button>`,
                  )}
                </div>
              </div>
              <div>
                <div class="mb-1 text-xs text-ow-text-2">
                  ${translateText("game_modes.victories")}
                </div>
                <div class="flex flex-wrap gap-1">
                  ${VICTORY_OPTIONS.map(
                    (v) =>
                      html`<button
                        class="rounded border px-2 py-1 text-xs ${
                          this.victories.includes(v)
                            ? "border-ow-accent text-ow-accent"
                            : "border-ow-border text-ow-text-2"
                        }"
                        aria-pressed=${this.victories.includes(v)}
                        @click=${() => this.toggleVictory(v)}
                        data-victory-option=${v}
                      >
                        ${translateText(`victory.${v}_title`)}
                      </button>`,
                  )}
                </div>
              </div>
              <p class="text-xs text-ow-text-2 sm:col-span-2">
                ${translateText("game_modes.sandbox_more")}
              </p>
            </div>`
      }
    </section>`;
  }
}
