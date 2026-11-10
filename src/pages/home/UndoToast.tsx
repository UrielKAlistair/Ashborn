import { useCallback, useEffect, useRef, useState } from "react";
import { openInside } from "../../shared/graphModel";
import type { NodePatch, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

const TOAST_MS = 6000;

// `undo` is applied to each of `ids`: a ticked box and the steps its tick ticked. `subject` is the node
// acted on, whose own undoing elsewhere retires the offer.
type Undoable = { subject: string; ids: string[]; label: string; undo: NodePatch };

// Wraps `act` so that ticking a step done, giving it a priority or shelving it, from anywhere in the
// app, offers to undo it: each can move it out of sight. Stays the same function while `act` does, so the
// graph's cards don't redraw.
export function useUndoableChanges(act: Act, snapshot: Snapshot | null) {
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  // The offer on screen, read when a delete takes it away
  const shown = useRef(undoable);
  shown.current = undoable;

  const acting = useCallback<Act>(
    (name, ...args) => {
      let offer: Undoable | null = null;
      if (name === "updateNode") {
        const [id, patch] = args as [string, NodePatch];
        const node = latest.current?.nodes.find((candidate) => candidate.id === id);
        if (node && patch.done) {
          const inside = openInside(latest.current!.nodes, id);
          const label = `Done: ${node.title}${inside.length ? ` and ${inside.length} ${inside.length === 1 ? "step" : "steps"} in it` : ""}`;
          const ids = [...(node.completedAt ? [] : [id]), ...inside];
          if (ids.length) offer = { subject: id, ids, label, undo: { done: false } };
        } else if (node && patch.priority && patch.priority !== node.priority) offer = { subject: id, ids: [id], label: `P${patch.priority}: ${node.title}`, undo: { priority: node.priority } };
        else if (node && patch.shelved) offer = { subject: id, ids: [id], label: `Shelved: ${node.title}`, undo: { shelved: false } };
        else if (patch.done === false || patch.priority === null || patch.shelved === false) setUndoable((current) => (current?.subject === id ? null : current));
      }
      // A deleted node, and every node inside it, has nothing left to undo; a delete the server refuses
      // leaves them, and the offer comes back
      let retired: Undoable | null = null;
      if (name === "deleteNode") {
        const [id] = args as [string];
        const nodes = latest.current?.nodes ?? [];
        const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
        const gone = (nodeId: string) => {
          for (let at: string | null | undefined = nodeId; at; at = parentOf.get(at)) if (at === id) return true;
          return false;
        };
        const current = shown.current;
        if (current && (gone(current.subject) || current.ids.some(gone))) {
          retired = current;
          setUndoable((now) => (now === current ? null : now));
        }
      }
      if (offer) setUndoable(offer);
      return act(name, ...args).then((saved) => {
        // A change the server refused offers no undo
        if (!saved && offer) setUndoable((current) => (current === offer ? null : current));
        if (!saved && retired) setUndoable((current) => current ?? retired);
        return saved;
      });
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
          className="pointer-events-auto min-h-9 phone:min-h-11 shrink-0 rounded-lg px-2.5 font-medium text-ember hover:bg-ink/6"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
