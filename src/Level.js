// src/Level.js
// World container (WORLD layer).
//
// Responsibilities:
// - Build tilemap and static groups from level.tilemap
// - Spawn and manage world entities (Player, Boar, Leaf, Fire)
// - Apply world rules (gravity, fall reset, win condition)
// - Track world metrics (score, win flag) and handle reset logic
//
// Non-goals:
// - Does NOT control camera, parallax, or screen-space UI (VIEW layer)
// - Does NOT own global flow/state machine (Game does)
// - Does NOT load JSON files (LevelLoader does)
//
// Architectural notes:
// - Level is the “simulation” layer.
// - Entities own their own behavior; Level wires interactions and world rules.
// - Emits events via EventBus to decouple from Sound/UI/Debug systems.

import { PlayerEntity } from "./entities/PlayerEntity.js";
import { PlayerController } from "./world/PlayerController.js";
import { buildTilesAndGroups } from "./world/TileBuilder.js";
import {
  hookBoarSolids,
  cacheBoarSpawns,
  updateBoars,
  clearBoars,
  rebuildBoarsFromSpawns,
} from "./world/BoarSystem.js";
import { maybeRedrawHUD, redrawHUD } from "./world/HUDRenderer.js";
import {
  getPlayerAttackRange,
  pickFirstPlayerMeleeTarget,
} from "./world/AttackHitResolver.js";
import { EVENTS } from "./EventNames.js";

export class Level {
  constructor(pkg, assets, opts = {}) {
    this.pkg = pkg;
    this.assets = assets;
    this.hudGfx = opts.hudGfx || null;
    this.events = opts.events || null;

    this.levelData = pkg.level;
    this.tuning = pkg.tuning || {};
    this.worldCfg = pkg.world || {};
    this.tilesCfg = pkg.tiles || {}; // may be empty; tiles are also in levelData.tiles in levels.json
    this.bounds = pkg.bounds || {};

    // world runtime state
    this.score = 0;
    this.won = false;

    // world time (ms since level start; WORLD-owned)
    // IMPORTANT: we STOP this timer on win OR death.
    this.elapsedMs = 0;

    // groups (created in TileBuilder / BoarSystem)
    this.ground = null;
    this.groundDeep = null;
    this.platformsL = null;
    this.platformsR = null;
    this.wallsL = null;
    this.wallsR = null;

    this.boar = null;
    this.leaf = null;
    this.fire = null;

    // player entity + controller
    this.player = null;
    this.playerCtrl = null;

    // restart bookkeeping
    this.leafSpawns = [];
    this.boarSpawns = [];

    // cached HUD state
    this._lastScore = null;
    this._lastHealth = null;
    this._lastMaxHealth = null;

    // normalized world config
    this.WIN_SCORE = Number(
      this.worldCfg.winScore ?? this.levelData?.winScore ?? 15,
    );
    this.GRAVITY = Number(
      this.worldCfg.gravity ?? this.levelData?.gravity ?? 10,
    );
    this.FALL_RESET_MARGIN_TILES = Number(
      this.worldCfg.fallResetMarginTiles ??
        this.levelData?.fallResetMarginTiles ??
        3,
    );

    // IMPORTANT:
    // Interactions should be wired once per Level instance.
    // If you wire them again on restart, p5play will stack callbacks and you’ll
    // get double damage / double pickups / “weird” state.
    this._playerInteractionsWired = false;
    this._boarFireWired = false;
    this._boarGroupBoundForPlayer = null; // remembers which boar Group we bound collides() to

    // bind event listeners
    this._unsubs = [];
    this._installEventListeners();

    // Track if player was overlapping fire last frame and last invuln value
    this._playerWasInFire = false;
    this._playerLastInvuln = 0;

    // Short grace period after restart to avoid stale overlap/contact carryover.
    this._fireDamageGraceFrames = 0;
  }

  _installEventListeners() {
    if (!this.events) return;
    this._unsubs.push(
      this.events.on(EVENTS.PLAYER_ATTACK_WINDOW, (info) =>
        this._tryHitBoar(info),
      ),
    );
  }

