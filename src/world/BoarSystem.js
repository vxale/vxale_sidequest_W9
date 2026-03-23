// src/world/BoarSystem.js
// Boar system (WORLD logic helper)
//
// Responsibilities:
// - Create and configure boar Group (tile='b', animation wiring)
// - Initialize boars spawned by Tiles() (one-time _lvlInit)
// - Maintain boar probes (front/foot/ground) for edge/hazard detection
// - Implement boar patrol, turning, knockback, recovery, and death behaviors
// - Provide helpers for clearing, rebuilding, and respawning boars
//
// Non-goals:
// - Does NOT handle player input or HUD (PlayerController does)
// - Does NOT load assets (AssetLoader does)
//
// Architectural notes:
// - Level owns the boar Group and calls these helpers.
// - BoarSystem is stateless except for stuck-turn tracking on each boar.

// --- GROUP CREATION ---
// Called by TileBuilder before Tiles() runs so 'b' spawns into this group
export function buildBoarGroup(level) {
  const tiles = level.levelData?.tiles ?? level.tilesCfg ?? {};
  const frameW = Number(tiles.frameW) || 32;
  const frameH = Number(tiles.frameH) || 32;

  level.boar = new Group();
  level.boarIdCounter = 0; // Counter for unique boar IDs
  level.boar.physics = "dynamic";
  level.boar.tile = "b";

  // IMPORTANT:
  // Some p5play builds treat anis.w / anis.h as getter-only.
  // So we NEVER assume those assignments are safe.
  const hasDefs = !!(
    level.assets?.boarAnis && typeof level.assets.boarAnis === "object"
  );

  if (hasDefs) {
    // Wire the sheet + anis defs on the GROUP (nice default for Tiles-spawned boars),
    // but do it safely.
    safeAssignSpriteSheet(level.boar, level.assets.boarImg);
    safeConfigureAniSheet(level.boar, frameW, frameH, -8);

    try {
      level.boar.addAnis(level.assets.boarAnis);
    } catch (err) {
      console.warn(
        "[BoarSystem] group.addAnis failed; boars may be static:",
        err,
      );
      level.boar.img = level.assets.boarImg;
    }
  } else {
    // static fallback
    level.boar.img = level.assets.boarImg;
  }
}

function ensureBoarAnis(level, e) {
  const defs = level.assets?.boarAnis;
  if (!defs || typeof defs !== "object") return;

  // If key anis exist, leave it alone.
  const hasDeath = !!(e.anis && e.anis.death);
  const hasThrow = !!(e.anis && e.anis.throwPose);
  const hasRun = !!(e.anis && e.anis.run);
  if (hasDeath && hasThrow && hasRun) return;

  const tiles = level.levelData?.tiles ?? level.tilesCfg ?? {};
  const frameW = Number(tiles.frameW) || 32;
  const frameH = Number(tiles.frameH) || 32;

  safeAssignSpriteSheet(e, level.assets.boarImg);
  safeConfigureAniSheet(e, frameW, frameH, -8);

  try {
    e.addAnis(defs);
  } catch (err) {
    // If addAnis fails, fall back to static image so the game doesn't crash.
    console.warn("[BoarSystem] sprite.addAnis failed; using static img:", err);
    e.img = level.assets.boarImg;
  }
}

// --- p5play v3 compatibility helpers ---

// Read size without assuming w/h are writable.
function boarWidth(e, fallbackW) {
  const v = e?.width ?? e?.w ?? fallbackW;
  return Number(v) || Number(fallbackW) || 18;
}

function boarHeight(e, fallbackH) {
  const v = e?.height ?? e?.h ?? fallbackH;
  return Number(v) || Number(fallbackH) || 12;
}

// Tiles() may spawn boars at tile-sized colliders.
// Some builds crash if you try to assign e.w/e.h.
// Instead: if size looks wrong, REPLACE the sprite using new Sprite(x,y,w,h).
function needsColliderReplace(e, desiredW, desiredH) {
  const w = boarWidth(e, desiredW);
  const h = boarHeight(e, desiredH);
  // Tiny tolerance
  return Math.abs(w - desiredW) > 0.25 || Math.abs(h - desiredH) > 0.25;
}

