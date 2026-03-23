// src/LevelLoader.js
// Level + tuning document loader (SYSTEM layer).
//
// Responsibilities:
// - Load levels.json and select a level by id
// - Normalize tile/world/view configuration into a single package
// - Merge per-level overrides into global tuning (deep merge)
// - Provide computed bounds and view dimensions (tile-based)
//
// Non-goals:
// - Does NOT create sprites, groups, or physics bodies
// - Does NOT contain game rules (Level does)
// - Does NOT draw anything (VIEW layer)
//
// Architectural notes:
// - This file is the data boundary between JSON and game code.
// - Keeping this separate enables scalable multi-level projects and data-driven tuning.

/**
 * Reliable JSON loader (Promise-based).
 * Avoids p5 loadJSON callback pitfalls with async/await.
 */
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON (${res.status}) at ${url}`);
  }

  // Read as text first so we can detect "HTML fallback" cases cleanly.
  const text = await res.text();
  const trimmed = text.trim();

  // If a server returns index.html / 404 HTML, JSON.parse would throw a confusing error.
  if (
    trimmed.startsWith("<") ||
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html")
  ) {
    throw new Error(`Expected JSON but got HTML from ${url}`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON at ${url}: ${e?.message ?? e}`);
  }
}

export class LevelLoader {
  constructor(globalTuning) {
    this.globalTuning = globalTuning || {};
    this.doc = null; // cached levels.json contents
  }

  /**
   * Load and cache the levels document (data/levels.json).
   * @param {string} url
   * @returns {Promise<Object>} levels doc
   */
  async loadDoc(url) {
    if (this.doc) return this.doc;
    this.doc = await fetchJSON(url);
    return this.doc;
  }

  /**
   * Select a level by id, merge tuning overrides, and return a normalized package.
   * @param {string} levelsUrl e.g., "data/levels.json" OR absolute URL
   * @param {string} levelId e.g., "level1"
   * @returns {Promise<{doc:Object, level:Object, tuning:Object, world:Object, view:Object, tiles:Object, bounds:Object}>}
   */
  async load(levelsUrl, levelId) {
    const doc = await this.loadDoc(levelsUrl);

    if (!doc || !Array.isArray(doc.levels)) {
      throw new Error(`levels.json missing "levels" array (${levelsUrl})`);
    }

    const level = doc.levels.find((l) => l.id === levelId) || doc.levels[0];
    if (!level) throw new Error(`No levels found in ${levelsUrl}`);

    // --- Normalize core dimensions (doc-level defaults) ---
    const tileW = Number(doc.tileW ?? 24);
    const tileH = Number(doc.tileH ?? 24);

    const frameW = Number(doc.frameW ?? 32);
    const frameH = Number(doc.frameH ?? 32);

    const viewTilesW = Number(doc.viewTilesW ?? 10);
    const viewTilesH = Number(doc.viewTilesH ?? 8);

    const viewW = tileW * viewTilesW;
    const viewH = tileH * viewTilesH;

    // --- Tilemap ---
    let tilemap = Array.isArray(level.tilemap) ? level.tilemap.slice() : [];
    if (tilemap.length === 0)
      throw new Error(`Level "${level.id}" missing "tilemap" array`);

    const cols = tilemap[0].length;
    const rows = tilemap.length;

    const levelW = cols * tileW;
    const levelH = rows * tileH;

    // --- Player start: scan for 's' in tilemap ---
    let playerStart = level.backupPlayerStart;
    let foundS = false;
    for (let row = 0; row < tilemap.length; row++) {
      const col = tilemap[row].indexOf("s");
      if (col !== -1) {
        // Center of the tile
        playerStart = {
          x: col * tileW + tileW / 2,
          y: row * tileH + tileH / 2,
        };
        // Remove 's' from the tilemap for rendering/logic
        tilemap[row] =
          tilemap[row].substring(0, col) +
          " " +
          tilemap[row].substring(col + 1);
        foundS = true;
        break; // Only use the first 's' found
      }
    }

    // --- Per-level world rules (NEW structured style) ---
    // Supports:
    //   level.world.gravity / fallResetMarginTiles / winScore
    // Falls back to legacy:
    //   level.gravity / level.fallResetMarginTiles / level.winScore
    const worldSrc =
      level.world && typeof level.world === "object" ? level.world : level;

    const world = {
      gravity: Number(worldSrc.gravity ?? 10),
      fallResetMarginTiles: Number(worldSrc.fallResetMarginTiles ?? 3),
      winScore: Number(worldSrc.winScore ?? 15),
    };

    // --- Per-level view overrides (NEW) ---
    // Supports:
    //   level.view.background, level.view.cameraLerp, etc.
    // Merges with doc-level view defaults (cameraLerp can also live on doc).
    const docView = {
      viewW,
      viewH,
      viewTilesW,
      viewTilesH,
      cameraLerp: Number(doc.cameraLerp ?? 0.1),
    };

    const levelView =
      level.view && typeof level.view === "object" ? level.view : {};

    const view = {
      ...docView,
      ...levelView,
    };

    // --- Optional rules flags (invincible levels etc.) ---
    const rules =
      level.rules && typeof level.rules === "object" ? level.rules : {};

    // --- Merge tuning overrides (level.overrides) into global tuning ---
    const overrides =
      level.overrides && typeof level.overrides === "object"
        ? level.overrides
        : null;
    const tuning = LevelLoader.deepMerge(this.globalTuning, overrides);

    // Package returned to Game/Level
    return {
      doc,
      level: {
        ...level,
        rules,
        tilemap,
        rows,
        cols,
        playerStart, // override with detected start if found
      },
      tuning,
      world,
      view,
      tiles: { tileW, tileH, frameW, frameH },
      bounds: { levelW, levelH },
    };
  }

  /**
   * Deep merge patch into base (returns a new object; does not mutate inputs).
   * Objects merge recursively; arrays/primitive values replace.
   */
  static deepMerge(base, patch) {
    const out = structuredClone(base || {});
    if (!patch) return out;

    for (const key of Object.keys(patch)) {
      const pv = patch[key];
      const bv = out[key];

      const pvIsObj = pv && typeof pv === "object" && !Array.isArray(pv);
      const bvIsObj = bv && typeof bv === "object" && !Array.isArray(bv);

      if (pvIsObj && bvIsObj) {
        out[key] = LevelLoader.deepMerge(bv, pv);
      } else {
        out[key] = pv;
      }
    }
    return out;
  }
}
