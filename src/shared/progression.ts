/**
 * Levels: how XP turns into the level and bar shown on a card and on the character sheet.
 * A card levels linearly (every NODE_LEVEL_XP); a stat levels ever more slowly (level ~ sqrt(xp)).
 */
// One press of a node's + button, and the credit for completing a node
export const PROGRESS_UNIT = 10;

// A node's bar fills every NODE_LEVEL_XP, so each press moves it a tenth of the way
export const NODE_LEVEL_XP = 100;

// Character stats: going from level L to L + 1 costs STAT_LEVEL_STEP * L, so reaching
// level L takes STAT_LEVEL_STEP * L(L - 1) / 2 in total and level grows like sqrt(xp).
const STAT_LEVEL_STEP = 100;

export type Level = {
  level: number;
  percent: number; // progress through the current level, 0 to 100
};

export function nodeLevel(xp: number): Level {
  return {
    level: Math.floor(xp / NODE_LEVEL_XP) + 1,
    percent: ((xp % NODE_LEVEL_XP) / NODE_LEVEL_XP) * 100,
  };
}

// The largest L with STAT_LEVEL_STEP * L(L - 1) / 2 <= xp, from the quadratic formula; L >= 1
export function statLevel(xp: number): Level {
  const level = Math.floor((1 + Math.sqrt(1 + (8 * xp) / STAT_LEVEL_STEP)) / 2);
  const reached = (STAT_LEVEL_STEP * level * (level - 1)) / 2;

  return { level, percent: ((xp - reached) / (STAT_LEVEL_STEP * level)) * 100 };
}
