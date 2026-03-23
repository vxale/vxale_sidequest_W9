// main.js
// Sketch entry point (VIEW + orchestration layer).
//
// Responsibilities:
// - Load tuning.json and levels.json via LevelLoader
// - Preload assets (images, animations, audio, parallax layers)
// - Create Canvas and configure pixel-perfect rendering
// - Instantiate and wire core systems (Game + input/sound/debug)
// - Draw VIEW elements (background colour, parallax, HUD composite)
// - Own VIEW setup: canvas size, integer scaling, parallax draw, HUD composite
// - Boot the WORLD: load JSON, preload assets, create Game + systems
//
// Non-goals:
// - Does NOT implement gameplay rules (WORLD logic lives in Level/entities)
// - Does NOT manage camera logic inside world update (VIEW modules do)
// - Does NOT contain entity behavior or physics setup beyond global world settings
//
// Architectural notes:
// - main.js owns VIEW setup (canvas sizing, scaling, parallax, background colour).
// - Game owns WORLD orchestration (EventBus, Level lifecycle, system wiring).
// - world.autoStep = false for stable pixel rendering; world.step() happens during world update.
//
// Important:
// - This file is loaded as a JS module (type="module").
// - In module scope, p5 will NOT automatically find setup/draw.
//   We MUST attach setup/draw (and input callbacks) to window.
//
// Notes:
// - Browsers block audio autoplay. We unlock audio on the first click/key press.
//
// Dependencies (loaded in index.html before this file):
// - p5.js
// - p5.sound (optional but required for loadSound)
// - p5play

import { LevelLoader } from "./src/LevelLoader.js";
import { Game } from "./src/Game.js";
import { ParallaxBackground } from "./src/ParallaxBackground.js";
import { loadAssets } from "./src/AssetLoader.js";
import {
  applyIntegerScale,
  installResizeHandler,
} from "./src/utils/IntegerScale.js";

import { CameraController } from "./src/CameraController.js";
import { InputManager } from "./src/InputManager.js";
import { SoundManager } from "./src/SoundManager.js";
import { DebugOverlay } from "./src/DebugOverlay.js";

import { WinScreen } from "./src/ui/WinScreen.js";
import { LoseScreen } from "./src/ui/LoseScreen.js";
import { DebugMenu } from "./src/ui/DebugMenu.js";
import { TitleScreen } from "./src/ui/TitleScreen.js";

/* -----------------------------------------------------------
   HIGH SCORE SYSTEM
   -----------------------------------------------------------
   System responsible for persisting leaderboard data locally
   using localStorage. It is initialized here and injected into
   Game so WORLD logic can submit scores when a level completes.
----------------------------------------------------------- */

import { HighScoreManager } from "./src/HighScoreManager.js";

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// p5 loadJSON is callback-based. This wrapper lets us use async/await reliably.
function loadJSONAsync(url) {
  return new Promise((resolve, reject) => {
    loadJSON(url, resolve, reject);
  });
}

// Browsers block audio until a user gesture.
// We unlock it once and never think about it again.
let audioUnlocked = false;

function startMusicLoopIfReady() {
  if (!audioUnlocked) return;
  soundManager?.playLoop?.("music");
}

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (typeof userStartAudio === "function") userStartAudio();
  startMusicLoopIfReady();
}