  destroy() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
  }

  // -----------------------
  // ani safety helpers
  // -----------------------

  _setAniSafe(sprite, name) {
    if (!sprite?.anis || !sprite.anis[name]) return false;
    sprite.ani = name;
    return true;
  }

  _setAniFrame0Safe(sprite, name) {
    if (!this._setAniSafe(sprite, name)) return false;
    if (sprite.ani) sprite.ani.frame = 0;
    return true;
  }

  // -----------------------
  // build / loop
  // -----------------------

  build() {
    world.gravity.y = this.GRAVITY;

    // Reset timer on build (new level instance or rebuild)
    this.elapsedMs = 0;

    // 1) Build tile groups + spawn from tilemap.
    // TileBuilder is responsible for creating:
    // - static tile groups (ground/platforms/walls)
    // - interactive groups (leaf/fire)
    // - boar group + tile spawning ('b') via Tiles()
    buildTilesAndGroups(this);

    // 2) Player entity + controller (WORLD)
    this.player = new PlayerEntity(this.pkg, this.assets);
    this.player.buildSprites();
    this.playerCtrl = new PlayerController(this.player, {
      events: this.events,
    });

    // 3) Cache spawns + wire interactions (ONE TIME) + hook boar collisions
    this._cacheLeafSpawns();
    cacheBoarSpawns(this);

    this._wirePlayerInteractionsOnce(); // player<->leaf/fire
    this._wireBoarFireRuleOnce(); // boar<->fire (wired once to boar group)
    this._rebindPlayerBoarCollide(); // player<->boar (bind to current boar group)
    hookBoarSolids(this);

    // 4) HUD
    this._lastScore = this._lastHealth = this._lastMaxHealth = null;
    maybeRedrawHUD(this);

    return this;
  }

  update({ input }) {
    if (this._fireDamageGraceFrames > 0) {
      this._fireDamageGraceFrames--;
    }

    // --- Fire pit repeated damage logic ---
    const player = this.player;
    const playerCtrl = this.playerCtrl;
    if (player && player.sprite && this.fire) {
      let inFire = false;
      for (const fireSprite of this.fire) {
        if (player.sprite.overlapping(fireSprite)) {
          inFire = true;
          break;
        }
      }
      // If player is in fire, invuln just ended, and was in fire last frame, apply damage again
      if (
        this._fireDamageGraceFrames === 0 &&
        inFire &&
        this._playerWasInFire &&
        player.invulnTimer === 0 &&
        this._playerLastInvuln > 0 &&
        !player.dead
      ) {
        playerCtrl.damageFromX(player.sprite.x);
      }
      this._playerWasInFire = inFire;
      this._playerLastInvuln = player.invulnTimer;
    }
    const playerDead = this.player?.dead === true;

    // 0) WORLD timer (STOP on terminal states)
    // (Put this early so it counts time even if logic below early-outs later.)
    if (!this.won && !playerDead) {
      this.elapsedMs += deltaTime;
    }

    // 1) AI (freeze boars if dead/won, matching monolith feel)
    if (!playerDead && !this.won) {
      updateBoars(this);
    } else if (this.boar) {
      for (const e of this.boar) e.vel.x = 0;
    }

    // 2) Player consumes input snapshot
    this.playerCtrl.update({
      input,
      solids: this._solids(),
      bounds: this.bounds,
      won: this.won,
    });

    // 3) Optional safety checks (remove later if desired)
    this._preStepPhysicsSanity();

    // 4) Physics step
    world.step();

    // 5) World rules
    this._fallResetIfNeeded();

    // 6) HUD refresh (score/health only; timer not shown)
    maybeRedrawHUD(this);
  }

  drawWorld() {
    allSprites.draw();
  }

  restart() {
    this.won = false;
    this.score = 0;

    // reset timer on restart
    this.elapsedMs = 0;

    // reset player entity/controller state
    this.playerCtrl.reset();

    // Reset fire overlap state and suppress fire damage briefly so stale
    // overlap/contact data from the death frame cannot damage on respawn.
    this._playerWasInFire = false;
    this._playerLastInvuln = 0;
    this._fireDamageGraceFrames = 2;

    // respawn leaves (overlap-only)
    for (const item of this.leafSpawns) {
      const s = item.s;
      s.x = item.x;
      s.y = item.y;
      s.active = true;
      s.visible = true;
      s.removeColliders();
    }

    // clear and rebuild boars from cached spawns (creates a NEW Group)
    clearBoars(this);
    rebuildBoarsFromSpawns(this);

    // IMPORTANT:
    // - Do NOT re-wire player overlaps/collides here (they would stack).
    // - But boar rules/collisions must be re-attached because this.boar is a new Group.
    this._boarFireWired = false; // boar group replaced => must re-wire overlaps to fire
    this._wireBoarFireRuleOnce();

    this._rebindPlayerBoarCollide(); // rebind because this.boar is a NEW Group
    hookBoarSolids(this);

    this._lastScore = this._lastHealth = this._lastMaxHealth = null;
    maybeRedrawHUD(this);

    this.events?.emit(EVENTS.LEVEL_RESTARTED);
  }

  // -----------------------
  // interactions
  // -----------------------

  // Player interactions should only be wired once.
  // These callbacks remain valid across restarts because:
  // - the player sprite is not replaced (it is reset)
  // - the leaf sprites persist (they are toggled active/visible)
  // - the boar Group is replaced on restart, BUT the player's collides() rule
  //   is attached to the player sprite; we re-attach it to the new boar Group.
  _wirePlayerInteractionsOnce() {
    if (this._playerInteractionsWired) return;
    this._playerInteractionsWired = true;

    const p = this.playerCtrl.sprite;

    // leaf collect
    p.overlaps(this.leaf, (playerSprite, leafSprite) =>
      this._rescueLeaf(playerSprite, leafSprite),
    );

    // fire damage
    p.overlaps(this.fire, (playerSprite, fireSprite) => {
      if (this._fireDamageGraceFrames > 0) return;
      this.playerCtrl.damageFromX(fireSprite.x);
    });
  }

  // Boar/fire rule is attached to the boar Group.
  // We wire it ONCE per boar-group instance (not per Level lifetime),
  // because the boar group is replaced on restart.
  _wireBoarFireRuleOnce() {
    if (this._boarFireWired) return;
    if (!this.boar || !this.fire) return;

    this._boarFireWired = true;
    // Use fire.overlaps(boar) to ensure the parameter is definitely the boar sprite
    // When fire (static) overlaps boar (dynamic), the callback parameter should be the boar
    this.fire.overlaps(this.boar, (sprite1, sprite2) => {
      // Check both possibilities in case parameter order is reversed
      const boarSprite = sprite2 || sprite1;

      if (boarSprite.dead || boarSprite.dying) return;

      // Fire is instant death: set dead state immediately, bypass grounded check
      boarSprite.hp = 0;
      boarSprite.dying = true;
      boarSprite.dead = true; // Immediate death - bypass grounded check for walking into fire
      boarSprite.deathStarted = false; // Reset so death animation/removal begins
      boarSprite.knockTimer = 0;
      boarSprite.recoveryTimer = -1;
      boarSprite.vel.x = 0;
      boarSprite.vel.y = 0;
      boarSprite.collider = "none";
      boarSprite.removeColliders?.();
      // Store current position for death animation
      boarSprite.holdX = boarSprite.x;
      boarSprite.holdY = boarSprite.y;
      boarSprite.deathFrameTimer = 0;
      boarSprite.vanishTimer = 24;
    });
  }

  // Player/boar contact damage must be attached to the CURRENT boar Group.
  // Guard so we only bind once per boar-Group instance (prevents stacking across restarts).
  _rebindPlayerBoarCollide() {
    const p = this.playerCtrl?.sprite;
    const g = this.boar;
    if (!p || !g) return;

    // If we already bound to this exact Group object, do nothing.
    if (this._boarGroupBoundForPlayer === g) return;
    this._boarGroupBoundForPlayer = g;

    p.collides(g, (playerSprite, boarSprite) => {
      if (boarSprite.dying || boarSprite.dead) return;
      this.playerCtrl.damageFromX(boarSprite.x);
    });
  }

  _rescueLeaf(playerSprite, leafSprite) {
    if (!leafSprite.active) return;

    leafSprite.active = false;
    leafSprite.visible = false;
    leafSprite.removeColliders();

    this.score++;
    this.events?.emit(EVENTS.LEAF_COLLECTED, {
      score: this.score,
      winScore: this.WIN_SCORE,
    });

    // Allow debug override for winScore
    let winScore = this.WIN_SCORE;
    if (window.debugState && window.debugState.winScoreOne) winScore = 1;
    if (this.score >= winScore) {
      this.won = true;

      // freeze player immediately (monolith behavior)
      playerSprite.vel.x = 0;
      playerSprite.vel.y = 0;

      this.events?.emit(EVENTS.LEVEL_WON, {
        score: this.score,
        winScore: winScore,
        elapsedMs: this.elapsedMs,
      });
    }
  }

  // Hook called from "player:attackWindow"
  _tryHitBoar({ facing, x, y }) {
    if (!this.boar) return;
    if (this.player.attackHitThisSwing) return; // optional guard

    const { rangeX, rangeY, verticalPad } = getPlayerAttackRange(this.tuning, {
      rangeX: 20,
      rangeY: 16,
      verticalPad: 10,
    });

    const boar = pickFirstPlayerMeleeTarget({
      attackInfo: { facing, x, y },
      playerSprite: this.playerCtrl.sprite,
      targets: this.boar,
      rangeX,
      rangeY,
      verticalPad,
      isTargetValid: (e) => !e.dead && !e.dying,
    });

    if (!boar) return;

    this._damageBoar(boar, facing);

    // latch "hit happened this swing" on the entity
    this.player.markAttackHit();
  }

  _damageBoar(e, facingDir) {
    if (e.dead || e.dying) return;

    const flashFrames = Number(this.tuning.boar?.hit?.flashFrames ?? 5);
    const knockFrames = Number(this.tuning.boar?.hit?.knockFrames ?? 7);
    const knockX = Number(this.tuning.boar?.hit?.knockX ?? 1.2);
    const knockY = Number(this.tuning.boar?.hit?.knockY ?? 1.6);

    e.hp = Math.max(0, (e.hp ?? Number(this.tuning.boar?.stats?.hp ?? 3)) - 1);
    e.flashTimer = flashFrames;

    this.events?.emit(EVENTS.BOAR_DAMAGED, { hp: e.hp, x: e.x, y: e.y });

    if (e.hp <= 0) {
      // Match monolith: enter "dying" first, then "dead" once grounded in BoarSystem.
      e.dying = true;
      e.vel.x = 0;

      // Ensure it can’t collide while dying
      e.collider = "none";
      e.removeColliders();

      // In the monolith you set "throwPose" here (not "death").
      // Actual death animation starts later inside BoarSystem when grounded.
      this._setAniFrame0Safe(e, "throwPose");

      this.events?.emit(EVENTS.BOAR_DIED, { x: e.x, y: e.y });
      return;
    }

    // knockback
    e.knockTimer = knockFrames;
    e.recoveryTimer = -1; // reset recovery so it can trigger again after this knockback
    e.wasDanger = false; // clear any previous turn state so wall/edge checks run on landing
    e.turnTimer = 0; // cancel any existing turn cooldown
    e.vel.x = facingDir * knockX;
    e.vel.y = -knockY;

    this._setAniFrame0Safe(e, "throwPose");
  }

  // -----------------------
  // helpers
  // -----------------------

  _cacheLeafSpawns() {
    this.leafSpawns = [];
    for (const s of this.leaf) {
      s.active = true;
      this.leafSpawns.push({ s, x: s.x, y: s.y });
    }
  }

  _solids() {
    const solids = {
      ground: this.ground,
      groundDeep: this.groundDeep,
      platformsL: this.platformsL,
      platformsR: this.platformsR,
      wallsL: this.wallsL,
      wallsR: this.wallsR,
    };

    // Optional additional solids (e.g., title-screen letters).
    if (Array.isArray(this.extraSolidGroups)) {
      this.extraSolidGroups.forEach((g, i) => {
        solids[`extraSolid${i}`] = g;
      });
    }

    return solids;
  }

  _fallResetIfNeeded() {
    // Prefer levelData.tiles.tileH from levels.json; fall back to cfg / default
    const tileH = Number(
      this.levelData?.tiles?.tileH ?? this.tilesCfg?.tileH ?? 24,
    );
    const p = this.playerCtrl.sprite;
    const playerDead = this.player?.dead === true;

    // Match monolith: fall reset only while alive and not won.
    if (
      !playerDead &&
      !this.won &&
      p.y > this.bounds.levelH + tileH * this.FALL_RESET_MARGIN_TILES
    ) {
      p.x = this.player.startX;
      p.y = this.player.startY;
      p.vel.x = 0;
      p.vel.y = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // PHYSICS SANITY
  // ---------------------------------------------------------------------------
  _preStepPhysicsSanity() {
    for (const s of allSprites) {
      if (!s) continue;

      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) {
        console.warn("[SANITY] removing sprite with bad position:", {
          x: s.x,
          y: s.y,
        });
        s.remove?.();
        continue;
      }

      // NOTE: In p5play v3, w/h may be getter-only and still valid to read.
      if ("w" in s && (!Number.isFinite(s.w) || s.w <= 0)) {
        console.warn("[SANITY] removing sprite with bad width:", {
          w: s.w,
          x: s.x,
          y: s.y,
        });
        s.remove?.();
        continue;
      }

      if ("h" in s && (!Number.isFinite(s.h) || s.h <= 0)) {
        console.warn("[SANITY] removing sprite with bad height:", {
          h: s.h,
          x: s.x,
          y: s.y,
        });
        s.remove?.();
        continue;
      }

      if (s.body) {
        const p = s.body.getPosition?.();
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          console.warn("[SANITY] removing sprite with bad body position:", {
            p,
          });
          s.remove?.();
        }
      }
    }
  }

  // -----------------------
  // HUD API (delegates)
  // -----------------------
  redrawHUD() {
    redrawHUD(this);
  }
}
