// Pickers of a place in the graph, as plain selects: NodePicker chooses an open quest or step (a
// deadline's), MoveToPicker moves a step there (sorting the Inbox, a card's Move to…). Both list the
// open, unshelved quests and steps, nested as on the graph.
import { createContext, useContext, type ReactNode, type Ref } from "react";
import { isDone, type GraphModel } from "../../shared/graphModel";
import type { GraphNode } from "../../shared/types";
import type { Act } from "./HomePage";

// Open quests and steps as options, nested as on the graph, leaving out `skip` and all inside it
function nodeOptions(model: GraphModel, skip?: string, parentId: string | null = null, depth = 0): ReactNode[] {
  return (model.children.get(parentId) ?? [])
    .filter((node) => node.id !== skip && !isDone(node) && !node.shelved)
    .flatMap((node) => [
      <option key={node.id} value={node.id}>
        {"  ".repeat(depth)}
        {node.title}
      </option>,
      ...nodeOptions(model, skip, node.id, depth + 1),
    ]);
}

// Whether nodeOptions offers `id`: it and every box around it open and not shelved
function offered(model: GraphModel, id: string): boolean {
  const node = model.byId.get(id);
  if (!node || isDone(node) || node.shelved) return false;
  return node.parentId ? offered(model, node.parentId) : true;
}

// A choice of open quests and steps, or none
export function NodePicker({ model, label, none, value, onChange, className }: { model: GraphModel; label: string; none: string; value: string | null; onChange: (nodeId: string | null) => void; className: string }) {
  return (
    <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={className}>
      <option value="">{none}</option>
      {/* A choice no longer offered (done, or shelved) still shows as chosen */}
      {value && !offered(model, value) && model.byId.has(value) ? <option value={value}>{model.byId.get(value)!.title}</option> : null}
      {nodeOptions(model)}
    </select>
  );
}

const OWN_QUEST = "own-quest";

// What MoveToPicker offers. A context, so a change to the graph redraws the pickers and not every card
export const MoveTargets = createContext<{ model: GraphModel; inboxId: string }>(null!);

// Sorts a step out of the Inbox: into any open quest or step, or into a quest of its own
export function MoveToPicker({ step, act, onMoved, selectRef, offerOwnQuest = true, className }: { step: GraphNode; act: Act; onMoved?: () => void; selectRef?: Ref<HTMLSelectElement>; offerOwnQuest?: boolean; className: string }) {
  const { model, inboxId } = useContext(MoveTargets);
  return (
    <select
      ref={selectRef}
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
      {offerOwnQuest ? <option value={OWN_QUEST}>Its own quest</option> : null}
      {nodeOptions(model, inboxId)}
    </select>
  );
}
