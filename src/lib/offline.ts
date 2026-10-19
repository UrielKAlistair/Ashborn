import { today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Alarm, AlarmPatch, AshbornApi, Delta, Placement, Snapshot } from "../shared/types";
import type { Mutation } from "./api";

// Changes made without a connection wait here, in order, until it is back
const queueStorageKey = "ashborn-offline-queue";

export type QueuedChange = { name: Mutation; args: unknown[] };

// What each change that can wait looks like on screen meanwhile. Ticks, quick adds, alarms and
// arranging the canvas can wait; anything else needs a connection.
const preview: Partial<Record<Mutation, (snapshot: Snapshot, args: unknown[]) => Delta | null>> = {
  createNode: (_snapshot, [title, parentId, id]) => ({
    nodes: [
      {
        id: id as string,
        parentId: parentId as string | null,
        title: title as string,
        stat: null,
        color: null,
        active: true,
        createdAt: new Date().toISOString(),
        completedAt: null,
        ownXp: 0,
        position: null,
        size: null,
      },
    ],
  }),
  updateNode: (snapshot, [id, patch]) => {
    const { done, ...rest } = patch as { done?: boolean };
    const node = snapshot.nodes.find((candidate) => candidate.id === id);
    if (done === undefined || Object.keys(rest).length > 0 || !node || Boolean(node.completedAt) === done) return null;
    const step = done ? 1 : -1;
    const count = snapshot.progressToday.date === today() ? snapshot.progressToday.count : 0;
    return {
      nodes: [{ ...node, completedAt: done ? new Date().toISOString() : null, ownXp: node.ownXp + step * PROGRESS_UNIT }],
      progressToday: { date: today(), count: Math.max(0, count + step) },
    };
  },
  toggleRoutine: (snapshot, [routineId, date]) => ({
    routineCheck: {
      routineId: routineId as string,
      date: date as string,
      checked: !snapshot.routineChecks.some((check) => check.routineId === routineId && check.date === date),
    },
  }),
  completeDeadline: (_snapshot, [id]) => ({ removedDeadlineIds: [id as string] }),
  // Arranging the canvas
  placeNodes: (snapshot, [places]) => ({
    nodes: (places as Placement[]).flatMap(({ id, position, size }) => {
      const node = snapshot.nodes.find((candidate) => candidate.id === id);
      return node ? [{ ...node, position, size: size ?? node.size }] : [];
    }),
  }),
  // Alarms ring from the phone, so setting, switching and removing them must work without signal
  createAlarm: (_snapshot, [alarm]) => ({ alarms: [alarm as Alarm] }),
  updateAlarm: (snapshot, [id, patch]) => {
    const alarm = snapshot.alarms.find((candidate) => candidate.id === id);
    return alarm ? { alarms: [{ ...alarm, ...(patch as AlarmPatch) }] } : null;
  },
  deleteAlarm: (_snapshot, [id]) => ({ removedAlarmIds: [id as string] }),
};

// Queues a change for later and returns how it looks meanwhile, or null if it cannot wait
export function queueChange(snapshot: Snapshot, name: Mutation, args: unknown[]): Delta | null {
  // A step made offline gets its id now, so it can be ticked before it reaches the server
  const change = { name, args: name === "createNode" && !args[2] ? [args[0], args[1], crypto.randomUUID()] : args };
  const delta = preview[name]?.(snapshot, change.args) ?? null;
  if (delta) saveQueue([...loadQueue(), change]);
  return delta;
}

export function queuedCount() {
  return loadQueue().length;
}

// Sends queued changes in order. Stops at a lost connection, keeping the rest; a change the
// server refuses is dropped and its error returned.
export async function sendQueue(api: AshbornApi): Promise<string[]> {
  const queue = loadQueue();
  const refused: string[] = [];

  while (queue.length > 0) {
    const [{ name, args }] = queue;
    try {
      await (api[name] as (...params: unknown[]) => Promise<Delta>)(...args);
    } catch (error) {
      if (isConnectionError(error)) break;
      refused.push((error as Error).message);
    }
    queue.shift();
    saveQueue(queue);
  }

  if (queue.length > 0) throw new Error("fetch failed: connection lost while sending queued changes");
  return refused;
}

// Supabase reports an unreachable server as a failed fetch
export function isConnectionError(error: unknown) {
  return !navigator.onLine || /fetch|network/i.test((error as Error)?.message ?? "");
}

function loadQueue(): QueuedChange[] {
  try {
    return JSON.parse(window.localStorage.getItem(queueStorageKey) ?? "[]") as QueuedChange[];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedChange[]) {
  try {
    window.localStorage.setItem(queueStorageKey, JSON.stringify(queue));
  } catch {
    // Storage full or blocked: the queued changes are lost when the app closes
  }
}
