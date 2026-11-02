import { today } from "../shared/dates";
import { cooked, read, recipeProblems, shownMeal, uncooked } from "../shared/kitchen";
import { PROGRESS_UNIT } from "../shared/progression";
import type {
  Alarm,
  AlarmPatch,
  AshbornApi,
  Deadline,
  DefaultMeal,
  Delta,
  GraphEdge,
  GraphNode,
  Kitchen,
  Meal,
  MealSlot,
  NodePatch,
  Placement,
  Recipe,
  Routine,
  Snapshot,
  StockItem,
} from "../shared/types";
import { ServerError, type Mutation } from "./api";

// Changes made without a connection wait here, in order, until it is back
const queueStorageKey = "ashborn-offline-queue";

// Failed sends of the first change in a row after which the app shows why it is held
const HELD_TRIES_SHOWN = 3;

// `at`: when the change was made, so that when it is sent later it still loses to a change made after it.
// `tries`: sends of it that met a server error worth trying again.
export type QueuedChange = { name: Mutation; args: unknown[]; at: string; tries?: number };

type Preview = (snapshot: Snapshot, args: any[], at: string) => Delta; // eslint-disable-line @typescript-eslint/no-explicit-any

// How each change looks on screen until it reaches the server, which may keep something else (a
// later change made elsewhere); the snapshot read after the queue is sent shows what it kept.
// Throws when the change could never be accepted.
const preview: Record<Mutation, Preview> = {
  createNode: (_snapshot, [title, parentId, id], at) => ({
    nodes: [
      {
        id,
        parentId,
        title,
        statWeights: {},
        color: null,
        active: true,
        createdAt: at,
        completedAt: null,
        shelved: false,
        priority: null,
        ownXp: 0,
        position: null,
      },
    ],
  }),
  updateNode: (snapshot, [id, patch], at) => {
    const node = existing(snapshot.nodes, id, "This step");
    const { done, ...fields } = patch as NodePatch;
    const ticked = done !== undefined && Boolean(node.completedAt) !== done;
    const step = ticked ? (done ? 1 : -1) : 0;
    const updated: GraphNode = {
      ...node,
      ...definedOnly(fields),
      completedAt: ticked ? (done ? at : null) : node.completedAt,
      ownXp: node.ownXp + step * PROGRESS_UNIT,
    };
    return { nodes: [updated], progressToday: step ? countedToday(snapshot, step) : undefined };
  },
  deleteNode: (snapshot, [id]) => ({ removedNodeIds: [id, ...descendants(snapshot.nodes, id)] }),
  moveNode: (snapshot, [id, parentId]) => ({
    nodes: [{ ...existing(snapshot.nodes, id, "This step"), parentId, position: null }],
    removedEdges: snapshot.edges.filter((edge) => edge.from === id || edge.to === id),
  }),
  placeNodes: (snapshot, [places]) => ({
    nodes: (places as Placement[]).flatMap(({ id, position }) => {
      const node = snapshot.nodes.find((candidate) => candidate.id === id);
      return node ? [{ ...node, position }] : [];
    }),
  }),
  resetLayout: (snapshot, [ids]) => ({
    nodes: snapshot.nodes.filter((node) => (ids as string[]).includes(node.id)).map((node) => ({ ...node, position: null })),
  }),
  addEdge: (_snapshot, [edge]) => ({ edges: [edge as GraphEdge] }),
  removeEdge: (_snapshot, [edge]) => ({ removedEdges: [edge as GraphEdge] }),
  levelUp: (snapshot, [nodeId]) => {
    const node = existing(snapshot.nodes, nodeId, "This step");
    return { nodes: [{ ...node, ownXp: node.ownXp + PROGRESS_UNIT }], progressToday: countedToday(snapshot, 1) };
  },
  createRoutine: (_snapshot, [routine]) => ({ routines: [routine as Routine] }),
  deleteRoutine: (_snapshot, [id]) => ({ removedRoutineIds: [id] }),
  setRoutineCheck: (_snapshot, [routineId, date, checked]) => ({ routineCheck: { routineId, date, checked } }),
  createDeadline: (_snapshot, [deadline]) => ({ deadlines: [deadline as Deadline] }),
  completeDeadline: (_snapshot, [id]) => ({ removedDeadlineIds: [id] }),
  deleteDeadline: (_snapshot, [id]) => ({ removedDeadlineIds: [id] }),
  createAlarm: (_snapshot, [alarm]) => ({ alarms: [alarm as Alarm] }),
  updateAlarm: (snapshot, [id, patch]) => ({ alarms: [{ ...existing(snapshot.alarms, id, "This alarm"), ...(patch as AlarmPatch) }] }),
  deleteAlarm: (_snapshot, [id]) => ({ removedAlarmIds: [id] }),
  updateSettings: (snapshot, [patch]) => ({ settings: { ...snapshot.settings, ...definedOnly(patch) } }),
  // The Kitchen
  createStockItem: (snapshot, [item]) => kitchen(snapshot, { items: [...snapshot.kitchen.items, { ...(item as StockItem), onHand: 0, readAt: null }] }),
  updateStockItem: (snapshot, [id, patch]) => {
    existing(snapshot.kitchen.items, id, "This stock item");
    return kitchen(snapshot, { items: snapshot.kitchen.items.map((item) => (item.id === id ? { ...item, ...definedOnly(patch) } : item)) });
  },
  deleteStockItem: (snapshot, [id]) =>
    kitchen(snapshot, {
      items: snapshot.kitchen.items.filter((item) => item.id !== id),
      recipes: snapshot.kitchen.recipes.map((recipe) => ({
        ...recipe,
        ingredients: recipe.ingredients.map((ingredient) => (ingredient.itemId === id ? { ...ingredient, itemId: null } : ingredient)),
      })),
    }),
  setStock: (snapshot, [, itemId, amount], at) => ({ kitchen: read(snapshot.kitchen, itemId, amount, at) }),
  saveRecipe: (snapshot, [recipe, isNew = true]) => {
    if (!isNew) existing(snapshot.kitchen.recipes, (recipe as Recipe).id, (recipe as Recipe).title);
    const problems = recipeProblems(recipe, snapshot.kitchen.items);
    if (problems.length > 0) throw new Error(problems.join(" "));
    return kitchen(snapshot, { recipes: [...snapshot.kitchen.recipes.filter((other) => other.id !== recipe.id), recipe] });
  },
  deleteRecipe: (snapshot, [id]) =>
    kitchen(snapshot, {
      recipes: snapshot.kitchen.recipes.filter((recipe) => recipe.id !== id),
      meals: snapshot.kitchen.meals.map((meal) => ({ ...meal, recipeIds: meal.recipeIds.filter((recipeId) => recipeId !== id) })),
      defaultWeek: snapshot.kitchen.defaultWeek.map((meal) => ({ ...meal, recipeIds: meal.recipeIds.filter((recipeId) => recipeId !== id) })),
    }),
  setMeal: (snapshot, [meal]) => {
    const { fromDefault, ...shown } = shownMeal(snapshot.kitchen, meal.date, meal.slot);
    if (shown.status === "cooked" && meal.status === "cancelled") throw new Error("This meal was cooked; untick it before cancelling it.");
    const planned: Meal = { ...(meal as Meal), id: fromDefault ? meal.id : shown.id, status: shown.status === "cooked" ? "cooked" : meal.status };
    return kitchen(snapshot, { meals: [...snapshot.kitchen.meals.filter((other) => other.id !== planned.id), planned] });
  },
  cookMeal: (snapshot, [date, slot, id], at) => ({ kitchen: cooked(snapshot.kitchen, date, slot as MealSlot, id, at) }),
  uncookMeal: (snapshot, [date, slot]) => ({ kitchen: uncooked(snapshot.kitchen, date, slot as MealSlot) }),
  setDefaultMeal: (snapshot, [meal]) => {
    const others = snapshot.kitchen.defaultWeek.filter((other) => other.weekday !== meal.weekday || other.slot !== meal.slot);
    return kitchen(snapshot, { defaultWeek: [...others, meal as DefaultMeal] });
  },
};

