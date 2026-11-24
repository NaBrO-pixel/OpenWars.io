import { Cell } from "@openfront/engine-api/game/GameTypes";
import { INFRASTRUCTURE_KINDS } from "@openfront/engine-api/game/Infrastructure";
import type { EventBus, GameEvent } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import type { TransformHandler } from "../../TransformHandler";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

/** Shows or hides the infrastructure overlay (from the Infrastructure panel). */
export class ToggleInfrastructureOverlayEvent implements GameEvent {
  constructor(public readonly visible: boolean) {}
}

const LETTER: Record<(typeof INFRASTRUCTURE_KINDS)[number], string> = {
  roads: "R",
  railways: "T",
  industry: "I",
  research: "S",
};

interface Badge {
  unitId: number;
  x: number;
  y: number;
  levels: number[];
  building: boolean;
}

/**
 * The infrastructure map overlay: a small badge over each of the player's
 * cities with its four levels. Off by default; positions follow the camera
 * every animation frame while it is on.
 */
@customElement("infrastructure-overlay")
export class InfrastructureOverlay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  @state() private visible = false;
  @state() private badges: Badge[] = [];
  private frame: number | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus?.on(ToggleInfrastructureOverlayEvent, (e) => {
      this.visible = e.visible;
      this.loop();
    });
  }

  dispose() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.visible = false;
  }

  private loop = () => {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (!this.visible) {
      this.badges = [];
      return;
    }
    this.badges = this.compute();
    this.frame = requestAnimationFrame(this.loop);
  };

  /** Badges for the player's sites, in screen coordinates. */
  compute(): Badge[] {
    const nation = this.game?.myPlayer()?.nation();
    if (!nation) return [];
    const out: Badge[] = [];
    for (const site of nation.sites) {
      const unit = this.game.unit(site.unitId);
      if (unit === undefined) continue;
      const tile = unit.tile();
      const p = this.transformHandler.worldToScreenCoordinates(
        new Cell(this.game.x(tile), this.game.y(tile)),
      );
      out.push({
        unitId: site.unitId,
        x: p.x,
        y: p.y,
        levels: INFRASTRUCTURE_KINDS.map((k) => site[k]),
        building: nation.projects.some((pr) => pr.unitId === site.unitId),
      });
    }
    return out;
  }

  render() {
    if (!this.visible) return nothing;
    return html`<div
      class="pointer-events-none fixed inset-0 z-[150]"
      aria-label=${translateText("infrastructure.overlay")}
    >
      ${this.badges.map(
        (b) =>
          html`<div
            class="absolute -translate-x-1/2 -translate-y-[160%] flex gap-1 rounded border ${
              b.building ? "border-ow-accent-2" : "border-ow-border"
            } bg-ow-panel/90 px-1 py-0.5 text-[10px] font-semibold tabular-nums text-ow-text shadow"
            style="left:${b.x}px;top:${b.y}px"
            data-infra-badge=${b.unitId}
          >
            ${INFRASTRUCTURE_KINDS.map(
              (k, i) =>
                html`<span
                  class=${b.levels[i] > 0 ? "text-ow-accent" : "text-ow-text-2"}
                  >${LETTER[k]}${b.levels[i]}</span
                >`,
            )}
          </div>`,
      )}
    </div>`;
  }
}
