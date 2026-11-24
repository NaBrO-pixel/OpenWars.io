import type { AgreementView } from "@openfront/engine-api/game/Diplomacy";
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { AgreementKind } from "@openfront/engine-lib/configuration/DiplomacyConfig";
import { renderNumber } from "@openfront/engine-lib/Format";
import { html, nothing, type TemplateResult } from "lit";
import { translateText } from "../../Utils";
import type { GameView } from "../../view";
import type { PlayerView } from "../../view/PlayerView";
import { formatStability } from "../NationalSummary";

export type Relationship = "allied" | "friendly" | "neutral" | "hostile";

export interface DiplomacyActions {
  act: (
    action: "propose" | "accept" | "reject" | "break",
    kind: AgreementKind,
    target: PlayerView,
  ) => void;
  requestAlliance: (target: PlayerView) => void;
  leaveAlliance: (target: PlayerView) => void;
}

/** Fighting: one side is attacking the other right now. */
export function atWar(me: PlayerView, other: PlayerView): boolean {
  return (
    me.outgoingAttacks().some((a) => a.targetID === other.smallID()) ||
    me.incomingAttacks().some((a) => a.attackerID === other.smallID())
  );
}

export function relationship(me: PlayerView, other: PlayerView): Relationship {
  if (me.isAlliedWith(other)) return "allied";
  if (atWar(me, other) || me.hasEmbargoAgainst(other)) return "hostile";
  const agreements = me.nation()?.diplomacy.agreements ?? [];
  if (agreements.some((a) => a.other === other.id())) return "friendly";
  return "neutral";
}

const RELATION_STYLE: Record<Relationship, string> = {
  allied: "text-ow-success border-ow-success/50",
  friendly: "text-ow-accent border-ow-accent/50",
  neutral: "text-ow-text-2 border-ow-border",
  hostile: "text-ow-error border-ow-error/50",
};

function secondsLeft(game: GameView, expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - game.ticks()) / 10));
}

function chip(game: GameView, a: AgreementView, onBreak: () => void) {
  return html`<span
    class="inline-flex items-center gap-1 rounded border border-ow-accent/50 px-1.5 py-0.5 text-[11px] text-ow-accent"
    data-agreement=${a.kind}
  >
    ${translateText(`diplomacy.kind_${a.kind}`)} ·
    ${secondsLeft(game, a.expiresAt)}s
    <button
      class="text-ow-error hover:underline"
      title=${translateText("diplomacy.break_warning")}
      @click=${onBreak}
      data-break=${a.kind}
    >
      ✕
    </button>
  </span>`;
}

function button(label: string, onClick: () => void, attr: string) {
  return html`<button
    class="rounded border border-ow-border px-1.5 py-0.5 text-[11px] text-ow-text hover:border-ow-accent hover:text-ow-accent"
    @click=${onClick}
    data-action=${attr}
  >
    ${label}
  </button>`;
}

