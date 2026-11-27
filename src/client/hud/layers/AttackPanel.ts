import {
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView, PlayerView } from "../../view";

/** The forces an Attack order moves, and the AA guns it re-prioritises. */
const FORCES: ReadonlyArray<readonly [UnitType, string]> = [
  [UnitType.Tank, "unit_type.tank"],
  [UnitType.Bomber, "unit_type.bomber"],
  [UnitType.Fighter, "unit_type.fighter"],
  [UnitType.AttackHelicopter, "unit_type.attack_helicopter"],
  [UnitType.AAGun, "unit_type.aa_gun"],
];

/**
 * Why `me` can't send its forces at `other`, or null if it can. Mirrors the
 * engine's checks (FocusForcesExecution): allies, pacts and ceasefires, Cold
 * War between nations, and an enemy with no structures to aim at.
 */
export function attackBlocker(
  game: GameView,
  me: PlayerView,
  other: PlayerView,
): string | null {
  if (me.isFriendly(other)) return "attack.blocked_friendly";
  const agreements = me.nation()?.diplomacy.agreements ?? [];
  if (
    agreements.some(
      (a) =>
        a.other === other.id() && (a.kind === "nap" || a.kind === "ceasefire"),
    )
  ) {
    return "attack.blocked_pact";
  }
  if (game.config().isColdWar()) return "attack.blocked_cold_war";
  if (other.units(...Structures.types).length === 0) {
    return "attack.blocked_no_structures";
  }
  return null;
}

/**
 * The Attack panel: send every tank and combat aircraft at an enemy's
 * structures and have the air defences engage it first, or recall them.
 */
export function renderAttack(
  game: GameView,
  me: PlayerView,
  focus: (target: string | null) => void,
): TemplateResult {
  const counts = FORCES.map(
    ([type, key]) => [key, me.units(type).length] as const,
  );
  const mobile = counts
    .filter(([key]) => key !== "unit_type.aa_gun")
    .reduce((n, [, c]) => n + c, 0);
  const current = me.nation()?.focus ?? null;
  const focused =
    current === null
      ? undefined
      : game.playerViews().find((p) => p.id() === current);
  const enemies = game
    .playerViews()
    .filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot)
    .sort((a, b) => {
      const n = me.nation()?.neighbours ?? [];
      return (
        Number(n.includes(b.id())) - Number(n.includes(a.id())) ||
        b.numTilesOwned() - a.numTilesOwned()
      );
    });
  return html`
    <p class="text-sm text-ow-text-2">${translateText("attack.intro")}</p>
    <div class="mt-2 grid grid-cols-5 gap-1 text-center" data-attack-forces>
      ${counts.map(
        ([key, n]) =>
          html`<div class="rounded border border-ow-border bg-ow-bg-2/60 p-1">
            <div class="ow-readout text-base text-ow-text">${n}</div>
            <div class="text-[10px] leading-tight text-ow-text-2">
              ${translateText(key)}
            </div>
          </div>`,
      )}
    </div>
    <div
      class="mt-2 flex items-center justify-between gap-2 rounded border border-ow-border bg-ow-bg-2/60 p-2"
    >
      <span class="text-sm text-ow-text" data-attack-focus=${current ?? ""}>
        ${
          focused === undefined
            ? translateText("attack.no_focus")
            : translateText("attack.focused_on", {
                name: focused.displayName(),
              })
        }
      </span>
      <button
        class="shrink-0 rounded border border-ow-border px-2 py-1 text-xs text-ow-text hover:border-ow-accent disabled:opacity-40"
        ?disabled=${mobile === 0 && current === null}
        @click=${() => focus(null)}
        data-attack-recall
      >
        ${translateText("attack.recall")}
      </button>
    </div>
    ${
      mobile === 0
        ? html`<p class="mt-2 text-xs text-ow-warning">
            ${translateText("attack.no_forces")}
          </p>`
        : nothing
    }
    <ul class="mt-2" data-attack-enemies>
      ${enemies.slice(0, 20).map((p) => {
        const blocker = attackBlocker(game, me, p);
        const structures = p.units(...Structures.types).length;
        return html`<li
          class="flex items-center justify-between gap-2 border-b border-ow-border/50 py-1.5 last:border-0"
          data-attack-enemy=${p.id()}
        >
          <div class="min-w-0">
            <div class="truncate text-sm text-ow-text">${p.displayName()}</div>
            <div class="text-[11px] text-ow-text-2">
              ${
                blocker === null
                  ? translateText("attack.structures", { count: structures })
                  : translateText(blocker)
              }
            </div>
          </div>
          <button
            class="shrink-0 rounded border px-2 py-1 text-xs ${
              current === p.id()
                ? "border-ow-accent bg-ow-accent/15 text-ow-accent"
                : "border-ow-border text-ow-text hover:border-ow-accent"
            } disabled:opacity-40 disabled:hover:border-ow-border"
            ?disabled=${blocker !== null || mobile === 0}
            @click=${() => focus(p.id())}
            data-attack-target=${p.id()}
          >
            ${translateText("attack.send")}
          </button>
        </li>`;
      })}
    </ul>
  `;
}
