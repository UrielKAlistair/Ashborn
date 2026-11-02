import { useEffect, useRef, useSyncExternalStore } from "react";

export type MirroredNow = { id: string; title: string; endsAt: number | null; canTick: boolean } | null;

// The step in Now, shown again elsewhere: in the desktop tray's menu, and marked on the graph. The
// card sets the ref as it renders; after the render it is passed on, only when it changed.
export function useNowMirror() {
  const now = useRef<MirroredNow>(null);
  const sent = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = JSON.stringify(now.current);
    if (next === sent.current) return;
    sent.current = next;
    window.ashborn?.setNow(now.current);
    setNowStep(now.current?.id ?? null);
  });
  return now;
}

// Whether a node is the step in Now; a card re-renders only when its own answer changes
export function useIsNowStep(id: string) {
  return useSyncExternalStore(subscribe, () => nowStep === id);
}

let nowStep: string | null = null;
const listeners = new Set<() => void>();

function setNowStep(id: string | null) {
  nowStep = id;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
