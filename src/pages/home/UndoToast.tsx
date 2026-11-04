import { useCallback, useEffect, useRef, useState } from "react";
import { openInside } from "../../shared/graphModel";
import type { NodePatch, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

const TOAST_MS = 6000;

// `undo` is applied to each of `ids`: a ticked box and the steps its tick ticked
type Undoable = { ids: string[]; label: string; undo: NodePatch };

// Wraps `act` so that ticking a step done, giving it a priority or shelving it, from anywhere in the
// app, offers to undo it: each can move it out of sight. Stays the same function while `act` does, so the
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
        if (node && patch.done) {
          const inside = openInside(latest.current!.nodes, id);
          const label = `Done: ${node.title}${inside.length ? ` and ${inside.length} ${inside.length === 1 ? "step" : "steps"} in it` : ""}`;
          const ids = [...(node.completedAt ? [] : [id]), ...inside];
          if (ids.length) setUndoable({ ids, label, undo: { done: false } });
        } else if (node && patch.priority && patch.priority !== node.priority) setUndoable({ ids: [id], label: `P${patch.priority}: ${node.title}`, undo: { priority: node.priority } });
        else if (node && patch.shelved) setUndoable({ ids: [id], label: `Shelved: ${node.title}`, undo: { shelved: false } });
        else if (patch.done === false || patch.priority === null || patch.shelved === false) setUndoable((current) => (current?.ids[0] === id ? null : current));
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
            for (const id of undoable.ids) void act("updateNode", id, undoable.undo);
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
