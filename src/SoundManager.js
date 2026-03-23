// src/SoundManager.js
// Audio playback (SYSTEM layer).
//
// Responsibilities:
// - Load sound assets during preload() (via loadSound)
// - Play sounds by key (SFX/music)
// - Provide a simple abstraction so gameplay code never touches audio directly
//
// Non-goals:
// - Does NOT subscribe to EventBus directly (Game wires events → play())
// - Does NOT decide when events happen (WORLD logic emits events)
// - Does NOT manage UI
//
// Architectural notes:
// - Game connects EventBus events (leaf:collected, player:damaged, etc.) to SoundManager.play().
// - This keeps audio concerns isolated from gameplay and supports easy swapping/muting.

export class SoundManager {
  constructor() {
    this.sfx = {};
  }

  load(name, path) {
    this.sfx[name] = loadSound(path);
  }

  play(name) {
    this.sfx[name]?.play();
  }

  playLoop(name) {
    const snd = this.sfx[name];
    if (!snd) return;

    if (typeof snd.isPlaying === "function" && snd.isPlaying()) return;

    if (typeof snd.setLoop === "function") snd.setLoop(true);
    if (typeof snd.loop === "function") {
      snd.loop();
      return;
    }

    snd.play?.();
  }

  stop(name) {
    this.sfx[name]?.stop?.();
  }
}
