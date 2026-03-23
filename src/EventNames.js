// src/EventNames.js
// Shared event-name constants for EventBus emit/on calls.

export const EVENTS = Object.freeze({
  PLAYER_DIED: "player:died",
  PLAYER_ATTACKED: "player:attacked",
  PLAYER_JUMPED: "player:jumped",
  PLAYER_ATTACK_WINDOW: "player:attackWindow",
  PLAYER_DAMAGED: "player:damaged",

  LEVEL_WON: "level:won",
  LEVEL_RESTARTED: "level:restarted",

  LEAF_COLLECTED: "leaf:collected",

  BOAR_DAMAGED: "boar:damaged",
  BOAR_DIED: "boar:died",

  LETTER_HIT: "letter:hit",
});
