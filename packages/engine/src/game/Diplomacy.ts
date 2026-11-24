// OpenWars diplomacy (docs/OpenWars2.md, milestone 4): agreements between
// two nations (non-aggression pacts, trade agreements, ceasefires,
// intelligence sharing), the proposals that lead to them, and reputation.
// Owned by GameImpl; changed only by DiplomacyExecution (player intents) and
// advanced once a second by NationalEconomyExecution, so every client agrees.
import type {
  AgreementView,
  DiplomacyView,
  ProposalView,
} from "@openfront/engine-api/game/Diplomacy";
import {
  MessageType,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import {
  type AgreementKind,
  DiplomacyConfig,
  influenceCap,
} from "@openfront/engine-lib/configuration/DiplomacyConfig";
import { z } from "zod";
import type { Game, Player } from "./Game";

const cfg = DiplomacyConfig;

interface Agreement {
  kind: AgreementKind;
  a: string;
  b: string;
  expiresAt: number;
}

interface Proposal {
  kind: AgreementKind;
  from: string;
  to: string;
  expiresAt: number;
}

export type DiplomacyRefusal =
  | "not_openwars"
  | "invalid_target"
  | "already_agreed"
  | "already_proposed"
  | "needs_alliance"
  | "needs_war"
  | "no_proposal"
  | "no_agreement"
  | "influence_limit";

const KindSchema = z.enum(["nap", "trade", "ceasefire", "intel"]);

export const DiplomacyDataSchema = z.object({
  agreements: z.array(
    z.object({
      kind: KindSchema,
      a: z.string(),
      b: z.string(),
      expiresAt: z.number(),
    }),
  ),
  proposals: z.array(
    z.object({
      kind: KindSchema,
      from: z.string(),
      to: z.string(),
      expiresAt: z.number(),
    }),
  ),
  reputation: z.array(z.tuple([z.string(), z.number()])),
});
export type DiplomacyData = z.infer<typeof DiplomacyDataSchema>;

const MESSAGES = {
  proposed: {
    nap: "events_display.diplomacy_proposed_nap",
    trade: "events_display.diplomacy_proposed_trade",
    ceasefire: "events_display.diplomacy_proposed_ceasefire",
    intel: "events_display.diplomacy_proposed_intel",
  },
  signed: {
    nap: "events_display.diplomacy_signed_nap",
    trade: "events_display.diplomacy_signed_trade",
    ceasefire: "events_display.diplomacy_signed_ceasefire",
    intel: "events_display.diplomacy_signed_intel",
  },
  broken: {
    nap: "events_display.diplomacy_broken_nap",
    trade: "events_display.diplomacy_broken_trade",
    ceasefire: "events_display.diplomacy_broken_ceasefire",
    intel: "events_display.diplomacy_broken_intel",
  },
  expired: {
    nap: "events_display.diplomacy_expired_nap",
    trade: "events_display.diplomacy_expired_trade",
    ceasefire: "events_display.diplomacy_expired_ceasefire",
    intel: "events_display.diplomacy_expired_intel",
  },
} as const;

const involves = (x: { a: string; b: string }, p: string, q: string) =>
  (x.a === p && x.b === q) || (x.a === q && x.b === p);

export class DiplomacyMap {
  private agreements: Agreement[] = [];
  private proposals: Proposal[] = [];
  private reputations = new Map<string, number>();

  reputation(player: Player): number {
    return this.reputations.get(player.id()) ?? cfg.reputationStart;
  }

  private setReputation(player: Player, value: number): void {
    this.reputations.set(player.id(), Math.max(0, Math.min(100, value)));
    player.nation()?.invalidate();
  }

  penalize(player: Player, amount: number): void {
    this.setReputation(player, this.reputation(player) - amount);
  }

  has(kind: AgreementKind, p: Player, q: Player): boolean {
    return this.agreements.some(
      (x) => x.kind === kind && involves(x, p.id(), q.id()),
    );
  }

  /** A pact or ceasefire stops the two from attacking each other. */
  blocksHostilities(p: Player, q: Player): boolean {
    return this.agreements.some(
      (x) =>
        (x.kind === "nap" || x.kind === "ceasefire") &&
        involves(x, p.id(), q.id()),
    );
  }

  count(kind: AgreementKind, p: Player): number {
    return this.agreements.filter(
      (x) => x.kind === kind && (x.a === p.id() || x.b === p.id()),
    ).length;
  }

  /** Why `from` can't propose `kind` to `to` now; null when they can. */
  canPropose(
    game: Game,
    kind: AgreementKind,
    from: Player,
    to: Player,
  ): DiplomacyRefusal | null {
    if (!game.config().isOpenWars()) return "not_openwars";
    if (from === to || !to.isAlive() || !from.isAlive()) {
      return "invalid_target";
    }
    if (to.type() === PlayerType.Bot) return "invalid_target";
    if (this.has(kind, from, to)) return "already_agreed";
    if (
      this.proposals.some(
        (p) => p.kind === kind && p.from === from.id() && p.to === to.id(),
      )
    ) {
      return "already_proposed";
    }
    if (kind === "intel" && !from.isAlliedWith(to)) return "needs_alliance";
    // A ceasefire ends a war: only between nations fighting each other.
    if (kind === "ceasefire" && !this.atWar(from, to)) return "needs_war";
    if (kind === "nap" && from.isAlliedWith(to)) return "already_agreed";
    if (this.overInfluence(game, kind, from, to)) return "influence_limit";
    return null;
  }

  /** The nations `p` holds an agreement other than a ceasefire with. */
  partners(p: Player): Set<string> {
    const id = p.id();
    const out = new Set<string>();
    for (const x of this.agreements) {
      if (x.kind === "ceasefire") continue;
      if (x.a === id) out.add(x.b);
      else if (x.b === id) out.add(x.a);
    }
    return out;
  }

  /** How many partners `p` may have now (DiplomacyConfig influence). */
  influenceCap(game: Game, p: Player): number {
    const others = game
      .players()
      .filter(
        (o) => o !== p && o.isAlive() && o.type() !== PlayerType.Bot,
      ).length;
    return influenceCap(others, game.ticks());
  }

  /**
   * A new partnership would take either side past its influence. Ceasefires
   * end wars and are never limited; more agreements with an existing
   * partner add no partner.
   */
  private overInfluence(
    game: Game,
    kind: AgreementKind,
    p: Player,
    q: Player,
  ): boolean {
    if (kind === "ceasefire") return false;
    const full = (x: Player, y: Player) => {
      const mine = this.partners(x);
      return !mine.has(y.id()) && mine.size >= this.influenceCap(game, x);
    };
    return full(p, q) || full(q, p);
  }

  /** At war: one of them is attacking the other right now. */
  atWar(p: Player, q: Player): boolean {
    const hits = (x: Player, y: Player) =>
      x.outgoingAttacks().some((a) => a.target() === y);
    return hits(p, q) || hits(q, p);
  }

  /**
   * Proposes an agreement. If the other side has already proposed the same
   * one, this accepts it instead (simultaneous proposals agree).
   */
  propose(
    game: Game,
    kind: AgreementKind,
    from: Player,
    to: Player,
  ): DiplomacyRefusal | null {
    const reverse = this.proposals.find(
      (p) => p.kind === kind && p.from === to.id() && p.to === from.id(),
    );
    if (reverse !== undefined) return this.accept(game, kind, from, to);
    const refusal = this.canPropose(game, kind, from, to);
    if (refusal !== null) return refusal;
    this.proposals.push({
      kind,
      from: from.id(),
      to: to.id(),
      expiresAt: game.ticks() + cfg.proposalTicks,
    });
    game.displayMessage(
      MESSAGES.proposed[kind],
      MessageType.NATIONAL_DEVELOPMENT,
      to.id(),
      undefined,
      { name: from.displayName() },
      undefined,
      from.id(),
    );
    this.touch(from, to);
    return null;
  }

  /** `by` accepts the proposal `from` made them. */
  accept(
    game: Game,
    kind: AgreementKind,
    by: Player,
    from: Player,
  ): DiplomacyRefusal | null {
    const i = this.proposals.findIndex(
      (p) => p.kind === kind && p.from === from.id() && p.to === by.id(),
    );
    if (i < 0) return "no_proposal";
    this.proposals.splice(i, 1);
    // Conditions may have changed since it was proposed.
    if (kind === "intel" && !from.isAlliedWith(by)) return "needs_alliance";
    if (this.has(kind, by, from)) return "already_agreed";
    if (this.overInfluence(game, kind, from, by)) return "influence_limit";
    this.agreements.push({
      kind,
      a: from.id(),
      b: by.id(),
      expiresAt: game.ticks() + cfg.agreements[kind].ticks,
    });
    // A pact or ceasefire stops the fighting at once.
    if (kind === "nap" || kind === "ceasefire") {
      for (const atk of [...from.outgoingAttacks(), ...by.outgoingAttacks()]) {
        const t = atk.target();
        if ((t === by || t === from) && !atk.retreating()) atk.orderRetreat();
      }
    }
    for (const p of [from, by]) {
      game.displayMessage(
        MESSAGES.signed[kind],
        MessageType.NATIONAL_DEVELOPMENT,
        p.id(),
        undefined,
        { name: (p === from ? by : from).displayName() },
      );
    }
    this.touch(from, by);
    return null;
  }

  reject(
    kind: AgreementKind,
    by: Player,
    from: Player,
  ): DiplomacyRefusal | null {
    const i = this.proposals.findIndex(
      (p) => p.kind === kind && p.from === from.id() && p.to === by.id(),
    );
    if (i < 0) return "no_proposal";
    this.proposals.splice(i, 1);
    this.touch(from, by);
    return null;
  }

  /** `by` breaks an agreement early: it ends, and their reputation suffers. */
  breakAgreement(
    game: Game,
    kind: AgreementKind,
    by: Player,
    other: Player,
  ): DiplomacyRefusal | null {
    const i = this.agreements.findIndex(
      (x) => x.kind === kind && involves(x, by.id(), other.id()),
    );
    if (i < 0) return "no_agreement";
    this.agreements.splice(i, 1);
    this.penalize(by, cfg.agreements[kind].breakPenalty);
    for (const p of [by, other]) {
      game.displayMessage(
        MESSAGES.broken[kind],
        MessageType.ALLIANCE_BROKEN,
        p.id(),
        undefined,
        { name: by.displayName() },
      );
    }
    this.touch(by, other);
    return null;
  }

  /**
   * Once a second: expire proposals and agreements, end those whose parties
   * are gone or whose conditions lapsed, let AI nations answer, and let
   * reputation recover.
   */
  advance(game: Game, steps: number): void {
    const now = game.ticks();
    const alive = (id: string) => {
      if (!game.hasPlayer(id)) return null;
      const p = game.player(id);
      return p.isAlive() ? p : null;
    };
    for (const prop of [...this.proposals]) {
      const from = alive(prop.from);
      const to = alive(prop.to);
      if (from === null || to === null || prop.expiresAt <= now) {
        this.proposals.splice(this.proposals.indexOf(prop), 1);
        if (from !== null && to !== null) this.touch(from, to);
        continue;
      }
      if (to.type() === PlayerType.Nation) {
        if (this.reputation(from) >= cfg.aiMinReputation) {
          this.accept(game, prop.kind, to, from);
        } else {
          this.reject(prop.kind, to, from);
        }
      }
    }
    for (const ag of [...this.agreements]) {
      const a = alive(ag.a);
      const b = alive(ag.b);
      const lapsed =
        a === null ||
        b === null ||
        ag.expiresAt <= now ||
        (ag.kind === "intel" && !a.isAlliedWith(b));
      if (!lapsed) continue;
      this.agreements.splice(this.agreements.indexOf(ag), 1);
      for (const p of [a, b]) {
        if (p === null) continue;
        game.displayMessage(
          MESSAGES.expired[ag.kind],
          MessageType.ALLIANCE_EXPIRED,
          p.id(),
          undefined,
          { name: (p === a ? b : a)?.displayName() ?? "" },
        );
        p.nation()?.invalidate();
      }
    }
    this.aiOffers(game, steps);
    if (steps % cfg.reputationRecoverySteps === 0) {
      for (const [id, rep] of this.reputations) {
        if (rep >= 100) continue;
        this.reputations.set(id, rep + 1);
        if (game.hasPlayer(id)) game.player(id).nation()?.invalidate();
      }
    }
  }

  view(player: Player, game?: Game): DiplomacyView {
    const id = player.id();
    const agreements: AgreementView[] = this.agreements
      .filter((x) => x.a === id || x.b === id)
      .map((x) => ({
        kind: x.kind,
        other: x.a === id ? x.b : x.a,
        expiresAt: x.expiresAt,
      }));
    const incoming: ProposalView[] = this.proposals
      .filter((p) => p.to === id)
      .map((p) => ({ kind: p.kind, other: p.from, expiresAt: p.expiresAt }));
    const outgoing: ProposalView[] = this.proposals
      .filter((p) => p.from === id)
      .map((p) => ({ kind: p.kind, other: p.to, expiresAt: p.expiresAt }));
    return {
      reputation: this.reputation(player),
      agreements,
      incoming,
      outgoing,
      ...(game === undefined
        ? {}
        : {
            influence: {
              partners: this.partners(player).size,
              cap: this.influenceCap(game, player),
            },
          }),
    };
  }

  /**
   * AI nations seek trade: every `aiOfferEverySteps` (staggered by nation),
   * each offers a trade agreement to the first neighbouring nation, in id
   * order, that it is on good terms with and may sign with now.
   */
  private aiOffers(game: Game, steps: number): void {
    for (const p of game.players()) {
      if (p.type() !== PlayerType.Nation || !p.isAlive()) continue;
      if ((steps + p.smallID()) % cfg.aiOfferEverySteps !== 0) continue;
      const partner = p
        .nearby()
        .filter((n): n is Player => n.isPlayer())
        .filter(
          (n) =>
            n.type() !== PlayerType.Bot &&
            p.relation(n) >= Relation.Neutral &&
            !this.atWar(p, n) &&
            this.canPropose(game, "trade", p, n) === null,
        )
        .sort((a, b) => a.smallID() - b.smallID())[0];
      if (partner !== undefined) this.propose(game, "trade", p, partner);
    }
  }

  /** Both sides' views changed. */
  private touch(p: Player, q: Player): void {
    p.nation()?.invalidate();
    q.nation()?.invalidate();
  }

  toData(): DiplomacyData {
    return {
      agreements: this.agreements.map((x) => ({ ...x })),
      proposals: this.proposals.map((p) => ({ ...p })),
      reputation: [...this.reputations.entries()],
    };
  }

  restore(d: DiplomacyData): void {
    this.agreements = d.agreements.map((x) => ({ ...x }));
    this.proposals = d.proposals.map((p) => ({ ...p }));
    this.reputations = new Map(d.reputation);
  }
}
