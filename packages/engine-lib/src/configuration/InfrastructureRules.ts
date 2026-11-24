// Infrastructure costs and the start checks, shared by the engine (which
// decides) and the client (which shows costs and greys out what the engine
// would refuse). The engine's InfrastructureMap is authoritative.
import type {
  InfrastructureKind,
  InfrastructureProjectView,
  SiteLevels,
} from "@openfront/engine-api/game/Infrastructure";
import { EconomyConfig } from "./EconomyConfig";

const infra = EconomyConfig.infrastructure;

export interface ProjectCost {
  money: number;
  industry: number;
  steps: number;
}

/** What building `kind` up to `level` (1..3) costs. */
export function projectCost(
  kind: InfrastructureKind,
  level: number,
): ProjectCost {
  const c = infra.cost[kind];
  return {
    money: c.moneyBase * level * level,
    industry: c.industryBase * level,
    steps: c.stepsBase * level,
  };
}

export type StartRefusal =
  | "not_openwars"
  | "not_a_site"
  | "max_level"
  | "needs_roads"
  | "already_building"
  | "too_many_projects"
  | "cannot_afford";

/**
 * Why a project can't start on a site the player owns, from the site's
 * levels, the player's projects and resources; null when it can.
 */
export function startRefusal(args: {
  unitId: number;
  kind: InfrastructureKind;
  levels: SiteLevels;
  projects: readonly Pick<InfrastructureProjectView, "unitId" | "kind">[];
  /** Every project under way at this site, whoever owns it. */
  siteBusy?: boolean;
  money: bigint;
  industry: number;
  /** Money costs nothing (infinite gold). */
  freeMoney?: boolean;
}): StartRefusal | null {
  const level = args.levels[args.kind] + 1;
  if (level > infra.maxLevel) return "max_level";
  if (args.kind === "railways" && args.levels.roads < level) {
    return "needs_roads";
  }
  if (
    args.siteBusy === true ||
    args.projects.some((p) => p.unitId === args.unitId && p.kind === args.kind)
  ) {
    return "already_building";
  }
  if (args.projects.length >= infra.maxProjects) return "too_many_projects";
  const cost = projectCost(args.kind, level);
  const shortOfMoney =
    args.freeMoney !== true && args.money < BigInt(cost.money);
  if (shortOfMoney || args.industry < cost.industry) {
    return "cannot_afford";
  }
  return null;
}
