// src/world/HUDRenderer.js
// HUD rendering (VIEW helper).
//
// Responsibilities:
// - Draw HUD into a screen-space graphics buffer (hudGfx)
// - Redraw only when values change (score/health)
// - Keep all HUD code out of Level's core simulation logic
//
// Non-goals:
// - Does NOT move camera or draw world sprites
// - Does NOT change game rules
// - Does NOT render timer (time is tracked in Level/Game but not displayed here)

export function maybeRedrawHUD(level) {
  if (!level?.hudGfx || !level.assets?.fontImg) return;

  // PlayerEntity owns health; PlayerController is just the brain.
  const health = level.player?.health ?? level.playerCtrl?.player?.health ?? 0;
  const maxHealth =
    level.player?.maxHealth ?? level.playerCtrl?.player?.maxHealth ?? 0;

  if (
    level.score !== level._lastScore ||
    health !== level._lastHealth ||
    maxHealth !== level._lastMaxHealth
  ) {
    redrawHUD(level);
    level._lastScore = level.score;
    level._lastHealth = health;
    level._lastMaxHealth = maxHealth;
  }
}

export function redrawHUD(level) {
  const g = level?.hudGfx;
  if (!g || !level.assets?.fontImg) return;

  const FONT_COLS = level.tuning?.hud?.font?.cols ?? 19;
  const CELL = level.tuning?.hud?.font?.cell ?? 30;
  const FONT_SCALE = level.tuning?.hud?.font?.scale ?? 1 / 3;
  const GLYPH_W = CELL * FONT_SCALE;

  const FONT_CHARS =
    level.tuning?.hud?.fontChars ??
    " !\"#$%&'()*+,-./0123456789:;<=>?@" +
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
      "abcdefghijklmnopqrstuvwxyz{|}~";

  // Use PlayerEntity health (authoritative)
  const health = level.player?.health ?? level.playerCtrl?.player?.health ?? 0;
  const maxHealth =
    level.player?.maxHealth ?? level.playerCtrl?.player?.maxHealth ?? 0;

  const drawBitmap = (str, x, y, scale = FONT_SCALE) => {
    str = String(str);
    const dw = CELL * scale;
    const dh = CELL * scale;

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const idx = FONT_CHARS.indexOf(ch);
      if (idx === -1) continue;

      const col = idx % FONT_COLS;
      const row = Math.floor(idx / FONT_COLS);

      const sx = col * CELL;
      const sy = row * CELL;

      g.image(
        level.assets.fontImg,
        Math.round(x + i * dw),
        Math.round(y),
        dw,
        dh,
        sx,
        sy,
        CELL,
        CELL,
      );
    }
  };

  const drawOutlined = (str, x, y, fillHex) => {
    g.tint("#000000");
    drawBitmap(str, x - 1, y);
    drawBitmap(str, x + 1, y);
    drawBitmap(str, x, y - 1);
    drawBitmap(str, x, y + 1);

    g.tint(fillHex);
    drawBitmap(str, x, y);

    g.noTint();
  };

  // Clear & prep the HUD buffer
  g.clear();
  g.drawingContext.imageSmoothingEnabled = false;
  g.imageMode(CORNER);

  // Score
  const label = level.tuning?.hud?.rescueLabel ?? "RESCUED";
  drawOutlined(`${label} ${level.score}/${level.WIN_SCORE}`, 6, 6, "#ffdc00");

  // Hearts
  const heartChar = "~";
  const heartX = 200;
  const heartY = 6;
  const spacing = GLYPH_W + 2;

  for (let i = 0; i < maxHealth; i++) {
    const x = heartX + i * spacing;
    const col = i < health ? "#ff5050" : "#783030";
    drawOutlined(heartChar, x, heartY, col);
  }
}
