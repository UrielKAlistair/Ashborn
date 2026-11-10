/**
 * The graph model: what every view derives from the user's quests, steps and prerequisites.
 *
 * Input: a Snapshot, the rows as stored. A quest is a node with no parent; a step sits inside a quest
 * or inside another step (that step is then called a box). An edge `from → to` says `from` must be
 * done before `to`; both ends share a parent.
 * Output: a GraphModel of lookups (who is inside whom), and four derived facts per node: its XP with
 * everything that led to it, whether it can be done now (ready), whether it is put away (shelved),
 * and, for a box that is done with all its contents (a quest: all its contents), when the last tick
 * was (finished).
 * The stat totals for the character sheet ride along.
 *
 * The model is rebuilt from scratch on every change. That is the simplest correct choice, and fast
 * enough at today's sizes (hundreds of nodes; totalXp is the costly pass, O(N·(N+E))). The small
 * queries at the end (doneAround, openInside) work on bare rows instead, because the API, the
 * offline queue and Undo use them where no model is at hand.
 */
import type { GraphEdge, GraphNode, Snapshot, StatKey, StatWeights } from "./types";

export const statKeys: StatKey[] = ["STR", "DEX", "INT", "WIS", "CHR", "MND"];

export type GraphModel = {
  byId: Map<string, GraphNode>;
  children: Map<string | null, GraphNode[]>; // keyed by parent id; null holds the quests
  totalXp: Map<string, number>; // a node's own XP and its steps', plus that of everything upstream
  ready: Set<string>; // not done, not shelved, with no unfinished prerequisite or step
  shelved: Set<string>; // shelved itself, or inside a shelved box
  finishedAt: Map<string, number>; // boxes whose steps at any depth are all done, and the box too if a step: when the last was ticked (ms)
  statXp: Record<StatKey, number>;
  totalStatXp: number;
};

export const isDone = (node: GraphNode) => node.completedAt !== null;

/**
 * Builds the model in four passes over the nodes (readiness reads the shelving):
 * XP (a node is worth its whole subtree, summed over itself and every prerequisite upstream, so a
 * card's level shows the ground covered to reach it); shelving; readiness; finishing.
 */
export function buildGraphModel(snapshot: Snapshot): GraphModel {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = groupBy(snapshot.nodes, (node) => node.parentId);
  const incoming = groupBy(snapshot.edges, (edge: GraphEdge) => edge.to);

  // A node together with all its steps, at any depth, memoised
  const subtreeXp = new Map<string, number>();
  const subtree = (id: string): number => {
    const cached = subtreeXp.get(id);
    if (cached !== undefined) return cached;
    const sum = (byId.get(id)?.ownXp ?? 0) + (children.get(id) ?? []).reduce((acc, child) => acc + subtree(child.id), 0);
    subtreeXp.set(id, sum);
    return sum;
  };

  // The node and every node it waits on, through prerequisite edges, transitively
  const upstreamOf = (id: string) => {
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
      for (const edge of incoming.get(stack.pop()!) ?? []) {
        if (!seen.has(edge.from)) {
          seen.add(edge.from);
          stack.push(edge.from);
        }
      }
    }
    return seen;
  };

  const totalXp = new Map<string, number>();
  snapshot.nodes.forEach((node) => {
    let sum = 0;
    upstreamOf(node.id).forEach((id) => (sum += subtree(id)));
    totalXp.set(node.id, sum);
  });

  // Shelved: the node or a box it sits in was shelved. It is off the graph (unless its quest
  // shows its shelved steps) and never ready
  const shelved = new Set(snapshot.nodes.filter((node) => isShelved(byId, node)).map((node) => node.id));

  // Ready: open, not put away, every prerequisite done, and every step inside done (a box is done
  // last, after its contents)
  const ready = new Set(
    snapshot.nodes
      .filter(
        (node) =>
          !isDone(node) &&
          !shelved.has(node.id) &&
          (incoming.get(node.id) ?? []).every((edge) => byId.get(edge.from)?.completedAt) &&
          (children.get(node.id) ?? []).every(isDone),
      )
      .map((node) => node.id),
  );

  // The latest tick in a node and its steps, or null while any of them is open. A quest is never
  // ticked itself, so only its steps count.
  const lastTick = new Map<string, number | null>();
  const lastTickOf = (node: GraphNode): number | null => {
    if (lastTick.has(node.id)) return lastTick.get(node.id)!;
    let latest: number | null = node.parentId === null ? 0 : node.completedAt ? Date.parse(node.completedAt) : null;
    for (const child of children.get(node.id) ?? []) {
      const tick = lastTickOf(child);
      latest = latest === null || tick === null ? null : Math.max(latest, tick);
    }
    lastTick.set(node.id, latest);
    return latest;
  };
  // Only a node with contents can finish; a bare step is simply done
  const finishedAt = new Map<string, number>();
  snapshot.nodes.forEach((node) => {
    const tick = lastTickOf(node);
    if (tick !== null && children.has(node.id)) finishedAt.set(node.id, tick);
  });

  // All work in a quest trains each of the quest's stats, scaled by that stat's weight
  const statXp = Object.fromEntries(statKeys.map((key) => [key, 0])) as Record<StatKey, number>;
  let totalStatXp = 0;
  snapshot.nodes.forEach((node) => {
    trainedStats(questOf(byId, node).statWeights).forEach(([key, weight]) => {
      statXp[key] += weight * node.ownXp;
      totalStatXp += weight * node.ownXp;
    });
  });

  return { byId, children, totalXp, ready, shelved, finishedAt, statXp, totalStatXp };
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function isShelved(byId: Map<string, GraphNode>, node: GraphNode): boolean {
  if (node.shelved) return true;
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  return parent ? isShelved(byId, parent) : false;
}

// The quest a node sits in (a quest is its own)
export function questOf(byId: Map<string, GraphNode>, node: GraphNode): GraphNode {
  let current = node;
  let parent = current.parentId ? byId.get(current.parentId) : undefined;
  while (parent) {
    current = parent;
    parent = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return current;
}

// The stats a quest trains with their weights, in statKeys order
export function trainedStats(weights: StatWeights): [StatKey, number][] {
  return statKeys.flatMap((key): [StatKey, number][] => ((weights[key] ?? 0) > 0 ? [[key, weights[key]!]] : []));
}

// A finished box folds: to one line inside a quest, or, for a quest, out of the graph into Completed
export function isFinished(model: GraphModel, id: string) {
  return model.finishedAt.has(id);
}

// The done boxes from `id` out to its quest (never the quest, which is never ticked): a step opened or
// put inside them means they are no longer done
export function doneAround(nodes: Pick<GraphNode, "id" | "parentId" | "completedAt">[], id: string | null): string[] {
  const around: string[] = [];
  for (let node = nodes.find((candidate) => candidate.id === id); node && node.parentId !== null; node = nodes.find((candidate) => candidate.id === node!.parentId)) {
    if (node.completedAt) around.push(node.id);
  }
  return around;
}

// The open nodes under `id`, at any depth: ticking a box done ticks these too
export function openInside(nodes: Pick<GraphNode, "id" | "parentId" | "completedAt">[], id: string): string[] {
  return nodes.filter((node) => node.parentId === id).flatMap((node) => [...(node.completedAt ? [] : [node.id]), ...openInside(nodes, node.id)]);
}
