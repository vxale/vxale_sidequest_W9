// src/AssetLoader.js
// Asset loading (SYSTEM layer).
//
// Responsibilities:
// - Load image assets (tiles, spritesheets, UI, backgrounds) during preload()
// - Build animation definitions from tuning.json (including "hold": true → Infinity)
// - Return a normalized assets bundle used by Game/Level/entities
//
// Non-goals:
// - Does NOT create sprites, groups, or physics bodies
// - Does NOT decide game rules or world state
// - Does NOT draw anything to the screen
//
// Architectural notes:
// - main.js calls loadAssets() in boot().
// - Keeping assets + animation definitions separate supports data-driven tuning.

export async function loadAssets(levelPkg, tuningDoc) {
  // ---- images ----
  // IMPORTANT:
  // loadImage() is "preload-safe" only if p5 is actually tracking it inside preload().
  // To make this robust even if your boot flow uses async/await, we wrap loadImage in a Promise.
  const playerImg = await loadImageAsync("assets/foxSpriteSheet.png");
  const boarImg = await loadImageAsync("assets/boarSpriteSheet.png");
  const leafImg = await loadImageAsync("assets/leafSpriteSheet.png");
  const fireImg = await loadImageAsync("assets/fireSpriteSheet.png");

  const groundTileImg = await loadImageAsync("assets/groundTile.png");
  const groundTileDeepImg = await loadImageAsync("assets/groundTileDeep.png");
  const platformLCImg = await loadImageAsync("assets/platformLC.png");
  const platformRCImg = await loadImageAsync("assets/platformRC.png");
  const wallLImg = await loadImageAsync("assets/wallL.png");
  const wallRImg = await loadImageAsync("assets/wallR.png");

  const fontImg = await loadImageAsync("assets/bitmapFont.png");

  // Letter images for title screen "ADVENTURE" sprites
  const letterImages = {
    A: await loadImageAsync("assets/letterA.png"),
    D: await loadImageAsync("assets/letterD.png"),
    V: await loadImageAsync("assets/letterV.png"),
    E: await loadImageAsync("assets/letterE.png"),
    N: await loadImageAsync("assets/letterN.png"),
    T: await loadImageAsync("assets/letterT.png"),
    U: await loadImageAsync("assets/letterU.png"),
    R: await loadImageAsync("assets/letterR.png"),
  };

  // Backgrounds (keys should match levels.json parallaxLayers[].key)
  // If levelPkg provides a parallax layer list with { key, src }, prefer that.
  // Otherwise fall back to the default 3-layer set.
  const backgrounds = await loadBackgrounds(levelPkg);

  // ---- anis ----
  // Prefer tuning-driven animations if present, else fallback to monolith defaults.
  // ALSO: inject a spriteSheet reference by default so addAnis never tries to load "undefined".
  let playerAnis = buildAnis(
    tuningDoc?.player?.animations,
    defaultPlayerAnis(),
    {
      spriteSheet: playerImg,
    },
  );

  let boarAnis = buildAnis(tuningDoc?.boar?.animations, defaultBoarAnis(), {
    spriteSheet: boarImg,
  });

  // If tuning.json uses per-animation "img" fields (strings), preload them here and replace with p5.Images.
  // This prevents runtime XHRs and avoids /undefined crashes.
  playerAnis = await resolveAniImages(playerAnis, "player");
  boarAnis = await resolveAniImages(boarAnis, "boar");

  // Guard rails: fail early with a helpful message instead of crashing inside p5/p5play.
  validateAssets({
    playerImg,
    boarImg,
    leafImg,
    fireImg,
    groundTileImg,
    groundTileDeepImg,
    platformLCImg,
    platformRCImg,
    wallLImg,
    wallRImg,
    fontImg,
    backgrounds,
    playerAnis,
    boarAnis,
  });

  return {
    playerImg,
    boarImg,
    leafImg,
    fireImg,

    groundTileImg,
    groundTileDeepImg,
    platformLCImg,
    platformRCImg,
    wallLImg,
    wallRImg,

    fontImg,
    letterImages,
    backgrounds,

    playerAnis,
    boarAnis,
  };
}

/**
 * Merge/normalize anis data:
 * - converts { hold:true } -> frameDelay: Infinity
 * - injects defaults (like spriteSheet) if not provided in tuning
 * - keeps other keys intact
 */
function buildAnis(tuningAnis, fallbackAnis, inject = {}) {
  const src =
    tuningAnis && typeof tuningAnis === "object" ? tuningAnis : fallbackAnis;
  const out = {};

  for (const [name, def] of Object.entries(src)) {
    // If tuning provides null/undefined for an animation by mistake, skip it safely.
    if (!def || typeof def !== "object") continue;

    const d = { ...inject, ...def };

    // JSON-safe "hold" -> Infinity
    if (d.hold === true) {
      d.frameDelay = Infinity;
      delete d.hold;
    }

    // If tuning accidentally sets img to undefined/empty, remove it so p5play doesn't loadImage(undefined).
    if ("img" in d && (d.img === undefined || d.img === null || d.img === "")) {
      delete d.img;
    }

    // If spriteSheet is missing, keep it missing (Level/Entity might set it),
    // BUT our loadAssets() injects spriteSheet by default for player/boar so it's usually present.
    out[name] = d;
  }

  return out;
}

// --- fallback anis (from your monolith) ---
function defaultPlayerAnis() {
  return {
    idle: { row: 0, frames: 4, frameDelay: 10 },
    run: { row: 1, frames: 4, frameDelay: 3 },
    jump: { row: 2, frames: 3, frameDelay: Infinity, frame: 0 },
    attack: { row: 3, frames: 6, frameDelay: 2 },
    hurtPose: { row: 5, frames: 4, frameDelay: Infinity },
    death: { row: 5, frames: 4, frameDelay: 16 },
  };
}

