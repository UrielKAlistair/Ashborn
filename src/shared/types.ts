/**
 * The data, as every part of Ashborn sees it: the app on desktop and phone, and the agent server.
 * Quests and steps (GraphNode, GraphEdge), routines, deadlines, alarms and the Kitchen, gathered in a
 * Snapshot loaded once at start. A change returns a Delta of only the rows it touched, which the
 * caller merges into its Snapshot. AshbornApi, at the end, is every change there is.
 */
export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type ISODate = string; // YYYY-MM-DD, in the user's time zone
export type StatKey = "STR" | "DEX" | "INT" | "WIS" | "CHR" | "MND";
// Absolute multipliers, not shares: each XP earned in the quest adds weight × XP to the stat (design 7)
export type StatWeights = Partial<Record<StatKey, number>>;
export type ClockTime = string; // HH:MM, local time

// How an alarm stops: a plain one is dismissed; the others only after walking or sit-ups,
// counted by the phone's accelerometer
export type AlarmKind = "none" | "plain" | "walk" | "situps";
// What a ring plays: the phone's alarm sound, or the app's own tune for an agent calling the user
export type AlarmSound = "default" | "call";

// A node in the graph. Top-level nodes are quests; a node with a parent is a step inside it,
// and steps can hold steps of their own. Siblings form a DAG through prerequisite edges.
export type GraphNode = {
  id: string;
  parentId: string | null;
  title: string;
  statWeights: StatWeights; // quests only: the stats work in the quest trains; empty trains none
  createdAt: string;
  completedAt: string | null; // a step is done when this is set
  shelved: boolean; // set aside: off the graph and the to-do, with all inside it, until unshelved
  priority: Priority | null; // null: none
  ownXp: number; // level-ups plus the completion credit
  lastActive: string; // when it was last made, ticked, levelled up or otherwise worked on; layout and looks don't count
  position: Point | null; // where the user put it, relative to its box; null: laid out automatically
  stamps: Record<string, string>; // column name → when the server last changed it
};

export type Point = { x: number; y: number };
export type Priority = 1 | 2 | 3 | 4; // 1 is the most urgent
export const priorities: Priority[] = [1, 2, 3, 4];

// `from` is a prerequisite of `to`; both have the same parent
export type GraphEdge = {
  from: string;
  to: string;
};

// A recurring obligation with an optional if-then cue ("after dinner"), ticked per day. With a
// time it can ring an alarm then (on the phone).
export type Routine = {
  id: string;
  title: string;
  cue: string;
  weekdays: Weekday[];
  time: ClockTime | null;
  alarm: AlarmKind; // "none" unless time is set
};

export type RoutineCheck = {
  routineId: string;
  date: ISODate;
};

// An alarm of its own: a one-off at `at`, or recurring at `time` on `weekdays`. Rings on the phone.
export type Alarm = {
  id: string;
  label: string;
  kind: Exclude<AlarmKind, "none">;
  sound: AlarmSound;
  at: string | null; // ISO timestamp, for a one-off
  time: ClockTime | null; // for a recurring alarm
  weekdays: Weekday[]; // empty for a one-off
  enabled: boolean;
};

export type AlarmPatch = Partial<Omit<Alarm, "id">>;
export type RoutinePatch = Partial<Omit<Routine, "id">>;

// One ring skipped: the schedule's key for it (see AlarmInstance) and the day it rings on
export type AlarmSkip = { key: string; date: ISODate };

// Done deadlines are never sent: the app only shows open ones
export type Deadline = {
  id: string;
  title: string;
  dueDate: ISODate;
  alarmTime: ClockTime | null; // an alarm on the due day (on the phone)
  nodeId: string | null; // the quest or step it is for, picked in Today; it never changes a priority
};
export type DeadlinePatch = Partial<Omit<Deadline, "id">>;

// The Kitchen. Amounts are in the base unit of their kind (g, ml, count); a unit says how an
// amount is shown or was written.
export const stockUnits = ["g", "kg", "ml", "l", "count"] as const;
export type StockUnit = (typeof stockUnits)[number];
export type UnitKind = "mass" | "volume" | "count";
// Each unit's kind, and how many base units one of it is
export const units: Record<StockUnit, { kind: UnitKind; base: number }> = {
  g: { kind: "mass", base: 1 },
  kg: { kind: "mass", base: 1000 },
  ml: { kind: "volume", base: 1 },
  l: { kind: "volume", base: 1000 },
  count: { kind: "count", base: 1 },
};

export const mealSlots = ["breakfast", "lunch", "dinner"] as const;
export type MealSlot = (typeof mealSlots)[number];
// When each meal is eaten; reminders are timed from these
export const mealTimes: Record<MealSlot, ClockTime> = { breakfast: "08:00", lunch: "13:00", dinner: "20:00" };
// The dates the app holds meals for: from this many days back to this many ahead of today
export const mealDaysBack = 2;
export const mealDaysAhead = 6;

export type StockItem = {
  id: string;
  name: string;
  unit: StockUnit; // how it is shown
  target: number; // base units
  onHand: number; // base units: the latest reading plus the meals cooked after it
  readAt: string | null; // when the latest reading was made; null if never counted
};

// One change to a stock item, in base units. The snapshot holds only those of meals it holds.
export type StockChange = { id: string; itemId: string; mealId: string | null; amount: number; madeAt: string };

export type RecipeIngredient = {
  id: string;
  itemId: string | null; // null: the stock item was dropped, so nothing is deducted
  name: string;
  amount: number; // base units of the item's kind
  unit: StockUnit; // the unit it was written in
};

