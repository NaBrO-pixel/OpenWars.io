# Armour: Tanks

Tanks are ground units built on the systems that already exist:

- You build them through `build_unit` and command them through `move_warship`.
- They travel in the `UnitUpdate` stream, like warships and aircraft.
- They are saved by the snapshot system.
- The rules are in `packages/engine-lib/src/game/TankRules.ts` and the simulation is in `packages/engine/src/execution/TankExecution.ts`.

## Building and orders

- A tank rolls out of your finished **factory** nearest to the tile you pick. Without a factory you cannot build one.
- Cost: 250k for the first, 250k more for each tank you own, capped at 1.5M.
- Health: 1,000.
- To give orders, click your tank (or shift-drag over several), then click any land tile. It drives there: one tile every 3 ticks through your own or friendly land, one every 5 ticks while breaking through.
- A tank stops where it cannot get closer: water, impassable terrain, or a nation it may not attack. Nations covered by a non-aggression pact or ceasefire, and every nation in Cold War mode, block it at the border.

## Combat

- **Breakthrough:** each hostile or unclaimed tile a tank enters becomes yours. The defender loses 50 troops per tile and the tank loses 3 health.
- **Tank duels:** every second a tank shoots the nearest hostile tank within 8 tiles for 150 damage.
- **Defence posts:** a finished hostile defence post within 12 tiles hits a tank for 80 damage per post level every second, so fortified borders stop armour.
- **From the air:** attack helicopters now count tanks among their targets.
- **Repair:** a tank repairs 10 health a second on your own land once it has been out of combat for 5 seconds.
- **Destroyed:** a tank at zero health is destroyed and explodes.

## AI

`NationArmourBehavior` runs after `NationAirBehavior` on each nation's attack tick and acts at most once per call:

1. It answers hostile tanks within 40 tiles of its structures. It sends a free tank, or buys one if it is under its cap.
2. It re-orders tanks that reached or took their objective onto the nearest valuable structure (city, factory, port, airbase, silo or SAM) of the player it is attacking with the most troops.
3. While at war, it buys tanks toward that objective, up to its cap.

**Limits on the AI:**

- At most 1, 2 or 3 tanks at a time for Medium, Hard and Impossible nations.
- A purchase needs three times the tank's cost in the treasury.
- Over the whole game, a nation buys at most one tank per two city levels.
- Easy nations and the tutorial do not use tanks.
- Like the air behaviour, it is stateless: it adds nothing to snapshots and draws nothing from the nations' random generator.

`tests/NationGoldPerMinute.test.ts` records how many aircraft and tanks the nations field in a 20-minute world game against Impossible nations. In the current baseline that is 22 aircraft and 20 tanks at the end, with 46 tanks built over the match. Building them costs the nations a few factories compared with the baseline before tanks.

## Client

- **Build menu and hotbar:** a Tank entry, greyed out without a factory.
- **Lobby:** hosts can disable tanks.
- **Map:** a top-down tank sprite in the unit atlas (column 16), drawn on the ground layer. Tanks have health bars like warships and explode when destroyed.
- **Selection:** tanks are selected and ordered like aircraft, and they take orders on land.

## Tests

- `tests/Tanks.test.ts` covers spawning at a factory, driving and re-ordering, breakthrough, stopping at the Cold War border, duels, defence posts, and snapshot round-trips. It also covers the AI's attack, defence and opt-outs, and that nations still build an air arm under the OpenWars rules.
- `FullGameSnapshot` scripts tanks in its OpenWars variant.
