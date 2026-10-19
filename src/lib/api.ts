import type { AshbornApi, Delta, Snapshot } from "../shared/types";

// The api methods that change data (and so return a Delta)
export type Mutation = {
  [K in keyof AshbornApi]: ReturnType<AshbornApi[K]> extends Delta ? K : never;
}[keyof AshbornApi];

// Calls a main-process api method
export async function callApi<K extends keyof AshbornApi>(
  name: K,
  ...args: Parameters<AshbornApi[K]>
): Promise<ReturnType<AshbornApi[K]>> {
  if (!window.ashborn) {
    throw new Error("Ashborn bridge unavailable: run the app through Electron.");
  }

  return (await window.ashborn.call(name, ...args)) as ReturnType<AshbornApi[K]>;
}

// Merges a change into the data on screen. Lists the change doesn't touch keep their identity.
export function applyDelta(snapshot: Snapshot, delta: Delta): Snapshot {
  const removedNodes = new Set(delta.removedNodeIds);
  const removedEdges = new Set(delta.removedEdges?.map(edgeKey));
  const check = delta.routineCheck;

  return {
    nodes: merge(snapshot.nodes, (node) => node.id, delta.nodes, removedNodes),
    edges:
      removedNodes.size > 0 || removedEdges.size > 0 || delta.edges
        ? merge(
            snapshot.edges.filter((edge) => !removedNodes.has(edge.from) && !removedNodes.has(edge.to)),
            edgeKey,
            delta.edges,
            removedEdges,
          )
        : snapshot.edges,
    routines: merge(snapshot.routines, (routine) => routine.id, delta.routines, new Set(delta.removedRoutineIds)),
    routineChecks: check
      ? [
          ...snapshot.routineChecks.filter((c) => c.routineId !== check.routineId || c.date !== check.date),
          ...(check.checked ? [{ routineId: check.routineId, date: check.date }] : []),
        ]
      : snapshot.routineChecks,
    deadlines: merge(snapshot.deadlines, (deadline) => deadline.id, delta.deadlines, new Set(delta.removedDeadlineIds)),
    progressToday: delta.progressToday ?? snapshot.progressToday,
  };
}

function edgeKey(edge: { from: string; to: string }) {
  return `${edge.from}->${edge.to}`;
}

// Upserts keep their place if present and append if new; removals drop by key
function merge<T>(rows: T[], keyOf: (row: T) => string, upserts: T[] = [], removed = new Set<string>()): T[] {
  if (upserts.length === 0 && removed.size === 0) return rows;

  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  removed.forEach((key) => byKey.delete(key));
  upserts.forEach((row) => byKey.set(keyOf(row), row));

  return [...byKey.values()];
}
