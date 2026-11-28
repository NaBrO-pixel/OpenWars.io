import type { NationView } from "@openfront/engine-api/game/GameUpdates";
import {
  researchRefusal,
  TECH_BRANCHES,
  type TechDefinition,
  type TechEffects,
  TECHS,
} from "@openfront/engine-lib/configuration/TechConfig";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, type TemplateResult } from "lit";
import { translateText } from "../../Utils";

export interface ResearchActions {
  start: (id: string) => void;
  cancel: (id: string) => void;
  freeMoney: boolean;
}

type TechState = "completed" | "researching" | "available" | "locked";

const EFFECT_KEYS: Record<keyof TechEffects, string> = {
  industryPermille: "research.effect_industry",
  researchPermille: "research.effect_research",
  industryMoneyPermille: "research.effect_industry_money",
  taxPermille: "research.effect_tax",
  upkeepCutPermille: "research.effect_upkeep",
  infrastructureIndustryCutPermille: "research.effect_infrastructure_cost",
  extraProjects: "research.effect_projects",
  researchCentrePermille: "research.effect_research_centres",
  stabilityTarget: "research.effect_stability",
  growthPenaltyCutPermille: "research.effect_growth_penalty",
  deficitPenaltyCutPermille: "research.effect_deficit_penalty",
  intelLevels: "research.effect_intel",
  tankDamagePermille: "research.effect_tank_damage",
  tankArmourPermille: "research.effect_tank_armour",
  aaExtraVolley: "research.effect_aa_volley",
  bombExtraLevels: "research.effect_bomb_levels",
  militaryUpkeepCutPermille: "research.effect_military_upkeep",
  mobilisationUnrestCutPermille: "research.effect_mobilisation_unrest",
};

/** The effect lines of a technology, e.g. "+15% industry output". */
export function effectLines(effects: TechEffects): string[] {
  return (Object.entries(effects) as [keyof TechEffects, number][]).map(
    ([k, v]) =>
      translateText(EFFECT_KEYS[k], {
        value:
          k === "extraProjects" ||
          k === "intelLevels" ||
          k === "aaExtraVolley" ||
          k === "bombExtraLevels"
            ? v
            : Math.round(v / 10),
      }),
  );
}

function stateOf(t: TechDefinition, nation: NationView): TechState {
  if (nation.techs.includes(t.id)) return "completed";
  if (nation.researching?.id === t.id) return "researching";
  if (t.requires.every((r) => nation.techs.includes(r))) return "available";
  return "locked";
}

const STATE_STYLE: Record<TechState, string> = {
  completed: "border-ow-success/60 bg-ow-success/10",
  researching: "border-ow-accent bg-ow-accent/10",
  available: "border-ow-border bg-ow-bg-2/60",
  locked: "border-ow-border/50 bg-ow-bg-2/30 opacity-60",
};

function card(
  t: TechDefinition,
  nation: NationView,
  money: bigint,
  actions: ResearchActions,
): TemplateResult {
  const state = stateOf(t, nation);
  const refusal = researchRefusal({
    id: t.id,
    completed: new Set(nation.techs),
    active: nation.researching?.id ?? null,
    research: nation.research,
    money,
    freeMoney: actions.freeMoney,
  });
  let control: TemplateResult = html``;
  if (state === "researching") {
    const r = nation.researching!;
    const pct = Math.floor((r.done / r.total) * 100);
    control = html`<div class="mt-1 flex items-center gap-2">
      <div class="h-1.5 flex-1 rounded bg-ow-raised overflow-hidden">
        <div class="h-full bg-ow-accent" style="width:${pct}%"></div>
      </div>
      <span class="text-xs tabular-nums text-ow-text-2"
        >${r.total - r.done}s</span
      >
      <button
        class="text-xs text-ow-error hover:underline"
        @click=${() => actions.cancel(t.id)}
        data-research-cancel=${t.id}
      >
        ${translateText("research.cancel")}
      </button>
    </div>`;
  } else if (state === "available") {
    control = html`<button
      class="mt-1 w-full rounded border px-2 py-0.5 text-xs ${
        refusal === null
          ? "border-ow-accent text-ow-accent hover:bg-ow-accent/15"
          : "border-ow-border text-ow-text-2 cursor-not-allowed"
      }"
      ?disabled=${refusal !== null}
      title=${refusal === null ? "" : translateText(`research.refusal_${refusal}`)}
      @click=${() => actions.start(t.id)}
      data-research-start=${t.id}
    >
      ${translateText("research.start")} · ${t.research}
      ${translateText("research.points_short")} · ${renderNumber(t.money)} ·
      ${t.steps}s
    </button>`;
  }
  return html`<div
    class="mt-2 rounded border p-2 ${STATE_STYLE[state]}"
    data-tech=${t.id}
    data-tech-state=${state}
  >
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-sm font-semibold text-ow-text"
        >${translateText(`tech.${t.id}.name`)}</span
      >
      <span class="text-[11px] uppercase tracking-wide text-ow-text-2"
        >${translateText(`research.state_${state}`)}</span
      >
    </div>
    <p class="text-xs text-ow-text-2">${translateText(`tech.${t.id}.desc`)}</p>
    <ul class="mt-1 text-xs text-ow-success">
      ${effectLines(t.effects).map((l) => html`<li>${l}</li>`)}
    </ul>
    ${
      state === "locked"
        ? html`<p class="mt-1 text-xs text-ow-text-2">
            ${translateText("research.requires", {
              tech: t.requires
                .map((r) => translateText(`tech.${r}.name`))
                .join(", "),
            })}
          </p>`
        : control
    }
  </div>`;
}

export function renderResearch(
  nation: NationView,
  money: bigint,
  actions: ResearchActions,
): TemplateResult {
  return html`
    <p class="text-sm text-ow-text-2">${translateText("research.intro")}</p>
    <p class="mt-1 text-sm text-ow-text">
      ${translateText("research.points", {
        points: renderNumber(nation.research),
        rate: nation.researchRate,
      })}
    </p>
    ${TECH_BRANCHES.map(
      (branch) =>
        html`<section class="mt-3" data-branch=${branch}>
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-ow-text-2"
          >
            ${translateText(`research.branch_${branch}`)}
          </h3>
          ${TECHS.filter((t) => t.branch === branch).map((t) =>
            card(t, nation, money, actions),
          )}
        </section>`,
    )}
  `;
}
