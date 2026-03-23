// src/entities/Fire.js
// Hazard (WORLD entity).
//
// Responsibilities:
// - Create and configure fire sprites from tilemap spawns ("f")
// - Play burn animation
// - Act as overlap-only hazard (no solid collision)
// - Provide spawn bookkeeping support if needed for resets
//
// Non-goals:
// - Does NOT reduce player health directly (Level wires overlap → Player.takeDamageFromX)
// - Does NOT decide death/win conditions (Level/Game do)
// - Does NOT draw HUD or screen-space UI (VIEW layer)
// - Does NOT play sounds directly (emit events; Game wires SoundManager)
//
// Architectural notes:
// - Fire is a passive hazard object.
// - Level owns world rules and routes interactions into Player.
// - Events allow sound/debug/UI to react without Fire importing those systems.

export class FireController {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;
    this.tuning = pkg.tuning || {};
    this.group = null;
  }

  /**
   * @param {Group} fireGroup - already created (tile="f") OR create one before Tiles() runs
   */
  initFromGroup(fireGroup) {
    this.group = fireGroup;

    // overlap-only hazard
    for (const s of this.group) {
      s.collider = "static";
      s.sensor = true;
    }
  }

  /**
   * Utility to create a correctly configured fire Group (before Tiles()).
   * Keep tile="f" so Tiles() will spawn them.
   */
  static makeGroup(pkg, assets) {
    const g = new Group();
    g.physics = "static";
    g.spriteSheet = assets.fireImg;

    // If you later move this into tuning.json, replace these literals.
    g.addAnis({ burn: { w: 32, h: 32, row: 0, frames: 16 } });

    g.w = 18;
    g.h = 16;

    g.tile = "f";
    return g;
  }
}
