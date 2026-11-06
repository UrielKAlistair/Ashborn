import { useSyncExternalStore } from "react";

import type { CanvasStyle, RGB } from "../pages/home/territory/territoryRenderer";

// The colour theme, dark or light: data-theme on <html>, which index.css reads, kept in this
// device's storage
export type Theme = "dark" | "light";
export const themes: Theme[] = ["dark", "light"];
export const themeNames: Record<Theme, string> = { dark: "Dark", light: "Light" };

const storageKey = "ashborn-theme";
const listeners = new Set<() => void>();

export function storedTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(storageKey);
    // "meadow" was the light theme's name
    return stored === "meadow" ? "light" : (themes.find((theme) => theme === stored) ?? "dark");
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

// How the hex canvas is drawn in a theme: in the dark light is added, on the light theme's paper the
// hue is laid down as a wash. The bare fabric is faint everywhere, so the territories carry the
// picture. Colours are the theme's own.
export function canvasStyle(theme: Theme): CanvasStyle {
  const ink = cssRgb("--color-ink");
  const hues = { 1: cssRgb("--priority-1"), 2: cssRgb("--priority-2"), 3: cssRgb("--priority-3"), 4: cssRgb("--priority-4"), none: ink };
  const dark = theme === "dark";
  return { ink, fabricAlpha: dark ? 0.045 : 0.09, dark, hues };
}

// A colour variable of the theme (a #rrggbb) as RGB (0-255), for drawing outside CSS
function cssRgb(name: string): RGB {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = Number.parseInt(hex.slice(1), 16);
  return Number.isNaN(value) ? [255, 255, 255] : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
