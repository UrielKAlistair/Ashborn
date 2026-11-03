import { daysBetween } from "./dates";
import { isDone, questOf, type GraphModel } from "./graphModel";
import type { GraphNode, ISODate, Priority, Snapshot } from "./types";

// A priority belongs to a chain: set on a node, or raised by a deadline linked to it, it covers the
// node's open prerequisites, transitively, and the steps inside it.

export type Priorities = {
  effective: Map<string, Priority>; // what covers the node; absent: nothing does
  best: Map<string, Priority>; // the most urgent in the node and everything inside it
  marked: Map<string, Priority>; // what the graph marks: set or raised on the node, or covering it from outside its box
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

  const inside = (id: string, boxId: string) => {
    for (let parent = model.byId.get(id)?.parentId; parent; parent = model.byId.get(parent)?.parentId) if (parent === boxId) return true;
    return false;
  };
  const own = new Set([...set, ...raised].map(({ id }) => id));
  const marked = new Map([...effective].filter(([id]) => own.has(id) || !inside(id, origin.get(id)!.nodeId)));

  return { effective, best, marked, origin };
}

// The colour of a link on the graph: a chain's, when one end is marked and both are in the same chain;
// a link inside a box that holds its priority stays plain
export function linkPriority({ effective, marked, origin }: Priorities, from: string, to: string): Priority | undefined {
  const sameChain = origin.has(to) && origin.get(from)?.nodeId === origin.get(to)?.nodeId;
  return sameChain && (marked.has(from) || marked.has(to)) ? effective.get(to) : undefined;
}

// Most urgent first, the given order kept among equals; no priority comes last
export function byPriority<T extends { id: string }>(nodes: T[], { best }: Priorities): T[] {
  const rank = (node: T) => best.get(node.id) ?? 5;
  return [...nodes].sort((a, b) => rank(a) - rank(b));
}

// A quest nothing has been added to: its next move is a first step, not ticking it done
export function needsFirstStep(model: GraphModel, node: GraphNode) {
  return !node.parentId && !model.children.has(node.id);
}

// The to-do: what shown quests have ready now that a priority covers, most urgent first: steps, and
// quests that need a first step (a finished quest has steps; an empty Inbox waits for captures)
export function prioritisedSteps(model: GraphModel, snapshot: Snapshot, { effective }: Priorities): Array<{ priority: Priority; steps: GraphNode[] }> {
  const steps = snapshot.nodes.filter(
    (node) =>
      (node.parentId || (needsFirstStep(model, node) && node.id !== snapshot.inboxId)) &&
      model.ready.has(node.id) &&
      effective.has(node.id) &&
      questOf(model.byId, node).active,
  );
  return ([1, 2, 3, 4] as const).flatMap((priority) => {
    const inGroup = steps.filter((step) => effective.get(step.id) === priority);
    return inGroup.length ? [{ priority, steps: inGroup }] : [];
  });
}
