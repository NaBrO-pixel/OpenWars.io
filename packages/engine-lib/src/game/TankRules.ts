// Armour update: tank rules shared by the engine and the client
// (docs/Armour.md). Integer constants only; the simulation is in
// packages/engine/src/execution/TankExecution.ts.

/** Ticks per tile driven through friendly or own land. */
export const TANK_MOVE_TICKS = 3;
/** Ticks per tile while breaking through hostile or unclaimed land. */
export const TANK_ASSAULT_TICKS = 5;
/** Health a tank loses for each tile it captures. */
export const TANK_CAPTURE_WEAR = 3;
/** Troops the defender loses for each of its tiles a tank captures. */
export const TANK_CAPTURE_TROOP_LOSS = 50;
/** Ticks between a tank's shots. */
export const TANK_FIRE_TICKS = 10;
/** Range (tiles) of a tank's gun against other tanks. */
export const TANK_GUN_RANGE = 8;
/** Damage of one tank round. */
export const TANK_GUN_DAMAGE = 150;
/** Range (tiles) of a defence post against tanks. */
export const DEFENCE_POST_ANTI_TANK_RANGE = 12;
/** Damage a finished defence post deals a tank per level, per volley. */
export const DEFENCE_POST_ANTI_TANK_DAMAGE = 80;
/** Ticks out of combat, on its own land, before a tank starts repairing. */
export const TANK_REPAIR_DELAY = 50;
/** Health repaired per volley interval on its own land. */
export const TANK_REPAIR = 10;

/** The 8 neighbour offsets, in a fixed order (determinism on ties). */
export const TANK_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
