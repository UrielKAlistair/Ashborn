import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { NowChoice } from "../../shared/nowStep";

/**
 * The step in Now, chosen once (App.tsx) and shown in three places, so none of them can disagree: the
 * card on Home reads the choice from NowChoiceContext; the desktop tray's menu names it; and the graph
 * marks its card (useIsNowStep).
 */
export type MirroredNow = { id: string; title: string } | null;

// The step in Now as the app chose it, for the card on Home
export const NowChoiceContext = createContext<NowChoice | null>(null);
export const useNowChoice = () => useContext(NowChoiceContext);

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
