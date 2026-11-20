// A new screen eases in: it rises a few pixels as it fades up, so a change of screen reads as one
// motion rather than a cut. The box is animated, never remounted, so screens kept alive behind others
// (the phone's graph) stay built. Moves within a screen (a recipe opened) and reduced motion skip it.
import { useLayoutEffect, useRef } from "react";
import { desktopSections, phoneSections, screenAt } from "../components/sections";

const ENTRANCE_MS = 160;
const RISE_PX = 4;

const allScreens = [...desktopSections, ...phoneSections].flatMap((section) => [...section.desktop, ...section.phone]);

export function usePageEntrance(path: string) {
  const box = useRef<HTMLDivElement>(null);
  const screen = screenAt(path, allScreens)?.path ?? path;
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    box.current?.animate([{ opacity: 0, transform: `translateY(${RISE_PX}px)` }, { opacity: 1, transform: "none" }], { duration: ENTRANCE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }, [screen]);
  return box;
}