function defaultBoarAnis() {
  return {
    run: { row: 1, frames: 4, frameDelay: 3 },
    throwPose: { row: 4, frames: 1, frameDelay: Infinity, frame: 0 },
    death: { row: 5, frames: 4, frameDelay: 16 },
  };
}

// ------------------------
// helpers
// ------------------------

function loadImageAsync(path) {
  if (!path) {
    // This is the exact scenario that led to GET /undefined.
    throw new Error(
      `[AssetLoader] loadImageAsync called with invalid path: ${path}`,
    );
  }
  return new Promise((resolve, reject) => {
    try {
      loadImage(
        path,
        (img) => resolve(img),
        (err) =>
          reject(
            new Error(`[AssetLoader] Failed to load image "${path}": ${err}`),
          ),
      );
    } catch (e) {
      reject(
        new Error(
          `[AssetLoader] loadImage("${path}") threw: ${e?.message ?? e}`,
        ),
      );
    }
  });
}

async function loadBackgrounds(levelPkg) {
  // If levels.json supplies parallaxLayers with keys and sources, load them dynamically.
  // Expected shape (flexible):
  // levelPkg.parallaxLayers = [{ key:"bgFar", src:"assets/..." }, ...]
  // Your levels.json stores parallax in: level.view.parallax
  const layers = levelPkg?.level?.view?.parallax || levelPkg?.parallaxLayers;

  if (Array.isArray(layers) && layers.length > 0) {
    const bg = {};
    for (const layer of layers) {
      const key = layer?.key;
      const src = layer?.src || layer?.path || layer?.img;
      if (!key) continue;

      // If src is missing, keep it undefined but DON'T crash here;
      // validation will catch it with a clean error.
      bg[key] = src ? await loadImageAsync(src) : undefined;
    }
    return bg;
  }

  // Default fallback set
  return {
    bgFar: await loadImageAsync("assets/background_layer_1.png"),
    bgMid: await loadImageAsync("assets/background_layer_2.png"),
    bgFore: await loadImageAsync("assets/background_layer_3.png"),
  };
}

async function resolveAniImages(anis, label = "entity") {
  if (!anis || typeof anis !== "object") return anis;

  // If tuning uses { img: "assets/some.png" } per animation, convert those strings to p5.Images now.
  const out = {};
  for (const [name, def] of Object.entries(anis)) {
    if (!def || typeof def !== "object") continue;

    const d = { ...def };

    // If img is a string, preload it and replace with the loaded image.
    if (typeof d.img === "string") {
      if (!d.img) {
        delete d.img;
      } else {
        d.img = await loadImageAsync(d.img);
      }
    }

    // If spriteSheet is accidentally a string path, preload it too.
    // (This makes tuning flexible and prevents p5play from trying to load "undefined".)
    if (typeof d.spriteSheet === "string") {
      if (!d.spriteSheet) {
        throw new Error(
          `[AssetLoader] ${label}.${name}.spriteSheet is an empty string`,
        );
      }
      d.spriteSheet = await loadImageAsync(d.spriteSheet);
    }

    // If img exists but is still undefined/null, remove it to avoid loadImage(undefined).
    if ("img" in d && (d.img === undefined || d.img === null)) {
      delete d.img;
    }

    out[name] = d;
  }

  return out;
}

function validateAssets(bundle) {
  const mustHaveImages = [
    "playerImg",
    "boarImg",
    "leafImg",
    "fireImg",
    "groundTileImg",
    "groundTileDeepImg",
    "platformLCImg",
    "platformRCImg",
    "wallLImg",
    "wallRImg",
    "fontImg",
  ];

  for (const key of mustHaveImages) {
    if (!bundle[key]) {
      throw new Error(`[AssetLoader] Missing required image: ${key}`);
    }
  }

  if (!bundle.backgrounds || typeof bundle.backgrounds !== "object") {
    throw new Error(`[AssetLoader] Missing backgrounds object`);
  }

  // Background values should all be defined images.
  for (const [k, v] of Object.entries(bundle.backgrounds)) {
    if (!v) {
      throw new Error(
        `[AssetLoader] Background "${k}" is missing/undefined (check levels.json parallaxLayers or default bg paths)`,
      );
    }
  }

  // Anis sanity checks (prevents p5play from crashing deep in addAnis/loadImage).
  const checkAnis = (anis, label) => {
    if (!anis || typeof anis !== "object") {
      throw new Error(`[AssetLoader] Missing ${label}Anis object`);
    }
    for (const [name, def] of Object.entries(anis)) {
      if (!def || typeof def !== "object") {
        throw new Error(`[AssetLoader] ${label}Anis.${name} is invalid`);
      }
      // If an ani uses spriteSheet rows/frames, spriteSheet must exist at runtime.
      // We inject spriteSheet by default, so this catches tuning mistakes.
      if (!def.spriteSheet && !def.img) {
        // Allow cases where your entity sets sprite.spriteSheet later,
        // but this warning is *usually* what causes the /undefined crash.
        // Throwing here keeps the failure obvious.
        throw new Error(
          `[AssetLoader] ${label}Anis.${name} has no spriteSheet and no img. ` +
            `This can cause addAnis() to loadImage(undefined).`,
        );
      }
      if ("img" in def && (def.img === undefined || def.img === null)) {
        throw new Error(
          `[AssetLoader] ${label}Anis.${name}.img is undefined/null`,
        );
      }
    }
  };

  checkAnis(bundle.playerAnis, "player");
  checkAnis(bundle.boarAnis, "boar");
}
