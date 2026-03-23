// src/InputManager.js
// Input boundary (SYSTEM layer).
//
// Responsibilities:
// - Read keyboard state each frame
// - Provide a stable input snapshot object (holds + presses)
// - Centralize key mapping so WORLD code never touches kb directly
//
// Contract (what Game/Player expect):
// - left/right: held booleans
// - jumpPressed/attackPressed: edge-triggered booleans (true for 1 frame)
// - restartPressed/debugTogglePressed: edge-triggered booleans (true for 1 frame)
//
// Notes:
// - Requires p5play global `kb`

export class InputManager {
  constructor() {
    // previous frame DOWN states (for edge detection)
    this._prevDown = {
      jump: false,
      attack: false,
      restart: false,
      debugToggle: false,
      enter: false,
      eKey: false,
      vKey: false,
      backspace: false,
    };
    this._prevLetters = {};

    // canonical snapshot (same object reused every frame)
    this._input = {
      // held
      left: false,
      right: false,

      // edge-triggered (true for 1 frame)
      jumpPressed: false,
      attackPressed: false,
      restartPressed: false,
      debugTogglePressed: false,
      enterPressed: false,
      ePressed: false,
      vPressed: false,
      typedChar: null,
      backspacePressed: false,
    };
  }

  update() {
    // If kb isn't ready yet (rare during boot), keep a safe "all false" snapshot.
    if (typeof kb === "undefined" || !kb) {
      this._input.left = false;
      this._input.right = false;
      this._input.jumpPressed = false;
      this._input.attackPressed = false;
      this._input.restartPressed = false;
      this._input.debugTogglePressed = false;
      this._input.enterPressed = false;
      this._input.ePressed = false;
      this._input.vPressed = false;
      this._input.typedChar = null;
      this._input.backspacePressed = false;
      return this._input;
    }

    // -----------------------
    // Holds
    // -----------------------
    const leftHeld = kb.pressing("a") || kb.pressing("left");
    const rightHeld = kb.pressing("d") || kb.pressing("right");

    // -----------------------
    // Down states (for edges)
    // Use kb.pressing for "is currently down", then edge-detect ourselves.
    // (Avoid kb.presses here to keep all edge logic in one place.)
    // -----------------------
    const jumpDown = kb.pressing("w") || kb.pressing("up");
    const attackDown = kb.pressing("space");
    const restartDown = kb.pressing("r");
    const debugToggleDown = kb.pressing("t");
    const enterDown = kb.pressing("enter");
    const eDown = kb.pressing("e");
    const vDown = kb.pressing("v");

    // -----------------------
    // Write snapshot
    // -----------------------
    this._input.left = leftHeld;
    this._input.right = rightHeld;

    this._input.jumpPressed = jumpDown && !this._prevDown.jump;
    this._input.attackPressed = attackDown && !this._prevDown.attack;
    this._input.restartPressed = restartDown && !this._prevDown.restart;
    this._input.debugTogglePressed =
      debugToggleDown && !this._prevDown.debugToggle;
    this._input.enterPressed = enterDown && !this._prevDown.enter;
    this._input.ePressed = eDown && !this._prevDown.eKey;
    this._input.vPressed = vDown && !this._prevDown.vKey;

    // Typed character detection (A-Z)
    this._input.typedChar = null;
    for (let c = 65; c <= 90; c++) {
      const letter = String.fromCharCode(c).toLowerCase();
      const isDown = kb.pressing(letter);
      const wasDown = this._prevLetters[letter] ?? false;
      if (isDown && !wasDown) {
        this._input.typedChar = String.fromCharCode(c);
      }
      this._prevLetters[letter] = isDown;
    }

    // Backspace edge detection
    const backspaceDown = kb.pressing("backspace");
    this._input.backspacePressed = backspaceDown && !this._prevDown.backspace;

    // -----------------------
    // Store prev DOWN states
    // -----------------------
    this._prevDown.jump = jumpDown;
    this._prevDown.attack = attackDown;
    this._prevDown.restart = restartDown;
    this._prevDown.debugToggle = debugToggleDown;
    this._prevDown.enter = enterDown;
    this._prevDown.eKey = eDown;
    this._prevDown.vKey = vDown;
    this._prevDown.backspace = backspaceDown;

    return this._input;
  }

  // Game.js expects: inputSnap = this.input.input;
  get input() {
    return this._input;
  }
}
