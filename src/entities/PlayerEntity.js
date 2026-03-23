// src/entities/PlayerEntity.js
// Player entity (WORLD entity).
//
// Responsibilities:
// - Own player state (health/timers/flags)
// - Own player sprites (main sprite + ground sensor)
// - Provide small action methods (move/jump/attack/damage)
// - Apply animation based on current state (visual state driven by world state)
//
// Non-goals:
// - Does NOT read input directly (PlayerController does)
// - Does NOT decide game win state (Level does)

export class PlayerEntity {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;

    this.tuning = pkg.tuning || {};
    this.tilesCfg = pkg.tiles || {};
    this.bounds = pkg.bounds || {};
    this.levelData = pkg.level || {};

    // sprites
    this.sprite = null;
    this.sensor = null;

    // spawn
    const ps = this.levelData.playerStart ||
      this.levelData.backupPlayerStart || {
        x: this.tilesCfg.frameW ?? 32,
        y: (this.bounds.levelH ?? 0) - (this.tilesCfg.tileH ?? 24) * 4,
      };
    this.startX = ps.x;
    this.startY = ps.y;

    // stats
    this.maxHealth = Number(this.tuning.player?.damage?.maxHealth ?? 3);
    this.health = this.maxHealth;

    // state
    this.dead = false;
    this.pendingDeath = false;

    // death animation latch (prevents looping forever)
    this.deathAnimStarted = false;

    // timers
    this.invulnTimer = 0;
    this.knockTimer = 0;

    // attack
    this.attacking = false;
    this.attackFrameCounter = 0;
    this.attackHitThisSwing = false;

    // tuning defaults
    this.MOVE_SPEED = Number(this.tuning.player?.move?.speed ?? 1.5);
    this.JUMP_STRENGTH = Number(this.tuning.player?.jump?.strength ?? 4.5);

    this.INVULN_FRAMES = Number(this.tuning.player?.damage?.invulnFrames ?? 45);
    this.KNOCK_FRAMES = Number(this.tuning.player?.damage?.knockFrames ?? 30);

    this.KNOCKBACK_X = Number(this.tuning.player?.damage?.knockbackX ?? 2.0);
    this.KNOCKBACK_Y = Number(this.tuning.player?.damage?.knockbackY ?? 3.2);

    this.COLLIDER_W = Number(this.tuning.player?.collider?.w ?? 18);
    this.COLLIDER_H = Number(this.tuning.player?.collider?.h ?? 12);

    this.ANI_OFFSET_Y = Number(this.tuning.player?.anisOffset?.y ?? -8);

