/**
 * The data store over Supabase: every read and change the app and the agent make (AshbornApi).
 *
 * createApi builds it. Each change returns a Delta of the rows it touched, read back after it (nodes
 * through the nodes_with_xp view, so a node comes with its XP; an update in the same request). Each
 * write of a field is stamped with when the change was made, so a later change wins whatever order
 * changes reach the server; links and deletes carry no stamp, having no field to compete over.
 * Changes to the same row are sent one after another (inRowOrder), so an earlier one can't land last.
 * Below it: the readers (the Kitchen, today's progress, settings), the row converters (to*), and
 * the error type the offline queue reads (ServerError). Merging a Delta into the data on screen is in
 * snapshotMerge.ts.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { addDays, today } from "../shared/dates";
import { openInside } from "../shared/graphModel";
import { recipeProblems, sameKind } from "../shared/kitchen";
import { PROGRESS_UNIT } from "../shared/progression";
import { RING_LOOKBACK_MS } from "../shared/schedule";
import {
  mealDaysAhead,
  mealDaysBack,
  type Alarm,
  type AlarmKind,
  type ScheduleEvent,
  type AshbornApi,
  type Deadline,
  type Delta,
  type GraphEdge,
  type GraphNode,
  type Kitchen,
  type MealSlot,
  type MealStatus,
  type Priority,
  type Routine,
  type StatWeights,
  type StockUnit,
  type Settings,
  type Weekday,
} from "../shared/types";

// Rows the server returns at most a request (Supabase's default cap)
const PAGE = 1000;
// Ids sent in one request's address (each about 37 characters), well under the server's limit on its length
const IDS_PER_REQUEST = 100;

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
  description?: string;
  stat_weights: StatWeights;
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
export type AlarmRow = { id: string; label: string; kind: Alarm["kind"]; sound: Alarm["sound"]; at: string | null; time: string | null; weekdays: Weekday[]; enabled: boolean; event_id: string | null };
export type EventRow = { id: string; title: string; details: string; at: string | null; time: string | null; weekdays: Weekday[]; minutes: number | null; rings: ScheduleEvent["rings"] };
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

  // An event's start alarm, as a list: none, or the one
  const eventAlarms = async (eventId: string) => (must(await db.from("alarms").select().eq("event_id", eventId)) as AlarmRow[]).map(toAlarm);

  const readNode = async (id: string) => toNode(must(await nodes().select().eq("id", id).single()));

  // Reopens the done boxes from `id` out to its quest, for a step opened or put inside them, in one
  // request (reopen_around); a quest has no boxes around it
  const reopenAround = async (id: string | null, at: string) =>
    id ? (must(await db.rpc("reopen_around", { start: id, at })) as NodeRow[]).map(toNode) : [];

  return inRowOrder(db, {
    async getSnapshot() {
      const day = today();
      const [nodeRows, edgeRows, routineRows, checkRows, deadlineRows, alarmRows, skipRows, eventRows, kitchen, settingsRow] = await Promise.all([
        // A second key for rows made at the same moment: without one, an update can move a row among them,
        // or a page boundary skip it
        allPages((from, to) => nodes().select().order("created_at").order("id").range(from, to)),
        allPages((from, to) => db.from("graph_edges").select("from_id, to_id").order("from_id").order("to_id").range(from, to)),
        db.from("routines").select().order("created_at"),
        // From yesterday, and one-offs from a day back: the phone's schedule reaches back that far
        db.from("routine_checks").select("routine_id, date").gte("date", addDays(day, -1)).eq("checked", true),
        db.from("deadlines").select().is("done_at", null).order("due_date"),
        db.from("alarms").select().or(`at.is.null,at.gt.${new Date(Date.now() - RING_LOOKBACK_MS).toISOString()}`).order("created_at"),
        // From yesterday, as the one-offs above
        db.from("alarm_skips").select("key, date").eq("skipped", true).gte("date", addDays(day, -1)),
        db.from("events").select().order("created_at"),
        readKitchen(db, day),
        readSettings(db),
      ]);

      return {
        nodes: nodeRows.map(toNode),
        edges: edgeRows.map(toEdge),
        routines: must(routineRows).map(toRoutine),
        routineChecks: must(checkRows).map((row) => ({ routineId: row.routine_id, date: row.date })),
        deadlines: must(deadlineRows).map(toDeadline),
        alarms: must(alarmRows).map(toAlarm),
        skippedAlarms: must(skipRows).map((row) => ({ key: row.key, date: row.date })),
        events: must(eventRows).map(toEvent),
        kitchen,
        settings: settingsRow,
      };
    },

    async createNode(title, parentId, id = crypto.randomUUID()) {
      const at = clock().toISOString();
      // Stamped when made, as on screen until now, so the order doesn't shift when the row comes back
      must(await db.from("graph_nodes").upsert({ id, title, parent_id: parentId, created_at: at }, { onConflict: "id", ignoreDuplicates: true }));
      // The reopen touches only the boxes above the new step, so the step is read meanwhile
      const [node, reopened] = await Promise.all([readNode(id), reopenAround(parentId, at)]);
      return { nodes: [node, ...reopened] };
    },

    async updateNode(id, { title, description, statWeights, done, shelved, priority }) {
      const at = clock().toISOString();
      const completed_at = done === undefined ? undefined : done ? at : null;
      const stat_weights = statWeights && positiveWeights(statWeights);
      const fields = { title, description, stat_weights, completed_at, shelved, priority };
      // A bare tick on a step already done changes nothing, so it keeps the day it was done on (a tick
      // replayed from another device's queue would otherwise move it, and its progress, to today)
      const bareTick = done === true && Object.values({ ...fields, completed_at: undefined }).every((value) => value === undefined);
      const update = nodes().update({ ...fields, changed_at: stamps(fields, at) }).eq("id", id);
      const row = must(await (bareTick ? update.is("completed_at", null) : update).select().maybeSingle());
      if (!row) {
        const unchanged = bareTick ? (must(await nodes().select().eq("id", id).maybeSingle()) as NodeRow | null) : null;
        if (unchanged) return { nodes: [toNode(unchanged)] };
        throw new Error("This step was deleted on another device.");
      }
      // A box ticked done means everything in it is done: everything in it when the tick was made, so a
      // tick sent from the offline queue leaves alone the steps added since on another device. A tick that
      // lost to a later change of the box (an untick on another device) ticks nothing inside.
      const won = done && row.completed_at !== null && Date.parse(row.completed_at) === Date.parse(at);
      const inside = won ? openInside((await allPages((from, to) => nodes().select("id, parent_id, completed_at").lte("created_at", at).order("id").range(from, to)) as NodeRow[]).map((tree) => ({ id: tree.id, parentId: tree.parent_id, completedAt: tree.completed_at })), id) : [];
      // In batches, as the ids travel in the request's address
      const ticked: NodeRow[] = [];
      for (let from = 0; from < inside.length; from += IDS_PER_REQUEST) {
        const batch = inside.slice(from, from + IDS_PER_REQUEST);
        ticked.push(...(must(await nodes().update({ completed_at: at, changed_at: stamps({ completed_at: at }, at) }).in("id", batch).is("completed_at", null).select()) as NodeRow[]));
      }

      // A step reopened inside done boxes reopens them: a box is done only while everything in it is
      const reopened = done === false && row.completed_at === null ? await reopenAround(row.parent_id, at) : [];

      return { nodes: [...[row as NodeRow, ...ticked].map(toNode), ...reopened] };
    },

    async deleteNode(id) {
      const removed = must(await db.rpc("delete_node", { target: id })) as string[];

      return { removedNodeIds: removed };
    },

    async moveNode(id, parentId) {
      const at = clock().toISOString();
      const removed = must(await db.rpc("move_node", { target: id, new_parent: parentId, at })) as Array<{ from_id: string; to_id: string }>;
      // A move that stood: its place in the old box means nothing in the new one, and an open step
      // put into done boxes reopens them
      const after = await readNode(id);
      const moved = after.parentId === parentId;
      const unplace = async () => void must(await nodes().update({ x: null, y: null, changed_at: stamps({ x: null, y: null }, at) }).eq("id", id));
      // The reopen touches only the boxes above the step, so it runs beside clearing the step's place.
      // A done step leaves done boxes done.
      const reopen = async () => (after.completedAt ? [] : reopenAround(parentId, at));
      const [, reopened] = moved ? await Promise.all([unplace(), reopen()]) : [undefined, []];

      return { nodes: [await readNode(id), ...reopened], removedEdges: removed.map(toEdge) };
    },

    async placeNodes(places) {
      const rows = places.map(({ id, position }) => ({ id, ...position }));
      const placed = must(await db.rpc("place_nodes", { places: rows, at: clock().toISOString() })) as string[];

      const read: NodeRow[] = [];
      for (let from = 0; from < placed.length; from += IDS_PER_REQUEST) {
        read.push(...(must(await nodes().select().in("id", placed.slice(from, from + IDS_PER_REQUEST))) as NodeRow[]));
      }
      return { nodes: read.map(toNode) };
    },

    async resetLayout(ids) {
      const fields = { x: null, y: null };
      const at = clock().toISOString();
      const rows: NodeRow[] = [];
      for (let from = 0; from < ids.length; from += IDS_PER_REQUEST) {
        rows.push(...(must(await nodes().update({ ...fields, changed_at: stamps(fields, at) }).in("id", ids.slice(from, from + IDS_PER_REQUEST)).select()) as NodeRow[]));
      }

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
      return { nodes: [await readNode(nodeId)] };
    },

    async createRoutine({ id, title, cue, weekdays, time, alarm }) {
      must(await db.from("routines").upsert({ id, title, cue, weekdays, time, alarm }, { onConflict: "id", ignoreDuplicates: true }));
      return { routines: [toRoutine(must(await db.from("routines").select().eq("id", id).single()))] };
    },

    async updateRoutine(id, patch) {
      const row = must(await db.from("routines").update({ ...patch, changed_at: stamps(patch, clock().toISOString()) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This routine was deleted on another device.");

      return { routines: [toRoutine(row as RoutineRow)] };
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
      // A replayed create can find the deadline already done on another device: the app holds open ones only
      const row = must(await db.from("deadlines").select().eq("id", id).single()) as DeadlineRow;
      return row.done_at ? { removedDeadlineIds: [id] } : { deadlines: [toDeadline(row)] };
    },

    async updateDeadline(id, { title, dueDate, alarmTime, nodeId }) {
      // A field left undefined is neither sent nor stamped
      const fields = { title, due_date: dueDate, alarm_time: alarmTime, node_id: nodeId };
      const row = must(await db.from("deadlines").update({ ...fields, changed_at: stamps(fields, clock().toISOString()) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This deadline was deleted on another device.");
      // Done on another device meanwhile: it leaves, as the open list holds no done deadline
      return (row as DeadlineRow).done_at ? { removedDeadlineIds: [id] } : { deadlines: [toDeadline(row as DeadlineRow)] };
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

    async createAlarm({ id, label, kind, sound, at, time, weekdays, enabled }) {
      const alarm = { id, label, kind, sound, at, time, weekdays, enabled };
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

    // The database makes, moves or removes the event's start alarm (sync_event_alarm); each returns it as left
    async createEvent({ id, title, details, at, time, weekdays, minutes, rings }) {
      must(await db.from("events").upsert({ id, title, details, at, time, weekdays, minutes, rings }, { onConflict: "id", ignoreDuplicates: true }));
      const row = must(await db.from("events").select().eq("id", id).single()) as EventRow;
      return { events: [toEvent(row)], alarms: await eventAlarms(id) };
    },

    async updateEvent(id, patch) {
      const before = await eventAlarms(id);
      const row = must(await db.from("events").update({ ...patch, changed_at: stamps(patch, clock().toISOString()) }).eq("id", id).select().maybeSingle());
      if (!row) throw new Error("This event was deleted on another device.");
      const alarms = await eventAlarms(id);
      const removedAlarmIds = before.filter((alarm) => !alarms.some((kept) => kept.id === alarm.id)).map((alarm) => alarm.id);

      return { events: [toEvent(row as EventRow)], alarms, removedAlarmIds };
    },

    async deleteEvent(id) {
      const removedAlarmIds = (await eventAlarms(id)).map((alarm) => alarm.id);
      must(await db.from("events").delete().eq("id", id));

      return { removedEventIds: [id], removedAlarmIds };
    },

    // Absolute and stamped, like a routine's tick: the later choice wins. Returns what the database kept.
    async setAlarmSkip(key, date, skipped) {
      const row = { key, date, skipped, changed_at: { skipped: clock().toISOString() } };
      const kept = must(await db.from("alarm_skips").upsert(row, { onConflict: "user_id,key" }).select("skipped").single()) as { skipped: boolean };

      return { alarmSkip: { key, date, skipped: kept.skipped } };
    },

    async updateSettings({ timeZone }) {
      const at = clock().toISOString();
      const fields = { time_zone: timeZone };
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
  updateRoutine: (id) => [`routine:${id}`],
  deleteRoutine: (id) => [`routine:${id}`],
  setRoutineCheck: (routineId, date) => [`routine:${routineId}@${date}`, `routine:${routineId}`],
  createDeadline: (deadline) => [`deadline:${deadline.id}`],
  updateDeadline: (id) => [`deadline:${id}`],
  completeDeadline: (id) => [`deadline:${id}`],
  deleteDeadline: (id) => [`deadline:${id}`],
  createAlarm: (alarm) => [`alarm:${alarm.id}`],
  updateAlarm: (id) => [`alarm:${id}`],
  deleteAlarm: (id) => [`alarm:${id}`],
  setAlarmSkip: (key) => [`skip:${key}`],
  createEvent: (event) => [`event:${event.id}`],
  updateEvent: (id) => [`event:${id}`],
  deleteEvent: (id) => [`event:${id}`],
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


// A user with no settings row has the defaults
export async function readSettings(db: SupabaseClient): Promise<Settings> {
  const row = must(await db.from("user_settings").select("time_zone").maybeSingle()) as { time_zone: string | null } | null;
  return { timeZone: row?.time_zone ?? null };
}

// A node's own XP: what level-ups logged on it, plus the completion credit once it is done
export function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description ?? "",
    statWeights: row.stat_weights,
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
// read separately). Moving it on the canvas, a priority or shelving it doesn't,
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
  return { id: row.id, label: row.label, kind: row.kind, sound: row.sound, at: row.at, time: toClock(row.time), weekdays: row.weekdays, enabled: row.enabled, eventId: row.event_id };
}

export function toEvent(row: EventRow): ScheduleEvent {
  return { id: row.id, title: row.title, details: row.details, at: row.at, time: toClock(row.time), weekdays: row.weekdays, minutes: row.minutes, rings: row.rings };
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

// Every row a read gives, a page at a time: the graph keeps its done steps, so it outgrows one request.
// `page` reads rows `from` to `to` inclusive, in an order with no ties.
async function allPages<T>(page: (from: number, to: number) => PromiseLike<Result & { data: T[] | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const data = must(await page(from, from + PAGE - 1));
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Unwraps a Supabase result, turning its error into a thrown one
function must<T>(result: Result & { data: T }): NonNullable<T> {
  if (result.error) fail(result);
  return result.data as NonNullable<T>;
}
