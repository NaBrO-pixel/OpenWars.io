import fs from "fs";
import path from "path";
import {
  buildPublicAssetManifest,
  PROPRIETARY_ASSETS_IN_USE,
} from "../src/server/PublicAssetManifest";

// proprietary/ is © OpenFront Inc. and may only ship as part of OpenFront.
// OpenWars replaces those assets with its own (resources/), so nothing that
// ships may refer to a file that exists only in proprietary/.
const ROOT = path.join(__dirname, "..");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}

const proprietaryOnly = files(path.join(ROOT, "proprietary"))
  .map((f) => path.relative(path.join(ROOT, "proprietary"), f))
  .filter((rel) => rel !== "LICENSE" && !PROPRIETARY_ASSETS_IN_USE.has(rel))
  .filter((rel) => !fs.existsSync(path.join(ROOT, "resources", rel)));

const sources = [
  ...files(path.join(ROOT, "src")),
  ...files(path.join(ROOT, "packages")).filter(
    (f) => !f.includes("node_modules"),
  ),
  path.join(ROOT, "index.html"),
  path.join(ROOT, "vite.config.ts"),
].filter((f) => /\.(ts|html|css|json)$/.test(f));

describe("proprietary OpenFront assets", () => {
  test.each(proprietaryOnly)("%s is not referenced", (rel) => {
    const users = sources.filter((f) =>
      fs.readFileSync(f, "utf8").includes(rel),
    );
    expect(users.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  test("a build publishes only the allowlisted proprietary files", () => {
    const manifest = buildPublicAssetManifest([path.join(ROOT, "proprietary")]);
    expect(Object.keys(manifest).sort()).toEqual(
      [...PROPRIETARY_ASSETS_IN_USE].sort(),
    );
  });
});
