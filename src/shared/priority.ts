import { daysBetween } from "./dates";
import { isDone, questOf, type GraphModel } from "./graphModel";
import type { GraphNode, ISODate, Priority, Snapshot } from "./types";

// A priority belongs to a chain: set on a node, or raised by a deadline linked to it, it covers the
// node's open prerequisites, transitively, and the steps inside it.

export type Priorities = {
  effective: Map<string, Priority>; // what covers the node; absent: nothing does
  best: Map<string, Priority>; // the most urgent in the node and everything inside it
  origin: Map<string, PriorityOrigin>; // where a covered node's priority comes from
};

// The node a priority was set on, or the node a deadline raised it on (with the deadline)
export type PriorityOrigin = { nodeId: string; deadlineId: string | null };

// The nearer the deadline, the higher the priority; further out than this raises nothing
export function deadlinePriority(daysLeft: number): Priority | null {
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 3) return 2;
  if (daysLeft <= 7) return 3;
  if (daysLeft <= 14) return 4;
  return null;
}

export function derivePriorities(model: GraphModel, snapshot: Snapshot, date: ISODate): Priorities {
  const prerequisites = new Map<string, string[]>();
  for (const { from, to } of snapshot.edges) prerequisites.set(to, [...(prerequisites.get(to) ?? []), from]);

  const set = snapshot.nodes.flatMap((node) => (node.priority ? [{ id: node.id, priority: node.priority, deadlineId: null }] : []));
  const raised = snapshot.deadlines.flatMap((deadline) => {
    const priority = deadlinePriority(daysBetween(date, deadline.dueDate));
    return deadline.nodeId && priority ? [{ id: deadline.nodeId, priority, deadlineId: deadline.id }] : [];
  });

  // Most urgent first, so a node's first visit is its highest priority and ends the walk there
  const effective = new Map<string, Priority>();
  const origin = new Map<string, PriorityOrigin>();
  const cover = (id: string, priority: Priority, from: PriorityOrigin) => {
    const node = model.byId.get(id);
    if (!node || isDone(node) || effective.has(id)) return;
    effective.set(id, priority);
    origin.set(id, from);
    (prerequisites.get(id) ?? []).forEach((before) => cover(before, priority, from));
    (model.children.get(id) ?? []).forEach((step) => cover(step.id, priority, from));
  };
  [...set, ...raised]
    .sort((a, b) => a.priority - b.priority)
    .forEach(({ id, priority, deadlineId }) => cover(id, priority, { nodeId: id, deadlineId }));

  const best = new Map<string, Priority>();
  const bestIn = (node: GraphNode): Priority | undefined => {
    const inside = (model.children.get(node.id) ?? []).map(bestIn);
    const found = [effective.get(node.id), ...inside].reduce((a, b) => (a && b ? (a < b ? a : b) : a ?? b), undefined);
    if (found) best.set(node.id, found);
    return found;
  };
  (model.children.get(null) ?? []).forEach(bestIn);

  return { effective, best, origin };
}

// Most urgent first, the given order kept among equals; no priority comes last
export function byPriority<T extends { id: string }>(nodes: T[], { best }: Priorities): T[] {
  const rank = (node: T) => best.get(node.id) ?? 5;
  return [...nodes].sort((a, b) => rank(a) - rank(b));
}

// The to-do: the steps of shown quests ready now that a priority covers, most urgent first
export function prioritisedSteps(model: GraphModel, snapshot: Snapshot, { effective }: Priorities): Array<{ priority: Priority; steps: GraphNode[] }> {
  const steps = snapshot.nodes.filter((node) => node.parentId && model.ready.has(node.id) && effective.has(node.id) && questOf(model.byId, node).active);
  return ([1, 2, 3, 4] as const).flatMap((priority) => {
    const inGroup = steps.filter((step) => effective.get(step.id) === priority);
    return inGroup.length ? [{ priority, steps: inGroup }] : [];
  });
}
