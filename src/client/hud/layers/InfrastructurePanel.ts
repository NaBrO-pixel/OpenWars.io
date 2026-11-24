import type { NationView } from "@openfront/engine-api/game/GameUpdates";
import {
  INFRASTRUCTURE_KINDS,
  type InfrastructureKind,
  type InfrastructureSiteView,
} from "@openfront/engine-api/game/Infrastructure";
import { EconomyConfig } from "@openfront/engine-lib/configuration/EconomyConfig";
import {
  projectCost,
  startRefusal,
} from "@openfront/engine-lib/configuration/InfrastructureRules";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";

const MAX = EconomyConfig.infrastructure.maxLevel;

export interface InfrastructureActions {
  start: (unitId: number, kind: InfrastructureKind) => void;
  cancel: (unitId: number, kind: InfrastructureKind) => void;
  locate: (unitId: number) => void;
  toggleOverlay: () => void;
  overlayOn: boolean;
  /** Infinite gold: projects cost no money. */
  freeMoney: boolean;
}

function pips(level: number): TemplateResult {
  return html`<span class="inline-flex gap-0.5" aria-label=${`${level}/${MAX}`}>
    ${Array.from(
      { length: MAX },
      (_, i) =>
        html`<span
          class="h-2 w-2 rounded-full ${i < level ? "bg-ow-accent" : "bg-ow-raised"}"
        ></span>`,
    )}
  </span>`;
}

function track(
  site: InfrastructureSiteView,
  kind: InfrastructureKind,
  nation: NationView,
  money: bigint,
  actions: InfrastructureActions,
): TemplateResult {
  const level = site[kind];
  const project = nation.projects.find(
    (p) => p.unitId === site.unitId && p.kind === kind,
  );
  const next = level + 1;
  let control: TemplateResult;
  if (project !== undefined) {
    const pct = Math.floor((project.done / project.total) * 100);
    control = html`<div class="flex items-center gap-2 min-w-0" data-project>
      <div class="h-1.5 w-20 rounded bg-ow-raised overflow-hidden">
        <div class="h-full bg-ow-accent-2" style="width:${pct}%"></div>
      </div>
      <span class="text-xs tabular-nums text-ow-text-2"
        >${project.total - project.done}s</span
      >
      <button
        class="text-xs text-ow-error hover:underline"
        @click=${() => actions.cancel(site.unitId, kind)}
        data-cancel=${kind}
      >
        ${translateText("infrastructure.cancel")}
      </button>
    </div>`;
  } else if (level >= MAX) {
    control = html`<span class="text-xs text-ow-success"
      >${translateText("infrastructure.max")}</span
    >`;
  } else {
    const cost = projectCost(kind, next);
    const refusal = startRefusal({
      unitId: site.unitId,
      kind,
      levels: site,
      projects: nation.projects,
      money,
      industry: nation.industry,
      freeMoney: actions.freeMoney,
    });
    control = html`<button
      class="rounded border px-2 py-0.5 text-xs ${
        refusal === null
          ? "border-ow-accent text-ow-accent hover:bg-ow-accent/15"
          : "border-ow-border text-ow-text-2 cursor-not-allowed"
      }"
      ?disabled=${refusal !== null}
      title=${refusal === null ? "" : translateText(`infrastructure.refusal_${refusal}`)}
      @click=${() => actions.start(site.unitId, kind)}
      data-start=${kind}
    >
      ${translateText("infrastructure.build_level", { level: next })} ·
      ${renderNumber(cost.money)} · ${cost.industry}
      ${translateText("infrastructure.industry_short")} · ${cost.steps}s
    </button>`;
  }
  return html`<div class="py-1.5 border-b border-ow-border/50 last:border-0">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm text-ow-text"
        >${translateText(`infrastructure.${kind}`)}</span
      >
      ${pips(level)}
    </div>
    <p class="text-xs text-ow-text-2/80">
      ${translateText(`infrastructure.${kind}_effect`)}
    </p>
    <div class="mt-1 flex justify-end">${control}</div>
  </div>`;
}

export function renderInfrastructure(
  nation: NationView,
  money: bigint,
  actions: InfrastructureActions,
): TemplateResult {
  return html`
    <p class="text-sm text-ow-text-2">
      ${translateText("infrastructure.intro")}
    </p>
    <div class="mt-2 flex items-center justify-between text-sm">
      <span class="text-ow-text-2"
        >${translateText("infrastructure.projects", {
          n: nation.projects.length,
          max: EconomyConfig.infrastructure.maxProjects,
        })}</span
      >
      <button
        class="text-ow-accent hover:underline"
        @click=${actions.toggleOverlay}
        aria-pressed=${actions.overlayOn}
        data-overlay-toggle
      >
        ${translateText(
          actions.overlayOn
            ? "infrastructure.hide_overlay"
            : "infrastructure.show_overlay",
        )}
      </button>
    </div>
    ${
      nation.sites.length === 0
        ? html`<p class="mt-3 text-sm text-ow-text-2" data-no-sites>
            ${translateText("infrastructure.no_sites")}
          </p>`
        : nation.sites.map(
            (site, i) =>
              html`<section
                class="mt-3 rounded border border-ow-border bg-ow-bg-2/60 p-2"
                data-site=${site.unitId}
              >
                <header class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-ow-text">
                    ${translateText("infrastructure.site", { n: i + 1 })}
                  </h3>
                  <button
                    class="text-xs text-ow-accent hover:underline"
                    @click=${() => actions.locate(site.unitId)}
                  >
                    ${translateText("infrastructure.locate")}
                  </button>
                </header>
                ${INFRASTRUCTURE_KINDS.map((k) =>
                  track(site, k, nation, money, actions),
                )}
              </section>`,
          )
    }
    ${nothing}
  `;
}
