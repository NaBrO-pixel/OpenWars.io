// OpenWars diplomacy views (milestone 4), shared by the engine and the UI.
import { z } from "zod";

export const AgreementKindSchema = z.enum([
  "nap",
  "trade",
  "ceasefire",
  "intel",
]);

export interface AgreementView {
  kind: z.infer<typeof AgreementKindSchema>;
  /** The other party's PlayerID. */
  other: string;
  expiresAt: number;
}

export interface ProposalView {
  kind: z.infer<typeof AgreementKindSchema>;
  /** The other party: the proposer for incoming, the recipient for outgoing. */
  other: string;
  expiresAt: number;
}

export interface DiplomacyView {
  /** 0..100. */
  reputation: number;
  agreements: AgreementView[];
  incoming: ProposalView[];
  outgoing: ProposalView[];
}

/** A world event as the client shows it (milestone 5). */
export interface WorldEventView {
  id: string;
  /** The nation it affects (PlayerID), or null for the whole world. */
  target: string | null;
  startsAt: number;
  endsAt: number;
}