    // attack window
    this.ATTACK_START = Number(this.tuning.player?.attackStartFrame ?? 4);
    this.ATTACK_END = Number(this.tuning.player?.attackEndFrame ?? 8);
    this.ATTACK_FINISH = Number(this.tuning.player?.attackFinishFrame ?? 12);
  }

  // -----------------------
  // animation safety
  // -----------------------
  _hasAni(name) {
    return !!(this.sprite?.anis && this.sprite.anis[name]);
  }

  _setAni(name) {
    if (!this._hasAni(name)) return false;
    this.sprite.ani = name;
    return true;
  }

  _setAniFrame(name, frame) {
    if (!this._setAni(name)) return false;
    if (this.sprite.ani) this.sprite.ani.frame = frame;
    return true;
  }

  _playAni(name, startFrame = 0) {
    if (!this._setAni(name)) return false;
    if (this.sprite.ani) {
      this.sprite.ani.frame = startFrame;
      this.sprite.ani.play?.();
    }
    return true;
  }

  // -----------------------
  // build / reset
  // -----------------------
  buildSprites() {
    const { frameW = 32, frameH = 32 } = this.tilesCfg;

    this.sprite = new Sprite(this.startX, this.startY, frameW, frameH);
    this.sprite.rotationLock = true;

    const anis = this.assets?.playerAnis;
    const img = this.assets?.playerImg;

    if (img) this.sprite.spriteSheet = img;

    if (anis && typeof anis === "object") {
      this.sprite.anis.w = frameW;
      this.sprite.anis.h = frameH;
      this.sprite.anis.offset.y = this.ANI_OFFSET_Y;
      this.sprite.addAnis(anis);
      this._setAni("idle");
    } else {
      this.sprite.img = img;
    }

    // collider
    this.sprite.w = this.COLLIDER_W;
    this.sprite.h = this.COLLIDER_H;
    this.sprite.friction = 0;
    this.sprite.bounciness = 0;

    // ground sensor (query-only)
    this.sensor = new Sprite();
    this.sensor.x = this.sprite.x;
    this.sensor.y = this.sprite.y + this.sprite.h / 2;
    this.sensor.w = this.sprite.w;
    this.sensor.h = 2;
    this.sensor.mass = 0.01;
    this.sensor.removeColliders();
    this.sensor.visible = false;

    const j = new GlueJoint(this.sprite, this.sensor);
    j.visible = false;

    return this;
  }

  reset() {
    this.health = this.maxHealth;
    this.dead = false;
    this.pendingDeath = false;
    this.deathAnimStarted = false;

    this.invulnTimer = 0;
    this.knockTimer = 0;

    this.attacking = false;
    this.attackFrameCounter = 0;
    this.attackHitThisSwing = false;

    if (!this.sprite) return;

    this.sprite.x = this.startX;
    this.sprite.y = this.startY;
    this.sprite.vel.x = 0;
    this.sprite.vel.y = 0;
    this.sprite.tint = "#ffffff";

    this._setAni("idle");
  }

  // -----------------------
  // queries
  // -----------------------
  isGrounded(solids) {
    const s = this.sensor;
    if (!s) return false;

    // Allow either { ground, platformsL, ... } OR an array [ground, platformsL, ...]
    const list = Array.isArray(solids) ? solids : Object.values(solids || {});
    for (const g of list) {
      if (g && s.overlapping(g)) return true;
    }
    return false;
  }

  // -----------------------
  // timers
  // -----------------------
  tickTimers() {
    if (this.invulnTimer > 0) this.invulnTimer--;
    if (this.knockTimer > 0) this.knockTimer--;
  }

  // -----------------------
  // actions (mutations)
  // -----------------------
  stopX() {
    this.sprite.vel.x = 0;
  }

  moveLeft() {
    this.sprite.vel.x = -this.MOVE_SPEED;
    this.sprite.mirror.x = true;
  }

  moveRight() {
    this.sprite.vel.x = this.MOVE_SPEED;
    this.sprite.mirror.x = false;
  }

  jump() {
    this.sprite.vel.y = -1 * this.JUMP_STRENGTH;
  }

  startAttack() {
    this.attacking = true;
    this.attackHitThisSwing = false;
    this.attackFrameCounter = 0;
    this.stopX();
    this._playAni("attack", 0);
  }

  markAttackHit() {
    this.attackHitThisSwing = true;
  }

  clampToBounds(bounds) {
    const half = (this.sprite?.w ?? 0) / 2;
    const maxX = (bounds?.levelW ?? this.sprite.x) - half;
    this.sprite.x = constrain(this.sprite.x, half, maxX);
  }

  // -----------------------
  // animation (visual state)
  // -----------------------
  applyAnimation({ grounded, won }) {
    if (!this.sprite?.anis || Object.keys(this.sprite.anis).length === 0)
      return;

    // ---- DEAD: play once, then hold last frame (prevents infinite loop)
    if (this.dead) {
      if (!this.deathAnimStarted) {
        this.deathAnimStarted = true;
        this._playAni("death", 0);
        // If available, disable looping
        this.sprite.ani?.noLoop?.();
      } else {
        this._setAni("death");

        // Hard clamp to last frame (works even if noLoop doesn't exist)
        const def = this.assets?.playerAnis?.death;
        const frames = Number(def?.frames ?? 1);
        if (this.sprite.ani) this.sprite.ani.frame = Math.max(0, frames - 1);
      }
      return;
    }

    if (won) {
      // optional: choose idle when winning
      this._setAni("idle");
      return;
    }

    if (this.knockTimer > 0 || this.pendingDeath) {
      this._setAniFrame("hurtPose", 1);
      return;
    }

    // attack animation is started by startAttack(); don't stomp it here
    if (this.attacking) return;

    if (!grounded) {
      const f = this.sprite.vel.y < 0 ? 0 : 1;
      this._setAniFrame("jump", f);
      return;
    }

    const moving = Math.abs(this.sprite.vel.x) > 0.01;
    this._setAni(moving ? "run" : "idle");
  }

  // -----------------------
  // damage / effects
  // -----------------------
  takeDamageFromX(sourceX) {
    if (this.invulnTimer > 0 || this.dead) return false;
    if (window.debugState && window.debugState.playerInvincible) return false;

    this.health = Math.max(0, this.health - 1);
    if (this.health <= 0) this.pendingDeath = true;

    this.invulnTimer = this.INVULN_FRAMES;
    this.knockTimer = this.KNOCK_FRAMES;

    const dir = this.sprite.x < sourceX ? -1 : 1;
    this.sprite.vel.x = dir * this.KNOCKBACK_X;
    this.sprite.vel.y = -this.KNOCKBACK_Y;

    // cancel attack
    this.attacking = false;
    this.attackFrameCounter = 0;
    this.attackHitThisSwing = false;

    return true;
  }

  applyHurtBlinkTint() {
    if (!this.sprite) return;

    if (!this.dead && this.invulnTimer > 0) {
      this.sprite.tint =
        Math.floor(this.invulnTimer / 4) % 2 === 0 ? "#ff5050" : "#ffffff";
    } else {
      this.sprite.tint = "#ffffff";
    }
  }
}
