# OpenWars 2.0: repository audit and implementation plan

Milestone 0 of the OpenWars 2.0 specification. It records how the game works
today, which systems 2.0 builds on, where the specification and the existing
architecture differ, and the plan for milestones 1 to 8. No game code was
changed for this milestone.

## 1. Architecture map

| Area                 | Where                                                                                                  | Notes                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simulation (engine)  | `packages/engine` (+ `engine-lib`, `engine-api`)                                                       | Deterministic TypeScript, no dependencies but zod. Runs in a Web Worker in every client. 10 ticks/s.                                                                    |
| Game state           | `packages/engine/src/game/GameImpl.ts`, `PlayerImpl.ts`, `UnitImpl.ts`                                 | Players own **tiles** (map pixels), not named provinces.                                                                                                                |
| Rules / balance      | `packages/engine-lib/src/configuration/Config.ts`                                                      | One `Config` class: gold rate, troop growth, unit costs, win percentage. Shared by engine and client (`PlayerLike`).                                                    |
| Player actions       | Intents, `packages/engine-api/src/Schemas.ts` (zod) → one `Execution` each (`engine/src/execution`)    | 27 intent types (attack, build_unit, upgrade_structure, allianceRequest, embargo, donate_gold, …).                                                                      |
| Per-tick systems     | Executions: `PlayerExecution` (income, troop growth), `WinCheckExecution`, `NationExecution` (AI)      | `ExecutionManager` runs them every tick.                                                                                                                                |
| Client view          | `GameUpdates` (`engine-api/src/game/GameUpdates.ts`) → `src/client/view/GameView.ts`                   | Engine emits diffed updates (`PlayerUpdate` fields only when changed).                                                                                                  |
| Multiplayer          | `src/server/GameServer.ts`, `Worker.ts`, `Master.ts`                                                   | **Lockstep**: the server collects intents into turns and relays them; it does not run the simulation. Per-turn state hashes (`HashUpdate`) detect clients that diverge. |
| Wire format          | `packages/shared/src/WireSchemas.ts`, `ZbinWire.ts`                                                    | Binary zod encoding (zbin); field order is the layout.                                                                                                                  |
| Action authorisation | `src/server/IntentAuthorization.ts` + each Execution's own checks                                      | The server checks who may send an intent; the engine rejects invalid ones identically on every client.                                                                  |
| Reconnect            | `src/server/Rejoin.ts`, `GameServer.rejoinClient`                                                      | A rejoining client receives the turns since `lastTurn` and replays them; the state it rebuilds is exact because the engine is deterministic.                            |
| Save / resume        | `packages/engine/src/snapshot` (versioned records)                                                     | Whole-simulation snapshots; every stored class has a versioned snapshot type.                                                                                           |
| Rendering            | `src/client/render` (custom WebGL2), `src/client/hud/layers` (Lit components)                          | Territory, borders, units, railroads, overlays (radar rings from the AIR update).                                                                                       |
| UI                   | Lit + Tailwind 4, `src/client/styles.css`; i18n via `translateText` + `resources/lang/en.json`         | HUD: `ControlPanel`, `GameLeftSidebar`, `GameRightSidebar`, `EventsDisplay`, `PlayerPanel`, `WinModal`, …                                                               |
| Game modes           | `GameType` (Singleplayer/Public/Private) × `GameMode` (FFA/Team) × `RankedType`; HvN via `playerTeams` | Public rotation in `src/server/MapPlaylist.ts`.                                                                                                                         |
| Accounts             | `src/accounts` (OpenWars' own service)                                                                 | Sign-in, XP. Not part of the simulation.                                                                                                                                |
| Build / CI           | Vite; `npm run build-prod`; `.github/workflows/ci.yml` (typecheck, build, tests in 3 shards, lint)     | Deploy: `Dockerfile`, `deploy/docker-compose.yml`.                                                                                                                      |
| Tests                | Vitest, ~780 files / ~11,900 tests; `tests/util/Setup.ts` builds real games                            | Engine changes must come with tests (CLAUDE.md).                                                                                                                        |

### Existing systems 2.0 reuses

| 2.0 system      | Existing base                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money           | Gold: worker income (`Config.goldAdditionRate`), trade ships, trains, donations                                                                                             |
| Population      | Troops and `maxTroops` (from tiles and cities)                                                                                                                              |
| Infrastructure  | Structures with levels (`upgrade_structure`): City, Factory, Port, Defense Post; railroads and train stations (`RailNetwork`) ; construction time (`ConstructionExecution`) |
| Diplomacy       | Alliances (request, accept, reject, break, extend, expiry), traitor penalty, embargoes, gold/troop donations                                                                |
| Victory         | `WinCheckExecution` (territory share, team share, time limit)                                                                                                               |
| Events / alerts | `DisplayEvent` updates, `EventsDisplay`                                                                                                                                     |
| Onboarding      | `docs/OnboardingTutorial.md`, `Tutorial.ts`, `OnboardingOverlay`                                                                                                            |

## 2. Baseline (before any 2.0 change, commit `5df87a0`)

- `npm run typecheck`: clean. `npm run lint`: clean.
- Production build: succeeds (built inside the Docker image).
- `npx vitest --run`: 11,919 passed, 1 skipped, **2 failing**, both before
  2.0 and unrelated to it:
  - `tests/perf/client/ClientRenderPipelinePerf.test.ts`: needs WebGL globals
    that this sandbox lacks (`WebGLTexture is not defined`).
  - `tests/client/graphics/layers/WinModalProvisionalXp.test.ts` ("shows the
    server's figure alone…"): fails on `main` without any 2.0 change.

## 3. Where the specification and the architecture differ

### 3.1 "Authoritative server" → authoritative deterministic simulation

The specification asks the server to compute economy, research, diplomacy and
victory. In OpenWars the server never runs the game: every client runs the
same deterministic simulation on the same turns. Moving gameplay to the server
would mean replacing the multiplayer architecture, which the specification
also forbids (§2.2).

**Approach:** every 2.0 system lives in the engine. Players act only through
intents. The server checks the sender (`IntentAuthorization`), and the engine
validates each intent identically on every client: costs, prerequisites,
permissions, duplicates. A client that edits its own state diverges from
everyone else's hash, and the existing desync detection flags it. That gives
the guarantees §13 asks for, with no client able to decide an outcome alone.
Reconnection is exact for every new system for free, because a rejoining
client replays the turns.

### 3.2 Territories are tiles, not named regions

The map is ownership per pixel. There are no provinces with names,
population or infrastructure slots. Inventing provinces would mean new map
data for 148 maps.

**Approach:** "territory" in 2.0 means a **development site**: a structure on
a tile (the existing structure system, extended). Infrastructure is built on
your land like cities are today, with levels 0–3, costs, build time and
effects, and overlays show it. The right-hand panel shows the selected
structure, or the owner's national figures for a bare tile. Economic value
comes from national totals (tiles, population, structures), not per-province
numbers.

### 3.3 Intelligence cannot be secret in lockstep

Every client holds the whole game state, so information can't be hidden
securely: a modified client can read everything.

**Approach:** intelligence confidence is a gameplay rule applied in the UI.
Without intelligence on a country, players see ranges ("~1.2k–1.8k troops")
rather than numbers. Levels come from research, agreements and proximity. The
rules are computed in the engine, so they are the same for everyone. This is
documented as fair-play information design, not anti-cheat.

### 3.4 Compatibility with existing games and replays

Records and replays of earlier games must still play back exactly. **All 2.0
systems are gated by a new game-config field** (the mode preset). With it off,
the simulation is byte-for-byte today's; existing tests and replays keep
passing. New intents are additive schema members; clients and servers are
always the same build (the commit check), so no wire migration is needed.

## 4. Technical risks

| Risk                                                           | Mitigation                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Desyncs from new engine code                                   | Integers and DetMath only; existing hash checks; a determinism test per system (two runs, identical hashes)   |
| Per-tick cost on 400-bot maps                                  | Economy, research and events run on intervals (every 10 ticks or slower), O(players), never per tile per tick |
| Snapshot format                                                | New per-player state goes into versioned snapshot records with migrations                                     |
| zbin wire layout                                               | New fields appended at the end of schemas only                                                                |
| Nation AI ignores new systems                                  | Teach `NationExecution` to research, build and accept agreements (milestones 3–4), or nations fall behind     |
| UI scope (milestone 1) touches many components with many tests | Redesign component by component behind the existing component boundaries                                      |

## 5. Plan

Each milestone goes on its own branch, is tested, and is merged to `main`
only when its tests, typecheck and production build pass.

| #   | Milestone              | Main work                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Visual redesign        | Design tokens from §3.2 in `styles.css`; new top resource bar; collapsible left navigation (panels fill in as systems land); right contextual panel; bottom activity feed (restyled `EventsDisplay`); responsive breakpoints for tablet and Chromebook                                                                                                                     |
| 2   | Economy                | `engine-lib/configuration/EconomyConfig.ts` (all balance values); per-player industry, research points and stability in `PlayerImpl`; an economy step in `PlayerExecution` (tax from population, upkeep from tiles and army, stability from expansion and growth); diffed `PlayerUpdate` fields; snapshot records; economy panel with income/expense breakdown and history |
| 3   | Infrastructure         | Four types (Road hub, Rail hub reusing the rail network, Industrial centre extending Factory, new Research centre), levels 0–3 via `upgrade_structure`; costs in money and industry; build time via `ConstructionExecution`; cancel intent; effects on economy and connectivity; overlay                                                                                   |
| 4   | Research and diplomacy | Tech tree data (3 branches × 5) in config; `start_research` / `cancel_research` intents; effects as modifiers read by Config. Diplomacy: agreement types (non-aggression, trade, ceasefire, intel sharing) generalising the alliance request flow; reputation replacing the traitor flag's one-off penalty; diplomacy panel                                                |
| 5   | Intelligence, events   | Confidence levels and estimate ranges computed in the engine; reports and territorial history. Event catalogue in config (6 events), seeded deterministic scheduling with warnings, effects as timed modifiers; event panel and history                                                                                                                                    |
| 6   | Military, victory      | Supply efficiency from connectivity to the capital and infrastructure; defence bonus from development; mobilisation slider (army upkeep); `WinCheckExecution` refactored into pluggable victory conditions (territorial, economic, diplomatic, technological) with hold periods so temporary states don't win                                                              |
| 7   | Game modes             | World Conquest (default), Cold War (no conquest victory, other paths emphasised), Sandbox (validated settings only), as presets over shared systems; lobby UI                                                                                                                                                                                                              |
| 8   | Release                | Multiplayer and reconnect tests per mode, balance simulations (bot-vs-bot runs checking every victory path is reachable in 10–30 minutes), performance pass, onboarding update, release notes                                                                                                                                                                              |

### Multiplayer test strategy

- Engine tests run real games (`tests/util/Setup.ts`); determinism tests run
  the same turns twice and compare hashes.
- Invalid-intent tests: insufficient funds, missing prerequisites, acting for
  another player, duplicate construction — the engine must reject each one.
- Browser tests: two clients in one public lobby against the dev server
  (method used for the accounts work), checking both see the same resources,
  agreements and victory.
- Reconnect: a client drops mid-game and rejoins; its view must match.

## 6. Milestone log

### Milestone 1: visual redesign (first pass)

- Design tokens `--color-ow-*` (the §3.2 palette) in `src/client/styles.css`.
  Tailwind's gray, slate, zinc and neutral scales are remapped onto it, and
  the accent moves to `#39BDE8`, so every existing surface (home page,
  modals, HUD) takes the OpenWars look without touching each component.
- Inter is bundled (`resources/fonts/Inter-*.woff2`, OFL) and is the UI font.
- `<command-bar>` (`hud/layers/CommandBar.ts`): the top resource bar. Money,
  measured income per second, population, territory share, match clock. From
  tablet width up; phones keep the bottom panel's figures.
- `<command-nav>` (`hud/layers/CommandNav.ts`): the collapsible left
  navigation, with a section registry (`COMMAND_SECTIONS`). Working sections:
  country overview, statistics. Economy, infrastructure, research,
  diplomacy and intelligence are added by their milestones; no section is
  listed before its system exists.
- `hud/NationalSummary.ts`: the figures both read, in one place.

Deferred to the milestone that gives them content: the right contextual
territory panel (milestone 3, infrastructure), map overlays (milestones 3 and
5), the activity feed's event and research entries (milestones 4 and 5).

### Milestone 2: national economy

- `GameConfig.ruleset: "openwars"` turns the OpenWars systems on. New solo,
  hosted and public games set it (`SinglePlayerModal`, `GameManager`,
  `MapPlaylist`); without it the simulation is exactly the classic one.
- All balance values: `packages/engine-lib/src/configuration/EconomyConfig.ts`.
- `packages/engine/src/game/NationState.ts`: the economy rules
  (`economyStep`, pure and unit-tested) and each nation's state: industry and
  research stockpiles, stability (permille, moving toward a target), the last
  step's income and expenses, and a net-income history.
- `NationalEconomyExecution`, once a second for every nation (not tribes):
  tax on population scaled by stability, industry income, territory upkeep
  beyond a free heartland, structure upkeep. Stability's target rises with
  development and falls with fast growth (measured against at least the
  heartland, so opening expansion is not punished) and with debts the
  treasury can't cover.
- Synchronisation: the economy is part of the deterministic simulation, so
  every client computes it identically (desyncs are caught by the existing
  hashes); it reaches the UI as `PlayerUpdate.nation`, a new object only
  when the figures change. Snapshots: `Player` v3 (migration from v2).
  Reconnecting clients replay turns, so their economy is exact.
- UI: the bar adds industry, research and stability; net income subtracts
  the economy's expenses; an Economy panel explains every income and expense
  line and shows stability against its target and a net-income trend.
- Tests: `tests/core/executions/NationalEconomy.test.ts` (rules, a running
  game, update diffing, snapshot continuation), the full-game snapshot test's
  new `openwars` variant, `CommandInterface.test.ts`.

No player action is added in this milestone, so there is nothing new to
validate: the economy runs by itself. Spending industry and research comes
with infrastructure (milestone 3) and research (milestone 4).

### Milestone 3: infrastructure

- Each city is a development site with four tracks, levels 0–3: roads,
  railways, industrial centre, research centre. Infrastructure belongs to the
  city: a captured city keeps it for its new owner; a destroyed one loses it.
- Projects cost money (quadratic in level) and industry, take time (once a
  second, in the economy step), show progress, and can be cancelled (all
  industry and 75% of money back). At most 3 at once; railways need roads of
  the same level. Infinite-gold games pay no money (as for units).
- Effects (EconomyConfig.infrastructure): industrial centres add industry,
  research centres add research, roads cut territory upkeep, railways raise
  the money industry earns, and every level counts as development
  (stability).
- Engine: `game/Infrastructure.ts` (InfrastructureMap on GameImpl; Game
  snapshot v2), `InfrastructureExecution` for the new `infrastructure`
  intent (start/cancel), appended last to the intent union. Costs and the
  start checks are shared with the client
  (`engine-lib/configuration/InfrastructureRules.ts`); the engine's check is
  the one that decides, identically on every client.
- AI nations develop their cities every 15 s, keeping a money reserve.
- UI: Infrastructure panel (sites, levels, costs, effects, progress,
  cancel, locate, refusal reasons), `<infrastructure-overlay>` map badges,
  completion notices in the events feed (`MessageType.NATIONAL_DEVELOPMENT`).
- Tests: `tests/core/executions/Infrastructure.test.ts` (costs, building,
  effects, refunds, every refusal, capture, snapshot continuation, AI),
  scripted-game coverage in the full-game snapshot test, client panel tests.
  Checked end to end in a browser: a project started from the panel finished
  and showed in the overlay and the events feed.

Not done here: a right-hand contextual panel for a clicked tile. Sites are
reached through the Infrastructure panel (with Locate); the contextual panel
is folded into milestone 8's interface pass.

### Milestone 4: research and diplomacy

Research:

- `engine-lib/configuration/TechConfig.ts`: three branches (industry,
  technology, society) of five technologies, basic to advanced, each a
  chain. Every technology has a real effect (`techModifiers`): industry or
  research output, tax, industry money, territory upkeep, infrastructure
  industry cost, extra projects, research-centre output, stability target,
  softer growth and deficit penalties.
- `research` intent (start/cancel; `ResearchExecution`): one at a time,
  paid in research points and money up front, takes time, 75% refund on
  cancel. Progress and completed technologies live in `NationState`
  (Player snapshot v4); completions are announced; AI nations research.
- Research panel: the tree with locked / available / researching /
  completed states, costs, durations, prerequisites, effects and progress.

Diplomacy:

- Built on the existing alliances (request, accept, reject, break,
  extension, expiry), which stay as they are and are reachable from the new
  panel too.
- `game/Diplomacy.ts` (`DiplomacyMap` on GameImpl, Game snapshot v3):
  agreements between two nations — non-aggression pacts, trade agreements,
  ceasefires (only between nations at war), intelligence sharing (only
  between allies) — each proposed, then accepted or rejected, timed, and
  breakable. Simultaneous proposals agree. Expired, lapsed or orphaned
  (eliminated party) agreements and proposals are cleared every second.
- Effects: pacts and ceasefires block attacks both ways (in
  `canAttackPlayer`, which every attack path checks) and turn attacks under
  way into retreats; trade agreements raise both sides' tax and industry
  money; alliances raise research; intelligence sharing shows the partner's
  exact money and stability in the diplomacy panel.
- Reputation 0–100: breaking an agreement or betraying an alliance costs
  reputation; it recovers by 1 every 10 s. AI nations accept proposals from
  nations of reputation 50 or more and refuse the rest.
- `diplomacy` intent (propose/accept/reject/break; `DiplomacyExecution`):
  the sender is always the one acting, and every rule runs in the engine on
  every client, so no client can sign or break for another.
- Diplomacy panel: reputation, proposals to you, every country with its
  relationship (allied, friendly, neutral, hostile), reputation, agreements
  with time left and break buttons, and the proposals available.
- Tests: `tests/core/executions/Research.test.ts`, `Diplomacy.test.ts`
  (acceptance, rejection, simultaneous proposals, expiry, prerequisites,
  blocking attacks, ceasefire retreats, reputation loss and recovery, AI
  answers, economic effects, snapshots), scripted-game coverage, panel
  tests. Checked over real multiplayer: one browser proposed a trade
  agreement from the panel, another accepted it from theirs, and both
  clients then held the same agreement with the same expiry.

### Milestone 5: intelligence and world events

World events:

- `engine-lib/configuration/EventConfig.ts`: the catalogue (global
  recession, industrial boom, trade disruption, political instability,
  technological breakthrough, natural disaster). Each has an id, scope
  (world or one nation), trigger conditions (earliest minute, fewest
  nations), weight, warning time, duration and effects. Adding an event is
  adding an entry.
- `game/WorldEvents.ts` (on GameImpl, Game snapshot v4): the first event
  after 3 minutes, then one every 150–240 s, at most two at once, never the
  same twice at once. Choices hash the tick, so there is no random state and
  every client draws the same events. Most are announced before they start;
  start and end are announced too.
- Effects are temporary economy modifiers (tax, industry, industry money,
  research, stability target, suspended trade bonuses); the natural disaster
  also takes 20% of the nation's industry stockpile. Nothing destroys land or
  units, so no event can eliminate a nation.
- World events panel: current and upcoming events (phase, time left, who is
  affected, effects) and the history.

Intelligence:

- `engine-lib/configuration/IntelRules.ts`: confidence per pair of nations
  — unknown, limited (neighbours, agreement partners), estimated (allies),
  detailed (intelligence sharing) — plus levels from research (Information
  Systems and Advanced Computing now add one each). Figures are shown as
  nothing, an order of magnitude, a ±20–25% range that always contains the
  true value, or exactly. Territory share is always exact: it is on the map.
- Neighbours come from the engine (`NationView.neighbours`).
- Intelligence panel: country selection, confidence with its reason,
  strength, economy and diplomacy at that confidence, territory history and
  dated reports (expansion, losses, and military build-up alerts at
  estimated confidence or better).
- As planned in §3.3: every client holds the whole state (lockstep), so this
  is fair-play information design, not secrecy against modified clients.

Tests: `WorldEvents.test.ts` (catalogue, effects, warnings before effects,
history, concurrency, fairness, determinism across runs, snapshot
continuation), `IntelRules.test.ts`, panel tests.

### Milestone 6: military and victory conditions

- `engine-lib/configuration/MilitaryConfig.ts`:
  - Mobilisation (peacetime, standard, mobilised, total war) scales troop
    growth (60%–160%), costs army upkeep per 1,000 troops, and lowers
    stability at the higher levels. It is set with the new `mobilise` intent
    (`MobiliseExecution`).
  - Supply efficiency (50–100%) comes from roads and railways relative to
    territory size: poorly supplied attackers lose up to 50% more troops.
  - Defensive development: infrastructure levels raise attackers' losses
    against the nation (capped at +25%).
- Combat: `attackLogic` takes the attacker's supply and the defender's
  defence as optional inputs (OpenWars games only). Both are saved in
  snapshots, so restored games fight identically.
- Victory (`game/Victory.ts`): a list of conditions, each giving progress
  (permille) and how long it must hold.
  - Territorial: the classic win check, listed for progress.
  - Economic: 40% of the world's net income, held for 90 s.
  - Diplomatic: alliances or agreements with 60% of nations and reputation
    70+, held for 90 s.
  - Technological: all three advanced specialisations.
    The economic and diplomatic holds reset when the condition lapses, so a
    passing spike can't win. A team game goes to the winner's team. Adding a
    condition is adding an entry; `setWinner` gains an optional victory type,
    carried on the Win update and shown on the end screen.
- UI:
  - Military panel: mobilisation control, forces, expenditure, supply,
    defence, and fronts (attacks in and out).
  - Victory progress in Statistics.
- Tests: `tests/core/executions/MilitaryAndVictory.test.ts` (upkeep,
  growth, supply, combat factors, each victory path, holds, team wins,
  snapshot continuation). The full-game snapshot test now checks execution
  coverage across all its variants together.

### Milestone 7: game modes

- `GameConfig.ruleset` now takes `"openwars"` (World Conquest, the default
  for new games), `"coldwar"` and `"sandbox"`; all three run every OpenWars
  system. Two match settings join it: `eventFrequencyPermille` and
  `victoryConditions`.
- World Conquest: everything on; win by territory, economy, diplomacy or
  technology.
- Cold War: nations can't attack each other (in `canAttackPlayer`, so every
  attack path respects it); tribes' land can still be taken. No territorial
  victory; the other three decide the match.
- Sandbox: choose world-event frequency (off, rare, normal, frequent) and
  which victory conditions count. Everything else (starting gold, map,
  nations, timers…) uses the existing lobby settings. Game speed is not
  offered: the simulation has no speed setting, and only implemented
  settings are exposed.
- `Config.isColdWar / eventFrequencyPermille / victoryEnabled`;
  `WinCheckExecution.hasWon` and the victory evaluator respect the enabled
  list.
- `<openwars-mode-picker>` in the solo and host-lobby dialogs. Every mode
  sends its settings in full, so switching mode in a hosted lobby (partial
  config patches) never keeps another mode's settings. Public lobbies stay
  World Conquest.
- Tests: `tests/core/executions/GameModes.test.ts` (Cold War attacks and
  victories, Sandbox event and victory settings, classic games unchanged),
  picker tests. Checked in a browser: picking Cold War in the solo dialog
  starts a Cold War game.

## Milestone 8 — testing and release preparation

- **Onboarding:** a "How OpenWars works" guide (`GuidePanel.ts`) covers the map, territory, resources, development, research, diplomacy and winning. It opens once on a player's first OpenWars game and can be reopened any time from the `?` button in the command nav. Tested in `CommandInterface.test.ts`.
- **Multiplayer:** all 2.0 state is in the deterministic engine and in snapshots, so reconnecting clients restore it. `FullGameSnapshot` and each system's snapshot round-trip test check this. Diplomacy was verified end to end with two real clients.
- **Balance:** `VictoryBalance.test.ts` checks pacing from the configs, and `VictoryTiming.test.ts` plays a 30-minute world game of Hard nations under the OpenWars rules. Each minute it records how close the leading nation is to each victory, and it requires a winner between minutes 10 and 30.
  - **First run:** a nation researched every technology and won by research at minute 18. The other paths were below 30%.
  - **Retune:** technologies take longer to research (tiers 1–5: 40/60/90/120/150 s), the economic victory needs 30% of world income (was 40%), and the diplomatic victory needs agreements with 40% of the other nations (was 60%).
  - **Now:** research decides AI-only games at minute 25. AI nations don't deliberately chase economic or diplomatic dominance, so those paths, and territory, are for players who pursue them; in the simulation they reach 25–50% by then.
- **Still open:** the contextual territory panel and responsive polish for small screens.

### Release checklist

1. `npm test`. Known failures: `ClientRenderPipelinePerf`, which needs WebGL, and `WinModalProvisionalXp`. Both failed before 2.0.
2. `npm run typecheck`, `npm run lint`, `npm run build-prod` (run the build after tests: `RenderHtml.test.ts` fails against local build output).
3. Play one solo game in each mode: World Conquest, Cold War and Sandbox.
4. Deploy with `deploy/` as described in `docs/SelfHosting.md`.

## Armour update

Tanks are ground units that roll out of factories, break through hostile land, duel other tanks and are stopped by defence posts. Nations use them against the player they are at war with. See `docs/Armour.md`.

## Diplomacy pacing and AI trade

- **Influence grows with time.** A nation may hold agreements other than ceasefires with at most 2% of the other nations per minute of play, and always with at least one (`DiplomacyConfig.influencePerMinutePermille`, `influenceCap`). The 40% the diplomatic victory needs takes about twenty minutes whatever the size of the game. Before this, AI nations accepted every proposal from a nation in good standing, so a player could win diplomatically within a few minutes.
  - **What's limited:** new partners only. More agreements with an existing partner, and ceasefires, are always allowed.
  - **Where the limit is checked:** when a deal is proposed and again when it is accepted.
  - **In the Diplomacy panel:** it shows influence as partners against the limit, and hides offers to new partners once the limit is reached.
- **AI nations offer trade.** Every 30 seconds (staggered by nation), each AI nation offers a trade agreement to the first neighbour it is on neutral or better terms with, isn't at war with, and may still sign with.
- **Simulation:** in the 30-minute AI world game, the diplomatic path now passes its threshold at minute 22 and research wins at minute 25. Economic dominance reaches 43%.

## Victory thresholds scale with the game

- **Economic:** a nation needs twice its fair share of world income, and never less than 30% (`economicShareNeeded`). That's 67% in a game of three, 50% in a game of four, and 30% from seven nations up. Before this, in a game of three the average share (33%) was already above the threshold.
- **Diplomatic:** a nation needs agreements or alliances with 40% of the other nations, and never fewer than two (`diplomaticPartnersNeeded`). Before this, a single trade deal won a game of three.
- **Influence in small games:** the limit also grows by one partner every 8 minutes, so small games can reach two partners from minute 8.
- **Statistics panel:** victory descriptions show the real numbers for the current game, computed by the same functions the engine uses.

## Futuristic blue look

The UI is restyled as a futuristic blue HUD. It's built on the shared tokens, so most screens change without per-component edits.

- **Palette (`styles.css`):** deep-space navy surfaces, an electric blue-cyan accent (`#38c6ff`), and blue-tinted greys. Tailwind's gray, slate, zinc and neutral scales are remapped onto it.
- **Display font:** Orbitron (SIL OFL, `resources/fonts/Orbitron-OFL.txt`, variable weight 400-900) replaces Bungee. It's used for titles, buttons and the command bar's figures; other scripts fall back to Inter.
- **Glass panels:**
  - `.ow-glass` is a translucent navy gradient with a thin cyan edge, a soft blue glow and corner brackets. The command bar and command nav use it, and in-game HUD panels (`bg-gray-800/92`) and the graphics panel get the same surface.
  - Modals use `.ow-glass-modal`.
  - The opacity of all of these follows the HUD opacity setting.
- **Buttons:** primary buttons are a blue-to-cyan gradient with a glow, secondary buttons are glass with a cyan edge, and the home Tutorial button is outlined neon instead of yellow.
- **Backdrop:** a faint holographic grid under a blue glow, with slow scanlines (`.ow-backdrop`, `.ow-scanlines`). The scanlines stand still for players who ask for reduced motion.
- **Not changed:** the map renderer (territory colours, terrain).

## Attack panel, smoother money, bomber stand-down

- **Attack panel:** a command-nav section and the `focus_forces` intent (`FocusForcesExecution`).
  - **Attack:** pick an enemy you can attack. Every tank drives at its structures, every bomber strikes one, and every fighter and attack helicopter takes station over one. Units are spread across the structures. Transport helicopters are left alone.
  - **Focus:** the chosen enemy is kept on the nation, so AA guns, fighters, attack helicopters and tanks engage its units first (`focusRank`).
  - **Recall all:** tanks drive to the nearest factory and aircraft stand down at the nearest airbase.
  - **Refused:** against allies, nations under a pact or ceasefire, in Cold War, and against enemies with no structures. The panel shows each reason.
- **Money flow:** each economy step's net change (tax and industry money less upkeep) is now paid out evenly over the next 10 ticks instead of in one lump. On Total War, upkeep used to make the treasury rise every tick and then drop once a second, so a structure that looked affordable couldn't be paid for. The amount still to pay out is part of the nation's snapshot and desync hash.
- **Bombers:** a bomber whose aim point has no hostile structure in reach (none there, or destroyed or taken meanwhile) now flies home and stays docked instead of circling.
- **HUD fix:** the command nav and infrastructure overlay elements had been placed inside the top HUD grid. They took grid cells and pushed the speed/pause/settings/leave bar onto a second row, which moved whenever the hovered-country card grew. They now sit outside the grid.

## Military research branch and new world events

- **Military research branch:** a fourth branch, with each technology requiring the one before it. It doesn't count toward the technological victory (`VICTORY_BRANCHES`), so that victory's pacing is unchanged. AI nations research it only after the other branches.
  1. Combined Arms: +25% tank gun damage.
  2. Composite Armour: −30% damage to tanks.
  3. Flak Directors: +1 shell per AA gun volley.
  4. Precision Bombing: bomber strikes knock structures down one more level.
  5. War Economy: −35% army upkeep and −50% unrest from mobilisation.
- **New world events:**
  - Arms race (global, from minute 8): +20% industry, −4% stability target.
  - Scientific summit (global, from minute 6): +40% research.
  - Bumper harvest (one nation): +25% tax, +6% stability target.
  - Cyber attack (one nation, from minute 7): −50% research, −15% money from industry.

## Phones held sideways

On screens no taller than 520px (the `short:` variant), the command nav sits below the resource bar and scrolls instead of running off the screen. The resource bar is compact: one line per figure, small labels, so it clears the leaderboard buttons and the speed/pause bar.
