// src/entities/Leaf.js
// Collectible (WORLD entity).
//
// Responsibilities:
// - Create and configure leaf sprites from tilemap spawns ("x")
// - Play idle animation
// - Act as overlap-only collectible (no solid collision)
// - Provide spawn bookkeeping support (so Level can reset collectibles)
//
// Non-goals:
// - Does NOT increment score directly (Level does)
// - Does NOT trigger win state itself (Level does)
// - Does NOT draw HUD or screen-space UI (VIEW layer)
// - Does NOT play sounds directly (emit events; Game wires SoundManager)
//
// Architectural notes:
// - Leaf is a passive world object.
// - Level handles overlap response and emits/forwards collection events.
// - Keeping Leaf logic small reinforces separation of data (tilemap) from game rules.

export class LeafController {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;
    this.tuning = pkg.tuning || {};

    this.group = null;
    this.spawns = [];
  }

  /**
   * @param {Group} leafGroup - already created (tile="x") OR create one before Tiles() runs
   */
  initFromGroup(leafGroup) {
    this.group = leafGroup;

    // overlap-only
    for (const s of this.group) s.removeColliders();

    this.cacheSpawns();
  }

  cacheSpawns() {
    this.spawns = [];
    for (const s of this.group) {
      s.active = true;
      this.spawns.push({ s, x: s.x, y: s.y });
    }
  }

  respawnAll() {
    for (const item of this.spawns) {
      const s = item.s;
      s.x = item.x;
      s.y = item.y;
      s.active = true;
      s.visible = true;
      s.removeColliders(); // keep overlap-only
    }
  }

  /**
   * Utility to create a correctly configured leaf Group (before Tiles()).
   * You can still use tile="x" so Tiles() will spawn them.
   */
  static makeGroup(pkg, assets) {
    const g = new Group();
    g.physics = "static";
    g.spriteSheet = assets.leafImg;

    // If you later move this into tuning.json, replace these literals.
    g.addAnis({ idle: { w: 32, h: 32, row: 0, frames: 5 } });

    g.w = 10;
    g.h = 6;
    g.anis.offset.x = 2;
    g.anis.offset.y = -4;

    g.tile = "x";
    return g;
  }
}