// Queues a change for later and returns how it looks meanwhile. `at` is when the user made it (the
// click, which may be well before an online attempt failed). A step made offline gets its id now, so
// it can be changed again before it reaches the server.
export function queueChange(snapshot: Snapshot, name: Mutation, args: unknown[], made: Date = new Date()): Delta {
  const at = made.toISOString();
  const change: QueuedChange = { name, args: withIds(name, args), at };
  const delta = preview[name](snapshot, change.args, at);
  saveQueue([...loadQueue(), change]);
  return delta;
}

// Queues changes sent but not answered when the app closes, so they are sent again at the next
// start; sending a change twice changes nothing more than sending it once
export function queueUnsent(changes: QueuedChange[]) {
  if (changes.length > 0) saveQueue([...loadQueue(), ...changes]);
}

// How a change looks on screen while it is on its way; throws when it could never be accepted
export function previewChange(snapshot: Snapshot, name: Mutation, args: unknown[], at: string): Delta {
  return preview[name](snapshot, args, at);
}

// The arguments with any id the change creates filled in, so its preview and the row the server
// makes share it
export function withIds(name: Mutation, args: unknown[]): unknown[] {
  return name === "createNode" && !args[2] ? [args[0], args[1], crypto.randomUUID()] : args;
}

function existing<T extends { id: string }>(rows: T[], id: string, what: string): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`${what} was deleted on another device.`);
  return row;
}

