// src/ui/TitleScreen.js
// Title screen (VIEW + WORLD layer).
//
// Responsibilities:
// - Run the title screen mini-level (player can move/jump/attack)
// - Spawn falling "ADVENTURE" letter sprites that the player can destroy
// - Render "Fox's Forest" title text as bitmap overlay
// - Handle fade-to-black transition when all letters are destroyed

import {
  getPlayerAttackRange,
  pickFirstPlayerMeleeTarget,
} from "../world/AttackHitResolver.js";
import { EVENTS } from "../EventNames.js";

export class TitleScreen {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;

    this.viewW = pkg.view?.viewW ?? pkg.view?.w ?? 240;
    this.viewH = pkg.view?.viewH ?? pkg.view?.h ?? 192;

    // Bitmap-font config (matching HUD style)
    this.FONT_COLS = pkg.tuning?.hud?.font?.cols ?? 19;
    this.CELL = pkg.tuning?.hud?.font?.cell ?? 30;
    this.FONT_SCALE = pkg.tuning?.hud?.font?.scale ?? 1 / 3;
    this.FONT_CHARS =
      pkg.tuning?.hud?.fontChars ??
      " !\"#$%&'()*+,-./0123456789:;<=>?@" +
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
        "abcdefghijklmnopqrstuvwxyz{|}~";

    // Letter sprites
    this._letterSprites = [];
    this._releasedDynamicLetters = [];
    this._lettersBuilt = false;
    this._allDestroyed = false;

    // Attack listener unsubscribe
    this._attackUnsub = null;

    // Letter drop timing: wait 200 ms after first key input, then release letters
    this._dropTriggered = false;
    this._lettersReleased = false;
    this._dropTimerMs = 0;
    this._dropDelayMs = 100;
    this._dropStaggerMs = 60;
    this._dropQueueStarted = false;

    // Horizontal spread profile for scripted letter drop.
    this._dropSpreadSpeed = 1.7;

    // Fade state: "playing" | "fade-out" | "fade-in" | "done"
    this._state = "playing";
    this._fadeAlpha = 0;
    this._fadeSpeed = 4; // alpha increase per frame (0-255)
    this._holdTimer = 0;

