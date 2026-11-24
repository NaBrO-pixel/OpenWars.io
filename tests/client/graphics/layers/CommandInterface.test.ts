import type { NationView } from "@openfront/engine-api/game/GameUpdates";
import "../../../../src/client/hud/layers/CommandBar";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../../../src/client/components/OpenWarsModePicker";
import type { OpenWarsModePicker } from "../../../../src/client/components/OpenWarsModePicker";
import type { CommandBar } from "../../../../src/client/hud/layers/CommandBar";
import {
  COMMAND_SECTIONS,
  type CommandNav,
} from "../../../../src/client/hud/layers/CommandNav";
import { guideMayAutoOpen } from "../../../../src/client/hud/layers/GuidePanel";
import { ToggleInfrastructureOverlayEvent } from "../../../../src/client/hud/layers/InfrastructureOverlay";
import {
  formatEstimate,
  reports,
} from "../../../../src/client/hud/layers/IntelligencePanel";
import { effectLines } from "../../../../src/client/hud/layers/ResearchPanel";
import {
  formatClock,
  formatIncome,
  formatShare,
  IncomeTracker,
  nationalSummary,
} from "../../../../src/client/hud/NationalSummary";
import {
  SendDiplomacyIntentEvent,
  SendInfrastructureIntentEvent,
  SendMobiliseIntentEvent,
  SendResearchIntentEvent,
} from "../../../../src/client/Transport";
import { UserSettings } from "../../../../src/client/UserSettings";
import type { GameView } from "../../../../src/client/view";

beforeEach(() => {
  // The guide opens itself once; tests other than its own start past it.
  localStorage.setItem("openwars.guideSeen", "1");
});

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
    type: () => "HUMAN",
  } as FakePlayer;
}

