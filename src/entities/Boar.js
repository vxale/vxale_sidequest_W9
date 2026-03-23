// Utility: update all boar probe visibilities (for debug menu)
export function updateAllBoarProbeVisibility(show) {
  if (!window.game || !window.game.level || !window.game.level.boar) return;
  for (const e of window.game.level.boar) {
    if (e.frontProbe) e.frontProbe.visible = !!show;
    if (e.footProbe) e.footProbe.visible = !!show;
    if (e.groundProbe) e.groundProbe.visible = !!show;
  }
}
// src/entities/Boar.js
// Enemy controller (WORLD entity).
//
// Responsibilities:
// - Create and configure boar sprites from tilemap spawns ("b")
// - Run boar AI each frame (patrol + probe-based turning)
// - Manage probes (front/foot/ground) for terrain and hazard sensing
// - Handle damage, knockback, flash, death animation, and removal
// - Expose simple API to Level (update/reset hooks as needed)
//
// Non-goals:
// - Does NOT reduce player health directly (Level wires collision → Player.takeDamageFromX)
// - Does NOT modify score or win state (Level does)
// - Does NOT control camera/parallax or draw screen-space UI (VIEW layer)
// - Does NOT play sounds directly (emit events; Game wires SoundManager)
//
// Architectural notes:
// - Boar owns AI + combat state (hp, knock timers, probes, death state).
// - Level owns the world rules and manages group creation/spawns.
// - Boar emits events via EventBus (boar:damaged, boar:died) for sound/debug/UI decoupling.

export class BoarController {
  constructor(pkg, assets) {
    console.log("[BoarDebug] BoarController instantiated");
    this.pkg = pkg;
    this.assets = assets;
    this.tuning = pkg.tuning || {};
    this.bounds = pkg.bounds || {};

    // assigned later
    this.group = null;
    this.solids = null;
    this.leaf = null;
    this.fire = null;
    this.wallsL = null;
    this.wallsR = null;

    // tuning defaults (match monolith)
    const b = this.tuning.boar || {};
    this.W = b.collider?.w ?? 18;
    this.H = b.collider?.h ?? 12;
    this.SPEED = b.move?.speed ?? 0.6;
    this.HP = b.stats?.hp ?? 3;

    this.KNOCK_FRAMES = b.hit?.knockFrames ?? 7;
    this.KNOCK_X = b.hit?.knockX ?? 1.2;
    this.KNOCK_Y = b.hit?.knockY ?? 1.6;
    this.FLASH_FRAMES = b.hit?.flashFrames ?? 5;

    this.TURN_COOLDOWN = b.turning?.turnCooldownFrames ?? 12;

    this.PROBE_FORWARD = b.probes?.forward ?? 10;
    this.PROBE_FRONT_Y = b.probes?.frontY ?? 10;
    this.PROBE_HEAD_Y = b.probes?.headY ?? 0;
    this.PROBE_SIZE = b.probes?.size ?? 4;
  }

  /**
   * Attach probes and initialize each boar sprite in the existing group.
   *
   * This method is called once per boar Group to set up all the boars for gameplay.
   * It stores references to game world objects (solids, collectibles, hazards) that
   * boars need to interact with, sets up collision detection, and initializes each
   * individual boar sprite with AI, physics, and animation properties.
   *
   * @param {Group} boarGroup - The p5play Group containing all boar sprites (created by tilemap)
   * @param {Object} refs - Object containing references to all game world objects
   * @param {Object} refs.solids - Terrain collision objects: { ground, groundDeep, platformsL, platformsR }
   * @param {Group} refs.leaf - Collectible leaf sprites that boars should avoid
   * @param {Group} refs.fire - Hazard sprites that kill boars on contact
   * @param {Group} refs.wallsL - Left-facing wall sprites for collision
   * @param {Group} refs.wallsR - Right-facing wall sprites for collision
   */
  initFromGroup(boarGroup, refs) {
    // Store the boar group for later use in update() and other methods
    this.group = boarGroup;

    // Store references to game world objects that boars interact with
    this.solids = refs.solids; // Terrain for collision and navigation
    this.leaf = refs.leaf; // Collectibles to avoid (boars turn away)
    this.fire = refs.fire; // Hazards that kill boars
    this.wallsL = refs.wallsL; // Left walls for collision
    this.wallsR = refs.wallsR; // Right walls for collision

    // Set up collision detection with solid terrain (ground, platforms, walls)
    // This prevents boars from passing through terrain and enables turning AI
    this._hookSolids();

    // Allow boars to pass through each other (no boar-to-boar collision)
    // This prevents issues when multiple boars get knocked onto the same platform
    this.group.collides(this.group, () => {}); // Empty callback = no collision response

    // Set up overlap detection with fire - boars die when they touch fire
    // This is a world rule that affects boar behavior and lifecycle
    if (this.fire) {
      this.group.overlaps(this.fire, (e) => this.dieInFire(e));
    }

    // Initialize each individual boar sprite in the group
    // This sets up physics, AI state, probes, and animation for each boar
    for (const e of this.group) this._initOne(e);
  }

