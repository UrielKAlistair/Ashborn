// A new screen eases in: it rises a few pixels as it fades up, so a change of screen reads as one
// motion rather than a cut. The box is animated, never remounted, so screens kept alive behind others
// (the phone's graph) stay built. Moves within a screen (a recipe opened) and reduced motion skip it.
// Within a screen, a step between views of one list (today and tomorrow, one week and the next) eases
// in the same way, sliding a few pixels from the side it was stepped towards.
import { useLayoutEffect, useRef } from "react";
import { desktopSections, phoneSections, screenAt } from "../components/sections";

const ENTRANCE_MS = 160;
const RISE_PX = 4;
const SLIDE_PX = 8;

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
    enter(box.current, `translateY(${RISE_PX}px)`);
  }, [screen]);
  return box;
}

// `step` orders the views a box shows: a later step enters from the right, an earlier one from the left
export function useStepEntrance(step: number) {
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(step);
  useLayoutEffect(() => {
    if (step === last.current) return;
    enter(box.current, `translateX(${step > last.current ? SLIDE_PX : -SLIDE_PX}px)`);
    last.current = step;
  }, [step]);
  return box;
}

function enter(box: HTMLElement | null, from: string) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  box?.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }], { duration: ENTRANCE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" });
}