// Copy minimal state from a Tiles()-spawned boar into a correctly-sized sprite.
function replaceBoarSprite(level, oldBoar, desiredW, desiredH) {
  const s = new Sprite(oldBoar.x, oldBoar.y, desiredW, desiredH);

  // Preserve direction if present
  s.dir = oldBoar.dir;

  // Preserve any per-sprite fields Tiles() might have set
  // (and anything Level/TileBuilder might have attached)
  // We only copy what we rely on.
  s._lvlInit = false;

  // Remove the old sprite from the world + group safely
  oldBoar.footProbe?.remove?.();
  oldBoar.frontProbe?.remove?.();
  oldBoar.groundProbe?.remove?.();
  oldBoar.remove?.();

  // Add new sprite to the boar group
  level.boar.add(s);

  return s;
}

function safeAssignSpriteSheet(target, img) {
  if (!img || !target) return;
  try {
    target.spriteSheet = img;
  } catch (err) {
    // ignore
  }
}

function safeConfigureAniSheet(target, frameW, frameH, offsetY) {
  if (!target) return;
  try {
    if (!target.anis) return;
    // These setters can throw in some builds; wrap each.
    try {
      target.anis.w = frameW;
    } catch (e) {}
    try {
      target.anis.h = frameH;
    } catch (e) {}
    try {
      if (target.anis.offset) target.anis.offset.y = offsetY;
    } catch (e) {}
  } catch (err) {
    // ignore
  }
}

// --- Public helpers used by Level ---

export function hookBoarSolids(level) {
  if (!level.boar) return;
  if (level.ground) level.boar.collides(level.ground);
  if (level.groundDeep) level.boar.collides(level.groundDeep);
  if (level.platformsL) level.boar.collides(level.platformsL);
  if (level.platformsR) level.boar.collides(level.platformsR);
  if (level.wallsL) level.boar.collides(level.wallsL);
  if (level.wallsR) level.boar.collides(level.wallsR);

  // Prevent boar-to-boar collision by using overlaps instead of collides
  // Overlaps trigger contact detection but don't apply physics response
  level.boar.overlaps(level.boar, () => {
    // No-op callback: detect overlap but don't apply physics
  });
}

export function cacheBoarSpawns(level) {
  level.boarSpawns = [];
  if (!level.boar) return;
  for (const e of level.boar) {
    level.boarSpawns.push({ x: e.x, y: e.y, dir: e.dir });
  }
}

export function clearBoars(level) {
  if (!level.boar) return;
  // Iterate a snapshot because removing from a live Group while iterating
  // can skip entries and leave stale boars behind after restart.
  for (const e of [...level.boar]) {
    e.footProbe?.remove?.();
    e.frontProbe?.remove?.();
    e.groundProbe?.remove?.();
    e.remove?.();
  }
}

export function rebuildBoarsFromSpawns(level) {
  // Recreate the group itself
  buildBoarGroup(level);

  const tiles = level.levelData?.tiles ?? level.tilesCfg ?? {};
  const frameW = Number(tiles.frameW) || 32;
  const frameH = Number(tiles.frameH) || 32;

  const boarW = Number(level.tuning.boar?.w ?? 18);
  const boarH = Number(level.tuning.boar?.h ?? 12);
  const boarHP = Number(level.tuning.boar?.hp ?? 3);

  for (const s of level.boarSpawns) {
    // Create with desired collider size (most reliable across builds)
    const e = new Sprite(s.x, s.y, boarW, boarH);

    // Sheet/anis (safe)
    const hasDefs =
      level.assets?.boarAnis && typeof level.assets.boarAnis === "object";
    if (hasDefs) {
      safeAssignSpriteSheet(e, level.assets.boarImg);
      safeConfigureAniSheet(e, frameW, frameH, -8);
      try {
        e.addAnis(level.assets.boarAnis);
      } catch (err) {
        e.img = level.assets.boarImg;
      }
    } else {
      e.img = level.assets.boarImg;
    }

    // Init like Tiles() boars
    e.rotationLock = true;
    e.physics = "dynamic";
    e.friction = 0;
    e.bounciness = 0;
    e.hp = boarHP;
    e.boarId = level.boarIdCounter++; // Assign unique ID

    attachBoarProbes(level, e);

    e.dir = s.dir === 1 || s.dir === -1 ? s.dir : random([-1, 1]);
    fixSpawnEdgeCase(level, e);

    e.wasDanger = false;
    e.flashTimer = 0;
    e.knockTimer = -1; // -1 means "no knockback active", prevents init recovery trigger
    e.recoveryTimer = -1;
    e.turnTimer = 0;
    // Mark that we're grounded (was airborne, now back on ground)
    e.isAirborne = false;

    e.dead = false;
    e.dying = false;
    e.deathStarted = false;
    e.deathFrameTimer = 0;

    e.vanishTimer = 0;
    e.holdX = e.x;
    e.holdY = e.y;

    e.mirror.x = e.dir === -1;
    e._lvlInit = true;

    level._setAniSafe?.(e, "run");
    level.boar.add(e);
  }
}

