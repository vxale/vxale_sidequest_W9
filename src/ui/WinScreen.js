// src/WinScreen.js
// Win overlay screen (VIEW layer).
//
// Responsibilities:
// - Render win-state overlay in screen-space (camera.off())
// - Display completion message + relevant stats (time, score, leaderboard)
// - Provide prompts for restart / submission actions (UI only)
//
// Non-goals:
// - Does NOT modify world state directly (Game/Level do)
// - Does NOT compute high scores (HighScoreManager does)
// - Does NOT poll kb directly (InputManager -> Game)
//
// Architectural notes:
// - Game decides when to show WinScreen (based on Level.won).
// - Keeps UI rendering separate from gameplay simulation.

export class WinScreen {
  constructor(pkg, assets) {
    this.pkg = pkg;
    this.assets = assets;

    // Bitmap font config (same charmap used in Level HUD)
    this.FONT_COLS = pkg.tuning?.hud?.fontCols ?? 19;
    this.CELL = pkg.tuning?.hud?.cell ?? 30;

    this.GLYPH_DRAW = 10; // draw size: 30/3 = crisp integer scale
    this.GLYPH_W = 8; // spacing between characters (tighter than draw size)

    this.FONT_CHARS =
      pkg.tuning?.hud?.fontChars ??
      " !\"#$%&'()*+,-./0123456789:;<=>?@" +
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
        "abcdefghijklmnopqrstuvwxyz{|}~";
  }

  draw({
    elapsedMs,
    topScores = [],
    awaitingName = false,
    nameEntry = "AAA",
    nameCursor = 0,
    blink = 0,
    lastRank = null,
    winScreenState = "default",
  } = {}) {
    const viewW = this.pkg.view?.viewW ?? this.pkg.view?.w ?? 240;
    const viewH = this.pkg.view?.viewH ?? this.pkg.view?.h ?? 192;

    camera.off();
    drawingContext.imageSmoothingEnabled = false;
    push();
    noStroke();
    fill(0, 120);
    rect(0, 0, viewW, viewH);
    pop();

    if (winScreenState === "default") {
      const msg1 = "YOU WIN!";
      const msg2 = `TIME: ${formatTimeMs(elapsedMs ?? 0)}`;
      const x1 = Math.round((viewW - msg1.length * this.GLYPH_W) / 2);
      const x2 = Math.round((viewW - msg2.length * this.GLYPH_W) / 2);
      let y = Math.round(viewH / 2 - 44);
      this._drawOutlined(window, msg1, x1, y, "#00e5ff");
      y += 28;
      this._drawOutlined(window, msg2, x2, y, "#ffdc00");
      y += 28;
      let prompt1, prompt2;
      if (lastRank !== null) {
        prompt1 = "Press E to enter initials";
      } else {
        prompt1 = "Press V to view high scores";
      }
      prompt2 = "Press R to restart";
      const xP1 = Math.round((viewW - prompt1.length * this.GLYPH_W) / 2);
      const xP2 = Math.round((viewW - prompt2.length * this.GLYPH_W) / 2);
      this._drawOutlined(window, prompt1, xP1, y, "#ffffff");
      y += 22;
      this._drawOutlined(window, prompt2, xP2, y, "#ffffff");
    } else if (winScreenState === "enter-initials") {
      let y = 10;
      const header = "HIGH SCORES:";
      const xH = Math.round((viewW - header.length * this.GLYPH_W) / 2);
      this._drawOutlined(window, header, xH, y, "#ffffff");
      y += 24;
      const col1 = Math.round(viewW / 2 - 70);
      const col2 = Math.round(viewW / 2 + 30);
      this._drawOutlined(window, "Initial", col1, y, "#bbbbbb");
      this._drawOutlined(window, "Time", col2, y, "#bbbbbb");
      y += 20;
      for (let i = 0; i < 5; i++) {
        const entry = topScores[i] || { name: "---", ms: 0 };
        let nameStr = entry.name;
        let color = "#ffffff";
        if (lastRank === i) color = "#00ff7a";
        if (awaitingName && lastRank === i) {
          // Draw each character individually: current cursor char is bright, rest are dimmer
          const rowColor = "#00ff7a";
          const cursorColor = "#ffdc00";
          for (let j = 0; j < 3; j++) {
            const ch = nameEntry[j] || "_";
            const cx = Math.round(col1 + j * this.GLYPH_W);
            this._drawOutlined(
              window,
              ch,
              cx,
              y,
              j === nameCursor ? cursorColor : rowColor,
            );
          }
        } else {
          this._drawOutlined(window, nameStr, col1, y, color);
        }
        let timeStr = entry.ms ? formatTimeMs(entry.ms) : "--:--.--";
        this._drawOutlined(window, timeStr, col2, y, color);
        y += 18;
      }
      y += 8;
      const prompt = "Type initials, ENTER to save";
      const xP = Math.round((viewW - prompt.length * this.GLYPH_W) / 2);
      this._drawOutlined(window, prompt, xP, y, "#ffffff");
    } else if (winScreenState === "show-highscores") {
      let y = 10;
      const header = "HIGH SCORES";
      const xH = Math.round((viewW - header.length * this.GLYPH_W) / 2);
      this._drawOutlined(window, header, xH, y, "#ffffff");
      y += 24;
      const col1 = Math.round(viewW / 2 - 70);
      const col2 = Math.round(viewW / 2 + 30);
      for (let i = 0; i < 5; i++) {
        const entry = topScores[i] || { name: "---", ms: 0 };
        let nameStr = entry.name;
        let color = lastRank === i ? "#00ff7a" : "#ffffff";
        let timeStr = entry.ms ? formatTimeMs(entry.ms) : "--:--.--";
        this._drawOutlined(window, nameStr, col1, y, color);
        this._drawOutlined(window, timeStr, col2, y, color);
        y += 18;
      }
      y += 8;
      const prompt = "Press R to restart";
      const xP = Math.round((viewW - prompt.length * this.GLYPH_W) / 2);
      this._drawOutlined(window, prompt, xP, y, "#ffffff");
    }

    camera.on();
    noTint();
  }

  _drawOutlined(g, str, x, y, fillHex) {
    g.tint("#000000");
    this._drawBitmap(g, str, x - 1, y);
    this._drawBitmap(g, str, x + 1, y);
    this._drawBitmap(g, str, x, y - 1);
    this._drawBitmap(g, str, x, y + 1);

    g.tint(fillHex);
    this._drawBitmap(g, str, x, y);

    g.noTint();
  }

  _drawBitmap(g, str, x, y) {
    const fontImg = this.assets.fontImg;
    if (!fontImg) return;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const idx = this.FONT_CHARS.indexOf(ch);
      if (idx === -1) continue;
      const sx = (idx % this.FONT_COLS) * this.CELL;
      const sy = Math.floor(idx / this.FONT_COLS) * this.CELL;
      g.image(
        fontImg,
        Math.round(x + i * this.GLYPH_W),
        Math.round(y),
        this.GLYPH_DRAW,
        this.GLYPH_DRAW,
        sx,
        sy,
        this.CELL,
        this.CELL,
      );
    }
  }
}

function formatTimeMs(ms) {
  ms = Number(ms) || 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const hh = Math.floor((ms % 1000) / 10);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const hs = String(hh).padStart(2, "0");
  return `${mm}:${ss}.${hs}`;
}
