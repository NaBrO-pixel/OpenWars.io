// OpenWars research (docs/OpenWars2.md, milestone 4): three branches of five
// technologies. Data only: the engine applies the effects (techModifiers),
// the client shows them. Integers: permille multipliers, flat bonuses.

export const TECH_BRANCHES = ["industry", "technology", "society"] as const;
export type TechBranch = (typeof TECH_BRANCHES)[number];

/** What completed technologies change, summed over every completed one. */
export interface TechEffects {
  /** Industry output, permille added (150 = +15%). */
  industryPermille?: number;
  /** Research output, permille added. */
  researchPermille?: number;
  /** Money earned per unit of industry, permille added. */
  industryMoneyPermille?: number;
  /** Tax income, permille added. */
  taxPermille?: number;
  /** Territory upkeep cut, permille. */
  upkeepCutPermille?: number;
  /** Industry cost of infrastructure projects cut, permille. */
  infrastructureIndustryCutPermille?: number;
  /** More infrastructure projects at once. */
  extraProjects?: number;
  /** Research from research centres, permille added. */
  researchCentrePermille?: number;
  /** Stability target, permille points added. */
  stabilityTarget?: number;
  /** Growth and deficit stability penalties cut, permille. */
  growthPenaltyCutPermille?: number;
  deficitPenaltyCutPermille?: number;
  /** Intelligence confidence levels gained on every country (milestone 5). */
  intelLevels?: number;
}

export interface TechDefinition {
  id: string;
  branch: TechBranch;
  /** 1..5 within its branch: 1 basic, 2-3 intermediate, 4-5 advanced. */
  tier: number;
  /** Research points and money paid when it starts. */
  research: number;
  money: number;
  /** Economy steps (seconds) it takes. */
  steps: number;
  /** Technologies that must be complete first. */
  requires: readonly string[];
  effects: TechEffects;
}

const tier = (n: number) => ({
  research: [0, 40, 90, 160, 260, 400][n],
  money: [0, 20_000, 50_000, 100_000, 180_000, 300_000][n],
  steps: [0, 30, 45, 60, 80, 100][n],
});

export const TECHS: readonly TechDefinition[] = [
  // --- Industry: production and the economy --------------------------------
  {
    id: "assembly_lines",
    branch: "industry",
    tier: 1,
    ...tier(1),
    requires: [],
    effects: { industryPermille: 150 },
  },
  {
    id: "standardised_parts",
    branch: "industry",
    tier: 2,
    ...tier(2),
    requires: ["assembly_lines"],
    effects: { infrastructureIndustryCutPermille: 250 },
  },
  {
    id: "logistics_networks",
    branch: "industry",
    tier: 3,
    ...tier(3),
    requires: ["standardised_parts"],
    effects: { upkeepCutPermille: 200 },
  },
  {
    id: "heavy_industry",
    branch: "industry",
    tier: 4,
    ...tier(4),
    requires: ["logistics_networks"],
    effects: { industryPermille: 300 },
  },
  {
    id: "automation",
    branch: "industry",
    tier: 5,
    ...tier(5),
    requires: ["heavy_industry"],
    effects: { industryMoneyPermille: 400, extraProjects: 1 },
  },
  // --- Technology: research and information --------------------------------
  {
    id: "research_labs",
    branch: "technology",
    tier: 1,
    ...tier(1),
    requires: [],
    effects: { researchPermille: 200 },
  },
  {
    id: "information_systems",
    branch: "technology",
    tier: 2,
    ...tier(2),
    requires: ["research_labs"],
    effects: { taxPermille: 100, intelLevels: 1 },
  },
  {
    id: "project_management",
    branch: "technology",
    tier: 3,
    ...tier(3),
    requires: ["information_systems"],
    effects: { extraProjects: 1 },
  },
  {
    id: "advanced_computing",
    branch: "technology",
    tier: 4,
    ...tier(4),
    requires: ["project_management"],
    effects: { researchPermille: 350, intelLevels: 1 },
  },
  {
    id: "scientific_revolution",
    branch: "technology",
    tier: 5,
    ...tier(5),
    requires: ["advanced_computing"],
    effects: { researchCentrePermille: 500, researchPermille: 150 },
  },
  // --- Society: stability and resilience -----------------------------------
  {
    id: "civil_administration",
    branch: "society",
    tier: 1,
    ...tier(1),
    requires: [],
    effects: { stabilityTarget: 60 },
  },
  {
    id: "public_services",
    branch: "society",
    tier: 2,
    ...tier(2),
    requires: ["civil_administration"],
    effects: { taxPermille: 150 },
  },
  {
    id: "social_cohesion",
    branch: "society",
    tier: 3,
    ...tier(3),
    requires: ["public_services"],
    effects: { growthPenaltyCutPermille: 500 },
  },
  {
    id: "economic_resilience",
    branch: "society",
    tier: 4,
    ...tier(4),
    requires: ["social_cohesion"],
    effects: { deficitPenaltyCutPermille: 600, stabilityTarget: 40 },
  },
  {
    id: "national_unity",
    branch: "society",
    tier: 5,
    ...tier(5),
    requires: ["economic_resilience"],
    effects: { stabilityTarget: 120 },
  },
];

export const TECH_BY_ID: ReadonlyMap<string, TechDefinition> = new Map(
  TECHS.map((t) => [t.id, t]),
);

export type TechModifiers = Required<TechEffects>;

export const NO_TECH: TechModifiers = {
  industryPermille: 0,
  researchPermille: 0,
  industryMoneyPermille: 0,
  taxPermille: 0,
  upkeepCutPermille: 0,
  infrastructureIndustryCutPermille: 0,
  extraProjects: 0,
  researchCentrePermille: 0,
  stabilityTarget: 0,
  growthPenaltyCutPermille: 0,
  deficitPenaltyCutPermille: 0,
  intelLevels: 0,
};

/** The summed effects of the given completed technologies. */
export function techModifiers(completed: Iterable<string>): TechModifiers {
  const m: TechModifiers = { ...NO_TECH };
  for (const id of completed) {
    const t = TECH_BY_ID.get(id);
    if (t === undefined) continue;
    for (const [k, v] of Object.entries(t.effects) as [
      keyof TechModifiers,
      number,
    ][]) {
      m[k] += v;
    }
  }
  return m;
}

export type ResearchRefusal =
  | "not_openwars"
  | "unknown"
  | "done"
  | "busy"
  | "locked"
  | "cannot_afford";

/** Why a nation can't start researching `id` now; null when it can. */
export function researchRefusal(args: {
  id: string;
  completed: ReadonlySet<string>;
  active: string | null;
  research: number;
  money: bigint;
  freeMoney?: boolean;
}): ResearchRefusal | null {
  const t = TECH_BY_ID.get(args.id);
  if (t === undefined) return "unknown";
  if (args.completed.has(args.id)) return "done";
  if (args.active !== null) return "busy";
  if (t.requires.some((r) => !args.completed.has(r))) return "locked";
  if (
    args.research < t.research ||
    (args.freeMoney !== true && args.money < BigInt(t.money))
  ) {
    return "cannot_afford";
  }
  return null;
}