// --- Boar AI update (called every frame by Level) ---

export function updateBoars(level) {
  if (!level.boar) return;

  if (level.won) {
    for (const e of level.boar) e.vel.x = 0;
    return;
  }

  const tiles = level.levelData?.tiles ?? level.tilesCfg ?? {};
  const frameW = Number(tiles.frameW) || 32;
  const frameH = Number(tiles.frameH) || 32;

  const boarSpeed = Number(level.tuning.boar?.speed ?? 0.6);
  const boarW = Number(level.tuning.boar?.w ?? 18);
  const boarH = Number(level.tuning.boar?.h ?? 12);
  const boarHP = Number(level.tuning.boar?.hp ?? 3);
  const boarRecoveryFrames = Number(
    level.tuning.boar?.hit?.recoveryFrames ?? 30,
  );

  const hasAnis =
    level.assets?.boarAnis && typeof level.assets.boarAnis === "object";

  // IMPORTANT:
  // We iterate over a snapshot so replacing/removing boars won't break the loop.
  const boarsSnapshot = [...level.boar];

  for (const old of boarsSnapshot) {
    let e = old;

    // Defensive recovery: if probes were lost (e.g., from stale sprites),
    // reattach so edge/hazard logic stays functional.
    if (!e.frontProbe || !e.footProbe || !e.groundProbe) {
      attachBoarProbes(level, e);
    }

    // -----------------------------
    // One-time init for Tiles() boars
    // -----------------------------
    if (e._lvlInit !== true) {
      // If this sprite's collider is tile-sized, replace it safely.
      if (needsColliderReplace(e, boarW, boarH)) {
        e = replaceBoarSprite(level, e, boarW, boarH);
      }

      e._lvlInit = true;

      e.physics = "dynamic";
      e.rotationLock = true;

      e.friction = 0;
      e.bounciness = 0;

      e.hp = e.hp ?? boarHP;
      e.boarId = level.boarIdCounter++; // Assign unique ID

      // Make sure *this sprite* has anis, not just the group.
      if (hasAnis) {
        safeAssignSpriteSheet(e, level.assets.boarImg);
        safeConfigureAniSheet(e, frameW, frameH, -8);

        // add defs (safe)
        try {
          // only attempt if missing something obvious
          if (!e.anis || !e.anis.run) e.addAnis(level.assets.boarAnis);
        } catch (err) {
          // ignore; ensureBoarAnis will also try
        }
        ensureBoarAnis(level, e);
      } else {
        e.img = level.assets.boarImg;
      }

      attachBoarProbes(level, e);

      e.dir = e.dir === 1 || e.dir === -1 ? e.dir : random([-1, 1]);
      fixSpawnEdgeCase(level, e);

      e.wasDanger = false;

      e.flashTimer = 0;
      e.knockTimer = -1; // -1 means "no knockback active", prevents init recovery trigger
      e.recoveryTimer = -1;
      e.turnTimer = 0;
      e.isAirborne = false;

      e.dead = false;
      e.dying = false;
      e.deathStarted = false;
      e.deathFrameTimer = 0;

      e.vanishTimer = 0;
      e.holdX = e.x;
      e.holdY = e.y;

      e.mirror.x = e.dir === -1;

      // start in run pose
      level._setAniSafe?.(e, "run");
    }

    // -----------------------------
    // Probes + timers
    // -----------------------------
    updateBoarProbes(level, e);
    updateGroundProbe(level, e, boarH);

    if (e.flashTimer > 0) e.flashTimer--;
    if (e.knockTimer > 0) e.knockTimer--;
    if (e.recoveryTimer > 0) e.recoveryTimer--;
    if (e.turnTimer > 0) e.turnTimer--;

    // start recovery when knockback ends (knockTimer reaches 0 from a hit)
    if (e.knockTimer === 0 && e.recoveryTimer < 0) {
      e.recoveryTimer = boarRecoveryFrames; // stun/recovery period
      e.wasDanger = false; // forget previous hazards so we can turn again
      e.turnTimer = 0; // allow immediate turning after recovery
      e.knockTimer = -1; // reset so this doesn't trigger again
      // Debug: Recovery started (removed console.log for production)
    }

    e.tint = e.flashTimer > 0 ? "#ff5050" : "#ffffff";

    const grounded = boarGrounded(level, e) || boarTouchingSolid(level, e);
    const frontHitsHazard = frontProbeHitsHazard(level, e); // used even when airborne
    // physical collision check: sometimes the probe misses when the boar
    // is partly embedded in the wall. using colliding() gives us the raw
    // contact information from the physics engine so we can still turn.
    const touchingWall =
      (level.wallsL && e.colliding(level.wallsL)) ||
      (level.wallsR && e.colliding(level.wallsR));

    // -----------------------------
    // Death state machine (monolith-matching)
    // -----------------------------
    if (!e.dead && e.dying && grounded) {
      e.dead = true;
      e.deathStarted = false;
    }

    if (e.dying && !e.dead) {
      e.vel.x = 0;
      level._setAniFrame0Safe?.(e, "throwPose");
      continue;
    }

    if (e.dead && !e.deathStarted) {
      e.deathStarted = true;

      e.holdX = e.x;
      e.holdY = e.y;

      e.vel.x = 0;
      e.vel.y = 0;

      e.collider = "none";
      e.removeColliders();

      e.x = e.holdX;
      e.y = e.holdY;

      level._setAniFrame0Safe?.(e, "death");

      e.deathFrameTimer = 0;
      e.vanishTimer = 24;
      e.visible = true;
    }

    if (e.dead) {
      e.x = e.holdX;
      e.y = e.holdY;

      const deathDef = level.assets?.boarAnis?.death;
      const frames = Number(deathDef?.frames ?? 1);
      const delayFrames = Number(deathDef?.frameDelay ?? 6);
      const msPerFrame = (delayFrames * 1000) / 60;

      e.deathFrameTimer += deltaTime;
      const f = Math.floor(e.deathFrameTimer / msPerFrame);

      if (e.ani) e.ani.frame = Math.min(frames - 1, f);

      if (f >= frames - 1) {
        if (e.vanishTimer > 0) {
          e.visible = Math.floor(e.vanishTimer / 3) % 2 === 0;
          e.vanishTimer--;
        } else {
          e.footProbe?.remove?.();
          e.frontProbe?.remove?.();
          e.groundProbe?.remove?.();
          e.remove?.();
        }
      }
      continue;
    }

    // -----------------------------
    // Control states
    // -----------------------------
    if (e.knockTimer > 0) {
      level._setAniFrame0Safe?.(e, "throwPose");
      continue;
    }

    // recovery period: stay in throwPose, don't patrol yet
    if (e.recoveryTimer > 0) {
      // Debug: In recovery (removed console.log for production)
      e.vel.x = 0;
      level._setAniFrame0Safe?.(e, "throwPose");

      // Safety: if recovering boar is on a platform edge (no ground ahead),
      // or if it's physically pressing a wall while still stunned, cancel
      // recovery and turn away to prevent it being pinned in place.
      const hasGroundAhead = frontProbeHasGroundAhead(level, e);
      if ((touchingWall || !hasGroundAhead) && e.turnTimer === 0) {
        e.recoveryTimer = 0; // end recovery early
        // push away from whatever hazard we're seeing
        if (touchingWall) e.x += -e.dir * 6;
        turnBoar(level, e, -e.dir);
        updateBoarProbes(level, e);
      }

      continue;
    }

    // Recovery just ended - log the state
    if (e.recoveryTimer === 0) {
      // Debug: Recovery ended (removed console.log for production)
      e.recoveryTimer = -1; // prevent re-logging
    }

    if (!grounded) {
      // If the front probe is touching a wall while airborne, we'll turn immediately
      if (frontProbeHitsHazard(level, e) && e.turnTimer === 0) {
        e.x += -e.dir * 6; // bump away from the wall
        turnBoar(level, e, -e.dir);
        updateBoarProbes(level, e); // Update probes to new direction
        e.isAirborne = true;
        e.vel.x = 0;
        level._setAniFrame0Safe?.(e, "throwPose");
      } else if (!e.isAirborne && e.knockTimer === 0) {
        // walked off an edge during normal patrol
        // Debug: Lost ground mid-patrol (removed console.log for production)
        e.x += -e.dir * 6;
        turnBoar(level, e, -e.dir);
        updateBoarProbes(level, e); // Update probes to new direction
        e.isAirborne = true; // mark that we're now airborne
        e.vel.x = 0;
        level._setAniFrame0Safe?.(e, "throwPose");
      } else {
        e.isAirborne = true;
      }
      level._setAniFrame0Safe?.(e, "throwPose");
      continue;
    }

    // Mark that we're grounded (was airborne, now back on ground)
    e.isAirborne = false;

    if (e.dir !== 1 && e.dir !== -1) e.dir = random([-1, 1]);

    const halfW = boarWidth(e, boarW) / 2;

    if (e.x < halfW) turnBoar(level, e, 1);
    if (e.x > level.bounds.levelW - halfW) turnBoar(level, e, -1);

    // --- Simple AI: turn at edge or hazard (wall/fire) ---
    const noGroundAhead = !frontProbeHasGroundAhead(level, e);
    // frontHitsHazard already declared above
    // Blue probe (footProbe) checks for wall overlap
    const blueProbeHitsWall =
      e.footProbe.overlapping(level.wallsL) ||
      e.footProbe.overlapping(level.wallsR) ||
      e.footProbe.overlapping(level.platformsL) ||
      e.footProbe.overlapping(level.platformsR);

    if (
      e.turnTimer === 0 &&
      (noGroundAhead || frontHitsHazard || blueProbeHitsWall)
    ) {
      turnBoar(level, e, -e.dir);
      updateBoarProbes(level, e);
      continue;
    }

    // patrol
    e.vel.x = e.dir * boarSpeed;
    e.mirror.x = e.dir === -1;

    // Extra safety: don't let "run" override terminal states
    if (!e.dead && !e.dying) level._setAniSafe?.(e, "run");
  }
}
// End of updateBoars