    // Done flag (signals main.js to switch to level 1)
    this.done = false;
  }

  /**
   * Called after the title Game is built. Creates the letter sprites
   * and wires attack detection.
   * @param {Game} game - the title screen Game instance
   */
  init(game) {
    this._game = game;
    this._buildLetterSprites();
    this._wireAttackListener();
  }

  _buildLetterSprites() {
    if (this._lettersBuilt) return;
    this._lettersBuilt = true;

    const word = "ADVENTURE";
    const letterTint = "#f7be00";
    const letterLayer = 10;
    const playerLayer = 20;
    const letterImages = this.assets.letterImages;
    if (!letterImages) return;

    const spriteW = 15;
    const spriteH = 15;
    const spacing = spriteW - 1;

    // Create one Group per unique letter character — same pattern as tiles
    // (group.img + group.w + group.h, then spawn Sprite from group)
    this._letterGroups = {};
    for (const ch of new Set(word)) {
      const img = letterImages[ch];
      if (!img) continue;
      const g = new Group();
      g.img = img;
      g.w = spriteW;
      g.h = spriteH;
      g.scale = 1;
      g.bounciness = 0.2;
      g.friction = 0.5;
      g.rotationLock = true;
      g.mass = 1;
      g.layer = letterLayer;
      this._letterGroups[ch] = g;
    }

    // Center the word horizontally
    const totalW = word.length * spacing;
    const startX = Math.round((this.viewW - totalW) / 2 + spacing / 2);

    // Vertical start: closer to FOX'S FOREST but still within locked-camera view
    const startY = 150;

    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      const grp = this._letterGroups[ch];
      if (!grp) continue;

      const x = Math.round(startX + i * spacing);
      const y = Math.round(startY);

      // Spawn from the group — inherits img, w, h (same as tiles)
      const s = new grp.Sprite(x, y);
      s.tint = letterTint;
      s.collider = "k"; // hold in place until delayed release
      s.layer = letterLayer;
      s.bounciness = 0.2;
      s.friction = 0.7;
      s._letterChar = ch;
      s._letterIndex = i;

      this._letterSprites.push(s);
    }

    // Wire collisions: group-to-group (efficient, same as boar/tile collisions)
    const level = this._game?.level;
    if (level) {
      const solidGroups = [
        level.ground,
        level.groundDeep,
        level.platformsL,
        level.platformsR,
        level.wallsL,
        level.wallsR,
      ];
      this._letterSolidGroups = solidGroups.filter(Boolean);
      const playerSprite = level.player?.sprite;
      if (playerSprite) playerSprite.layer = playerLayer;
      const letterGroups = Object.values(this._letterGroups);

      // Add letter groups to level solids so standing on letters counts as grounded.
      level.extraSolidGroups = letterGroups;

      for (const letterGrp of letterGroups) {
        for (const solidGrp of solidGroups) {
          if (solidGrp) letterGrp.collides(solidGrp);
        }

        // Player should collide with letters so fox can walk/push them.
        // Attack checks still use player:attackWindow + _tryHitLetter().
        if (playerSprite) {
          letterGrp.collides(playerSprite);
          playerSprite.collides(letterGrp);
        }
      }

      // Disable letter-to-letter physical collision response to avoid jittering
      // when stacked during the drop animation.
      for (const a of letterGroups) {
        for (const b of letterGroups) {
          a.overlaps(b, () => {});
        }
      }
    }
  }

  _wireAttackListener() {
    if (!this._game?.events) return;
    this._attackUnsub = this._game.events.on(
      EVENTS.PLAYER_ATTACK_WINDOW,
      (info) => this._tryHitLetter(info),
    );
  }

  _tryHitLetter(info) {
    if (!info) return;

    const { facing, x, y } = info;
    const { rangeX, rangeY, verticalPad } = getPlayerAttackRange(
      this.pkg.tuning,
      {
        rangeX: 20,
        rangeY: 16,
        verticalPad: 10,
      },
    );

    const player = this._game?.level?.player;
    if (!player?.sprite) return;

    const letter = pickFirstPlayerMeleeTarget({
      attackInfo: { facing, x, y },
      playerSprite: player.sprite,
      targets: this._letterSprites,
      rangeX,
      rangeY,
      verticalPad,
      isTargetValid: (s) => !s.removed && !s._destroyed,
      targetWidth: (s) => s.w ?? 16,
      targetHeight: (s) => s.h ?? 16,
    });

    if (!letter) return;

    // Hit! Destroy this letter with knockback effect
    this._destroyLetter(letter, facing);
    this._game?.events?.emit(EVENTS.LETTER_HIT, {
      x: letter.x,
      y: letter.y,
      char: letter._letterChar,
    });

    // Only hit one letter per swing
    player.markAttackHit();
  }

  _destroyLetter(s, facingDir) {
    const hitCfg = this.pkg?.tuning?.player?.attack?.titleLetterHit ?? {};
    const knockX = Number(hitCfg.knockX ?? 4);
    const knockY = Number(hitCfg.knockY ?? 5);
    const rotation = Number(hitCfg.rotation ?? 15);
    const life = Number(hitCfg.life ?? 30);

    // Knockback the letter up and away, then remove after a delay
    s.vel.x = facingDir * knockX;
    s.vel.y = -knockY;
    s.rotationLock = false;
    s.rotation = facingDir * rotation;
    s.life = life; // p5play auto-removes after this many frames
    s._destroyed = true;
  }

  _countRemaining() {
    let count = 0;
    for (const s of this._letterSprites) {
      if (!s.removed && !s._destroyed) count++;
    }
    return count;
  }

  update() {
    if (this.done) return;

    if (this._state === "playing") {
      // Run the game (player can move, attack, physics runs)
      if (this._game) {
        this._game.update();
        this._updateLetterDropDelay();
        this._updateLetterSettling();
        this._confineLettersToView();
        this._confinePlayerToView();
      }

      // Check if all letters are destroyed
      if (
        this._lettersBuilt &&
        this._countRemaining() === 0 &&
        !this._allDestroyed
      ) {
        this._allDestroyed = true;
        this._state = "fade-out";
        this._fadeAlpha = 0;
      }
    } else if (this._state === "fade-out") {
      // Still run physics so letters finish flying off
      if (this._game) {
        this._game.update();
        this._updateLetterDropDelay();
        this._updateLetterSettling();
        this._confineLettersToView();
        this._confinePlayerToView();
      }
      this._fadeAlpha = Math.min(255, this._fadeAlpha + this._fadeSpeed);
      if (this._fadeAlpha >= 255) {
        this._state = "hold-black";
        this._holdTimer = 0;
      }
    } else if (this._state === "hold-black") {
      this._holdTimer++;
      if (this._holdTimer >= 30) {
        // Clean up title screen sprites before switching
        this._cleanup();
        this.done = true;
      }
    }
  }

  draw({ parallax, cameraX } = {}) {
    if (this.done) return;

    // Let the game draw the world (background, tiles, player, letter sprites)
    const viewW = this.viewW;
    const viewH = this.viewH;

    const bg = this.pkg.level?.view?.background ?? [69, 61, 79];
    background(bg[0], bg[1], bg[2]);

    // Parallax background
    parallax?.draw({
      cameraX: cameraX || 0,
      viewW,
      viewH,
    });

    // Draw world sprites (tiles, player, letter sprites — all rendered by p5play)
    if (this._game?.level) {
      this._game.level.drawWorld();
    }

    // Bottom instruction text (white, no outline), screen-space.
    camera.off();
    this._drawInstructions();
    camera.on();

    // Draw fade overlay
    if (this._state === "fade-out" || this._state === "hold-black") {
      camera.off();
      push();
      noStroke();
      fill(0, this._fadeAlpha);
      rect(0, 0, viewW, viewH);
      pop();
      camera.on();
    }
  }

  _confinePlayerToView() {
    const playerSprite = this._game?.level?.player?.sprite;
    if (!playerSprite || playerSprite.removed) return;

    const halfW = (playerSprite.w ?? 12) / 2;
    const minX = halfW;
    const maxX = this.viewW - halfW;

    if (playerSprite.x < minX) {
      playerSprite.x = minX;
      if (playerSprite.vel?.x < 0) playerSprite.vel.x = 0;
    } else if (playerSprite.x > maxX) {
      playerSprite.x = maxX;
      if (playerSprite.vel?.x > 0) playerSprite.vel.x = 0;
    }
  }

  _updateLetterDropDelay() {
    if (this._lettersReleased) return;

    if (!this._dropTriggered) {
      const input = this._game?.input?.input;
      const keyHit =
        !!input?.left ||
        !!input?.right ||
        !!input?.jumpPressed ||
        !!input?.attackPressed ||
        !!input?.restartPressed ||
        !!input?.debugTogglePressed;

      if (keyHit) {
        this._dropTriggered = true;
        this._dropTimerMs = 0;
      }
      return;
    }

    this._dropTimerMs += deltaTime;
    if (this._dropTimerMs >= this._dropDelayMs) {
      this._releaseLettersStaggered();
    }
  }

  _releaseLettersStaggered() {
    if (this._lettersReleased) return;

    if (!this._dropQueueStarted) {
      this._dropQueueStarted = true;
      this._dropQueueStartMs = this._dropTimerMs;
    }

    const elapsed = this._dropTimerMs - this._dropQueueStartMs;
    const releaseCount = Math.floor(elapsed / this._dropStaggerMs) + 1;

    for (let i = 0; i < this._letterSprites.length; i++) {
      const s = this._letterSprites[i];
      if (!s || s.removed || s._releasedToFall) continue;
      if (i >= releaseCount) continue;

      this._startLetterFall(s, i);
    }

    // Mark complete once all letters have been released.
    this._lettersReleased = this._letterSprites.every(
      (s) => !s || s.removed || s._releasedToFall,
    );
  }

  _startLetterFall(s, index) {
    s._releasedToFall = true;
    s._letterIndex = index;
    s.rotationLock = false;

    const total = Math.max(1, this._letterSprites.length);
    const center = (total - 1) / 2;
    const rel = center === 0 ? 0 : (index - center) / center; // -1 (left) to +1 (right)
    const bias = Math.sign(rel) * Math.pow(Math.abs(rel), 1.08);

    // Left letters drift left, right letters drift right, center letters near vertical.
    s._fallVx = bias * this._dropSpreadSpeed + random(-0.08, 0.08);
    s._fallVy = random(-0.2, 0);
    s._rotVel = bias * 1.25 + random(-0.45, 0.45);
  }

  _updateLetterSettling() {
    for (const s of this._letterSprites) {
      if (!s || s.removed || !s._releasedToFall || s._destroyed || s._settled) {
        continue;
      }

      // Scripted fall + bounce to avoid physics tunneling through thin tile tops.
      s._fallVy = Number(s._fallVy ?? 0) + 0.28;
      s._fallVx = Number(s._fallVx ?? 0) * 0.992;
      s._rotVel = Number(s._rotVel ?? 0) * 0.986;

      s.x += s._fallVx;
      s.y += s._fallVy;
      s.rotation = Number(s.rotation ?? 0) + s._rotVel;

      // Keep letters in-bounds while they spread.
      this._confineLetterToView(s);

      const groundTop = this._findGroundTopForLetter(s);
      if (groundTop === null) continue;

      const halfH = (s.h ?? 15) / 2;
      if (s.y + halfH < groundTop) continue;

      // Land on top of the nearest solid at this x.
      s.y = groundTop - halfH;

      // Bounce a little, then settle.
      if (Math.abs(s._fallVy) > 0.75) {
        s._fallVy = -Math.abs(s._fallVy) * 0.28;
        s._fallVx *= 0.75;
        s._rotVel *= 0.65;
      } else {
        s._fallVy = 0;
        s._fallVx = 0;
        s._rotVel = 0;
        s.rotation = 0;
        s.rotationLock = true;

        // After scripted landing, hand control back to physics so the fox can
        // push letters around naturally.
        s.physics = "dynamic";
        s.collider = "d";
        s.mass = 1;
        s.bounciness = 0;
        s.friction = 0.9;
        for (const solid of this._letterSolidGroups ?? []) {
          s.collides(solid);
        }

        s._settled = true;
      }
    }
  }

  _findGroundTopForLetter(s) {
    const groups = this._letterSolidGroups ?? [];
    if (!groups.length) return null;

    const halfW = (s.w ?? 15) / 2;
    const topY = s.y - (s.h ?? 15) / 2;
    let bestTop = null;

    for (const group of groups) {
      for (const tile of group) {
        if (!tile || tile.removed) continue;

        const tileHalfW = (tile.w ?? 24) / 2;
        const tileHalfH = (tile.h ?? 24) / 2;
        const tileLeft = tile.x - tileHalfW;
        const tileRight = tile.x + tileHalfW;

        // Must overlap horizontally to be a valid landing surface.
        if (s.x + halfW <= tileLeft || s.x - halfW >= tileRight) continue;

        const tileTop = tile.y - tileHalfH;

        // Consider only solids at or below the letter's top edge.
        if (tileTop < topY - 1) continue;

        if (bestTop === null || tileTop < bestTop) {
          bestTop = tileTop;
        }
      }
    }

    return bestTop;
  }

  _confineLettersToView() {
    for (const s of this._letterSprites) {
      if (!s || s.removed) continue;
      this._confineLetterToView(s);
    }
  }

  _confineLetterToView(s) {
    const halfW = (s.w ?? 15) / 2;
    const minX = halfW;
    const maxX = this.viewW - halfW;

    if (s.x < minX) {
      s.x = minX;
      if (typeof s._fallVx === "number" && s._fallVx < 0) s._fallVx = 0;
      if (s.vel?.x < 0) s.vel.x = 0;
    } else if (s.x > maxX) {
      s.x = maxX;
      if (typeof s._fallVx === "number" && s._fallVx > 0) s._fallVx = 0;
      if (s.vel?.x > 0) s.vel.x = 0;
    }
  }

  _drawInstructions() {
    const fontImg = this.assets?.fontImg;
    if (!fontImg) return;

    drawingContext.imageSmoothingEnabled = false;
    imageMode(CORNER);

    const line1 = "MOVE - WASD/ARROW KEYS";
    const line2 = "ATTACK - SPACE";

    const glyphW = this.CELL * this.FONT_SCALE;
    const x1 = Math.round((this.viewW - line1.length * glyphW) / 2);
    const x2 = Math.round((this.viewW - line2.length * glyphW) / 2);

    // Place over deep-ground strip near bottom.
    const y2 = this.viewH - Math.round(this.CELL * this.FONT_SCALE) - 4;
    const y1 = y2 - Math.round(this.CELL * this.FONT_SCALE) - 2;

    tint("#ffffff");
    this._drawBitmapLine(line1, x1, y1);
    this._drawBitmapLine(line2, x2, y2);
    noTint();
  }

  _drawBitmapLine(str, x, y) {
    const fontImg = this.assets?.fontImg;
    if (!fontImg) return;

    const dw = this.CELL * this.FONT_SCALE;
    const dh = this.CELL * this.FONT_SCALE;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const idx = this.FONT_CHARS.indexOf(ch);
      if (idx === -1) continue;

      const sx = (idx % this.FONT_COLS) * this.CELL;
      const sy = Math.floor(idx / this.FONT_COLS) * this.CELL;

      image(
        fontImg,
        Math.round(x + i * dw),
        Math.round(y),
        dw,
        dh,
        sx,
        sy,
        this.CELL,
        this.CELL,
      );
    }
  }

  _letterOnSolid(s) {
    const level = this._game?.level;
    if (!level) return false;

    return (
      (!!level.ground && s.overlapping(level.ground)) ||
      (!!level.groundDeep && s.overlapping(level.groundDeep)) ||
      (!!level.platformsL && s.overlapping(level.platformsL)) ||
      (!!level.platformsR && s.overlapping(level.platformsR)) ||
      (!!level.wallsL && s.overlapping(level.wallsL)) ||
      (!!level.wallsR && s.overlapping(level.wallsR))
    );
  }

  _cleanup() {
    // Remove letter sprites
    for (const s of this._letterSprites) {
      if (!s.removed) s.remove();
    }
    this._letterSprites = [];
    this._releasedDynamicLetters = [];

    // Remove letter groups
    if (this._letterGroups) {
      for (const g of Object.values(this._letterGroups)) {
        g.removeAll();
      }
      this._letterGroups = null;
    }

    if (this._game?.level) {
      this._game.level.extraSolidGroups = [];
    }

    // Unsubscribe attack listener
    if (this._attackUnsub) {
      this._attackUnsub();
      this._attackUnsub = null;
    }

    // Remove all sprites from the title level
    // (Game/Level sprites need to be cleared before building level 1)
    for (const s of [...allSprites]) {
      s.joints?.removeAll?.();
      s.remove();
    }
  }
}