const NATION: NationView = {
  industry: 340,
  research: 75,
  stability: 720,
  stabilityTarget: 800,
  income: { base: 1000, tax: 900, industry: 120 },
  expenses: { territory: 200, structures: 30, military: 0 },
  industryRate: 8,
  researchRate: 3,
  development: 4,
  netHistory: [500, 900, 1200, 1790],
  sites: [],
  projects: [],
  techs: [],
  researching: null,
  diplomacy: { reputation: 100, agreements: [], incoming: [], outgoing: [] },
  events: [],
  eventHistory: [],
  neighbours: [],
  intelLevels: 0,
  mobilisation: 1,
  supply: 700,
  defence: 50,
  victory: [],
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
    config: () => ({ maxTroops: () => 100_000, gameConfig: () => ({}) }),
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

describe("infrastructure panel", () => {
  const SITE = { unitId: 7, roads: 1, railways: 0, industry: 3, research: 0 };
  function open(nation: NationView, gold = 10_000_000n) {
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    const me = player("me", 100, 0, nation);
    me.gold = () => gold;
    nav.game = {
      ...(game(me) as object),
      unit: () => undefined,
    } as unknown as GameView;
    const bus = new EventBus();
    const sent: unknown[] = [];
    bus.on(SendInfrastructureIntentEvent, (e) => sent.push(e));
    bus.on(ToggleInfrastructureOverlayEvent, (e) => sent.push(e));
    nav.eventBus = bus;
    nav.init();
    nav.tick();
    nav.toggle("infrastructure");
    return { nav, sent };
  }

  it("starts and cancels projects through intents", async () => {
    const { nav, sent } = open({ ...NATION, industry: 5_000, sites: [SITE] });
    await nav.updateComplete;
    const site = nav.querySelector('[data-site="7"]')!;
    // Industry is at level 3: fully developed, no button.
    expect(site.querySelector('[data-start="industry"]')).toBeNull();
    (site.querySelector('[data-start="roads"]') as HTMLButtonElement).click();
    expect(sent).toEqual([
      expect.objectContaining({ action: "start", unitId: 7, kind: "roads" }),
    ]);
    nav.remove();

    const building = open({
      ...NATION,
      sites: [SITE],
      projects: [{ unitId: 7, kind: "research", level: 1, done: 5, total: 25 }],
    });
    await building.nav.updateComplete;
    (
      building.nav.querySelector('[data-cancel="research"]') as HTMLElement
    ).click();
    expect(building.sent).toEqual([
      expect.objectContaining({ action: "cancel", kind: "research" }),
    ]);
    building.nav.remove();
  });

  it("disables what the engine would refuse, and says why", async () => {
    const { nav } = open({ ...NATION, industry: 0, sites: [SITE] }, 0n);
    await nav.updateComplete;
    const roads = nav.querySelector(
      '[data-start="roads"]',
    ) as HTMLButtonElement;
    expect(roads.disabled).toBe(true);
    expect(roads.title).toBe("infrastructure.refusal_cannot_afford");
    // Railways at level 1 need roads at level 1: met. Level 2 would not be.
    const rail = nav.querySelector(
      '[data-start="railways"]',
    ) as HTMLButtonElement;
    expect(rail.title).toBe("infrastructure.refusal_cannot_afford");
    nav.remove();
  });

  it("toggles the map overlay", async () => {
    const { nav, sent } = open({ ...NATION, sites: [SITE] });
    await nav.updateComplete;
    (nav.querySelector("[data-overlay-toggle]") as HTMLElement).click();
    expect(sent).toEqual([expect.objectContaining({ visible: true })]);
    nav.remove();
  });

  it("explains how to start when there are no cities", async () => {
    const { nav } = open({ ...NATION, sites: [] });
    await nav.updateComplete;
    expect(nav.querySelector("[data-no-sites]")).not.toBeNull();
    nav.remove();
  });

  it("never opens itself in the onboarding tutorial game", () => {
    expect(guideMayAutoOpen(true, true)).toBe(false);
    expect(guideMayAutoOpen(false, false)).toBe(false);
  });
});

describe("research panel", () => {
  function open(nation: NationView) {
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    const me = player("me", 100, 0, nation);
    me.gold = () => 10_000_000n;
    nav.game = game(me);
    const bus = new EventBus();
    const sent: unknown[] = [];
    bus.on(SendResearchIntentEvent, (e) => sent.push(e));
    nav.eventBus = bus;
    nav.init();
    nav.tick();
    nav.toggle("research");
    return { nav, sent };
  }

  it("shows each technology's state distinctly", async () => {
    const { nav } = open({
      ...NATION,
      research: 1_000,
      techs: ["assembly_lines"],
      researching: { id: "research_labs", done: 10, total: 30 },
    });
    await nav.updateComplete;
    const state = (id: string) =>
      nav.querySelector(`[data-tech="${id}"]`)?.getAttribute("data-tech-state");
    expect(state("assembly_lines")).toBe("completed");
    expect(state("research_labs")).toBe("researching");
    expect(state("standardised_parts")).toBe("available");
    expect(state("heavy_industry")).toBe("locked");
    expect(nav.querySelectorAll("[data-branch]")).toHaveLength(3);
    // Busy: nothing else can start.
    const btn = nav.querySelector(
      '[data-research-start="standardised_parts"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("research.refusal_busy");
    nav.remove();
  });

  it("starts and cancels research through intents", async () => {
    const { nav, sent } = open({ ...NATION, research: 1_000 });
    await nav.updateComplete;
    (
      nav.querySelector(
        '[data-research-start="civil_administration"]',
      ) as HTMLElement
    ).click();
    expect(sent).toEqual([
      expect.objectContaining({
        action: "start",
        tech: "civil_administration",
      }),
    ]);
    nav.remove();
    const busy = open({
      ...NATION,
      researching: { id: "research_labs", done: 1, total: 30 },
    });
    await busy.nav.updateComplete;
    (
      busy.nav.querySelector(
        '[data-research-cancel="research_labs"]',
      ) as HTMLElement
    ).click();
    expect(busy.sent).toEqual([
      expect.objectContaining({ action: "cancel", tech: "research_labs" }),
    ]);
    busy.nav.remove();
  });

  it("describes effects in plain numbers", () => {
    expect(effectLines({ industryPermille: 150, extraProjects: 1 })).toEqual([
      "research.effect_industry",
      "research.effect_projects",
    ]);
  });
});

describe("diplomacy panel", () => {
  function country(id: string, nation: NationView | null = NATION) {
    const p = player(id, 100, 0, nation) as FakePlayer &
      Record<string, unknown>;
    Object.assign(p, {
      smallID: () => id.length,
      type: () => "HUMAN",
      isAlliedWith: () => false,
      hasEmbargoAgainst: () => false,
      outgoingAttacks: () => [],
      incomingAttacks: () => [],
    });
    return p;
  }

  function open(diplomacy: NationView["diplomacy"], allied = false) {
    const me = country("me", { ...NATION, diplomacy });
    const rival = country("rival");
    if (allied) {
      me.isAlliedWith = () => true;
      rival.isAlliedWith = () => true;
    }
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = {
      ...(game(me, [rival]) as object),
      ticks: () => 0,
    } as unknown as GameView;
    const bus = new EventBus();
    const sent: unknown[] = [];
    bus.on(SendDiplomacyIntentEvent, (e) => sent.push(e));
    nav.eventBus = bus;
    nav.init();
    nav.tick();
    nav.toggle("diplomacy");
    return { nav, sent };
  }

  const EMPTY = { reputation: 100, agreements: [], incoming: [], outgoing: [] };

  it("lists countries with relationship and proposes agreements", async () => {
    const { nav, sent } = open(EMPTY);
    await nav.updateComplete;
    const row = nav.querySelector('[data-country="rival"]')!;
    expect(
      row
        .querySelector("[data-relationship]")
        ?.getAttribute("data-relationship"),
    ).toBe("neutral");
    // Not allied, not at war: pact and trade on offer, no ceasefire or intel.
    expect(row.querySelector('[data-action="propose-ceasefire"]')).toBeNull();
    expect(row.querySelector('[data-action="propose-intel"]')).toBeNull();
    (row.querySelector('[data-action="propose-trade"]') as HTMLElement).click();
    expect(sent).toEqual([
      expect.objectContaining({
        action: "propose",
        kind: "trade",
        target: "rival",
      }),
    ]);
    nav.remove();
  });

  it("accepts and rejects proposals, and breaks agreements", async () => {
    const { nav, sent } = open({
      reputation: 72,
      agreements: [{ kind: "nap", other: "rival", expiresAt: 600 }],
      incoming: [{ kind: "trade", other: "rival", expiresAt: 300 }],
      outgoing: [],
    });
    await nav.updateComplete;
    expect(
      nav.querySelector("[data-reputation]")?.getAttribute("data-reputation"),
    ).toBe("72");
    expect(
      nav
        .querySelector('[data-country="rival"] [data-relationship]')
        ?.getAttribute("data-relationship"),
    ).toBe("friendly");
    (
      nav.querySelector(
        '[data-incoming="trade"] [data-action="accept"]',
      ) as HTMLElement
    ).click();
    (nav.querySelector('[data-break="nap"]') as HTMLElement).click();
    expect(sent).toEqual([
      expect.objectContaining({ action: "accept", kind: "trade" }),
      expect.objectContaining({ action: "break", kind: "nap" }),
    ]);
    nav.remove();
  });

  it("offers intelligence sharing to allies", async () => {
    const { nav } = open(EMPTY, true);
    await nav.updateComplete;
    const row = nav.querySelector('[data-country="rival"]')!;
    expect(row.querySelector('[data-action="propose-intel"]')).not.toBeNull();
    expect(
      row
        .querySelector("[data-relationship]")
        ?.getAttribute("data-relationship"),
    ).toBe("allied");
    nav.remove();
  });

  it("never opens itself in the onboarding tutorial game", () => {
    expect(guideMayAutoOpen(true, true)).toBe(false);
    expect(guideMayAutoOpen(false, false)).toBe(false);
  });
});

describe("intelligence and events panels", () => {
  function setupNav(me: FakePlayer, others: FakePlayer[]) {
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = {
      ...(game(me, others) as object),
      ticks: () => 100,
    } as unknown as GameView;
    nav.init();
    nav.tick();
    return nav;
  }
  function country(id: string, nation: NationView, tiles = 100) {
    const p = player(id, tiles, 0, nation) as FakePlayer &
      Record<string, unknown>;
    Object.assign(p, {
      type: () => "HUMAN",
      isAlliedWith: () => false,
      allies: () => [],
    });
    return p;
  }

  it("shows unknown and estimated figures without exact numbers", async () => {
    const rival = country("rival", { ...NATION, stability: 640 }, 300);
    const me = country("me", { ...NATION, neighbours: [] });
    const nav = setupNav(me, [rival]);
    nav.toggle("intelligence");
    await nav.updateComplete;
    const panel = nav.querySelector('[data-intel-target="rival"]')!;
    expect(
      panel.querySelector("[data-confidence]")?.getAttribute("data-confidence"),
    ).toBe("unknown");
    expect(panel.textContent).toContain("intelligence.unknown");
    expect(panel.textContent).not.toContain("64%");
    nav.remove();

    // A neighbour with research: estimated, shown as a range.
    const me2 = country("me", {
      ...NATION,
      neighbours: ["rival"],
      intelLevels: 1,
    });
    const nav2 = setupNav(me2, [rival]);
    nav2.toggle("intelligence");
    await nav2.updateComplete;
    const p2 = nav2.querySelector('[data-intel-target="rival"]')!;
    expect(
      p2.querySelector("[data-confidence]")?.getAttribute("data-confidence"),
    ).toBe("estimated");
    expect(p2.textContent).toMatch(/~\S+–\S+/);
    nav2.remove();
  });

  it("formats estimates", () => {
    expect(
      formatEstimate({ kind: "range", low: 1_000, high: 2_000 }, String),
    ).toBe("~1000–2000");
    expect(formatEstimate({ kind: "unknown" }, String)).toBe(
      "intelligence.unknown",
    );
  });

  it("reports notable changes from the history", () => {
    const samples = [0, 1, 2, 3, 4].map((i) => ({
      t: i * 15,
      share: 0.01 + i * 0.01,
      troops: 1000 * (i + 1) * (i + 1),
    }));
    expect(reports(samples, "unknown").map((r) => r.key)).toEqual([
      "intelligence.report_expanded",
    ]);
    expect(reports(samples, "estimated").map((r) => r.key)).toContain(
      "intelligence.alert_buildup",
    );
  });

  it("lists world events with their phase and who they affect", async () => {
    const me = country("me", {
      ...NATION,
      events: [
        { id: "global_recession", target: null, startsAt: 400, endsAt: 1600 },
        { id: "natural_disaster", target: "me", startsAt: 50, endsAt: 650 },
      ],
      eventHistory: [
        { id: "industrial_boom", target: null, startsAt: 0, endsAt: 90 },
      ],
    });
    const nav = setupNav(me, []);
    nav.toggle("events");
    await nav.updateComplete;
    const phase = (id: string) =>
      nav
        .querySelector(`[data-world-event="${id}"]`)
        ?.getAttribute("data-phase");
    expect(phase("global_recession")).toBe("warning");
    expect(phase("natural_disaster")).toBe("active");
    expect(phase("industrial_boom")).toBe("past");
    expect(nav.textContent).toContain("world_events.you");
    nav.remove();
  });

  it("never opens itself in the onboarding tutorial game", () => {
    expect(guideMayAutoOpen(true, true)).toBe(false);
    expect(guideMayAutoOpen(false, false)).toBe(false);
  });
});

describe("military panel and victory progress", () => {
  it("changes mobilisation through an intent and shows victory progress", async () => {
    const nation: NationView = {
      ...NATION,
      victory: [
        { kind: "economic", progress: 1000, held: 30, needed: 90 },
        { kind: "technological", progress: 333, held: 0, needed: 0 },
      ],
    };
    const me = player("me", 100, 0, nation) as FakePlayer &
      Record<string, unknown>;
    Object.assign(me, {
      smallID: () => 1,
      outgoingAttacks: () => [],
      incomingAttacks: () => [
        { attackerID: 9, targetID: 1, troops: 500, id: "x", retreating: false },
      ],
    });
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = game(me);
    const bus = new EventBus();
    const sent: unknown[] = [];
    bus.on(SendMobiliseIntentEvent, (e) => sent.push(e));
    nav.eventBus = bus;
    nav.init();
    nav.tick();
    nav.toggle("military");
    await nav.updateComplete;
    (nav.querySelector('[data-mobilise="3"]') as HTMLElement).click();
    expect(sent).toEqual([expect.objectContaining({ level: 3 })]);
    expect(nav.querySelector("[data-fronts]")?.textContent).toContain(
      "military.attacked_by",
    );
    nav.toggle("statistics");
    await nav.updateComplete;
    expect(
      nav.querySelector('[data-victory="economic"]')?.textContent,
    ).toContain("victory.holding");
    expect(
      nav.querySelector('[data-victory="technological"]')?.textContent,
    ).toContain("33%");
    nav.remove();
  });

  it("never opens itself in the onboarding tutorial game", () => {
    expect(guideMayAutoOpen(true, true)).toBe(false);
    expect(guideMayAutoOpen(false, false)).toBe(false);
  });
});

describe("mode picker", () => {
  it("emits each mode's full settings, and Sandbox's choices", async () => {
    const picker = document.createElement(
      "openwars-mode-picker",
    ) as OpenWarsModePicker;
    document.body.appendChild(picker);
    const got: unknown[] = [];
    picker.addEventListener("mode-change", (e) =>
      got.push((e as CustomEvent).detail),
    );
    await picker.updateComplete;
    (picker.querySelector('[data-mode="coldwar"]') as HTMLElement).click();
    await picker.updateComplete;
    expect(got[got.length - 1]).toEqual({
      ruleset: "coldwar",
      eventFrequencyPermille: 1000,
      victoryConditions: ["economic", "diplomatic", "technological"],
    });
    (picker.querySelector('[data-mode="sandbox"]') as HTMLElement).click();
    await picker.updateComplete;
    (picker.querySelector('[data-frequency="0"]') as HTMLElement).click();
    (
      picker.querySelector('[data-victory-option="territorial"]') as HTMLElement
    ).click();
    expect(got[got.length - 1]).toEqual({
      ruleset: "sandbox",
      eventFrequencyPermille: 0,
      victoryConditions: ["economic", "diplomatic", "technological"],
    });
    picker.remove();
  });
});

describe("guide", () => {
  it("opens once on the first OpenWars game, then on demand", async () => {
    localStorage.removeItem("openwars.guideSeen");
    // While the tutorial panel runs, the guide waits.
    new UserSettings().setTutorialDismissed(false);
    const waiting = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(waiting);
    waiting.game = game(player("me", 100, 0, NATION));
    waiting.init();
    waiting.tick();
    await waiting.updateComplete;
    expect(waiting.querySelector("[data-guide]")).toBeNull();
    waiting.remove();
    new UserSettings().setTutorialDismissed(true);
    const nav = document.createElement("command-nav") as CommandNav;
    document.body.appendChild(nav);
    nav.game = game(player("me", 100, 0, NATION));
    nav.init();
    nav.tick();
    await nav.updateComplete;
    expect(nav.querySelectorAll("[data-guide]")).toHaveLength(7);
    nav.toggle("guide");
    await nav.updateComplete;
    nav.init();
    nav.tick();
    await nav.updateComplete;
    expect(nav.querySelector("[data-guide]")).toBeNull();
    nav.toggle("guide");
    await nav.updateComplete;
    expect(nav.querySelectorAll("[data-guide]")).toHaveLength(7);
    nav.remove();
  });

  it("never opens itself in the onboarding tutorial game", () => {
    expect(guideMayAutoOpen(true, true)).toBe(false);
    expect(guideMayAutoOpen(false, false)).toBe(false);
  });
});