  /**
   * Sets up collision detection between the boar group and all solid terrain objects.
   * This ensures boars cannot pass through ground, platforms, or walls, enabling
   * proper terrain navigation and turning behavior.
   */
  _hookSolids() {
    if (!this.group || !this.solids) return;
    const { ground, groundDeep, platformsL, platformsR } = this.solids;

    this.group.collides(ground);
    this.group.collides(groundDeep);
    this.group.collides(platformsL);
    this.group.collides(platformsR);

    if (this.wallsL) this.group.collides(this.wallsL);
    if (this.wallsR) this.group.collides(this.wallsR);
  }

  /**
   * Initializes a single boar sprite with all necessary properties for physics,
   * combat, AI behavior, and animation. Sets up collision detection, attaches
   * terrain-sensing probes, initializes timers and state flags, and configures
   * the initial movement direction and animation.
   * @param {Sprite} e - The boar sprite to initialize
   */
  _initOne(e) {
    e.physics = "dynamic";
    e.rotationLock = true;

    e.w = this.W;
    e.h = this.H;

    e.friction = 0;
    e.bounciness = 0;

    e.hp = e.hp ?? this.HP;

    this._attachProbes(e);

    // choose a safe direction BEFORE first movement
    e.dir = e.dir === 1 || e.dir === -1 ? e.dir : random([-1, 1]);
    this._fixSpawnEdgeCase(e);

    e.wasDanger = false;

    e.flashTimer = 0;
    e.knockTimer = 0;
    e.recoveryTimer = 0;
    e.turnTimer = 0;

    e.dead = false;
    e.dying = false;
    e.deathStarted = false;
    e.deathFrameTimer = 0;

    e.vanishTimer = 0;
    e.holdX = e.x;
    e.holdY = e.y;

    e.mirror.x = e.dir === -1;
    e.ani = "run";
  }

  // -------------------------
  // Public API
  // -------------------------
  update({ won = false, levelW = this.bounds.levelW } = {}) {
    console.log("[BoarDebug] BoarController.update called");
    if (!this.group) return;

    if (won) {
      for (const e of this.group) e.vel.x = 0;
      return;
    }

    for (const e of this.group) this._updateOne(e, levelW);
  }

  /**
   * Called by Level wiring (boar overlaps fire).
   */
  dieInFire(e) {
    if (e.dead || e.dying) return;
    e.hp = 0;
    e.dying = true;
    e.knockTimer = 0;
    e.vel.x = 0;
  }