function countryRow(
  game: GameView,
  me: PlayerView,
  other: PlayerView,
  actions: DiplomacyActions,
): TemplateResult {
  const mine = me.nation()!.diplomacy;
  const rel = relationship(me, other);
  const agreements = mine.agreements.filter((a) => a.other === other.id());
  const has = (k: AgreementKind) => agreements.some((a) => a.kind === k);
  const pending = (k: AgreementKind) =>
    mine.outgoing.some((p) => p.other === other.id() && p.kind === k);
  const allied = me.isAlliedWith(other);
  const war = atWar(me, other);
  const theirs = other.nation();
  const shared = has("intel");
  const offers: TemplateResult[] = [];
  const offer = (k: AgreementKind) => {
    if (has(k)) return;
    offers.push(
      pending(k)
        ? html`<span class="text-[11px] text-ow-text-2"
            >${translateText("diplomacy.pending", {
              kind: translateText(`diplomacy.kind_${k}`),
            })}</span
          >`
        : button(
            translateText(`diplomacy.propose_${k}`),
            () => actions.act("propose", k, other),
            `propose-${k}`,
          ),
    );
  };
  if (war) offer("ceasefire");
  if (!allied && !war) offer("nap");
  if (!war) offer("trade");
  if (allied) offer("intel");
  return html`<li
    class="py-2 border-b border-ow-border/50 last:border-0"
    data-country=${other.id()}
  >
    <div class="flex items-center justify-between gap-2">
      <span class="truncate text-sm text-ow-text">${other.displayName()}</span>
      <span
        class="shrink-0 rounded border px-1.5 text-[11px] uppercase ${RELATION_STYLE[rel]}"
        data-relationship=${rel}
        >${translateText(`diplomacy.rel_${rel}`)}</span
      >
    </div>
    <div class="text-xs text-ow-text-2">
      ${translateText("diplomacy.reputation_of", {
        value: theirs?.diplomacy.reputation ?? 100,
      })}
      ${
        shared && theirs
          ? html`·
            ${translateText("diplomacy.shared_intel", {
              money: renderNumber(other.gold()),
              stability: formatStability(theirs.stability),
            })}`
          : nothing
      }
    </div>
    <div class="mt-1 flex flex-wrap gap-1">
      ${agreements.map((a) =>
        chip(game, a, () => actions.act("break", a.kind, other)),
      )}
      ${offers}
      ${
        other.type() === PlayerType.Bot
          ? nothing
          : allied
            ? button(
                translateText("diplomacy.leave_alliance"),
                () => actions.leaveAlliance(other),
                "leave-alliance",
              )
            : war
              ? nothing
              : button(
                  translateText("diplomacy.propose_alliance"),
                  () => actions.requestAlliance(other),
                  "propose-alliance",
                )
      }
    </div>
  </li>`;
}

export function renderDiplomacy(
  game: GameView,
  me: PlayerView,
  actions: DiplomacyActions,
): TemplateResult {
  const mine = me.nation()!.diplomacy;
  const others = game
    .playerViews()
    .filter((p) => p !== me && p.isAlive() && p.type() !== PlayerType.Bot)
    .sort((a, b) => {
      // Countries with agreements or proposals first, then the largest.
      const weight = (p: PlayerView) =>
        mine.agreements.some((x) => x.other === p.id()) ||
        mine.incoming.some((x) => x.other === p.id()) ||
        me.isAlliedWith(p)
          ? 1
          : 0;
      return weight(b) - weight(a) || b.numTilesOwned() - a.numTilesOwned();
    });
  const byId = (id: string) => game.playerViews().find((p) => p.id() === id);
  return html`
    <div class="text-sm text-ow-text" data-reputation=${mine.reputation}>
      ${translateText("diplomacy.your_reputation", { value: mine.reputation })}
    </div>
    <div class="mt-1 h-1.5 rounded bg-ow-raised overflow-hidden">
      <div
        class="h-full ${mine.reputation >= 50 ? "bg-ow-success" : "bg-ow-warning"}"
        style="width:${mine.reputation}%"
      ></div>
    </div>
    <p class="mt-1 text-xs text-ow-text-2">
      ${translateText("diplomacy.reputation_why")}
    </p>
    ${
      mine.incoming.length === 0
        ? nothing
        : html`<h3
              class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
            >
              ${translateText("diplomacy.incoming")}
            </h3>
            <ul>
              ${mine.incoming.map((p) => {
                const from = byId(p.other);
                if (from === undefined) return nothing;
                return html`<li
                  class="flex items-center justify-between gap-2 py-1"
                  data-incoming=${p.kind}
                >
                  <span class="text-sm text-ow-text"
                    >${translateText(`diplomacy.offer_${p.kind}`, {
                      name: from.displayName(),
                    })}</span
                  >
                  <span class="flex gap-1">
                    ${button(
                      translateText("diplomacy.accept"),
                      () => actions.act("accept", p.kind, from),
                      "accept",
                    )}
                    ${button(
                      translateText("diplomacy.reject"),
                      () => actions.act("reject", p.kind, from),
                      "reject",
                    )}
                  </span>
                </li>`;
              })}
            </ul>`
    }
    <h3
      class="mt-3 text-xs font-semibold uppercase tracking-wider text-ow-text-2"
    >
      ${translateText("diplomacy.countries")}
    </h3>
    <ul>
      ${others.map((o) => countryRow(game, me, o, actions))}
    </ul>
  `;
}
