// OpenWars intelligence (docs/OpenWars2.md, milestone 5): how much one
// nation knows about another, and how a figure is shown at that confidence.
//
// Fair-play information design, not secrecy: every client simulates the
// whole game (lockstep), so a modified client could read everything. The
// game shows each player only what these rules allow.

export const INTEL_LEVELS = [
  "unknown",
  "limited",
  "estimated",
  "detailed",
] as const;
export type IntelLevel = (typeof INTEL_LEVELS)[number];

export interface IntelFacts {
  self: boolean;
  /** An intelligence-sharing agreement between the two. */
  sharing: boolean;
  allied: boolean;
  /** Any agreement (pact, trade, ceasefire) between the two. */
  agreement: boolean;
  /** They share a border. */
  neighbour: boolean;
  /** Levels from research (TechConfig intelLevels). */
  techLevels: number;
}

/** The confidence one nation has in its picture of another. */
export function intelLevel(f: IntelFacts): IntelLevel {
  if (f.self || f.sharing) return "detailed";
  let level = 0;
  if (f.neighbour || f.agreement) level = 1;
  if (f.allied) level = 2;
  level = Math.min(3, level + f.techLevels);
  return INTEL_LEVELS[level];
}

export type Estimate =
  | { kind: "unknown" }
  | { kind: "magnitude"; low: number; high: number }
  | { kind: "range"; low: number; high: number }
  | { kind: "exact"; value: number };

/** The largest power of ten not above v (v >= 1). Integer loop: no
 * approximated Math functions in shared simulation code. */
function powerOfTenBelow(v: number): number {
  let p = 1;
  while (p * 10 <= v) p *= 10;
  return p;
}

/** Two significant figures, rounding down (low) or up (high). */
function sig2(v: number, up: boolean): number {
  if (v <= 0) return 0;
  const mag = Math.max(1, powerOfTenBelow(v) / 10);
  return (up ? Math.ceil(v / mag) : Math.floor(v / mag)) * mag;
}

/**
 * A figure as a nation at `level` sees it: nothing, its order of magnitude,
 * a ±20–25% range, or the exact value. Deterministic: the same figure gives
 * the same estimate, so it never flickers.
 */
export function estimate(value: number, level: IntelLevel): Estimate {
  switch (level) {
    case "unknown":
      return { kind: "unknown" };
    case "limited": {
      if (value < 1000) return { kind: "magnitude", low: 0, high: 1000 };
      const low = powerOfTenBelow(value);
      return { kind: "magnitude", low, high: low * 10 };
    }
    case "estimated":
      return {
        kind: "range",
        low: sig2(Math.floor(value * 0.8), false),
        high: sig2(Math.ceil(value * 1.25), true),
      };
    case "detailed":
      return { kind: "exact", value };
  }
}