// --- Probes + movement helpers ---

function placeProbe(probe, x, y) {
  probe.x = x;
  probe.y = y;
}

export function attachBoarProbes(level, e) {
  // Use probe size from tuning.json (boar.probes.size), fallback to 4
  const size = Number(level.tuning.boar?.probes?.size ?? 4);

  // Helper: sensor sprite that still has a collider
  function makeProbe(color) {
    const p = new Sprite(-9999, -9999, size, size);
    p.sensor = true;
    p.collider = "none"; // Not part of physics engine
    p.physics = "dynamic"; // Still allow position updates
    p.gravity = 0;
    p.mass = 0.0001;
    p.rotationLock = true;
    p.visible = !!window.showBoarProbes;
    p.layer = 999;
    p.friction = 0;
    p.bounciness = 0;
    if (window.showBoarProbes && color) p.color = color;
    return p;
  }

  e.frontProbe = makeProbe("red");
  e.footProbe = makeProbe("blue");
  e.groundProbe = makeProbe("green");

  // Ensure probes are removed when boar is removed
  const oldRemove = e.remove;
  e.remove = function () {
    if (e.frontProbe) e.frontProbe.remove();
    if (e.footProbe) e.footProbe.remove();
    if (e.groundProbe) e.groundProbe.remove();
    if (oldRemove) oldRemove.call(e);
  };

  // Ensure probe visibility/colors update if toggled after creation
  if (!window._boarProbeDebugHooked) {
    window._boarProbeDebugHooked = true;
    window.addEventListener("boarProbeDebugToggle", () => {
      for (const boar of level.boar || []) {
        if (boar.frontProbe) {
          boar.frontProbe.visible = !!window.showBoarProbes;
          if (window.showBoarProbes) boar.frontProbe.color = "red";
        }
        if (boar.footProbe) {
          boar.footProbe.visible = !!window.showBoarProbes;
          if (window.showBoarProbes) boar.footProbe.color = "blue";
        }
        if (boar.groundProbe) {
          boar.groundProbe.visible = !!window.showBoarProbes;
          if (window.showBoarProbes) boar.groundProbe.color = "green";
        }
      }
    });
  }
}

