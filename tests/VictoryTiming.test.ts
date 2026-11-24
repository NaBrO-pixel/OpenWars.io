// Victory pacing in a real AI game (docs/OpenWars2.md, milestone 8): a world
// game of Hard nations under the OpenWars rules. Each minute it records how
// far the leading nation is toward each victory (permille) and, once
// decided, who won how. The record is a snapshot, so a retune that moves a
// victory path out of the 10–30 minute window shows up in review.
import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import type { VictoryKind } from "@openfront/engine-lib/configuration/VictoryConfig";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { NationalEconomyExecution } from "@openfront/engine/execution/NationalEconomyExecution";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { RecomputeRailClusterExecution } from "@openfront/engine/execution/RecomputeRailClusterExecution";
import { WinCheckExecution } from "@openfront/engine/execution/WinCheckExecution";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { setup } from "./util/Setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICKS_PER_MINUTE = 600;
const MINUTES = 30;

function worldNations(): Nation[] {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "testdata/maps/world/manifest.json"),
      "utf8",
    ),
  ) as { nations: { coordinates: [number, number]; name: string }[] };
  return manifest.nations.map(
    (n) =>
      new Nation(
        new Cell(n.coordinates[0], n.coordinates[1]),
        new PlayerInfo(n.name, PlayerType.Nation, null, n.name),
      ),
  );
}

interface Row {
  minute: number;
  best: Partial<Record<VictoryKind, number>>;
  techs: number;
}

async function play(): Promise<{
  rows: Row[];
  winner: { minute: number; kind: string | undefined } | null;
}> {
  const nations = worldNations();
  const game = await setup(
    "world",
    { difficulty: Difficulty.Hard, ruleset: "openwars" },
    [],
    undefined,
    EngineConfig,
    false,
    nations,
  );
  for (const n of nations) {
    game.addExecution(new NationExecution("victory-timing", n));
  }
  game.addExecution(new RecomputeRailClusterExecution(game.railNetwork()));
  game.addExecution(new WinCheckExecution());
  game.addExecution(new NationalEconomyExecution());
  for (
    let i = 0;
    i < 100 && game.allPlayers().some((p) => !p.hasSpawned());
    i++
  ) {
    game.executeNextTick();
  }
  game.endSpawnPhase();

  const rows: Row[] = [];
  let winner: { minute: number; kind: string | undefined } | null = null;
  for (let minute = 1; minute <= MINUTES && winner === null; minute++) {
    for (let t = 0; t < TICKS_PER_MINUTE; t++) game.executeNextTick();
    const best: Partial<Record<VictoryKind, number>> = {};
    let techs = 0;
    for (const p of game.players()) {
      const n = p.nation();
      if (n === null) continue;
      techs = Math.max(techs, n.toData().techs.length);
      for (const v of n.view().victory) {
        const k = v.kind as VictoryKind;
        best[k] = Math.max(best[k] ?? 0, v.progress);
      }
    }
    rows.push({ minute, best, techs });
    const w = game.getWinner();
    if (w !== null) {
      // The condition the winner had met when the game was decided.
      const met = game
        .players()
        .flatMap((p) => p.nation()?.view().victory ?? [])
        .find((v) => v.progress >= 1000 && v.held >= v.needed);
      winner = { minute, kind: met?.kind ?? "territorial" };
    }
  }
  return { rows, winner };
}

describe("victory timing", () => {
  test(
    "world game, Hard nations, OpenWars rules",
    async () => {
      const result = await play();
      fs.writeFileSync(
        process.env.VICTORY_TIMING_OUT ?? "/dev/null",
        JSON.stringify(result),
      );
      // Decided, and inside the 10–30 minute window.
      expect(result.winner).not.toBeNull();
      expect(result.winner!.minute).toBeGreaterThanOrEqual(10);
      expect(result.winner!.minute).toBeLessThanOrEqual(30);
    },
    60 * 60 * 1000,
  );
});
