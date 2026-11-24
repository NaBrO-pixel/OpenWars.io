// OpenWars infrastructure (docs/OpenWars2.md, milestone 3): each city is a
// development site with four tracks, levels 0..3.
import { z } from "zod";

export const INFRASTRUCTURE_KINDS = [
  "roads",
  "railways",
  "industry",
  "research",
] as const;
export type InfrastructureKind = (typeof INFRASTRUCTURE_KINDS)[number];
export const InfrastructureKindSchema = z.enum(INFRASTRUCTURE_KINDS);

export type SiteLevels = Record<InfrastructureKind, number>;

export interface InfrastructureSiteView extends SiteLevels {
  /** The city's unit id. */
  unitId: number;
}

export interface InfrastructureProjectView {
  unitId: number;
  kind: InfrastructureKind;
  /** The level being built. */
  level: number;
  /** Economy steps (seconds) done and needed. */
  done: number;
  total: number;
}
