// src/DebugOverlay.js
// Debug overlay (VIEW tool, driven by SYSTEM events).
//
// Responsibilities:
// - Render debug info in screen-space (camera.off())
// - Toggle visibility (typically via InputManager signal)
// - Log events from EventBus (including wildcard "*")
// - Display lightweight runtime state (score/health/flags/events)
//
// Non-goals:
// - Does NOT change world state, physics, or outcomes
// - Does NOT own input polling (InputManager does)
// - Does NOT subscribe to events directly (Game wires it)
//
// Architectural notes:
// - Game owns the EventBus and forwards events to DebugOverlay.log().
// - This file exists to support iteration + teaching architecture boundaries.

export class DebugOverlay {
  constructor() {
    this.enabled = false;
    this.lines = [];
    this.maxLines = 8;
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  log(evt) {
    // evt is { name, payload } from EventBus wildcard
    if (!evt) return;
    const msg = `${evt.name}`;
    this.lines.unshift(msg);
    if (this.lines.length > this.maxLines) this.lines.length = this.maxLines;
  }

  draw({ game } = {}) {
    if (!this.enabled) return;

    camera.off();

    push();
    noStroke();
    fill(0, 160);
    rect(6, 6, 228, 86, 6);
    pop();

    fill(255);
    textSize(10);

    const lvl = game?.level || null;
    const score = lvl?.score ?? 0;

    const playerCtrl = lvl?.playerCtrl || null;
    const hp = playerCtrl?.health ?? "?";
    const maxHp = playerCtrl?.maxHealth ?? "?";
    const dead = playerCtrl?.dead ?? false;
    const won = lvl?.won ?? false;

    text(`Score: ${score}`, 12, 22);
    text(`Health: ${hp}/${maxHp}`, 12, 34);
    text(`Won: ${won}  Dead: ${dead}`, 12, 46);

    let y = 62;
    for (const line of this.lines) {
      text(line, 12, y);
      y += 10;
    }

    camera.on();
  }
}