import type { NationView } from "@openfront/engine-api/game/GameUpdates";
import "../../../../src/client/hud/layers/CommandBar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandBar } from "../../../../src/client/hud/layers/CommandBar";
import {
  COMMAND_SECTIONS,
  type CommandNav,
} from "../../../../src/client/hud/layers/CommandNav";
import {
  formatClock,
  formatIncome,
  formatShare,
  IncomeTracker,
  nationalSummary,
} from "../../../../src/client/hud/NationalSummary";
import type { GameView } from "../../../../src/client/view";

interface FakePlayer {
  id: () => string;
  isAlive: () => boolean;
  displayName: () => string;
  gold: () => bigint;
  goldEarned: () => number;
  troops: () => number;
  numTilesOwned: () => number;
  allies: () => FakePlayer[];
  units: () => unknown[];
  nation: () => NationView | null;
}

function player(
  id: string,
  tiles: number,
  earned = 0,
  nation: NationView | null = null,
): FakePlayer {
  return {
    id: () => id,
    isAlive: () => true,
    displayName: () => id,
    gold: () => 12_500n,
    goldEarned: () => earned,
    troops: () => 50_000,
    numTilesOwned: () => tiles,
    allies: () => [],
    units: () => [],
    nation: () => nation,
  };
}

const NATION: NationView = {
  industry: 340,
  research: 75,
  stability: 720,
  stabilityTarget: 800,
  income: { base: 1000, tax: 900, industry: 120 },
  expenses: { territory: 200, structures: 30 },
  industryRate: 8,
  researchRate: 3,
  development: 4,
  netHistory: [500, 900, 1200, 1790],
};

function game(
  me: FakePlayer | null,
  others: FakePlayer[] = [],
  opts: { seconds?: () => number; spawn?: boolean } = {},
): GameView {
  return {
    myPlayer: () => me,
    inSpawnPhase: () => opts.spawn ?? false,
    elapsedGameSeconds: opts.seconds ?? (() => 125),
    numLandTiles: () => 1000,
    playerViews: () => (me ? [me, ...others] : others),
    config: () => ({ maxTroops: () => 100_000 }),
  } as unknown as GameView;
}

describe("NationalSummary", () => {
  it("formats shares and income", () => {
    expect(formatShare(0.0042)).toBe("0.42%");
    expect(formatShare(0.25)).toBe("25.0%");
    expect(formatIncome(null, String)).toBe("…");
    expect(formatIncome(12.4, String)).toBe("+12/s");
    expect(formatIncome(-3, String)).toBe("-3/s");
  });

  it("formats the match clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("1:02:05");
  });

  it("measures income from cumulative earnings", () => {
    const t = new IncomeTracker();
    expect(t.sample(0, 0)).toBeNull();
    expect(t.sample(2, 200)).toBeNull(); // still measuring
    expect(t.sample(5, 500)).toBe(100);
    expect(t.sample(10, 1500)).toBe(150);
    // Older samples leave the 10 s window.
    expect(t.sample(20, 1500)).toBe(0);
  });
});

describe("command-bar", () => {
  let bar: CommandBar;
  beforeEach(() => {
    bar = document.createElement("command-bar") as CommandBar;
    document.body.appendChild(bar);
  });
  afterEach(() => bar.remove());

  it("shows the national figures", async () => {
    bar.game = game(player("me", 250));
    bar.init();
    bar.tick();
    await bar.updateComplete;
    const text = bar.textContent ?? "";
    expect(bar.querySelectorAll("[data-command-bar-item]")).toHaveLength(5);
    expect(text).toContain("25.0%");
    expect(text).toContain("2:05");
    expect(text).toContain("12.5K");
  });

  it("hides during the spawn phase and when there is no player", async () => {
    bar.game = game(player("me", 250), [], { spawn: true });
    bar.tick();
    await bar.updateComplete;
    expect(bar.children).toHaveLength(0);
    bar.game = game(null);
    bar.tick();
    await bar.updateComplete;
    expect(bar.querySelector("[data-command-bar-item]")).toBeNull();
  });
});

describe("economy interface", () => {
  it("the bar adds industry, research and stability", async () => {
    const bar = document.createElement("command-bar") as CommandBar;
    document.body.appendChild(bar);
    bar.game = game(player("me", 250, 0, NATION));
    bar.init();
    bar.tick();
    await bar.updateComplete;
    expect(bar.querySelectorAll("[data-command-bar-item]")).toHaveLength(8);
    expect(bar.textContent).toContain("72%");
    bar.remove();
  });

  it("the economy panel explains income and expenses", async () => {
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = game(player("me", 100, 0, NATION));
    nav.init();
    nav.tick();
    nav.toggle("economy");
    await nav.updateComplete;
    const panel = nav.querySelector('[data-command-panel="economy"]')!;
    const text = panel.textContent ?? "";
    for (const key of [
      "command_nav.income_tax_why",
      "command_nav.expense_territory_why",
      "command_nav.stability_why",
    ]) {
      expect(text).toContain(key);
    }
    expect(text).toContain("900/s"); // tax
    expect(text).toContain("230/s"); // total expenses
    expect(text).toContain("72% → 80%");
    expect(panel.querySelector("[data-economy-trend] polyline")).not.toBeNull();
    nav.remove();
  });

  it("net income takes the expenses off measured earnings", () => {
    const t = new IncomeTracker();
    const me = player("me", 100, 0, NATION);
    const g = game(me, [], { seconds: () => 0 });
    expect(nationalSummary(g, me as never, t).incomePerSecond).toBeNull();
    const later = player("me", 100, 5_000, NATION);
    const g2 = game(later, [], { seconds: () => 5 });
    // 1,000/s earned, 230/s expenses.
    expect(nationalSummary(g2, later as never, t).incomePerSecond).toBe(770);
  });
});

describe("command-nav", () => {
  let nav: CommandNav;
  beforeEach(() => {
    nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = game(player("me", 100), [
      player("big", 400),
      player("mid", 200),
    ]);
    nav.init();
    nav.tick();
  });
  afterEach(() => nav.remove());

  it("lists only sections whose system is on", async () => {
    await nav.updateComplete;
    const ids = () =>
      Array.from(nav.querySelectorAll("[data-command-section]")).map((b) =>
        b.getAttribute("data-command-section"),
      );
    // Classic rules: no economy section.
    expect(ids()).toEqual(["overview", "statistics"]);
    nav.game = game(player("me", 100, 0, NATION));
    nav.tick();
    await nav.updateComplete;
    expect(ids()).toEqual(COMMAND_SECTIONS.map((s) => s.id));
    expect(nav.querySelector("[data-command-panel]")).toBeNull();
  });

  it("opens, switches and closes panels", async () => {
    await nav.updateComplete;
    (
      nav.querySelector('[data-command-section="overview"]') as HTMLElement
    ).click();
    await nav.updateComplete;
    const overview = nav.querySelector('[data-command-panel="overview"]');
    expect(overview?.textContent).toContain("10.0%");
    // Rank 3 of 3: "big" and "mid" own more land.
    expect(overview?.textContent).toContain("command_nav.rank_of");

    (
      nav.querySelector('[data-command-section="statistics"]') as HTMLElement
    ).click();
    await nav.updateComplete;
    const rows = nav.querySelectorAll("[data-standing]");
    expect(
      Array.from(rows).map((r) => r.textContent?.trim().split(/\s+/)[1]),
    ).toEqual(["big", "mid", "me"]);

    nav.toggle("statistics");
    await nav.updateComplete;
    expect(nav.querySelector("[data-command-panel]")).toBeNull();
  });
});
