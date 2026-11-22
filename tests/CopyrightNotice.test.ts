import fs from "fs";
import path from "path";

// LICENSE, "ADDITIONAL TERMS (AGPL v3 Section 7)", Copyright Preservation
// Requirement (Section 7(b)): modified versions must preserve the notice
// "© OpenFront and Contributors" in reasonably visible locations such as the
// footer and the loading screen. The game is renamed OpenWars, but this
// notice must keep naming OpenFront, verbatim, in every language.
const NOTICE = "© OpenFront and Contributors";
const ROOT = path.join(__dirname, "..");
const LANG_DIR = path.join(ROOT, "resources/lang");

describe("copyright notice (AGPL §7(b))", () => {
  test("the license still requires this exact notice", () => {
    const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
    expect(license).toContain(`"${NOTICE}"`);
  });

  const langFiles = fs
    .readdirSync(LANG_DIR)
    .filter((f) => f.endsWith(".json") && f !== "metadata.json");

  test.each(langFiles)("%s shows the exact notice", (file) => {
    const lang = JSON.parse(
      fs.readFileSync(path.join(LANG_DIR, file), "utf8"),
    ) as { main?: { copyright?: string } };
    // A language without the key falls back to English, which has it.
    if (file !== "en.json" && lang.main?.copyright === undefined) return;
    expect(lang.main?.copyright).toBe(NOTICE);
  });

  test.each([
    ["footer", "src/client/components/Footer.ts", 'data-i18n="main.copyright"'],
    [
      "loading screen",
      "src/client/GameStartingModal.ts",
      'translateText("main.copyright")',
    ],
  ])("the %s renders it", (_where, file, usage) => {
    expect(fs.readFileSync(path.join(ROOT, file), "utf8")).toContain(usage);
  });
});
