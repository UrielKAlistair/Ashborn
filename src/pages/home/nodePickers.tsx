// A picker of a place in the graph, as a plain select: NodePicker chooses an open quest or step (a
// deadline's), from the open, unshelved quests and steps, nested as on the graph.
import type { ReactNode } from "react";
import { isDone, type GraphModel } from "../../shared/graphModel";

// Open quests and steps as options, nested as on the graph
function nodeOptions(model: GraphModel, parentId: string | null = null, depth = 0): ReactNode[] {
  return (model.children.get(parentId) ?? [])
    .filter((node) => !isDone(node) && !node.shelved)
    .flatMap((node) => [
      <option key={node.id} value={node.id}>
        {"  ".repeat(depth)}
        {node.title}
      </option>,
      ...nodeOptions(model, node.id, depth + 1),
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
