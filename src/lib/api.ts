import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { addDays, dayOf, DEFAULT_DAY_START_HOUR, startOfDay, today } from "../shared/dates";
import { recipeProblems, sameKind } from "../shared/kitchen";
import { PROGRESS_UNIT } from "../shared/progression";
import {
  mealDaysAhead,
  mealDaysBack,
  type Alarm,
  type AlarmKind,
  type AshbornApi,
  type Deadline,
  type Delta,
  type GraphEdge,
  type GraphNode,
  type Kitchen,
  type MealSlot,
  type MealStatus,
  type Priority,
  type ProgressToday,
  type Routine,
  type Snapshot,
  type StatWeights,
  type StockUnit,
  type QuestColor,
  type Settings,
  type Weekday,
} from "../shared/types";

// The api methods that change data (and so return a Delta). A Snapshot also fits the shape of a
// Delta, so getSnapshot is left out by name.
export type Mutation = Exclude<
  {
    [K in keyof AshbornApi]: Awaited<ReturnType<AshbornApi[K]>> extends Delta ? K : never;
  }[keyof AshbornApi],
  "getSnapshot"
>;

// Rows as Supabase returns them (see supabase/migrations)
export type NodeRow = {
  id: string;
  parent_id: string | null;
  title: string;
  stat_weights: StatWeights;
  color: QuestColor | null;
  active: boolean;
  created_at: string;
  completed_at: string | null;
  shelved: boolean;
  priority: Priority | null;
  logged_xp?: number; // only from the nodes_with_xp view
  last_logged_at?: string | null; // likewise
  changed_at?: Record<string, string>;
  x: number | null;
  y: number | null;
};
export type RoutineRow = { id: string; title: string; cue: string; weekdays: Weekday[]; time: string | null; alarm: AlarmKind };
export type AlarmRow = { id: string; label: string; kind: Alarm["kind"]; at: string | null; time: string | null; weekdays: Weekday[]; enabled: boolean };
export type DeadlineRow = { id: string; title: string; due_date: string; done_at: string | null; alarm_time: string | null; node_id: string | null };
type StockRow = { id: string; name: string; unit: StockUnit; target: number; on_hand: number; read_at: string | null };
type RecipeRow = {
  id: string;
  title: string;
  body: string;
  recipe_ingredients: { id: string; item_id: string | null; name: string; amount: number; unit: StockUnit }[];
  recipe_reminders: { id: string; label: string; offset_minutes: number; anchor_id: string | null }[];
};
type MealRow = {
  id: string;
  date: string;
  slot: MealSlot;
  description: string;
  status: MealStatus;
  meal_recipes: { recipe_id: string }[];
  stock_changes: { id: string; item_id: string; amount: number; made_at: string }[];
};
type DefaultMealRow = { weekday: Weekday; slot: MealSlot; description: string; default_meal_recipes: { recipe_id: string }[] };

