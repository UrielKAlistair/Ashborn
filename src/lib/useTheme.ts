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

// A trial switch, until the user picks one: the heading font, data-heading-font on <html>, which
// index.css reads
export const headingFonts = ["mono", "cinzel", "vt323", "silkscreen", "chakra", "space"] as const;
export type HeadingFont = (typeof headingFonts)[number];
export const headingFontNames: Record<HeadingFont, string> = {
  mono: "JetBrains Mono",
  cinzel: "Cinzel",
  vt323: "VT323",
  silkscreen: "Silkscreen",
  chakra: "Chakra Petch",
  space: "Space Mono throughout",
};
const headingFontKey = "ashborn-heading-font";

export function storedHeadingFont(): HeadingFont {
  try {
    const font = window.localStorage.getItem(headingFontKey);
    return headingFonts.find((name) => name === font) ?? "mono";
  } catch {
    return "mono";
  }
}

export function setHeadingFont(font: HeadingFont) {
  document.documentElement.dataset.headingFont = font;
  try {
    window.localStorage.setItem(headingFontKey, font);
  } catch {
    // Storage blocked: the font lasts until the app closes
  }
  listeners.forEach((listener) => listener());
}

export function useHeadingFont(): HeadingFont {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (document.documentElement.dataset.headingFont as HeadingFont | undefined) ?? "mono",
  );
}
