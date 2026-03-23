// src/HighScoreManager.js
// HighScoreManager (SYSTEM layer)
//
// Responsibilities:
// - Persist top 5 completion times per level (localStorage)
// - Seed defaults (optional) once if storage is empty
// - Compare and submit new times
// - Provide simple API for Game / WinScreen
//
// Non-goals:
// - Does NOT draw UI
// - Does NOT know about Level or Player directly
// - Does NOT control world state

export class HighScoreManager {
  constructor(storageKey = "gbda302_highscores_v2", opts = {}) {
    this.storageKey = storageKey;
    this.maxEntries = Number(opts.maxEntries ?? 5);
    this._cache = this._load();

    // optional seed, e.g. from /data/highscores.json already loaded elsewhere
    if (opts.seed && typeof opts.seed === "object") {
      this.seedIfEmpty(opts.seed, opts.defaultLevelId ?? "ex5_level1");
    }
  }

  // -----------------------
  // Public API
  // -----------------------

  /**
   * Returns array of entries: [{ name, ms }, ...] length <= maxEntries
   */
  getTop(levelId) {
    if (!levelId) return [];
    const arr = this._cache[levelId];
    return Array.isArray(arr)
      ? arr.map((e) => ({ name: e.name, ms: e.ms }))
      : [];
  }

  /**
   * Returns best ms or null.
   */
  getBestTime(levelId) {
    const top = this.getTop(levelId);
    return top.length ? Number(top[0].ms) : null;
  }

  /**
   * Whether a time qualifies for the leaderboard (top 5).
   */
  qualifies(levelId, ms) {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return false;

    const top = this.getTop(levelId);
    if (top.length < this.maxEntries) return true;

    const worst = Number(top[top.length - 1]?.ms);
    return t < worst;
  }

  /**
   * Inserts a score and returns result info.
   * If name is missing, you can pass "___" and later replace by index via setNameAt().
   */
  submit(levelId, name, ms) {
    if (!levelId)
      return { inserted: false, rank: null, top: this.getTop(levelId) };

    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0)
      return { inserted: false, rank: null, top: this.getTop(levelId) };

    const entry = {
      name: String(name ?? "___")
        .toUpperCase()
        .slice(0, 3)
        .padEnd(3, "_"),
      ms: t,
    };

    const top = this.getTop(levelId);
    top.push(entry);

    top.sort((a, b) => Number(a.ms) - Number(b.ms));
    const trimmed = top.slice(0, this.maxEntries);

    this._cache[levelId] = trimmed;
    this._save();

    const rank = trimmed.findIndex((e) => e.ms === t && e.name === entry.name);
    return {
      inserted: rank !== -1,
      rank: rank !== -1 ? rank : null,
      top: this.getTop(levelId),
    };
  }

  /**
   * Replace the name at a specific rank (0..4) for a level.
   * Useful for: insert placeholder, then user types initials.
   */
  setNameAt(levelId, index, name3) {
    const top = this.getTop(levelId);
    if (!top.length) return false;
    if (index < 0 || index >= top.length) return false;

    top[index].name = String(name3 ?? "___")
      .toUpperCase()
      .slice(0, 3)
      .padEnd(3, "_");
    this._cache[levelId] = top;
    this._save();
    return true;
  }

  resetLevel(levelId) {
    if (!levelId) return;
    delete this._cache[levelId];
    this._save();
  }

  resetAll() {
    this._cache = {};
    this._save();
  }

  /**
   * Seed storage ONLY if empty. Seed format options:
   *  A) { "ex5_level1": [{name, ms}, ...] }
   *  B) { scores: [{name, ms}, ...] }  // will apply to opts.defaultLevelId or "ex5_level1"
   */
  seedIfEmpty(seedObj, defaultLevelId = "ex5_level1") {
    // Check if storage already has entries for this specific level
    const existing = this._cache[defaultLevelId];
    if (Array.isArray(existing) && existing.length > 0) return false;

    const next = {};

    if (Array.isArray(seedObj?.scores)) {
      next[defaultLevelId] = seedObj.scores
        .map((e) => ({
          name: String(e.name ?? "___")
            .toUpperCase()
            .slice(0, 3),
          ms: Number(e.ms),
        }))
        .filter((e) => Number.isFinite(e.ms) && e.ms > 0)
        .sort((a, b) => a.ms - b.ms)
        .slice(0, this.maxEntries);
    } else {
      // assume per-level object
      for (const [lvl, arr] of Object.entries(seedObj)) {
        if (!Array.isArray(arr)) continue;
        next[lvl] = arr
          .map((e) => ({
            name: String(e.name ?? "___")
              .toUpperCase()
              .slice(0, 3),
            ms: Number(e.ms),
          }))
          .filter((e) => Number.isFinite(e.ms) && e.ms > 0)
          .sort((a, b) => a.ms - b.ms)
          .slice(0, this.maxEntries);
      }
    }

    // Merge seed data into cache (don't overwrite existing levels)
    for (const [lvl, entries] of Object.entries(next)) {
      if (!this._cache[lvl] || this._cache[lvl].length === 0) {
        this._cache[lvl] = entries;
      }
    }
    this._save();
    return true;
  }

  // -----------------------
  // Internal
  // -----------------------

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this._cache));
    } catch (err) {
      console.warn("[HighScoreManager] save failed:", err);
    }
  }
}
