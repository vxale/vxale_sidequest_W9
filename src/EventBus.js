// src/EventBus.js
// Event messaging (SYSTEM layer).
//
// Responsibilities:
// - Provide on()/off()/emit() for lightweight event handling
// - Support wildcard listeners ("*") for global debug logging
// - Decouple WORLD entities from UI/Sound/Debug systems
//
// Non-goals:
// - Does NOT store or simulate world state
// - Does NOT know about sprites, physics, camera, or rendering
//
// Architectural notes:
// - Game owns a single EventBus instance.
// - Level/entities emit events; UI/sound/debug subscribe via Game wiring.
// - This enables separation of concerns and prevents circular dependencies.

export class EventBus {
  constructor() {
    this._listeners = new Map(); // eventName -> Set<fn>
  }

  on(eventName, fn) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(fn);
    return () => this.off(eventName, fn);
  }

  off(eventName, fn) {
    const set = this._listeners.get(eventName);
    if (!set) return;
    set.delete(fn);
    if (set.size === 0) this._listeners.delete(eventName);
  }

  emit(eventName, payload) {
    // 1) specific listeners
    const set = this._listeners.get(eventName);
    if (set) {
      [...set].forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[EventBus] listener error for "${eventName}"`, err);
        }
      });
    }

    // 2) wildcard listeners: receive { name, payload }
    const any = this._listeners.get("*");
    if (any) {
      const evt = { name: eventName, payload };
      [...any].forEach((fn) => {
        try {
          fn(evt);
        } catch (err) {
          console.error(`[EventBus] wildcard listener error for "${eventName}"`, err);
        }
      });
    }
  }

  clear() {
    this._listeners.clear();
  }
}