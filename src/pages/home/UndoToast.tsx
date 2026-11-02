import { useCallback, useEffect, useRef, useState } from "react";
import type { NodePatch, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

const TOAST_MS = 6000;

type Undoable = { id: string; label: string; undo: NodePatch };

// Wraps `act` so that ticking a step done or giving it a priority, from anywhere in the app, offers
// to undo it: both can move the step out of sight. Stays the same function while `act` does, so the
// graph's cards don't redraw.
export function useUndoableChanges(act: Act, snapshot: Snapshot | null) {
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  const acting = useCallback<Act>(
    (name, ...args) => {
      if (name === "updateNode") {
        const [id, patch] = args as [string, NodePatch];
        const node = latest.current?.nodes.find((candidate) => candidate.id === id);
        if (node && patch.done) setUndoable({ id, label: `Done: ${node.title}`, undo: { done: false } });
        else if (node && patch.priority && patch.priority !== node.priority) setUndoable({ id, label: `P${patch.priority}: ${node.title}`, undo: { priority: node.priority } });
        else if (patch.done === false || patch.priority === null) setUndoable((current) => (current?.id === id ? null : current));
      }
      return act(name, ...args);
    },
    [act],
  );

  return { act: acting, undoable, dismiss: () => setUndoable(null) };
}

// What was just done, with Undo, for a few seconds; a newer change replaces it and starts the time
// again. `act` is the unwrapped one, so an undo offers no undo of its own. Only Undo takes taps: the
// rest lets them through to what it covers.
export function UndoToast({ undoable, act, onDismiss, phone }: { undoable: Undoable; act: Act; onDismiss: () => void; phone: boolean }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [undoable]);

  return (
    <div className={`pointer-events-none absolute inset-x-0 z-50 flex justify-center px-4 ${phone ? "bottom-20" : "bottom-6"}`}>
      <div role="status" className="flex max-w-md min-w-0 items-center gap-2 rounded-xl border border-ink/12 bg-card py-1 pr-1 pl-3.5 text-[13px] text-ink/85 shadow-[var(--card-shadow)] transition duration-150 ease-out starting:translate-y-2 starting:opacity-0">
        <span className="truncate">{undoable.label}</span>
        <button
          type="button"
          onClick={() => {
            void act("updateNode", undoable.id, undoable.undo);
            onDismiss();
          }}
          className="pointer-events-auto min-h-9 shrink-0 rounded-lg px-2.5 font-medium text-ember hover:bg-ink/6"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
