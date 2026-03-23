// src/ParallaxBackground.js
// Parallax background renderer (VIEW layer).
//
// Responsibilities:
// - Draw repeating background layers in screen-space (camera.off())
// - Offset layers based on camera.x using per-layer factor
// - Support multiple depth layers for a sense of movement
//
// Non-goals:
// - Does NOT modify camera position or world state
// - Does NOT load images (main.js preload does)
// - Does NOT interact with physics/entities
//
// Architectural notes:
// - main.js owns parallax construction using level.view.parallax from levels.json.
// - This stays VIEW-only so it can be swapped or removed without touching gameplay.

export class ParallaxBackground {
  /**
   * @param {Object} layers
   * Example:
   * [
   *   { img: bgFar, factor: 0.2 },
   *   { img: bgMid, factor: 0.5 },
   *   { img: bgFore, factor: 0.8 }
   * ]
   */
  constructor(layers = []) {
    this.layers = layers;
  }

  draw({ cameraX, viewW, viewH }) {
    camera.off();
    drawingContext.imageSmoothingEnabled = false;

    for (const layer of this.layers) {
      const { img, factor = 1 } = layer;
      if (!img) continue;

      const offsetX = -cameraX * factor;

      // tile horizontally
      const imgW = img.width;
      const imgH = img.height;

      // ensure enough tiles to fill width
      const startX = (offsetX % imgW) - imgW;

      for (let x = startX; x < viewW; x += imgW) {
        image(img, Math.round(x), 0, imgW, viewH);
      }
    }

    camera.on();
  }
}