function descendants(nodes: GraphNode[], id: string): string[] {
  return nodes.filter((node) => node.parentId === id).flatMap((node) => [node.id, ...descendants(nodes, node.id)]);
}

function countedToday(snapshot: Snapshot, step: number) {
  const count = snapshot.progressToday.date === today() ? snapshot.progressToday.count : 0;
  return { date: today(), count: Math.max(0, count + step) };
}

function kitchen(snapshot: Snapshot, parts: Partial<Kitchen>): Delta {
  return { kitchen: { ...snapshot.kitchen, ...parts } };
}

function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function queuedCount() {
  return loadQueue().length;
}

// Thrown when the queue stops on a change worth sending again (no connection, or a server error
// that may pass); the change and those after it wait. `tries` counts the server errors it has met,
// and `shown` says whether that is enough to tell the user why.
export class QueueHeld extends Error {
  constructor(
    readonly reason: string,
    readonly tries: number,
  ) {
    super(`fetch failed: queued changes held (${reason})`);
  }

  get shown() {
    return this.tries >= HELD_TRIES_SHOWN;
  }
}

// Sends queued changes in order, each through an API whose clock says when it was made. A change
// that can never succeed is dropped and its error returned; at one worth trying again, sending
// stops and QueueHeld is thrown. The queue is read again before each send, since changes made
// meanwhile are appended to it.
export async function sendQueue(apiAt: (at: Date) => AshbornApi): Promise<string[]> {
  const refused: string[] = [];

  for (let next = loadQueue()[0]; next; next = loadQueue()[0]) {
    const { name, args, at, tries = 0 } = next;
    try {
      const api = apiAt(at ? new Date(at) : new Date()); // queued before changes carried a time: now
      await (api[name] as (...params: unknown[]) => Promise<Delta>)(...args);
    } catch (error) {
      // No connection says nothing about the change; a server error counts against it
      if (isConnectionError(error)) throw new QueueHeld((error as Error).message, tries);
      if (!refusedForGood(error)) {
        saveQueue([{ ...next, tries: tries + 1 }, ...loadQueue().slice(1)]);
        throw new QueueHeld((error as Error).message, tries + 1);
      }
      refused.push((error as Error).message);
    }
    saveQueue(loadQueue().slice(1));
  }

  return refused;
}

// A change the server can never accept: a refusal of ours ("deleted on another device", a unit of
// the wrong kind), or a Postgres error in the data (22), a constraint (23), access or schema (42),
// a raised exception (P0001), or a row not found (PGRST116). Anything else (no connection, 5xx, 429, an expired sign-in) may pass.
function refusedForGood(error: unknown) {
  if (error instanceof ServerError) return /^(22|23|42)/.test(error.code) || error.code === "P0001" || error.code === "PGRST116";
  return true;
}

// Supabase reports an unreachable server as a failed fetch, and a request given up on as a timeout
export function isConnectionError(error: unknown) {
  return error instanceof QueueHeld || !navigator.onLine || (error as Error)?.name === "TimeoutError" || /fetch|network|timed out/i.test((error as Error)?.message ?? "");
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
