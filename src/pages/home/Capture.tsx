import { createContext, useContext, useState, type ReactNode } from "react";
import { isDone, type GraphModel } from "../../shared/graphModel";
import { INBOX_TITLE } from "../../shared/inbox";
import type { GraphNode, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";

// A field that saves a thought into the Inbox, without asking where it goes. The first capture
// makes the Inbox; one made while the Inbox is done, hidden or shelved brings it back, so the
// thought never lands out of sight.
export function Capture({ snapshot, model, act }: { snapshot: Snapshot; model: GraphModel; act: Act }) {
  const [draft, setDraft] = useState("");
  const { inboxId } = snapshot;
  const waiting = (model.children.get(inboxId) ?? []).filter((item) => !isDone(item)).length;

  const save = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const inbox = model.byId.get(inboxId);
    if (!inbox) await act("createNode", INBOX_TITLE, null, inboxId);
    else if (isDone(inbox) || !inbox.active || inbox.shelved) await act("updateNode", inboxId, { done: false, active: true, shelved: false });
    await act("createNode", title, inboxId);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-canvas/60 px-3 focus-within:border-ember/60">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && void save()}
        aria-label="Capture a thought"
        placeholder="Capture a thought"
        className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink/90 placeholder:text-muted focus:outline-none"
      />
      {waiting > 0 ? <span className="shrink-0 font-mono text-[11px] text-muted tabular-nums">{waiting} in Inbox</span> : null}
    </div>
  );
}

// Open quests and steps as options, nested as on the graph, leaving out `skip` and all inside it
function nodeOptions(model: GraphModel, skip?: string, parentId: string | null = null, depth = 0): ReactNode[] {
  return (model.children.get(parentId) ?? [])
    .filter((node) => node.id !== skip && !isDone(node) && (parentId || node.active))
    .flatMap((node) => [
      <option key={node.id} value={node.id}>
        {"  ".repeat(depth)}
        {node.title}
      </option>,
      ...nodeOptions(model, skip, node.id, depth + 1),
    ]);
}

// A choice of open quests and steps, or none
export function NodePicker({ model, label, none, value, onChange, className }: { model: GraphModel; label: string; none: string; value: string | null; onChange: (nodeId: string | null) => void; className: string }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={className}>
      <option value="">{none}</option>
      {nodeOptions(model)}
    </select>
  );
}

const OWN_QUEST = "own-quest";

// What MoveToPicker offers. A context, so a change to the graph redraws the pickers and not every card
export const MoveTargets = createContext<{ model: GraphModel; inboxId: string }>(null!);

// Sorts a step out of the Inbox: into any open quest or step, or into a quest of its own
export function MoveToPicker({ step, act, onMoved, className }: { step: GraphNode; act: Act; onMoved?: () => void; className: string }) {
  const { model, inboxId } = useContext(MoveTargets);
  return (
    <select
      aria-label="Move to…"
      title="Move to…"
      value=""
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        void act("moveNode", step.id, event.target.value === OWN_QUEST ? null : event.target.value);
        onMoved?.();
      }}
      className={className}
    >
      <option value="" disabled>
        Move to…
      </option>
      <option value={OWN_QUEST}>Its own quest</option>
      {nodeOptions(model, inboxId)}
    </select>
  );
}
