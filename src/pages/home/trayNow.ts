import { useEffect, useRef } from "react";

export type TrayNow = { id: string; title: string; endsAt: number | null; canTick: boolean } | null;

// Mirrors the step in Now to the desktop tray's menu: the card sets the ref as it renders, and it
// is sent after the render, only when it changed
export function useTrayNow() {
  const now = useRef<TrayNow>(null);
  const sent = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = JSON.stringify(now.current);
    if (next === sent.current) return;
    sent.current = next;
    window.ashborn?.setNow(now.current);
  });
  return now;
}
