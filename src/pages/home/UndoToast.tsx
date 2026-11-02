import { useCallback, useEffect, useRef, useState } from "react";
import type { NodePatch, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

const TOAST_MS = 6000;

type Ticked = { id: string; title: string };

// Wraps `act` so that ticking a step done, from anywhere in the app, offers to undo it. Stays the
// same function while `act` does, so the graph's cards don't redraw.
export function useUndoableTicks(act: Act, snapshot: Snapshot | null) {
  const [ticked, setTicked] = useState<Ticked | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const acting = useCallback<Act>(
    (name, ...args) => {
      if (name === "updateNode") {
        const [id, patch] = args as [string, NodePatch];
        const title = latest.current?.nodes.find((node) => node.id === id)?.title;
        if (patch.done && title) setTicked({ id, title });
        else if (patch.done === false) setTicked((current) => (current?.id === id ? null : current));
      }
      return act(name, ...args);
    },
    [act],
  );

  return { act: acting, ticked, dismiss: () => setTicked(null) };
}

// "Done: <title> · Undo", for a few seconds; a newer tick replaces it and starts the time again
export function UndoToast({ ticked, act, onDismiss, phone }: { ticked: Ticked; act: Act; onDismiss: () => void; phone: boolean }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [ticked]);

  return (
    <div className={`pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4 ${phone ? "bottom-20" : "bottom-6"}`}>
      <div role="status" className="pointer-events-auto flex max-w-md min-w-0 items-center gap-2 rounded-xl border border-ink/12 bg-card py-1 pr-1 pl-3.5 text-[13px] text-ink/85 shadow-[var(--card-shadow)] transition duration-150 ease-out starting:translate-y-2 starting:opacity-0">
        <span className="truncate">Done: {ticked.title}</span>
        <button type="button" onClick={() => void act("updateNode", ticked.id, { done: false })} className="min-h-9 shrink-0 rounded-lg px-2.5 font-medium text-ember hover:bg-ink/6">
          Undo
        </button>
      </div>
    </div>
  );
}
