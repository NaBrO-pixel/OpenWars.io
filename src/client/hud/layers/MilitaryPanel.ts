import {
  MilitaryConfig,
  MOBILISATION_LEVELS,
} from "@openfront/engine-lib/configuration/MilitaryConfig";
import {
  diplomaticPartnersNeeded,
  economicShareNeeded,
} from "@openfront/engine-lib/configuration/VictoryConfig";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";

function row(label: string, value: string, why?: string) {
  return html`<div class="py-1 border-b border-ow-border/60 last:border-0">
    <div class="flex items-baseline justify-between gap-3 text-sm">
      <span class="text-ow-text-2">${label}</span>
      <span class="tabular-nums text-ow-text">${value}</span>
    </div>
    ${why ? html`<p class="text-xs text-ow-text-2/80">${why}</p>` : nothing}
  </div>`;
}

export function renderMilitary(
  game: GameView,
  me: PlayerView,
  mobilise: (level: number) => void,
): TemplateResult {
  const n = me.nation()!;
  const name = (smallID: number) =>
    game
      .playerViews()
      .find((p) => p.smallID() === smallID)
      ?.displayName() ?? translateText("military.wilderness");
  const out = me.outgoingAttacks();
  const inc = me.incomingAttacks();
  return html`
    <h3 class="text-xs font-semibold uppercase tracking-wider text-ow-text-2">
      ${translateText("military.mobilisation")}
    </h3>
    <div
      class="mt-1 grid grid-cols-2 gap-1"
      data-mobilisation=${n.mobilisation}
    >
      ${MOBILISATION_LEVELS.map(
        (lvl, i) =>
          html`<button
            class="rounded border px-2 py-1 text-xs ${
              i === n.mobilisation
                ? "border-ow-accent bg-ow-accent/15 text-ow-accent"
                : "border-ow-border text-ow-text hover:border-ow-accent"
            }"
            @click=${() => mobilise(i)}
            data-mobilise=${i}
          >
            ${translateText(`military.level_${lvl}`)}
          </button>`,
      )}
    </div>
    <p class="mt-1 text-xs text-ow-text-2">
      ${translateText(
        `military.level_${MOBILISATION_LEVELS[n.mobilisation]}_why`,
        {
          growth: Math.round(
            MilitaryConfig.troopGrowthPermille[n.mobilisation] / 10,
          ),
        },
      )}
    </p>
    <h3
      class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
    >
      ${translateText("military.forces")}
    </h3>
    ${row(
      translateText("command_bar.population"),
      `${renderTroops(me.troops())} / ${renderTroops(game.config().maxTroops(me))}`,
    )}
    ${row(
      translateText("military.attacking"),
      renderTroops(out.reduce((s, a) => s + a.troops, 0)),
    )}
    ${row(
      translateText("military.expenditure"),
      `${renderNumber(n.expenses.military)}/s`,
      translateText("military.expenditure_why"),
    )}
    ${row(
      translateText("military.supply"),
      `${Math.round(n.supply / 10)}%`,
      translateText("military.supply_why"),
    )}
    ${row(
      translateText("military.defence"),
      `+${Math.round(n.defence / 10)}%`,
      translateText("military.defence_why"),
    )}
    <h3
      class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
    >
      ${translateText("military.fronts")}
    </h3>
    ${
      out.length + inc.length === 0
        ? html`<p class="text-sm text-ow-text-2" data-no-fronts>
            ${translateText("military.no_fronts")}
          </p>`
        : html`<ul data-fronts>
            ${out.map(
              (a) =>
                html`<li class="text-sm text-ow-text">
                  ${translateText("military.attacking_target", {
                    target: name(a.targetID),
                    troops: renderTroops(a.troops),
                  })}
                </li>`,
            )}
            ${inc.map(
              (a) =>
                html`<li class="text-sm text-ow-error">
                  ${translateText("military.attacked_by", {
                    attacker: name(a.attackerID),
                    troops: renderTroops(a.troops),
                  })}
                </li>`,
            )}
          </ul>`
    }
  `;
}

/** Progress toward each victory, for the Statistics panel. */
export function renderVictoryProgress(
  me: PlayerView,
  nations: number,
): TemplateResult {
  const v = me.nation()?.victory ?? [];
  if (v.length === 0) return html``;
  // The thresholds depend on the size of the game (VictoryConfig).
  const why: Record<string, Record<string, string | number>> = {
    economic: { share: Math.round(economicShareNeeded(nations) / 10) },
    diplomatic: {
      partners: diplomaticPartnersNeeded(Math.max(0, nations - 1)),
      others: Math.max(0, nations - 1),
    },
  };
  return html`<h3
      class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
    >
      ${translateText("victory.progress")}
    </h3>
    ${v.map((p) => {
      const pct = Math.min(100, Math.floor(p.progress / 10));
      return html`<div class="mt-1" data-victory=${p.kind}>
        <div class="flex justify-between text-sm">
          <span class="text-ow-text"
            >${translateText(`victory.${p.kind}_title`)}</span
          >
          <span class="tabular-nums text-ow-text-2"
            >${pct}%${
              p.needed > 0 && p.progress >= 1000
                ? ` · ${translateText("victory.holding", { held: p.held, needed: p.needed })}`
                : ""
            }</span
          >
        </div>
        <div class="h-1.5 rounded bg-ow-raised overflow-hidden">
          <div
            class="h-full ${pct >= 100 ? "bg-ow-success" : "bg-ow-accent"}"
            style="width:${pct}%"
          ></div>
        </div>
        <p class="text-xs text-ow-text-2/80">
          ${translateText(`victory.${p.kind}_why`, why[p.kind] ?? {})}
        </p>
      </div>`;
    })}`;
}
