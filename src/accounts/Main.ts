// Starts the OpenWars accounts service: `npm run start:accounts`.
import path from "node:path";
import { createApp } from "./App";
import { configFromEnv } from "./Config";
import { AccountsDb } from "./Database";
import { Tokens } from "./Tokens";

async function main() {
  const config = configFromEnv();
  const db = new AccountsDb(path.join(config.dataDir, "accounts.sqlite"));
  const tokens = await Tokens.load(
    config.dataDir,
    config.issuer,
    config.audience,
  );
  const app = createApp({ config, db, tokens });
  app.listen(config.port, () => {
    console.log(
      `[accounts] listening on :${config.port} as ${config.issuer}` +
        ` (Discord ${config.discord ? "on" : "off"}, Google ${config.google ? "on" : "off"})`,
    );
  });
}

main().catch((e) => {
  console.error("[accounts] failed to start:", e);
  process.exit(1);
});
