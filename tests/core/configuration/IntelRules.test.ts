import {
  estimate,
  intelLevel,
} from "@openfront/engine-lib/configuration/IntelRules";

const none = {
  self: false,
  sharing: false,
  allied: false,
  agreement: false,
  neighbour: false,
  techLevels: 0,
};

describe("intelligence confidence", () => {
  test("follows contact, agreements, alliances and sharing", () => {
    expect(intelLevel(none)).toBe("unknown");
    expect(intelLevel({ ...none, neighbour: true })).toBe("limited");
    expect(intelLevel({ ...none, agreement: true })).toBe("limited");
    expect(intelLevel({ ...none, allied: true })).toBe("estimated");
    expect(intelLevel({ ...none, sharing: true })).toBe("detailed");
    expect(intelLevel({ ...none, self: true })).toBe("detailed");
  });

  test("research adds levels, up to detailed", () => {
    expect(intelLevel({ ...none, techLevels: 1 })).toBe("limited");
    expect(intelLevel({ ...none, neighbour: true, techLevels: 1 })).toBe(
      "estimated",
    );
    expect(intelLevel({ ...none, allied: true, techLevels: 2 })).toBe(
      "detailed",
    );
  });
});

describe("estimates", () => {
  test("never show more than the confidence allows", () => {
    expect(estimate(12_345, "unknown")).toEqual({ kind: "unknown" });
    expect(estimate(12_345, "limited")).toEqual({
      kind: "magnitude",
      low: 10_000,
      high: 100_000,
    });
    expect(estimate(12_345, "estimated")).toEqual({
      kind: "range",
      low: 9_800,
      high: 16_000,
    });
    expect(estimate(12_345, "detailed")).toEqual({
      kind: "exact",
      value: 12_345,
    });
  });

  test("a range always contains the true figure", () => {
    for (const v of [7, 99, 1_000, 54_321, 9_999_999]) {
      const e = estimate(v, "estimated");
      if (e.kind !== "range") throw new Error("expected a range");
      expect(e.low).toBeLessThanOrEqual(v);
      expect(e.high).toBeGreaterThanOrEqual(v);
    }
  });
});