// An alarm the recipe sets for a meal using it: offsetMinutes from the meal's time, or from
// another reminder of the same recipe
export type RecipeReminder = { id: string; label: string; offsetMinutes: number; anchorId: string | null };

export type Recipe = {
  id: string;
  title: string;
  body: string; // free text for the reader, never parsed
  ingredients: RecipeIngredient[];
  reminders: RecipeReminder[];
};

export type MealStatus = "planned" | "cooked" | "cancelled";

// A meal stored for a date: planned, cooked or cancelled
export type Meal = {
  id: string;
  date: ISODate;
  slot: MealSlot;
  description: string;
  status: MealStatus;
  recipeIds: string[];
};

// What a weekday's slot shows when its date has no meal of its own
export type DefaultMeal = { weekday: Weekday; slot: MealSlot; description: string; recipeIds: string[] };

export type Kitchen = {
  items: StockItem[];
  recipes: Recipe[];
  defaultWeek: DefaultMeal[];
  meals: Meal[]; // dated from mealDaysBack ago to mealDaysAhead ahead
  mealChanges: StockChange[]; // the stock changes of those meals
};

// What the app loads once at start
export type Snapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routines: Routine[];
  routineChecks: RoutineCheck[]; // from yesterday on
  deadlines: Deadline[];
  alarms: Alarm[]; // recurring ones, and one-offs from a day back
  skippedAlarms: AlarmSkip[]; // rings skipped, from yesterday on
  kitchen: Kitchen;
  settings: Settings;
};

// dayStartHour 0–23; timeZone an IANA name, written by the user's devices, null until one has
export type Settings = { dayStartHour: number; timeZone: string | null };

// What a change returns: only the rows it touched. Upserts replace by id; removals drop by id.
// Edges touching a removed node are dropped along with it.
export type Delta = {
  nodes?: GraphNode[];
  removedNodeIds?: string[];
  edges?: GraphEdge[];
  removedEdges?: GraphEdge[];
  routines?: Routine[];
  removedRoutineIds?: string[];
  routineCheck?: RoutineCheck & { checked: boolean };
  deadlines?: Deadline[];
  removedDeadlineIds?: string[];
  alarms?: Alarm[];
  removedAlarmIds?: string[];
  alarmSkip?: AlarmSkip & { skipped: boolean };
  kitchen?: Kitchen; // replaces the whole Kitchen
  settings?: Settings;
};

export type NodePatch = {
  title?: string;
  statWeights?: StatWeights;
  shelved?: boolean;
  priority?: Priority | null;
  done?: boolean;
};

// Where the user put a node on the desktop canvas
export type Placement = { id: string; position: Point };

// Everything the app and the agent server can ask of the data store. Reads return data; changes
// return a Delta.
export type AshbornApi = {
  getSnapshot(): Promise<Snapshot>;
  createNode(title: string, parentId: string | null, id?: string): Promise<Delta>; // id: made offline
  updateNode(id: string, patch: NodePatch): Promise<Delta>;
  deleteNode(id: string): Promise<Delta>;
  moveNode(id: string, parentId: string | null): Promise<Delta>; // drops the node's links
  placeNodes(places: Placement[]): Promise<Delta>;
  resetLayout(ids: string[]): Promise<Delta>; // back to automatic placement
  addEdge(edge: GraphEdge): Promise<Delta>;
  removeEdge(edge: GraphEdge): Promise<Delta>;
  levelUp(nodeId: string, id: string): Promise<Delta>; // ids made by the caller, so a resend counts once
  createRoutine(routine: Routine): Promise<Delta>;
  updateRoutine(id: string, patch: RoutinePatch): Promise<Delta>; // keeps its ticks
  deleteRoutine(id: string): Promise<Delta>;
  setRoutineCheck(routineId: string, date: ISODate, checked: boolean): Promise<Delta>;
  createDeadline(deadline: Deadline): Promise<Delta>;
  updateDeadline(id: string, patch: DeadlinePatch): Promise<Delta>;
  completeDeadline(id: string): Promise<Delta>;
  deleteDeadline(id: string): Promise<Delta>;
  createAlarm(alarm: Alarm): Promise<Delta>; // the id is made by the caller, so it works offline
  updateAlarm(id: string, patch: AlarmPatch): Promise<Delta>;
  deleteAlarm(id: string): Promise<Delta>;
  setAlarmSkip(key: string, date: ISODate, skipped: boolean): Promise<Delta>;
  updateSettings(patch: Partial<Settings>): Promise<Delta>;

  // The Kitchen. Cooking, uncooking and adjusting stock work offline; the rest needs a connection.
  createStockItem(item: Omit<StockItem, "onHand" | "readAt">): Promise<Delta>; // id made by the caller
  updateStockItem(id: string, patch: Partial<Omit<StockItem, "id" | "onHand">>): Promise<Delta>; // unit: same kind only
  deleteStockItem(id: string): Promise<Delta>; // its ingredients become untracked
  setStock(id: string, itemId: string, amount: number): Promise<Delta>; // a reading: the amount on hand, base units; id made by the caller
  saveRecipe(recipe: Recipe, isNew?: boolean): Promise<Delta>; // creates or replaces; refuses a unit of the wrong kind and reminder loops; isNew false: an edit, refused if the recipe was deleted meanwhile
  deleteRecipe(id: string): Promise<Delta>;
  setMeal(meal: Omit<Meal, "status"> & { status: "planned" | "cancelled" }): Promise<Delta>; // a cooked meal stays cooked
  cookMeal(date: ISODate, slot: MealSlot, id: string): Promise<Delta>; // id: used if the date has no meal yet
  uncookMeal(date: ISODate, slot: MealSlot): Promise<Delta>;
  setDefaultMeal(meal: DefaultMeal): Promise<Delta>;
};
