export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type ISODate = string; // YYYY-MM-DD, local time
export type StatKey = "STR" | "DEX" | "INT" | "WIS" | "CHR" | "MND";
export type ClockTime = string; // HH:MM, local time
export const threadColors = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type ThreadColor = (typeof threadColors)[number];

// How an alarm stops: a plain one is dismissed; the others only after walking or sit-ups,
// counted by the phone's accelerometer
export type AlarmKind = "none" | "plain" | "walk" | "situps";

// A node in the graph. Top-level nodes are threads; a node with a parent is a step inside it,
// and steps can hold steps of their own. Siblings form a DAG through prerequisite edges.
export type GraphNode = {
  id: string;
  parentId: string | null;
  title: string;
  stat: StatKey | null; // threads only: the stat all work in the thread trains
  color: ThreadColor | null; // threads only: the colour the user gave it; null is white
  active: boolean; // threads only: shown on the dashboard
  createdAt: string;
  completedAt: string | null; // a step is done when this is set
  ownXp: number; // level-ups plus the completion credit
  position: Point | null; // where the user put it, relative to its box; null: laid out automatically
  size: Extent | null; // the size the user gave it; null: as small as its content allows
};

export type Point = { x: number; y: number };
export type Extent = { width: number; height: number };

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
  at: string | null; // ISO timestamp, for a one-off
  time: ClockTime | null; // for a recurring alarm
  weekdays: Weekday[]; // empty for a one-off
  enabled: boolean;
};

export type AlarmPatch = Partial<Omit<Alarm, "id">>;

// Done deadlines are never sent: the app only shows open ones
export type Deadline = {
  id: string;
  title: string;
  dueDate: ISODate;
  alarmTime: ClockTime | null; // an alarm on the due day (on the phone)
};

// Level-ups and completed steps on `date`
export type ProgressToday = { date: ISODate; count: number };

// What the app loads once at start
export type Snapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  routines: Routine[];
  routineChecks: RoutineCheck[]; // today's
  deadlines: Deadline[];
  alarms: Alarm[]; // recurring ones, and one-offs still to ring
  progressToday: ProgressToday;
};

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
  progressToday?: ProgressToday;
};

export type NodePatch = {
  title?: string;
  stat?: StatKey | null;
  color?: ThreadColor | null;
  active?: boolean;
  done?: boolean;
};

// Where the user put a node on the desktop canvas, and (when they resized it) its size
export type Placement = { id: string; position: Point; size?: Extent };

// Everything the app (and later an agent) can ask of the data store. Reads return data; changes
// return a Delta.
export type AshbornApi = {
  getSnapshot(): Promise<Snapshot>;
  createNode(title: string, parentId: string | null, id?: string): Promise<Delta>; // id: made offline
  updateNode(id: string, patch: NodePatch): Promise<Delta>;
  deleteNode(id: string): Promise<Delta>;
  moveNode(id: string, parentId: string | null): Promise<Delta>; // drops the node's links
  placeNodes(places: Placement[]): Promise<Delta>;
  resetLayout(ids: string[]): Promise<Delta>; // back to automatic placement and size
  addEdge(edge: GraphEdge): Promise<Delta>;
  removeEdge(edge: GraphEdge): Promise<Delta>;
  levelUp(nodeId: string): Promise<Delta>;
  createRoutine(routine: Omit<Routine, "id">): Promise<Delta>;
  deleteRoutine(id: string): Promise<Delta>;
  toggleRoutine(routineId: string, date: ISODate): Promise<Delta>;
  createDeadline(deadline: Omit<Deadline, "id">): Promise<Delta>;
  completeDeadline(id: string): Promise<Delta>;
  deleteDeadline(id: string): Promise<Delta>;
  createAlarm(alarm: Alarm): Promise<Delta>; // the id is made by the caller, so it works offline
  updateAlarm(id: string, patch: AlarmPatch): Promise<Delta>;
  deleteAlarm(id: string): Promise<Delta>;
};
