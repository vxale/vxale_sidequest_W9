// src/world/AttackHitResolver.js
// Shared melee hit resolution for player attack windows.
//
// Responsibilities:
// - Normalize attack range lookup from tuning
// - Pick the first valid target in front of the player within range

export function getPlayerAttackRange(tuning, defaults = {}) {
  const fallbackX = Number(defaults.rangeX ?? 20);
  const fallbackY = Number(defaults.rangeY ?? 16);
  const fallbackVerticalPad = Number(defaults.verticalPad ?? 10);

  const rangeX = Number(
    tuning?.player?.attack?.rangeX ?? tuning?.player?.attackRangeX ?? fallbackX,
  );
  const rangeY = Number(
    tuning?.player?.attack?.rangeY ?? tuning?.player?.attackRangeY ?? fallbackY,
  );
  const verticalPad = Number(
    tuning?.player?.attack?.verticalPad ?? fallbackVerticalPad,
  );

  return { rangeX, rangeY, verticalPad };
}

export function pickFirstPlayerMeleeTarget({
  attackInfo,
  playerSprite,
  targets,
  rangeX,
  rangeY,
  verticalPad,
  isTargetValid,
  targetWidth,
  targetHeight,
}) {
  if (!attackInfo || !playerSprite || !targets) return null;

  const { facing, x, y } = attackInfo;
  if (!Number.isFinite(facing) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const playerFeetY = y + (playerSprite.h ?? playerSprite.height ?? 12) / 2;

  for (const target of targets) {
    if (!target) continue;
    if (isTargetValid && !isTargetValid(target)) continue;

    const dx = target.x - x;
    if (Math.sign(dx) !== facing) continue;

    const w = Number(
      targetWidth ? targetWidth(target) : (target.w ?? target.width ?? 18),
    );
    if (Math.abs(dx) > Number(rangeX) + w / 2) continue;

    const h = Number(
      targetHeight ? targetHeight(target) : (target.h ?? target.height ?? 12),
    );
    const targetFeetY = target.y + h / 2;
    if (
      Math.abs(targetFeetY - playerFeetY) >
      Number(rangeY) + Number(verticalPad ?? 10)
    )
      continue;

    return target;
  }

  return null;
}
