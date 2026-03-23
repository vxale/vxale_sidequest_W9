// src/world/PlayerController.js
// Player brain/controller (WORLD behavior driver).
//
// Responsibilities:
// - Consume InputManager snapshot
// - Apply movement/jump/attack rules to PlayerEntity
// - Emit gameplay events (attack window, damaged, died, etc.)
//
// Non-goals:
// - Does NOT own sprites (PlayerEntity owns sprites)
// - Does NOT own camera/HUD (VIEW)

import { EVENTS } from "../EventNames.js";

export class PlayerController {
  constructor(playerEntity, opts = {}) {
    this.player = playerEntity;
    this.events = opts.events || null;
  }

  // handy passthrough for old code that expects playerCtrl.sprite
  get sprite() {
    return this.player?.sprite;
  }

  reset() {
    this.player?.reset();
  }

  update({ input, solids, bounds, won }) {
    const p = this.player;
    if (!p?.sprite) return;

    // timers tick every frame regardless
    p.tickTimers();

    const grounded = p.isGrounded(solids);

    // -----------------------
    // DEATH LATCH (fixes "never reaches lose screen")
    // -----------------------
    // Latch death after landing. (Do NOT require knockTimer==0; that can prevent latching.)
    if (!p.dead && p.pendingDeath && grounded) {
      p.dead = true;
      p.pendingDeath = false;
      this.events?.emit(EVENTS.PLAYER_DIED, {
        health: p.health,
        maxHealth: p.maxHealth,
      });
    }

    // if dead or won, freeze horizontal control and just animate
    if (p.dead || won) {
      p.stopX();
      p.applyAnimation({ grounded, won });
      p.applyHurtBlinkTint();
      return;
    }

    // -----------------------
    // ATTACK start
    // -----------------------
    const wantAttack = input?.attackPressed;
    if (
      p.knockTimer === 0 &&
      !p.pendingDeath &&
      grounded &&
      !p.attacking &&
      wantAttack
    ) {
      p.startAttack();
      this.events?.emit(EVENTS.PLAYER_ATTACKED, {});
    }

    // -----------------------
    // JUMP
    // -----------------------
    const wantJump = input?.jumpPressed;
    if (p.knockTimer === 0 && !p.pendingDeath && grounded && wantJump) {
      p.jump();
      this.events?.emit(EVENTS.PLAYER_JUMPED, {});
    }

    // -----------------------
    // MOVE
    // -----------------------
    if (p.knockTimer > 0) {
      // no control during knockback
    } else if (p.pendingDeath) {
      p.stopX();
    } else if (!p.attacking) {
      p.stopX();
      if (input?.left) p.moveLeft();
      else if (input?.right) p.moveRight();
    }

    // -----------------------
    // ATTACK timing + window event
    // -----------------------
    if (p.attacking) {
      p.attackFrameCounter++;

      // emit ONCE when the window opens (Level can handle boar hits that frame)
      if (!p.attackHitThisSwing && p.attackFrameCounter === p.ATTACK_START) {
        this.events?.emit(EVENTS.PLAYER_ATTACK_WINDOW, {
          frame: p.attackFrameCounter,
          facing: p.sprite.mirror.x ? -1 : 1,
          x: p.sprite.x,
          y: p.sprite.y,
        });
      }

      // finish attack
      if (p.attackFrameCounter > p.ATTACK_FINISH) {
        p.attacking = false;
        p.attackFrameCounter = 0;
        p.attackHitThisSwing = false;
      }
    }

    // clamp + animate + tint
    p.clampToBounds(bounds);
    p.applyAnimation({ grounded, won });
    p.applyHurtBlinkTint();
  }

  // Optional: let hazards call into controller if you prefer
  damageFromX(sourceX) {
    const p = this.player;
    const didDamage = p.takeDamageFromX(sourceX);
    if (didDamage) {
      this.events?.emit(EVENTS.PLAYER_DAMAGED, {
        amount: 1,
        health: p.health,
        maxHealth: p.maxHealth,
        sourceX,
      });
    }
    return didDamage;
  }
}
