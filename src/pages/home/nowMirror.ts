import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The step in Now, the to-do's first (App.tsx), passed to the desktop tray's menu, which names it, and
 * to the graph, which marks its card (useIsNowStep).
 */
export type MirroredNow = { id: string; title: string } | null;

// The id the graph marks, held outside React so a card re-renders only when its own answer changes
let nowStep: string | null = null;
const listeners = new Set<() => void>();

// Passes the step on to the tray and the graph. The app calls it on every render; it is sent on only
// when it changed.
export function useNowMirror(now: MirroredNow) {
  const sent = useRef<string | undefined>(undefined);
  const next = JSON.stringify(now);
  useEffect(() => {
    if (next === sent.current) return;
    sent.current = next;
    window.ashborn?.setNow(now);
    setNowStep(now?.id ?? null);
  });
}

// Whether a node is the step in Now
export function useIsNowStep(id: string) {
  return useSyncExternalStore(subscribe, () => nowStep === id);
}

function setNowStep(id: string | null) {
  nowStep = id;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