// The data store over Supabase. Nodes are read and written through the nodes_with_xp view so
// each change returns the node with its XP in one round trip.
// `clock` says when a change was made: now for a change made online, the time it was queued for one
// sent later. Every write is stamped with it, so the later change wins whatever order they arrive in.
export function createApi(db: SupabaseClient, clock: () => Date = () => new Date()): AshbornApi {
  const nodes = () => db.from("nodes_with_xp");

  const readNode = async (id: string) => toNode(must(await nodes().select().eq("id", id).single()));

  return inRowOrder(db, {
    async getSnapshot(userId) {
      // Which day it is depends on the day-start hour, so the reads of today's data wait for it
      const settings = readSettings(db);
      const date = settings.then(({ dayStartHour }) => dayOf(new Date(), dayStartHour));
      const [nodeRows, edgeRows, routineRows, checkRows, deadlineRows, alarmRows, progressToday, kitchen, settingsRow] = await Promise.all([
        // A second key for rows made at the same moment: without one, an update can move a row among them
        nodes().select().order("created_at").order("id"),
        db.from("graph_edges").select("from_id, to_id"),
        db.from("routines").select().order("created_at"),
        date.then((day) => db.from("routine_checks").select("routine_id, date").eq("date", day).eq("checked", true)),
        db.from("deadlines").select().is("done_at", null).order("due_date"),
        db.from("alarms").select().or(`at.is.null,at.gt.${new Date().toISOString()}`).order("created_at"),
        settings.then(({ dayStartHour }) => readProgressToday(db, dayStartHour)),
        date.then((day) => readKitchen(db, day)),
        settings,
      ]);

      return {
        nodes: must(nodeRows).map(toNode),
        edges: must(edgeRows).map(toEdge),
        routines: must(routineRows).map(toRoutine),
        routineChecks: must(checkRows).map((row) => ({ routineId: row.routine_id, date: row.date })),
        deadlines: must(deadlineRows).map(toDeadline),
        alarms: must(alarmRows).map(toAlarm),
        progressToday,
        kitchen,
        settings: settingsRow,
        inboxId: userId,
      };
    },

    async createNode(title, parentId, id = crypto.randomUUID()) {
      // Stamped when made, as on screen until now, so the order doesn't shift when the row comes back
      must(await db.from("graph_nodes").upsert({ id, title, parent_id: parentId, created_at: clock().toISOString() }, { onConflict: "id", ignoreDuplicates: true }));
      return { nodes: [await readNode(id)] };
    },

    async updateNode(id, { title, statWeights, color, active, done, shelved, priority }) {
      const at = clock().toISOString();
      const completed_at = done === undefined ? undefined : done ? at : null;
      const stat_weights = statWeights && positiveWeights(statWeights);
      const fields = { title, stat_weights, color, active, completed_at, shelved, priority };
      const row = must(await nodes().update({ ...fields, changed_at: stamps(fields, at) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This step was deleted on another device.");

      return { nodes: [toNode(row as NodeRow)], progressToday: done === undefined ? undefined : await readProgressToday(db) };
    },

    async deleteNode(id) {
      const removed = must(await db.rpc("delete_node", { target: id })) as string[];

      return { removedNodeIds: removed, progressToday: await readProgressToday(db) };
    },

    async moveNode(id, parentId) {
      const removed = must(await db.rpc("move_node", { target: id, new_parent: parentId })) as Array<{ from_id: string; to_id: string }>;

      return { nodes: [await readNode(id)], removedEdges: removed.map(toEdge) };
    },

    async placeNodes(places) {
      const rows = places.map(({ id, position }) => ({ id, ...position }));
      const placed = must(await db.rpc("place_nodes", { places: rows })) as string[];

      return { nodes: (must(await nodes().select().in("id", placed)) as NodeRow[]).map(toNode) };
    },

    async resetLayout(ids) {
      const fields = { x: null, y: null };
      const rows = must(await nodes().update({ ...fields, changed_at: stamps(fields, clock().toISOString()) }).in("id", ids).select()) as NodeRow[];

      return { nodes: rows.map(toNode) };
    },

    async addEdge(edge) {
      must(await db.rpc("add_edge", { source_id: edge.from, target_id: edge.to }));

      return { edges: [edge] };
    },

    async removeEdge(edge) {
      must(await db.from("graph_edges").delete().eq("from_id", edge.from).eq("to_id", edge.to));

      return { removedEdges: [edge] };
    },

    // The id makes a level-up sent twice count once
    async levelUp(nodeId, id) {
      const row = { event_id: id, node_id: nodeId, amount: PROGRESS_UNIT, logged_at: clock().toISOString() };
      deletedIfMissing(await db.from("progress_log").upsert(row, { onConflict: "event_id", ignoreDuplicates: true }), "This step");
      const [node, progressToday] = await Promise.all([readNode(nodeId), readProgressToday(db)]);

      return { nodes: [node], progressToday };
    },

    async createRoutine({ id, title, cue, weekdays, time, alarm }) {
      must(await db.from("routines").upsert({ id, title, cue, weekdays, time, alarm }, { onConflict: "id", ignoreDuplicates: true }));
      return { routines: [toRoutine(must(await db.from("routines").select().eq("id", id).single()))] };
    },

    async deleteRoutine(id) {
      must(await db.from("routines").delete().eq("id", id));

      return { removedRoutineIds: [id] };
    },

    // Absolute rather than a toggle, and stamped: the tick made later wins, whichever device
    // sends last. Returns what the database kept.
    async setRoutineCheck(routineId, date, checked) {
      const row = { routine_id: routineId, date, checked, changed_at: { checked: clock().toISOString() } };
      const result = await db.from("routine_checks").upsert(row, { onConflict: "routine_id,date" }).select("checked").single();
      deletedIfMissing(result, "This routine");

      return { routineCheck: { routineId, date, checked: (result.data as { checked: boolean }).checked } };
    },

    async createDeadline({ id, title, dueDate, alarmTime, nodeId }) {
      must(await db.from("deadlines").upsert({ id, title, due_date: dueDate, alarm_time: alarmTime, node_id: nodeId }, { onConflict: "id", ignoreDuplicates: true }));
      return { deadlines: [toDeadline(must(await db.from("deadlines").select().eq("id", id).single()))] };
    },

    async linkDeadline(id, nodeId) {
      const fields = { node_id: nodeId };
      const row = must(await db.from("deadlines").update({ ...fields, changed_at: stamps(fields, clock().toISOString()) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This deadline was deleted on another device.");
      return { deadlines: [toDeadline(row as DeadlineRow)] };
    },

    async completeDeadline(id) {
      const at = clock().toISOString();
      const row = must(await db.from("deadlines").update({ done_at: at, changed_at: { done_at: at } }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This deadline was deleted on another device.");

      return { removedDeadlineIds: [id] };
    },

    async deleteDeadline(id) {
      must(await db.from("deadlines").delete().eq("id", id));

      return { removedDeadlineIds: [id] };
    },

    async createAlarm(alarm) {
      must(await db.from("alarms").upsert(alarm, { onConflict: "id", ignoreDuplicates: true }));
      return { alarms: [toAlarm(must(await db.from("alarms").select().eq("id", alarm.id).single()))] };
    },

    async updateAlarm(id, patch) {
      const row = must(await db.from("alarms").update({ ...patch, changed_at: stamps(patch, clock().toISOString()) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This alarm was deleted on another device.");

      return { alarms: [toAlarm(row as AlarmRow)] };
    },

    async deleteAlarm(id) {
      must(await db.from("alarms").delete().eq("id", id));

      return { removedAlarmIds: [id] };
    },

    async updateSettings({ dayStartHour, timeZone }) {
      const at = clock().toISOString();
      const fields = { day_start_hour: dayStartHour, time_zone: timeZone };
      must(await db.from("user_settings").upsert({ ...fields, changed_at: stamps(fields, at) }, { onConflict: "user_id" }));

      return { settings: await readSettings(db) };
    },

    // Every Kitchen change returns the whole Kitchen, read again
    async createStockItem({ id, name, unit, target }) {
      must(await db.from("stock_items").upsert({ id, name, unit, target }, { onConflict: "id", ignoreDuplicates: true }));
      return { kitchen: await readKitchen(db) };
    },

    async updateStockItem(id, patch) {
      const current = must(await db.from("stock_items").select("unit").eq("id", id).maybeSingle()) as { unit: StockUnit } | null;
      if (!current) throw new Error("This stock item was deleted on another device.");
      if (patch.unit && !sameKind(current.unit, patch.unit)) throw new Error(`An item counted in ${current.unit} cannot change to ${patch.unit}.`);
      const row = must(await db.from("stock_items").update({ ...patch, changed_at: stamps(patch, clock().toISOString()) }).eq("id", id).select("id").maybeSingle());
      if (!row) throw new Error("This stock item was deleted on another device.");
      return { kitchen: await readKitchen(db) };
    },

    async deleteStockItem(id) {
      must(await db.from("stock_items").delete().eq("id", id));
      return { kitchen: await readKitchen(db) };
    },

    // A reading: the amount on hand when counted. The id makes sending it twice count once.
    async setStock(id, itemId, amount) {
      const row = { id, item_id: itemId, amount, kind: "reading", made_at: clock().toISOString() };
      deletedIfMissing(await db.from("stock_changes").upsert(row, { onConflict: "id", ignoreDuplicates: true }), "This stock item");
      return { kitchen: await readKitchen(db) };
    },

    async saveRecipe(recipe, isNew = true) {
      const items = (must(await db.from("stock_on_hand").select()) as StockRow[]).map(toStockItem);
      const problems = recipeProblems(recipe, items);
      if (problems.length > 0) throw new Error(problems.join(" "));
      must(
        await db.rpc("save_recipe", {
          recipe: {
            id: recipe.id,
            title: recipe.title,
            body: recipe.body,
            ingredients: recipe.ingredients.map((ingredient) => ({ id: ingredient.id, item_id: ingredient.itemId, name: ingredient.name, amount: ingredient.amount, unit: ingredient.unit })),
            reminders: recipe.reminders.map((reminder) => ({ id: reminder.id, label: reminder.label, offset_minutes: reminder.offsetMinutes, anchor_id: reminder.anchorId })),
          },
          is_new: isNew,
          changed: clock().toISOString(),
        }),
      );
      return { kitchen: await readKitchen(db) };
    },

    async deleteRecipe(id) {
      must(await db.from("recipes").delete().eq("id", id));
      return { kitchen: await readKitchen(db) };
    },

    async setMeal({ id, date, slot, description, recipeIds, status }) {
      const args = { meal_id: id, meal_date: date, meal_slot: slot, meal_description: description, recipe_ids: recipeIds, meal_status: status };
      must(await db.rpc("set_meal", { ...args, changed: clock().toISOString() }));
      return { kitchen: await readKitchen(db) };
    },

    async cookMeal(date, slot, id) {
      must(await db.rpc("cook_meal", { meal_id: id, meal_date: date, meal_slot: slot, changed: clock().toISOString() }));
      return { kitchen: await readKitchen(db) };
    },

    async uncookMeal(date, slot) {
      must(await db.rpc("uncook_meal", { meal_date: date, meal_slot: slot, changed: clock().toISOString() }));
      return { kitchen: await readKitchen(db) };
    },

    async setDefaultMeal({ weekday, slot, description, recipeIds }) {
      const args = { meal_weekday: weekday, meal_slot: slot, meal_description: description, recipe_ids: recipeIds };
      must(await db.rpc("set_default_meal", { ...args, changed: clock().toISOString() }));
      return { kitchen: await readKitchen(db) };
    },
  });
}

// The rows each change touches or needs to exist: a step waits for its box, a link for its two
// ends, a tick for its routine, since on screen they may still be on their way. Every Kitchen
// change shares one key, since each returns the whole Kitchen and an earlier reply arriving late
// would put back older data.
const rowKeys: { [K in Mutation]: (...args: Parameters<AshbornApi[K]>) => string[] } = {
  createNode: (_title, parentId, id) => [...(id ? [`node:${id}`] : []), ...(parentId ? [`node:${parentId}`] : [])],
  updateNode: (id) => [`node:${id}`],
  deleteNode: (id) => [`node:${id}`],
  moveNode: (id, parentId) => [`node:${id}`, ...(parentId ? [`node:${parentId}`] : [])],
  placeNodes: (places) => places.map((place) => `node:${place.id}`),
  resetLayout: (ids) => ids.map((id) => `node:${id}`),
  addEdge: (edge) => [`edge:${edge.from}->${edge.to}`, `node:${edge.from}`, `node:${edge.to}`],
  removeEdge: (edge) => [`edge:${edge.from}->${edge.to}`, `node:${edge.from}`, `node:${edge.to}`],
  levelUp: (nodeId) => [`node:${nodeId}`],
  createRoutine: (routine) => [`routine:${routine.id}`],
  deleteRoutine: (id) => [`routine:${id}`],
  setRoutineCheck: (routineId, date) => [`routine:${routineId}@${date}`, `routine:${routineId}`],
  createDeadline: (deadline) => [`deadline:${deadline.id}`],
  linkDeadline: (id) => [`deadline:${id}`],
  completeDeadline: (id) => [`deadline:${id}`],
  deleteDeadline: (id) => [`deadline:${id}`],
  createAlarm: (alarm) => [`alarm:${alarm.id}`],
  updateAlarm: (id) => [`alarm:${id}`],
  deleteAlarm: (id) => [`alarm:${id}`],
  createStockItem: () => ["kitchen"],
  updateStockItem: () => ["kitchen"],
  deleteStockItem: () => ["kitchen"],
  setStock: () => ["kitchen"],
  saveRecipe: () => ["kitchen"],
  deleteRecipe: () => ["kitchen"],
  setMeal: () => ["kitchen"],
  cookMeal: () => ["kitchen"],
  uncookMeal: () => ["kitchen"],
  setDefaultMeal: () => ["kitchen"],
  updateSettings: () => ["settings"],
};

// Sends changes to the same row one after another, in the order they were made, so a later change
// can never be overwritten by an earlier one that reached the database last. Changes to different
// rows still go at once. Every api over one client shares the order, whatever its clock (the app
// makes one per change, to stamp it with when it was made).
const rowQueues = new WeakMap<SupabaseClient, ReturnType<typeof keyedQueue>>();

function inRowOrder(db: SupabaseClient, api: AshbornApi): AshbornApi {
  const queue = rowQueues.get(db) ?? keyedQueue();
  rowQueues.set(db, queue);
  const wrapped = { ...api } as Record<string, unknown>;
  for (const name of Object.keys(rowKeys) as Mutation[]) {
    const method = api[name] as (...args: unknown[]) => Promise<Delta>;
    const keysOf = rowKeys[name] as (...args: unknown[]) => string[];
    wrapped[name] = (...args: unknown[]) => queue(keysOf(...args), () => method(...args));
  }
  return wrapped as AshbornApi;
}

// Runs each task after every earlier task that shares one of its keys has settled (failed ones
// included); tasks with no key in common run at once
export function keyedQueue() {
  const last = new Map<string, Promise<unknown>>();
  return <T>(keys: string[], task: () => Promise<T>): Promise<T> => {
    const before = keys.map((key) => last.get(key)?.catch(() => {}));
    const run = Promise.all(before).then(task);
    const settled = run.catch(() => {});
    for (const key of keys) last.set(key, settled);
    void settled.then(() => keys.forEach((key) => last.get(key) === settled && last.delete(key)));
    return run;
  };
}

// The Kitchen, with meals from mealDaysBack before `date` to mealDaysAhead after it
export async function readKitchen(db: SupabaseClient, date = today()): Promise<Kitchen> {
  const day = (offset: number) => addDays(date, offset);
  const [itemRows, recipeRows, defaultRows, mealRows] = await Promise.all([
    db.from("stock_on_hand").select().order("created_at"),
    db
      .from("recipes")
      .select("id, title, body, recipe_ingredients(*), recipe_reminders(*)")
      .order("created_at")
      .order("position", { referencedTable: "recipe_ingredients" })
      .order("position", { referencedTable: "recipe_reminders" }),
    db.from("default_meals").select("weekday, slot, description, default_meal_recipes(recipe_id)"),
    db
      .from("meals")
      .select("id, date, slot, description, status, meal_recipes(recipe_id), stock_changes(id, item_id, amount, made_at)")
      .gte("date", day(-mealDaysBack))
      .lte("date", day(mealDaysAhead)),
  ]);
  const meals = must(mealRows) as MealRow[];

  return {
    items: (must(itemRows) as StockRow[]).map(toStockItem),
    recipes: (must(recipeRows) as RecipeRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      ingredients: row.recipe_ingredients.map((i) => ({ id: i.id, itemId: i.item_id, name: i.name, amount: Number(i.amount), unit: i.unit })),
      reminders: row.recipe_reminders.map((r) => ({ id: r.id, label: r.label, offsetMinutes: r.offset_minutes, anchorId: r.anchor_id })),
    })),
    defaultWeek: (must(defaultRows) as DefaultMealRow[]).map((row) => ({
      weekday: row.weekday,
      slot: row.slot,
      description: row.description,
      recipeIds: row.default_meal_recipes.map((link) => link.recipe_id),
    })),
    meals: meals.map((row) => ({ id: row.id, date: row.date, slot: row.slot, description: row.description, status: row.status, recipeIds: row.meal_recipes.map((link) => link.recipe_id) })),
    mealChanges: meals.flatMap((row) => row.stock_changes.map((change) => ({ id: change.id, itemId: change.item_id, mealId: row.id, amount: Number(change.amount), madeAt: change.made_at }))),
  };
}

// Numeric columns can arrive as strings, so amounts are read with Number
function toStockItem(row: StockRow) {
  return { id: row.id, name: row.name, unit: row.unit, target: Number(row.target), onHand: Number(row.on_hand), readAt: row.read_at };
}

// Level-ups and completed steps today. Times are stored in UTC, so the local day becomes a range.
export async function readProgressToday(db: SupabaseClient, dayStartHour?: number): Promise<ProgressToday> {
  const date = dayOf(new Date(), dayStartHour);
  const [from, to] = [startOfDay(date, dayStartHour).toISOString(), startOfDay(addDays(date, 1), dayStartHour).toISOString()];

  const [levelUps, completions] = await Promise.all([
    db.from("progress_log").select("*", { count: "exact", head: true }).gte("logged_at", from).lt("logged_at", to),
    db.from("graph_nodes").select("*", { count: "exact", head: true }).gte("completed_at", from).lt("completed_at", to),
  ]);

  return { date, count: countOf(levelUps) + countOf(completions) };
}

// A user with no settings row has the defaults
export async function readSettings(db: SupabaseClient): Promise<Settings> {
  const row = must(await db.from("user_settings").select("day_start_hour, time_zone").maybeSingle()) as { day_start_hour: number; time_zone: string | null } | null;
  return { dayStartHour: row?.day_start_hour ?? DEFAULT_DAY_START_HOUR, timeZone: row?.time_zone ?? null };
}

// A node's own XP: what level-ups logged on it, plus the completion credit once it is done
export function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    statWeights: row.stat_weights,
    color: row.color,
    active: row.active,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    shelved: row.shelved,
    priority: row.priority,
    ownXp: (row.logged_xp ?? 0) + (row.completed_at ? PROGRESS_UNIT : 0),
    lastActive: lastActive(row),
    position: row.x === null || row.y === null ? null : { x: row.x, y: row.y },
    stamps: row.changed_at ?? {},
  };
}

// The changes that count as working on a node: making, ticking, renaming or moving it (and a level-up,
// read separately). Moving it on the canvas, recolouring, a priority, shelving or hiding it doesn't,
// so an undone slip leaves a quiet quest quiet. Deleting a step or changing a link leaves no date.
const ACTIVITY_FIELDS = ["title", "parent_id", "completed_at"];

function lastActive(row: NodeRow) {
  const moments = [row.created_at, row.completed_at, row.last_logged_at, ...ACTIVITY_FIELDS.map((field) => row.changed_at?.[field])];
  return new Date(Math.max(...moments.flatMap((moment) => (moment ? [Date.parse(moment)] : [])))).toISOString();
}

// A zero weight trains nothing, so only positive weights are stored
function positiveWeights(weights: StatWeights): StatWeights {
  return Object.fromEntries(Object.entries(weights).filter(([, weight]) => weight > 0));
}

export function toEdge(row: { from_id: string; to_id: string }): GraphEdge {
  return { from: row.from_id, to: row.to_id };
}

export function toRoutine(row: RoutineRow): Routine {
  return { id: row.id, title: row.title, cue: row.cue, weekdays: row.weekdays, time: toClock(row.time), alarm: row.alarm };
}

export function toDeadline(row: DeadlineRow): Deadline {
  return { id: row.id, title: row.title, dueDate: row.due_date, alarmTime: toClock(row.alarm_time), nodeId: row.node_id };
}

export function toAlarm(row: AlarmRow): Alarm {
  return { id: row.id, label: row.label, kind: row.kind, at: row.at, time: toClock(row.time), weekdays: row.weekdays, enabled: row.enabled };
}

// Postgres gives times as HH:MM:SS
function toClock(time: string | null) {
  return time ? time.slice(0, 5) : null;
}

// A stamp for each field being set (those left undefined are not sent)
function stamps(fields: Record<string, unknown>, at: string) {
  return Object.fromEntries(Object.keys(fields).filter((key) => fields[key] !== undefined).map((key) => [key, at]));
}

// A failed request, with the Postgres or PostgREST error code and the HTTP status, so the offline
// queue can tell a change that can never succeed from one worth sending again
export class ServerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Result = { error: PostgrestError | null; status?: number };

function fail(result: Result): never {
  throw new ServerError(result.error!.message, result.error!.code ?? "", result.status ?? 0);
}

// An insert referring to a row deleted elsewhere fails its foreign key; say so in words
function deletedIfMissing(result: Result, what: string) {
  if (result.error?.code === "23503") throw new Error(`${what} was deleted on another device.`);
  if (result.error) fail(result);
}

// Unwraps a Supabase result, turning its error into a thrown one
function must<T>(result: Result & { data: T }): NonNullable<T> {
  if (result.error) fail(result);
  return result.data as NonNullable<T>;
}

function countOf(result: Result & { count: number | null }) {
  if (result.error) fail(result);
  return result.count ?? 0;
}

// Merges a change into the data on screen. Whatever the change leaves as it was keeps its
// identity, down to the rows, and a change that alters nothing (the echo of our own) returns the
// snapshot itself, so nothing on screen renders again.
export function applyDelta(snapshot: Snapshot, delta: Delta): Snapshot {
  const removedNodes = new Set(delta.removedNodeIds);
  const removedEdges = new Set(delta.removedEdges?.map(edgeKey));
  snapshot.edges.forEach((edge) => (removedNodes.has(edge.from) || removedNodes.has(edge.to)) && removedEdges.add(edgeKey(edge)));
  const check = delta.routineCheck;
  const wasChecked = check && snapshot.routineChecks.some((c) => c.routineId === check.routineId && c.date === check.date);

  const next: Snapshot = {
    nodes: merge(snapshot.nodes, (node) => node.id, delta.nodes?.map((node) => latestFields(snapshot.nodes.find(({ id }) => id === node.id), node)), removedNodes),
    edges: merge(snapshot.edges, edgeKey, delta.edges, removedEdges),
    routines: merge(snapshot.routines, (routine) => routine.id, delta.routines, new Set(delta.removedRoutineIds)),
    routineChecks:
      check && check.checked !== wasChecked
        ? [
            ...snapshot.routineChecks.filter((c) => c.routineId !== check.routineId || c.date !== check.date),
            ...(check.checked ? [{ routineId: check.routineId, date: check.date }] : []),
          ]
        : snapshot.routineChecks,
    deadlines: merge(snapshot.deadlines, (deadline) => deadline.id, delta.deadlines, new Set(delta.removedDeadlineIds)),
    alarms: merge(snapshot.alarms, (alarm) => alarm.id, delta.alarms, new Set(delta.removedAlarmIds)),
    progressToday: delta.progressToday && !same(delta.progressToday, snapshot.progressToday) ? delta.progressToday : snapshot.progressToday,
    kitchen: delta.kitchen && !same(delta.kitchen, snapshot.kitchen) ? delta.kitchen : snapshot.kitchen,
    settings: delta.settings && !same(delta.settings, snapshot.settings) ? delta.settings : snapshot.settings,
    inboxId: snapshot.inboxId,
  };

  return (Object.keys(next) as (keyof Snapshot)[]).every((key) => next[key] === snapshot[key]) ? snapshot : next;
}

// The columns behind each of a node's fields that the server stamps
const STAMPED_FIELDS = [
  ["title", ["title"]],
  ["statWeights", ["stat_weights"]],
  ["color", ["color"]],
  ["active", ["active"]],
  ["completedAt", ["completed_at"]],
  ["shelved", ["shelved"]],
  ["priority", ["priority"]],
  ["parentId", ["parent_id"]],
  ["position", ["x", "y"]],
] as const;

// A node as it arrived, except for fields where what is shown was changed later on the server: changes
// don't always arrive in the order they were made, and the older one must not overwrite the newer.
// Equal stamps are the same write, so what arrived stands. Activity only moves forward.
function latestFields(shown: GraphNode | undefined, arrived: GraphNode): GraphNode {
  if (!shown) return arrived;
  const later = { ...arrived, lastActive: shown.lastActive > arrived.lastActive ? shown.lastActive : arrived.lastActive };
  for (const [field, columns] of STAMPED_FIELDS) {
    if (!columns.some((column) => isOlder(arrived.stamps[column], shown.stamps[column]))) continue;
    Object.assign(later, { [field]: shown[field], stamps: { ...later.stamps, ...Object.fromEntries(columns.map((column) => [column, shown.stamps[column]])) } });
  }
  const logged = arrived.ownXp - (arrived.completedAt ? PROGRESS_UNIT : 0);
  return { ...later, ownXp: logged + (later.completedAt ? PROGRESS_UNIT : 0) };
}

function isOlder(stamp: string | undefined, than: string | undefined) {
  return than !== undefined && (stamp === undefined || Date.parse(stamp) < Date.parse(than));
}

function edgeKey(edge: { from: string; to: string }) {
  return `${edge.from}->${edge.to}`;
}

// Rows are built by the to* readers (or spread from one), so equal rows list their keys in the
// same order and compare equal as JSON
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Upserts keep their place if present and append if new; removals drop by key. An upsert equal to
// the row it replaces keeps the row, and a merge that changes nothing returns `rows` itself.
function merge<T>(rows: T[], keyOf: (row: T) => string, upserts: T[] = [], removed = new Set<string>()): T[] {
  if (upserts.length === 0 && removed.size === 0) return rows;

  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  let changed = false;
  removed.forEach((key) => (changed = byKey.delete(key) || changed));
  upserts.forEach((row) => {
    const key = keyOf(row);
    const before = byKey.get(key);
    if (before !== undefined && same(before, row)) return;
    byKey.set(key, row);
    changed = true;
  });

  return changed ? [...byKey.values()] : rows;
}