// Prevent the browser from stealing keys (space/arrows) for scrolling.
function preventKeysThatScroll(evt) {
  const k = (evt?.key ?? "").toLowerCase();
  const scrollKeys = [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  if (scrollKeys.includes(k)) {
    evt.preventDefault?.();
    return false;
  }
  return true;
}

// ------------------------------------------------------------
// State (WORLD + VIEW glue)
// ------------------------------------------------------------

let game; // WORLD orchestrator (updates + draws world)
let parallax; // VIEW background parallax
let hudGfx; // VIEW overlay buffer (screen-space)

let tuningDoc; // Data: tuning.json
let titlePkg; // Data package for the title screen level
let levelPkg; // Data package from LevelLoader (level + view + world + tiles)
let assets; // Preloaded assets bundle
let loader; // LevelLoader instance (reused for both levels)

let cameraController; // VIEW: follow + clamp camera to world bounds
let inputManager; // SYSTEM: keyboard snapshot
let soundManager; // SYSTEM: audio registry
let debugOverlay; // VIEW/SYSTEM: debug UI

// Global debug state (shared by DebugMenu and WORLD logic)
window.debugState = {
  boarProbes: false,
  collisionBoxes: false,
  playerInvincible: false,
  winScoreOne: false,
};
let debugMenu;

/* -----------------------------------------------------------
   HIGH SCORE SYSTEM STATE
----------------------------------------------------------- */

let highScoreManager;
let seedHighScores;

let winScreen;
let loseScreen;
let titleScreen;
let showTitle = true; // Start on title screen
let parallaxLayers = []; // Preloaded parallax layer defs [{ img, factor }, ...]

// Make URLs absolute so they can’t accidentally resolve relative to /src/...
const LEVELS_URL = new URL("./data/levels.json", window.location.href).href;
const TUNING_URL = new URL("./data/tuning.json", window.location.href).href;

// Level ids in levels.json
const TITLE_LEVEL_ID = "title_screen";
const GAME_LEVEL_ID = "ffa_level1";

// Fade-in state for level 1 transition
let fadeInAlpha = 0;
let fadingIn = false;

function buildParallaxLayers(pkg) {
  const defs = pkg?.level?.view?.parallax ?? [];
  return defs
    .map((d) => ({
      img: loadImage(d.img),
      factor: Number(d.speed ?? 0),
    }))
    .filter((l) => l.img);
}

function configureRuntimeView(viewW, viewH) {
  resizeCanvas(viewW, viewH);
  pixelDensity(1);
  noSmooth();
  drawingContext.imageSmoothingEnabled = false;

  applyIntegerScale(viewW, viewH);
  installResizeHandler(viewW, viewH);

  hudGfx = createGraphics(viewW, viewH);
  hudGfx.noSmooth();
  hudGfx.pixelDensity(1);
}

function clearP5PlayTileGroups() {
  const groups = window.p5play?.groups;
  if (!groups || typeof groups !== "object") return;

  for (const g of Object.values(groups)) {
    if (!g) continue;

    // Drop all lingering sprites from old level groups.
    g.removeAll?.();

    // Important: Tiles() picks groups by `tile` globally.
    // Clearing this prevents old title-screen groups from hijacking level-1 spawns.
    if ("tile" in g) g.tile = "";
  }
}

// Boot flags
let bootStarted = false;
let bootDone = false;

// ------------------------------------------------------------
// Boot pipeline (async) — runs from setup()
// ------------------------------------------------------------

async function boot() {
  console.log("BOOT: start");

  // --- Data ---
  tuningDoc = await loadJSONAsync(TUNING_URL);

  /* -----------------------------------------------------------
     Load High Score Seed Data

     This JSON file provides default leaderboard entries for
     first-time players. The HighScoreManager will copy this
     data into localStorage ONLY if storage is empty.
  ----------------------------------------------------------- */

  seedHighScores = await loadJSONAsync("./data/highscores.json");

  loader = new LevelLoader(tuningDoc);

  // Load the title screen level first (used during boot)
  titlePkg = await loader.load(LEVELS_URL, TITLE_LEVEL_ID);

  // --- Assets (images/animations/etc.) ---
  // Assets are shared between title and game levels (same sprite sheets/tiles)
  assets = await loadAssets(titlePkg, tuningDoc);

  // --- Audio registry ---
  // (AudioContext may still be locked until the user clicks/presses a key.)
  soundManager = new SoundManager();
  soundManager.load("music", "assets/sfx/music.wav");
  soundManager.load("jump", "assets/sfx/jump.wav");
  soundManager.load("hitEnemy", "assets/sfx/hitEnemy.wav");
  soundManager.load("leafCollect", "assets/sfx/leafCollect.wav");
  soundManager.load("receiveDamage", "assets/sfx/receiveDamage.wav");

  /* -----------------------------------------------------------
     HIGH SCORE SYSTEM INITIALIZATION

     Creates the persistence system for leaderboards.
     The seed JSON is only applied the first time the game
     runs in a browser.
  ----------------------------------------------------------- */

  highScoreManager = new HighScoreManager("gbda302_highscores_v2", {
    maxEntries: 5,
    seed: seedHighScores,
    defaultLevelId: "ffa_level1",
  });

  // --- Parallax layer defs (VIEW) ---
  parallaxLayers = buildParallaxLayers(titlePkg);

  // If audio was already unlocked before boot completed, start music now.
  startMusicLoopIfReady();

  // Now that all data is ready, build the WORLD + VIEW runtime.
  initRuntime();

  // Build a Game for the title screen level
  const titleGame = new Game(titlePkg, assets, {
    hudGfx,
    inputManager,
    soundManager,
    debugOverlay: null,
    highScores: highScoreManager,
  });
  titleGame.build();

  // Camera for title level
  cameraController = new CameraController(titlePkg);
  cameraController.setTarget(titleGame.level.playerCtrl.sprite);
  cameraController.reset();

  // Title screen overlay (manages letter sprites + fade)
  titleScreen = new TitleScreen(titlePkg, assets);
  titleScreen.init(titleGame);

  // Store title game reference for draw loop
  game = titleGame;
  window.game = game;

  bootDone = true;
  console.log("BOOT: done");
}

// ------------------------------------------------------------
// Runtime init (sync) — called after boot() finishes
// ------------------------------------------------------------

function initRuntime() {
  const { viewW, viewH } = titlePkg.view;

  // Configure canvas + HUD for the active level view.
  configureRuntimeView(viewW, viewH);

  // Keep timing stable (p5play anims feel best when p5 is targeting 60).
  frameRate(60);

  // Sprite rendering
  allSprites.pixelPerfect = true;

  // Physics: manual step for stable pixel rendering
  world.autoStep = false;

  // Systems
  inputManager = new InputManager();
  debugOverlay = new DebugOverlay();
  debugMenu = new DebugMenu(window.debugState);

  // VIEW: parallax background renderer (needed for title screen too)
  parallax = new ParallaxBackground(parallaxLayers);

  loop();
}

// ------------------------------------------------------------
// Build the gameplay level (called when title screen is dismissed)
// ------------------------------------------------------------

async function buildGameLevel() {
  // Defensive cleanup: ensure no title sprites/state leak into gameplay.
  for (const s of [...allSprites]) {
    s.joints?.removeAll?.();
    s.remove();
  }
  clearP5PlayTileGroups();
  camera.x = 0;
  camera.y = 0;

  // Ensure gameplay is not accidentally left paused by the debug menu.
  window.gamePaused = false;
  if (debugMenu?.enabled) {
    debugMenu.enabled = false;
  }

  // Load the gameplay level package
  levelPkg = await loader.load(LEVELS_URL, GAME_LEVEL_ID);

  // Switch runtime view back to gameplay resolution (e.g. 240x192)
  configureRuntimeView(levelPkg.view.viewW, levelPkg.view.viewH);

  // Rebuild parallax for the active level (title and gameplay can differ)
  parallaxLayers = buildParallaxLayers(levelPkg);
  parallax = new ParallaxBackground(parallaxLayers);

  // WORLD
  game = new Game(levelPkg, assets, {
    hudGfx,
    inputManager,
    soundManager,
    debugOverlay,

    highScores: highScoreManager,
  });

  game.build();
  window.game = game;

  // Run one init tick so boars created from Tiles() are normalized
  // (collider replacement + probe attachment) before first playable frame.
  game.update();

  // Defensive normalization in case any stale collider state leaked across transition.
  for (const s of game.level?.leaf ?? []) {
    s.removeColliders();
  }
  for (const s of game.level?.fire ?? []) {
    s.collider = "s";
  }

  // UI overlays
  winScreen = new WinScreen(levelPkg, assets);
  loseScreen = new LoseScreen(levelPkg, assets);

  // VIEW: camera follow + clamp
  cameraController = new CameraController(levelPkg);
  cameraController.setTarget(game.level.playerCtrl.sprite);
  cameraController.reset();

  // IMPORTANT: subscribe ONCE (not in draw)
  game.events.on("level:restarted", () => {
    cameraController?.reset();
  });

  // Start fade-in effect
  fadingIn = true;
  fadeInAlpha = 255;
}

// ------------------------------------------------------------
// p5 lifecycle (module-safe)
// ------------------------------------------------------------

function setup() {
  // Create a tiny placeholder canvas immediately so p5 is happy,
  // then pause the loop until our async boot finishes.
  new Canvas(10, 10, "pixelated");
  pixelDensity(1);
  noLoop();

  if (bootStarted) return;
  bootStarted = true;

  boot().catch((err) => {
    console.error("BOOT FAILED:", err);
    // loop stays stopped so the sketch doesn't spam errors
  });
}

function draw() {
  if (!bootDone) return;

  // --- Title screen ---
  if (showTitle && titleScreen) {
    const viewW = titlePkg.view.viewW;
    const viewH = titlePkg.view.viewH;

    // Title screen update (runs the title Game internally, which calls inputManager.update())
    titleScreen.update();

    // Camera follow for title level
    cameraController?.update({
      viewW,
      viewH,
      levelW: game?.level?.bounds?.levelW ?? viewW,
      levelH: game?.level?.bounds?.levelH ?? viewH,
    });
    cameraController?.applyToP5Camera();

    titleScreen.draw({ parallax, cameraX: camera.x || 0 });

    if (titleScreen.done && !titleScreen._transitioning) {
      titleScreen._transitioning = true;

      // Stop title updates/renders immediately while gameplay level is building.
      showTitle = false;
      game = null;
      window.game = null;

      buildGameLevel()
        .then(() => {
          titleScreen = null;
        })
        .catch((err) => {
          console.error("Failed to build game level:", err);

          // If build fails, re-enable title so the user isn't stuck on a blank frame.
          showTitle = true;
          game = titleScreen?._game ?? game;
          window.game = game;
          titleScreen._transitioning = false;
        });
    }
    return;
  }

  if (!game || !levelPkg) return;

  const viewW = levelPkg.view.viewW;
  const viewH = levelPkg.view.viewH;

  // Background colour is per-level in levels.json: level.view.background
  const bg = levelPkg.level?.view?.background ?? [69, 61, 79];
  background(bg[0], bg[1], bg[2]);

  // Collision box debug toggle
  allSprites.debug = !!(window.debugState && window.debugState.collisionBoxes);

  // Parallax uses camera.x from previous frame (fine with manual stepping)
  parallax?.draw({
    cameraX: camera.x || 0,
    viewW,
    viewH,
  });

  // Keep paused state synced to debug-menu visibility.
  if (!debugMenu?.enabled && window.gamePaused) {
    window.gamePaused = false;
  }

  // Pause game update if debug menu is open
  if (!window.gamePaused) {
    game.update();
  } else {
    // Freeze all sprite animations and physics
    for (const s of allSprites) {
      if (s.ani) s.ani.playing = false;
      if (s.vel) {
        s.vel.x = 0;
        s.vel.y = 0;
      }
    }
  }

  // VIEW: camera follow + clamp (after update so player position is current)
  cameraController?.update({
    viewW,
    viewH,
    levelW: game.level.bounds.levelW,
    levelH: game.level.bounds.levelH,
  });
  cameraController?.applyToP5Camera();

  // Check terminal state for HUD/overlay decisions
  const won = game?.won === true || game?.level?.won === true;
  const dead = game?.lost === true || game?.level?.player?.dead === true;
  const elapsedMs = Number(game?.elapsedMs ?? game?.level?.elapsedMs ?? 0);

  // WORLD draw + HUD composite (hide HUD on win/lose screens)
  game.draw({
    drawHudFn:
      won || dead
        ? null
        : () => {
            camera.off();
            try {
              drawingContext.imageSmoothingEnabled = false;
              imageMode(CORNER);
              image(hudGfx, 0, 0);
            } finally {
              camera.on();
              noTint();
            }
          },
  });

  // Fade-in overlay (black rect that fades out after transitioning from title)
  if (fadingIn) {
    camera.off();
    push();
    noStroke();
    fill(0, fadeInAlpha);
    rect(0, 0, viewW, viewH);
    pop();
    camera.on();

    fadeInAlpha -= 4;
    if (fadeInAlpha <= 0) {
      fadeInAlpha = 0;
      fadingIn = false;
    }
  }

  // Draw debug menu overlay if enabled
  debugMenu?.draw();

  if (won) {
    winScreen?.draw({
      elapsedMs,
      topScores: game.topScores,
      awaitingName: game.awaitingName,
      nameEntry: game.nameEntry,
      nameCursor: game._nameCursor,
      blink: game._blink,
      lastRank: game.lastRank,
      winScreenState: game.winScreenState,
    });
  }
  if (dead) loseScreen?.draw({ elapsedMs, game });
}

// ------------------------------------------------------------
// Optional input callbacks (audio unlock feels invisible)
// ------------------------------------------------------------

function mousePressed() {
  unlockAudioOnce();
}

function keyPressed(evt) {
  unlockAudioOnce();
  // Debug menu: toggle with backtick (`) key
  if (evt && (evt.key === "`" || evt.key === "Dead")) {
    debugMenu.toggle();
    return false;
  }
  // If debug menu is open, only handle debug menu navigation/toggles
  if (window.gamePaused) {
    if (debugMenu?.enabled && debugMenu.handleInput(evt)) {
      return false;
    }
    // Block all other input
    return false;
  }
  return preventKeysThatScroll(evt);
}

// Extra safety: prevent scrolling even if p5 doesn’t route a key event you expect.
window.addEventListener(
  "keydown",
  (e) => {
    const k = (e.key ?? "").toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
    }
  },
  { passive: false },
);

// ------------------------------------------------------------
// IMPORTANT: expose p5 entrypoints in module scope
// ------------------------------------------------------------

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.keyPressed = keyPressed;
