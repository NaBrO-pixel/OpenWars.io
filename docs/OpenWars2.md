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