function updateBoarProbes(level, e) {
  // Use tuning values for probe placement and size
  const probes = level.tuning.boar?.probes ?? {};
  const forward = probes.forward ?? 10; // Red probe (front) forward distance
  const footForward = probes.footForward ?? forward; // Blue probe (foot) forward distance
  const frontY = probes.frontY ?? 10; // Red probe Y offset
  const headY = probes.headY ?? 0; // Blue probe Y offset

  // Red probe (front): forward distance and Y offset
  const frontX = e.x + e.dir * forward;
  placeProbe(e.frontProbe, frontX, e.y + frontY);
  // Blue probe (foot): independent forward distance and Y offset
  const footX = e.x + e.dir * footForward;
  placeProbe(e.footProbe, footX, e.y - headY);

  // Zero velocity to prevent bobbing/drifting
  if (e.frontProbe) {
    e.frontProbe.vel.x = 0;
    e.frontProbe.vel.y = 0;
  }
  if (e.footProbe) {
    e.footProbe.vel.x = 0;
    e.footProbe.vel.y = 0;
  }
}

function updateGroundProbe(level, e, fallbackH) {
  const h = boarHeight(e, Number(fallbackH ?? level.tuning.boar?.h ?? 12));
  placeProbe(e.groundProbe, e.x, e.y + h / 2 + 4);
  if (e.groundProbe) {
    e.groundProbe.vel.x = 0;
    e.groundProbe.vel.y = 0;
  }
}

