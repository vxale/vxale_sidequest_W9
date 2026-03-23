// src/Game.js
// Game orchestrator (WORLD coordinator + SYSTEM wiring).
//
// Responsibilities:
// - Own the EventBus instance (system messaging)
// - Own InputManager snapshot flow (kb boundary)
// - Wire SoundManager + DebugOverlay to EventBus events
// - Build and update the active Level (world container)
// - Handle restart and high-level flow (state machine as project grows)
//
// Non-goals:
// - Does NOT handle camera/parallax/background drawing (VIEW layer in main.js)
// - Does NOT contain per-entity behavior (Player/Boar/etc. own that logic)
// - Does NOT load JSON documents directly (LevelLoader does)
//
// Architectural notes:
// - Game sits between SYSTEM modules and WORLD simulation.
// - main.js remains the VIEW/orchestration layer for rendering setup.

import { EventBus } from "./EventBus.js";
import { EVENTS } from "./EventNames.js";
import { Level } from "./Level.js";
import { HighScoreManager } from "./HighScoreManager.js";

export class Game {
  constructor(levelPkg, assets, opts = {}) {
    this.pkg = levelPkg;
    this.assets = assets;
    this.hudGfx = opts.hudGfx || null;

    // core systems
    this.events = new EventBus();

    // plug-in systems
    this.input = opts.inputManager || null;
    this.sound = opts.soundManager || null;
    this.debug = opts.debugOverlay || null;

    // highscores (SYSTEM)
    this.highScores = opts.highScores || new HighScoreManager();

    // world
    this.level = null;

    // high-level flow flags (WORLD-coordinator state)
    this.lost = false;

    // win/score UI state (VIEW reads these)
    this.won = false; // mirror of level.won but latched for UI convenience
    this.elapsedMs = 0; // mirror of level.elapsedMs (timer in Level)
    this.bestMs = null; // best time for this level id (if you also store per-level best)
    this.lastWinMs = null; // time you just finished with
    this.lastWinWasNewBest = false;

    // leaderboard UI state (top 5)
    this.topScores = []; // [{ name, ms }, ...]
    this.lastRank = null; // 0-4 if in top 5, else null

    // name-entry flow
    this.awaitingName = false; // if true, WinScreen should show name entry UI
    this.nameEntry = "AAA"; // editable 3 letters
    this._nameCursor = 0; // 0..2
    this._blink = 0;

    // internal guard so we submit highscores ONCE per win
    this._submittedWin = false;

    // win screen state machine: "default" | "enter-initials" | "show-highscores"
    this.winScreenState = "default";

    this._unsubs = [];
  }

  build() {
    this.level = new Level(this.pkg, this.assets, {
      hudGfx: this.hudGfx,
      events: this.events,
    });
    this.level.build();

    // init leaderboard snapshot (per-level)
    const levelId = this._levelId();
    this.topScores = this.highScores.getTop?.(levelId) ?? [];
    this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;

    this._wireEventListeners();
    return this;
  }

  _levelId() {
    // Prefer an explicit id if you store one in levels.json.
    // Fall back to your known start id.
    return this.pkg?.level?.id ?? this.pkg?.level?.levelId ?? "ex5_level1";
  }

  _wireEventListeners() {
    // re-wire safely (one set of listeners per Game instance)
    this._unsubs.forEach((u) => u());
    this._unsubs = [];

    // -----------------------
    // WORLD flow listeners
    // -----------------------
    this._unsubs.push(
      this.events.on(EVENTS.PLAYER_DIED, () => {
        this.lost = true;
      }),
    );

    // When the level is won, latch + submit time ONCE.
    this._unsubs.push(
      this.events.on(EVENTS.LEVEL_WON, () => {
        this.won = true;

        // freeze the visible timer at win moment (Level should stop ticking too,
        // but this makes UI robust even if Level internals change)
        this.elapsedMs = Number(this.level?.elapsedMs ?? this.elapsedMs ?? 0);

        if (this._submittedWin) return;
        this._submittedWin = true;

        const t = Number(this.level?.elapsedMs ?? 0);
        this.lastWinMs = t;

        // Insert into per-level leaderboard
        const levelId = this._levelId();
        const res = this.highScores.submit?.(levelId, "___", t) ?? {
          rank: null,
          top: [],
        };
        this.topScores = res.top ?? this.topScores;
        this.lastRank = Number.isFinite(res.rank) ? res.rank : null;
        this.winScreenState = "default";
        this.awaitingName = false;
      }),
    );

    // Clear terminal flags when the level restarts
    this._unsubs.push(
      this.events.on(EVENTS.LEVEL_RESTARTED, () => {
        this.lost = false;
        this.won = false;

        this._submittedWin = false;

        this.elapsedMs = 0;
        this.lastWinMs = null;
        this.lastWinWasNewBest = false;

        this.awaitingName = false;
        this.lastRank = null;
        this.nameEntry = "AAA";
        this._nameCursor = 0;
        this._blink = 0;

        // refresh snapshots
        this.topScores = this.highScores.getTop?.(5) ?? [];
        const levelId = this._levelId();
        this.bestMs = this.highScores.getBestTime?.(levelId) ?? null;
      }),
    );

    // -----------------------
    // SYSTEM listeners (sound/debug)
    // -----------------------
    if (this.sound) {
      const soundEventMap = {
        [EVENTS.LEAF_COLLECTED]: "leafCollect",
        [EVENTS.PLAYER_DAMAGED]: "receiveDamage",
        [EVENTS.PLAYER_JUMPED]: "jump",
        [EVENTS.PLAYER_DIED]: "die",
        [EVENTS.LEVEL_WON]: "win",
        [EVENTS.BOAR_DAMAGED]: "hitEnemy",
        [EVENTS.LETTER_HIT]: "hitEnemy",
      };

      for (const [eventName, soundName] of Object.entries(soundEventMap)) {
        this._unsubs.push(
          this.events.on(eventName, () => this.sound.play(soundName)),
        );
      }
    }

    if (this.debug) {
      this._unsubs.push(this.events.on("*", (evt) => this.debug.log?.(evt)));
    }
  }