  /**
   * Optional helper you can call from Player instead of mutating boar fields directly.
   * This mirrors monolith behavior.
   */
  takeHit(e, facingDir) {
    if (e.dead || e.dying) return;

    e.hp = max(0, (e.hp ?? this.HP) - 1);
    e.flashTimer = this.FLASH_FRAMES;

    if (e.hp <= 0) {
      e.dying = true;
      e.vel.x = 0;
      e.collider = "none";
      e.removeColliders();
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    e.knockTimer = this.KNOCK_FRAMES;
    e.vel.x = facingDir * this.KNOCK_X;
    e.vel.y = -this.KNOCK_Y;

    e.ani = "throwPose";
    e.ani.frame = 0;
  }

  // -------------------------
  // Internals (AI)
  // -------------------------
  _updateOne(e, levelW) {
    this._updateProbes(e);
    this._updateGroundProbe(e);

    // timers
    if (e.flashTimer > 0) e.flashTimer--;
    if (e.knockTimer > 0) e.knockTimer--;
    if (e.recoveryTimer > 0) e.recoveryTimer--;
    if (e.turnTimer > 0) e.turnTimer--;

    // start recovery immediately when knockback ends
    if (e.knockTimer === 0 && e.recoveryTimer === 0) {
      e.recoveryTimer = 30; // 3-4 frame stun/recovery period
    }

    // tint flash when hit
    e.tint = e.flashTimer > 0 ? "#ff5050" : "#ffffff";

    const grounded = this._grounded(e);

    // dying behavior: wait until grounded to start death
    if (!e.dead && e.dying && grounded) {
      e.dead = true;
      e.deathStarted = false;
    }

    if (e.dying && !e.dead) {
      e.vel.x = 0;
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    // start death once, then freeze + animate + remove
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

      e.ani = "death";
      e.ani.frame = 0;

      e.deathFrameTimer = 0;
      e.vanishTimer = 24;
      e.visible = true;
    }

    if (e.dead) {
      e.x = e.holdX;
      e.y = e.holdY;

      const frames = this.assets.boarAnis?.death?.frames ?? 4;
      const delayFrames = this.assets.boarAnis?.death?.frameDelay ?? 16;
      const msPerFrame = (delayFrames * 1000) / 60;

      e.deathFrameTimer += deltaTime;
      const f = Math.floor(e.deathFrameTimer / msPerFrame);
      e.ani.frame = Math.min(frames - 1, f);

      if (f >= frames - 1) {
        if (e.vanishTimer > 0) {
          e.visible = Math.floor(e.vanishTimer / 3) % 2 === 0;
          e.vanishTimer--;
        } else {
          e.footProbe?.remove();
          e.frontProbe?.remove();
          e.groundProbe?.remove();
          e.remove();
        }
      }
      return;
    }

    // knockback overrides patrol
    if (e.knockTimer > 0) {
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }
    // initiate recovery when knockback ends and boar lands
    // (moved to timer section - recovery now triggers immediately when knockTimer expires)

    // recovery period: stay in throwPose, don't patrol yet
    if (e.recoveryTimer > 0) {
      e.vel.x = 0;
      e.vel.y = 0;
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }
    // if not grounded, don’t patrol
    if (!grounded) {
      e.ani = "throwPose";
      e.ani.frame = 0;
      return;
    }

    // default direction if missing
    if (e.dir !== 1 && e.dir !== -1) e.dir = random([-1, 1]);

    // world bounds safety
    // Use BoarSystem.js turnBoar for all turning
    if (e.x < e.w / 2) window.turnBoar?.(window.game?.level, e, 1);
    if (e.x > levelW - e.w / 2) window.turnBoar?.(window.game?.level, e, -1);

    // Unified probe-based hazard detection (walls, fire, leaf)
    const noGroundAhead = !this._frontHasGround(e);
    const frontHitsHazard = this._frontHitsHazard(e);
    const frontHitsLeaf = this.leaf
      ? e.frontProbe.overlapping(this.leaf)
      : false;

    const dangerNow = noGroundAhead || frontHitsHazard || frontHitsLeaf;

    if (e.turnTimer === 0 && this._shouldTurnNow(e, dangerNow)) {
      window.turnBoar?.(window.game?.level, e, -e.dir);
      this._updateProbes(e);
      return;
    }
    // patrol
    e.vel.x = e.dir * this.SPEED;
    e.mirror.x = e.dir === -1;
    e.ani = "run";
  }

  // Unified hazard check: wall or fire
  _frontHitsHazard(e) {
    // Debug: confirm method is called
    console.log("[BoarDebug] _frontHitsHazard called");
    const fp = e.frontProbe;
    const bp = e.footProbe;
    // Debug: print probes
    console.log("[BoarDebug] frontProbe:", fp, "footProbe:", bp);
    // Walls: use either probe
    const hitL = this.wallsL
      ? fp.overlapping(this.wallsL) || bp.overlapping(this.wallsL)
      : false;
    const hitR = this.wallsR
      ? fp.overlapping(this.wallsR) || bp.overlapping(this.wallsR)
      : false;
    // Fire: use .overlapping() for both probes
    let hitFire = false;
    let fpFire = null;
    let bpFire = null;
    // Debug: print fire group
    console.log(
      "[BoarDebug] this.fire:",
      this.fire,
      Array.isArray(this.fire)
        ? this.fire.length
        : this.fire && this.fire.length,
    );
    if (this.fire) {
      fpFire = fp.overlapping(this.fire, true); // true = return array
      bpFire = bp.overlapping(this.fire, true);
      hitFire = (fpFire && fpFire.length > 0) || (bpFire && bpFire.length > 0);
      // Always log probe-fire overlap regardless of overlay state
      const fpIds =
        fpFire && fpFire.length
          ? fpFire.map((f) => f.id || f._id || f).join(",")
          : "none";
      const bpIds =
        bpFire && bpFire.length
          ? bpFire.map((f) => f.id || f._id || f).join(",")
          : "none";
      console.log(
        `[BoarProbeFire] frontProbe fire: ${fpIds} | footProbe fire: ${bpIds}`,
      );
    }
    return hitL || hitR || hitFire;
  }

  _shouldTurnNow(e, dangerNow) {
    const risingEdge = dangerNow && !e.wasDanger;
    e.wasDanger = dangerNow;
    return risingEdge;
  }

  // Removed: _turn(e, newDir) -- now handled by BoarSystem.js turnBoar

  // -------------------------
  // Probes
  // -------------------------
  _placeProbe(p, x, y) {
    p.x = x;
    p.y = y;
  }

  _attachProbes(e) {
    e.footProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.footProbe.collider = "none";
    e.footProbe.sensor = true;
    e.footProbe.visible = !!(window.debugState && window.debugState.boarProbes);
    e.footProbe.layer = 999;
    // Force correct settings in case Sprite constructor or external code changes them
    e.footProbe.physics = "dynamic";
    e.footProbe.mass = 0.0001;
    e.footProbe.friction = 0;
    e.footProbe.bounciness = 0;
    e.footProbe.immovable = true;

    e.frontProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.frontProbe.collider = "none";
    e.frontProbe.sensor = true;
    e.frontProbe.visible = !!(
      window.debugState && window.debugState.boarProbes
    );
    e.frontProbe.layer = 999;
    e.frontProbe.physics = "dynamic";
    e.frontProbe.mass = 0.0001;
    e.frontProbe.friction = 0;
    e.frontProbe.bounciness = 0;
    e.frontProbe.immovable = true;

    e.groundProbe = new Sprite(-9999, -9999, this.PROBE_SIZE, this.PROBE_SIZE);
    e.groundProbe.collider = "none";
    e.groundProbe.sensor = true;
    e.groundProbe.visible = !!(
      window.debugState && window.debugState.boarProbes
    );
    e.groundProbe.layer = 999;

    // Ensure probes are in allSprites and drawn above boar
    if (typeof allSprites !== "undefined") {
      if (!allSprites.includes(e.footProbe)) allSprites.push(e.footProbe);
      if (!allSprites.includes(e.frontProbe)) allSprites.push(e.frontProbe);
      if (!allSprites.includes(e.groundProbe)) allSprites.push(e.groundProbe);
    }
    e.footProbe.layer = 9999;
    e.frontProbe.layer = 9999;
    e.groundProbe.layer = 9999;
  }

  _updateProbes(e) {
    const forwardX = e.x + e.dir * this.PROBE_FORWARD;
    this._placeProbe(e.frontProbe, forwardX, e.y + this.PROBE_FRONT_Y);
    this._placeProbe(e.footProbe, forwardX, e.y - this.PROBE_HEAD_Y);
    // Always set probe visibility every frame
    const show = !!(window.debugState && window.debugState.boarProbes);
    if (e.frontProbe) e.frontProbe.visible = show;
    if (e.footProbe) e.footProbe.visible = show;
    if (e.groundProbe) e.groundProbe.visible = show;
  }

  _updateGroundProbe(e) {
    if (!e.groundProbe) return;
    this._placeProbe(e.groundProbe, e.x, e.y + e.h / 2 + 4);
  }

  _frontHasGround(e) {
    const p = e.frontProbe;
    const s = this.solids;
    return (
      p.overlapping(s.ground) ||
      p.overlapping(s.groundDeep) ||
      p.overlapping(s.platformsL) ||
      p.overlapping(s.platformsR)
    );
  }

  _frontHitsWall(e) {
    const p = e.frontProbe;
    const hitL = this.wallsL ? p.overlapping(this.wallsL) : false;
    const hitR = this.wallsR ? p.overlapping(this.wallsR) : false;
    return hitL || hitR;
  }

  _grounded(e) {
    const p = e.groundProbe;
    const s = this.solids;
    return (
      p.overlapping(s.ground) ||
      p.overlapping(s.groundDeep) ||
      p.overlapping(s.platformsL) ||
      p.overlapping(s.platformsR)
    );
  }

  _groundAheadForDir(e, dir) {
    const old = e.dir;
    e.dir = dir;
    this._updateProbes(e);

    const ok = this._frontHasGround(e);

    e.dir = old;
    return ok;
  }

  _fixSpawnEdgeCase(e) {
    const leftOk = this._groundAheadForDir(e, -1);
    const rightOk = this._groundAheadForDir(e, 1);

    if (leftOk && !rightOk) e.dir = -1;
    else if (rightOk && !leftOk) e.dir = 1;

    this._updateProbes(e);
    e.vel.x = 0;
    e.turnTimer = 0;
    e.wasDanger = false;
  }
}
