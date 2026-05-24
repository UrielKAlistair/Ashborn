export function getXpThresholdForLevel(level: number) {
  return 50 * level * level;
}

export function getLevelFromXp(xp: number) {
  let level = 1;
  let remainingXp = xp;

  while (remainingXp >= getXpThresholdForLevel(level)) {
    remainingXp -= getXpThresholdForLevel(level);
    level += 1;
  }

  return level;
}

export function getXpProgressPercent(xp: number) {
  const level = getLevelFromXp(xp);
  let xpIntoLevel = xp;

  for (let currentLevel = 1; currentLevel < level; currentLevel += 1) {
    xpIntoLevel -= getXpThresholdForLevel(currentLevel);
  }

  const threshold = getXpThresholdForLevel(level);

  if (threshold <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (xpIntoLevel / threshold) * 100));
}