function frontProbeHasGroundAhead(level, e) {
  const p = e.frontProbe;
  return (
    p.overlapping(level.ground) ||
    p.overlapping(level.groundDeep) ||
    p.overlapping(level.platformsL) ||
    p.overlapping(level.platformsR)
  );
}

function frontProbeHitsHazard(level, e) {
  // Use the blue (foot) probe for fire detection!
  const p = e.frontProbe;
  const foot = e.footProbe;
  if (level.fire) {
    // ...existing code...
  }
  return (
    !!p.overlapping(level.wallsL) ||
    !!p.overlapping(level.wallsR) ||
    !!foot.overlapping(level.fire)
  );
}

function boarGrounded(level, e) {
  const p = e.groundProbe;
  return (
    p.overlapping(level.ground) ||
    p.overlapping(level.groundDeep) ||
    p.overlapping(level.platformsL) ||
    p.overlapping(level.platformsR)
  );
}

function boarTouchingSolid(level, e) {
  return (
    (level.ground && e.colliding(level.ground)) ||
    (level.groundDeep && e.colliding(level.groundDeep)) ||
    (level.platformsL && e.colliding(level.platformsL)) ||
    (level.platformsR && e.colliding(level.platformsR))
  );
}

function shouldTurnNow(e, dangerNow) {
  const risingEdge = dangerNow && !e.wasDanger;
  e.wasDanger = dangerNow;
  return risingEdge;
}

function turnBoar(level, e, newDir) {
  const cooldown = level.tuning.boar?.turnCooldown ?? 12;

  if (e.turnTimer > 0) {
    return;
  }
  // clear previous danger flag so we always treat the next
  // detection as a fresh rising edge. this prevents stuck-while-
  // touching-wall behavior after a manual turn or edge correction.
  e.wasDanger = false;

  e.dir = newDir;
  e.turnTimer = cooldown;

  // Check if boar is physically touching a wall
  const touchingWall =
    (level.wallsL && e.colliding(level.wallsL)) ||
    (level.wallsR && e.colliding(level.wallsR));

  // Only move the boar during turn if it's currently grounded, touching a wall,
  // or if the front probe hits a wall.
  // This prevents turning from pushing grounded boars off platform edges
  // (knocked/falling boars can still be moved by knockback velocity).
  if (
    boarGrounded(level, e) ||
    frontProbeHitsHazard(level, e) ||
    touchingWall
  ) {
    e.x += e.dir * 6; // Revert nudge to 6px
    // (stuck turn detection removed)
  }

  e.vel.x = 0;
}

function groundAheadForDir(level, e, dir) {
  const old = e.dir;
  e.dir = dir;
  updateBoarProbes(level, e);

  const ok =
    e.frontProbe.overlapping(level.ground) ||
    e.frontProbe.overlapping(level.groundDeep) ||
    e.frontProbe.overlapping(level.platformsL) ||
    e.frontProbe.overlapping(level.platformsR);

  e.dir = old;
  return ok;
}

function fixSpawnEdgeCase(level, e) {
  const leftOk = groundAheadForDir(level, e, -1);
  const rightOk = groundAheadForDir(level, e, 1);

  if (leftOk && !rightOk) e.dir = -1;
  else if (rightOk && !leftOk) e.dir = 1;

  updateBoarProbes(level, e);
  e.vel.x = 0;
  e.turnTimer = 0;
  e.wasDanger = false;
}
