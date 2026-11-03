import { useSyncExternalStore } from "react";

import type { CanvasStyle } from "../pages/home/territory/territoryRenderer";
import { fabricAlpha } from "../pages/home/territory/territoryGrid";

// The colour theme, Ember (dark), Parchment (light) or Meadow (light, the canvas as a game map's
// ground): data-theme on <html>, which index.css reads, kept in this device's storage
export type Theme = "dark" | "light" | "meadow";
export const themes: Theme[] = ["dark", "light", "meadow"];
export const themeNames: Record<Theme, string> = { dark: "Ember", light: "Parchment", meadow: "Meadow" };

const storageKey = "ashborn-theme";
const listeners = new Set<() => void>();

export function storedTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return themes.find((theme) => theme === stored) ?? "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // Storage blocked: the theme lasts until the app closes
  }
  listeners.forEach((listener) => listener());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => themes.find((theme) => theme === document.documentElement.dataset.theme) ?? "dark",
  );
}

// How the hex canvas is drawn in a theme: Meadow paints the cells as ground, with darker tile edges
// and territories strong enough to show over it
export function canvasStyle(theme: Theme): CanvasStyle {
  return theme === "meadow"
    ? { ink: inkRgb(), fabricAlpha: 0.16, terrain: true, boost: [5, 2] }
    : { ink: inkRgb(), fabricAlpha, terrain: false, boost: [1, 1] };
}

// The theme's ink as RGB (0-255), for drawing outside CSS
function inkRgb(): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--color-ink").trim();
  const value = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(value) ? [255, 255, 255] : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Trial switches, until the user picks: each sets data-<name> on <html>, which index.css reads, and
// is kept per device. The first option is the default.
export const trials = {
  headingFont: {
    label: "Heading",
    options: { mono: "JetBrains", vt323: "VT323", silkscreen: "Silkscreen", pressStart: "Press Start", dotGothic: "DotGothic", pixelify: "Pixelify", jersey: "Jersey 10", tiny5: "Tiny5", sixtyfour: "Sixtyfour" },
  },
  textFont: {
    label: "Text",
    options: { mono: "JetBrains", plex: "IBM Plex", shareTech: "Share Tech", martian: "Martian", fira: "Fira Code", space: "Space Mono", courier: "Courier", geist: "Geist" },
  },
  palette: {
    label: "Dark",
    options: { graphite: "Graphite", black: "Black", charcoal: "Charcoal", dungeon: "Dungeon", steel: "Steel" },
  },
  boxLook: {
    label: "Box",
    options: { plain: "Plain", edge: "Top edge", title: "Title" },
  },
} as const;
export type Trial = keyof typeof trials;
const trialKey = (trial: Trial) => `ashborn-trial-${trial}`;

export function applyTrials() {
  for (const trial of Object.keys(trials) as Trial[]) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(trialKey(trial));
    } catch {
      // Storage blocked: the default
    }
    document.documentElement.dataset[trial] = stored && stored in trials[trial].options ? stored : Object.keys(trials[trial].options)[0];
  }
}

export function setTrial(trial: Trial, option: string) {
  document.documentElement.dataset[trial] = option;
  try {
    window.localStorage.setItem(trialKey(trial), option);
  } catch {
    // Storage blocked: the choice lasts until the app closes
  }
  listeners.forEach((listener) => listener());
}

export function useTrial(trial: Trial): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => document.documentElement.dataset[trial] ?? Object.keys(trials[trial].options)[0],
  );
}
