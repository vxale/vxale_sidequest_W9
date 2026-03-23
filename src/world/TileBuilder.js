// src/world/TileBuilder.js
// Tile + static group construction (WORLD helper).
//
// Responsibilities:
// - Create static groups for tile characters (g/d/L/R/[ ])
// - Create collectable/danger groups (leaf/fire)
// - Create boar group placeholder BEFORE Tiles() so 'b' spawns into it
// - Spawn everything from the level.tilemap via new Tiles(...)
// - Apply collider/sensor settings for leaf + fire
//
// Non-goals:
// - Does NOT control camera, parallax, or HUD
// - Does NOT implement boar AI (BoarSystem does)

// ---------------------------------------------------------------------------
// TILEMAP KEY (legend):
//   g = ground
//   d = deep ground
//   L = platform left cap
//   R = platform right cap
//   [ = platform left end
//   ] = platform right end
//   x = leaf (collectible)
//   f = fire (hazard)
//   b = boar (enemy)
//   s = player start (not a tile, just sets spawn)
//   (space) = empty
// ---------------------------------------------------------------------------

import { buildBoarGroup } from "./BoarSystem.js";

export function buildTilesAndGroups(level) {
  // ---------------------------------------------------------------------------
  // 1) Validate the data contract from levels.json
  // ---------------------------------------------------------------------------

  const tilemap = level.levelData?.tilemap;
  if (!Array.isArray(tilemap) || tilemap.length === 0) {
    throw new Error(
      `[TileBuilder] level.levelData.tilemap is missing or empty.`,
    );
  }

  const tiles = level.levelData?.tiles;
  if (!tiles || typeof tiles !== "object") {
    throw new Error(
      `[TileBuilder] levels.json is missing level.tiles { tileW, tileH, frameW, frameH }.`,
    );
  }

  const tileW = Number(tiles.tileW);
  const tileH = Number(tiles.tileH);

  if (!Number.isFinite(tileW) || tileW <= 0) {
    throw new Error(
      `[TileBuilder] Invalid tiles.tileW in levels.json: ${tiles.tileW}`,
    );
  }
  if (!Number.isFinite(tileH) || tileH <= 0) {
    throw new Error(
      `[TileBuilder] Invalid tiles.tileH in levels.json: ${tiles.tileH}`,
    );
  }

  // Save for anyone who wants them later (debug/UI/etc.)
  level._tileW = tileW;
  level._tileH = tileH;

  // ---------------------------------------------------------------------------
  // 2) Build groups (IMPORTANT: set w/h on groups BEFORE new Tiles(...))
  // ---------------------------------------------------------------------------

  // --- boar group (spawn from 'b') ---
  // Must exist BEFORE Tiles() runs so 'b' characters spawn into this group.
  buildBoarGroup(level);

  // --- leaf group (spawn from 'x') ---
  level.leaf = new Group();
  level.leaf.physics = "static";
  level.leaf.spriteSheet = level.assets.leafImg;
  level.leaf.addAnis({ idle: { w: 32, h: 32, row: 0, frames: 5 } });
  level.leaf.w = 10;
  level.leaf.h = 6;
  level.leaf.anis.offset.x = 2;
  level.leaf.anis.offset.y = -4;
  level.leaf.tile = "x";

  // --- fire group (spawn from 'f') ---
  level.fire = new Group();
  level.fire.physics = "static";
  level.fire.spriteSheet = level.assets.fireImg;
  level.fire.addAnis({ burn: { w: 32, h: 32, row: 0, frames: 16 } });
  level.fire.w = 18;
  level.fire.h = 16;
  level.fire.tile = "f";

  // --- ground tile (g) ---
  level.ground = new Group();
  level.ground.physics = "static";
  level.ground.img = level.assets.groundTileImg;
  level.ground.w = tileW;
  level.ground.h = tileH;
  level.ground.tile = "g";

  // --- deep ground tile (d) ---
  level.groundDeep = new Group();
  level.groundDeep.physics = "static";
  level.groundDeep.img = level.assets.groundTileDeepImg;
  level.groundDeep.w = tileW;
  level.groundDeep.h = tileH;
  level.groundDeep.tile = "d";

  // --- platform left cap (L) ---
  level.platformsL = new Group();
  level.platformsL.physics = "static";
  level.platformsL.img = level.assets.platformLCImg;
  level.platformsL.w = tileW;
  level.platformsL.h = tileH;
  level.platformsL.tile = "L";

  // --- platform right cap (R) ---
  level.platformsR = new Group();
  level.platformsR.physics = "static";
  level.platformsR.img = level.assets.platformRCImg;
  level.platformsR.w = tileW;
  level.platformsR.h = tileH;
  level.platformsR.tile = "R";

  // --- wall left ([) ---
  level.wallsL = new Group();
  level.wallsL.physics = "static";
  level.wallsL.img = level.assets.wallLImg;
  level.wallsL.w = tileW;
  level.wallsL.h = tileH;
  level.wallsL.tile = "[";

  // --- wall right (]) ---
  level.wallsR = new Group();
  level.wallsR.physics = "static";
  level.wallsR.img = level.assets.wallRImg;
  level.wallsR.w = tileW;
  level.wallsR.h = tileH;
  level.wallsR.tile = "]";

  // ---------------------------------------------------------------------------
  // 3) Spawn everything from the tilemap
  // ---------------------------------------------------------------------------

  new Tiles(tilemap, 0, 0, tileW, tileH);

  // ---------------------------------------------------------------------------
  // 4) Post-spawn adjustments
  // ---------------------------------------------------------------------------

  // Initialize boar state variables for all boars created by Tiles()
  for (const b of level.boar) {
    b.recoveryTimer = -1; // Sentinel: means recovery timer hasn't been set
    b.isAirborne = false; // Track if boar just fell off an edge
  }

  // fire overlap-only (sensors don't apply physics, just detect contact)
  for (const s of level.fire) {
    // Use collider "s" (sensor) instead of static + sensor
    // This ensures overlaps are detected without physics response
    s.collider = "s";
  }
  // Debug: fire group sprite count (removed console.log for production)

  // leaves overlap-only (boars pass through)
  for (const s of level.leaf) {
    s.removeColliders();
  }
}