  update() {
    // Input boundary is centralized in InputManager.
    // If no input manager is injected, use a neutral snapshot.
    const inputSnap = {
      left: false,
      right: false,
      jumpPressed: false,
      attackPressed: false,
      restartPressed: false,
      debugTogglePressed: false,
      enterPressed: false,
      ePressed: false,
      vPressed: false,
      typedChar: null,
      backspacePressed: false,
      ...(this.input ? (this.input.update(), this.input.input) : null),
    };

    if (inputSnap?.debugTogglePressed && this.debug) {
      this.debug.toggle();
    }

    // Skip world simulation in terminal states (won/lost) to avoid lag
    if (!(this.won || this.lost)) {
      this.level.update({ input: inputSnap });
    } else {
      for (const s of allSprites) {
        if (s.ani) s.ani.playing = false;
        if (s.vel) {
          s.vel.x = 0;
          s.vel.y = 0;
        }
      }
    }

    // Mirror timer + win state for VIEW convenience
    // - If won/lost, keep elapsedMs frozen at the last value we latched.
    const levelElapsed = Number(this.level?.elapsedMs ?? 0);
    const levelWon = this.level?.won === true;

    const dead = this.lost === true || this.level?.player?.dead === true;
    const terminal = levelWon || dead || this.won;

    if (!terminal) {
      this.elapsedMs = levelElapsed;
    } else if (!Number.isFinite(this.elapsedMs)) {
      this.elapsedMs = levelElapsed;
    }

    this.won = levelWon || this.won === true;

    // -----------------------
    // Win screen state transitions (E / V / Enter)
    // -----------------------
    const wasAwaitingName = this.awaitingName;

    if (this.won && !this.awaitingName) {
      if (this.winScreenState === "default") {
        if (inputSnap?.ePressed && this.lastRank !== null) {
          this.winScreenState = "enter-initials";
          this.awaitingName = true;
          this.nameEntry = "___";
          this._nameCursor = 0;
          this._blink = 0;
        } else if (inputSnap?.vPressed && this.lastRank === null) {
          this.winScreenState = "show-highscores";
        }
      }
    }

    // -----------------------
    // Name-entry controls (keyboard typing)
    // -----------------------
    if (wasAwaitingName) {
      this._blink = (this._blink + 1) % 60;

      if (inputSnap?.typedChar) {
        this.nameEntry =
          this.nameEntry.substring(0, this._nameCursor) +
          inputSnap.typedChar +
          this.nameEntry.substring(this._nameCursor + 1);
        this._nameCursor = (this._nameCursor + 1) % 3;
      }

      if (inputSnap?.backspacePressed) {
        this._nameCursor = (this._nameCursor - 1 + 3) % 3;
        this.nameEntry =
          this.nameEntry.substring(0, this._nameCursor) +
          "_" +
          this.nameEntry.substring(this._nameCursor + 1);
      }

      if (inputSnap?.enterPressed) {
        this._commitNameEntry();
        this.winScreenState = "show-highscores";
      }
    }

    // Restart only allowed from terminal states, not during name entry
    if (inputSnap?.restartPressed && (this.won || dead) && !this.awaitingName) {
      this.restart();
    }
  }

  _cycleNameChar(dir) {
    // dir: +1 or -1
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const idx = this._nameCursor;
    const cur = this.nameEntry[idx] ?? "A";
    const at = Math.max(0, chars.indexOf(cur));
    const next = (at + dir + chars.length) % chars.length;
    this.nameEntry =
      this.nameEntry.substring(0, idx) +
      chars[next] +
      this.nameEntry.substring(idx + 1);
  }

  _commitNameEntry() {
    if (this.lastRank === null) {
      this.awaitingName = false;
      return;
    }
    // Set the initials for the player's score in the high score table
    const levelId = this._levelId();
    if (typeof this.highScores.setNameAt === "function") {
      this.highScores.setNameAt(levelId, this.lastRank, this.nameEntry);
      this.topScores = this.highScores.getTop?.(levelId) ?? this.topScores;
    }
    this.awaitingName = false;
  }

  draw({ drawHudFn } = {}) {
    this.level.drawWorld();
    drawHudFn?.();

    if (this.debug) this.debug.draw?.({ game: this });
  }

  restart() {
    // reset coordinator flags immediately
    this.lost = false;
    this.won = false;

    this._submittedWin = false;

    this.elapsedMs = 0;
    this.lastWinMs = null;
    this.lastWinWasNewBest = false;

    this.awaitingName = false;
    this.lastRank = null;
    this.nameEntry = "AAA";
    this._nameCursor = 0;
    this._blink = 0;
    this.winScreenState = "default";

    this.level.restart();

    // Re-enable animations that were frozen during terminal state
    for (const s of allSprites) {
      if (s.ani) s.ani.playing = true;
    }

    // refresh leaderboard snapshot
    const levelId = this._levelId();
    this.topScores = this.highScores.getTop?.(levelId) ?? this.topScores;
  }
}
