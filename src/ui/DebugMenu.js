// src/ui/DebugMenu.js
import { updateAllBoarProbeVisibility } from "../entities/Boar.js";
// Debug menu overlay (VIEW/UI layer)
//
// Responsibilities:
// - Show/hide on backtick (`) key
// - Let user toggle debug features: boar probes, collision boxes, player invincibility, win condition
// - Update global debug state for use by WORLD logic
//
// Non-goals:
// - Does NOT change world state directly (WORLD reads debug state)
// - Does NOT log events (DebugOverlay does that)
//
// Usage:
// - Import and instantiate in main.js
// - Call draw() in main draw loop if enabled

export class DebugMenu {
  constructor(debugState) {
    this.debugState = debugState;
    this.enabled = false;
    this.options = [
      { label: "Show Boar Probes", key: "boarProbes" },
      { label: "Show Collision Boxes", key: "collisionBoxes" },
      { label: "Player Invincible", key: "playerInvincible" },
      { label: "Win Condition = 1", key: "winScoreOne" },
    ];
    this.selected = 0;
  }

  toggle() {
    this.enabled = !this.enabled;
    // Pause/unpause game
    window.gamePaused = this.enabled;
    // When menu is shown/hidden, update probe visibility in case it changed
    updateAllBoarProbeVisibility(this.debugState.boarProbes);
    // If unpausing, resume all animations
    if (!this.enabled) {
      for (const s of allSprites) {
        if (s.ani) s.ani.playing = true;
      }
    }
  }

  handleInput(evt) {
    if (!this.enabled) return false;
    if (evt.key === "ArrowUp") {
      this.selected =
        (this.selected + this.options.length - 1) % this.options.length;
      return true;
    }
    if (evt.key === "ArrowDown") {
      this.selected = (this.selected + 1) % this.options.length;
      return true;
    }
    if (evt.key === " " || evt.key === "Enter") {
      const opt = this.options[this.selected];
      this.debugState[opt.key] = !this.debugState[opt.key];
      // If boarProbes was toggled, update probe visibility immediately
      if (opt.key === "boarProbes") {
        updateAllBoarProbeVisibility(this.debugState.boarProbes);
        // Mirror legacy global for compatibility
        window.showBoarProbes = this.debugState.boarProbes;
        // Dispatch event for any listeners
        window.dispatchEvent(new Event("boarProbeDebugToggle"));
      }
      return true;
    }
    return false;
  }

  draw() {
    if (!this.enabled) return;
    camera.off();
    push();
    fill(0, 220);
    rect(20, 20, 200, 120, 10);
    textSize(16);
    fill(255);
    text("DEBUG MENU", 40, 45);
    textSize(13);
    for (let i = 0; i < this.options.length; ++i) {
      const opt = this.options[i];
      const y = 70 + i * 22;
      fill(i === this.selected ? "#ff0" : "#fff");
      const val = this.debugState[opt.key] ? "ON" : "OFF";
      text(`${opt.label}: ${val}`, 40, y);
    }
    pop();
    camera.on();
  }
}
