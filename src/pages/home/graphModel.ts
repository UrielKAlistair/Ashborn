import type { GraphEdge, GraphNode, Snapshot, StatKey } from "../../shared/types";

export const statKeys: StatKey[] = ["STR", "DEX", "INT", "WIS", "CHR", "MND"];

// Everything the dashboard derives from a snapshot
export type GraphModel = {
  byId: Map<string, GraphNode>;
  children: Map<string | null, GraphNode[]>; // keyed by parent id; null holds the threads
  totalXp: Map<string, number>; // a node's own XP and its steps', plus that of everything upstream
  ready: Set<string>; // not done, with no unfinished prerequisite or step
  statXp: Record<StatKey, number>;
  totalStatXp: number;
};

export const isDone = (node: GraphNode) => node.completedAt !== null;

export function buildGraphModel(snapshot: Snapshot): GraphModel {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const children = groupBy(snapshot.nodes, (node) => node.parentId);
  const incoming = groupBy(snapshot.edges, (edge: GraphEdge) => edge.to);

  // A node together with all its steps, at any depth
  const subtreeXp = new Map<string, number>();
  const subtree = (id: string): number => {
    const cached = subtreeXp.get(id);
    if (cached !== undefined) return cached;
    const sum = (byId.get(id)?.ownXp ?? 0) + (children.get(id) ?? []).reduce((acc, child) => acc + subtree(child.id), 0);
    subtreeXp.set(id, sum);
    return sum;
  };

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

  const ready = new Set(
    snapshot.nodes
      .filter(
        (node) =>
          !isDone(node) &&
          (incoming.get(node.id) ?? []).every((edge) => byId.get(edge.from)?.completedAt) &&
          (children.get(node.id) ?? []).every(isDone),
      )
      .map((node) => node.id),
  );

  // All work in a thread trains the thread's stat
  const statXp = Object.fromEntries(statKeys.map((key) => [key, 0])) as Record<StatKey, number>;
  let totalStatXp = 0;
  snapshot.nodes.forEach((node) => {
    const stat = threadOf(byId, node).stat;
    if (stat) {
      statXp[stat] += node.ownXp;
      totalStatXp += node.ownXp;
    }
  });

  return { byId, children, totalXp, ready, statXp, totalStatXp };
}

// The thread a node sits in (a thread is its own)
export function threadOf(byId: Map<string, GraphNode>, node: GraphNode): GraphNode {
  let current = node;
  let parent = current.parentId ? byId.get(current.parentId) : undefined;
  while (parent) {
    current = parent;
    parent = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return current;
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
