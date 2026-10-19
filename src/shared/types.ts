export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type ISODate = string; // YYYY-MM-DD, local time
export type StatKey = "STR" | "DEX" | "INT" | "WIS" | "CHR" | "MND";

// A node in the graph. Top-level nodes are threads; a node with a parent is a step inside it,
// and steps can hold steps of their own. Siblings form a DAG through prerequisite edges.
export type GraphNode = {
  id: string;
  parentId: string | null;
  title: string;
  stat: StatKey | null; // threads only: the stat all work in the thread trains
  active: boolean; // threads only: shown on the dashboard
  createdAt: string;
  completedAt: string | null; // a step is done when this is set
  ownXp: number; // level-ups plus the completion credit; derived by the database
};

// `from` is a prerequisite of `to`; both have the same parent
export type GraphEdge = {
  from: string;
  to: string;
};

// A recurring obligation with an optional if-then cue ("after dinner"), ticked per day
export type Routine = {
  id: string;
  title: string;
  cue: string;
  weekdays: Weekday[];
};

export type RoutineCheck = {
  routineId: string;
  date: ISODate;
};

// Done deadlines are never sent: the app only shows open ones
export type Deadline = {
  id: string;
  title: string;
  dueDate: ISODate;
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
  progressToday?: ProgressToday;
};

export type NodePatch = {
  title?: string;
  stat?: StatKey | null;
  active?: boolean;
  done?: boolean;
};

// Everything the renderer can ask of the main process. Reads return data; changes return a Delta.
export type AshbornApi = {
  getSnapshot(): Snapshot;
  createNode(title: string, parentId: string | null): Delta;
  updateNode(id: string, patch: NodePatch): Delta;
  deleteNode(id: string): Delta;
  addEdge(edge: GraphEdge): Delta;
  removeEdge(edge: GraphEdge): Delta;
  levelUp(nodeId: string): Delta;
  createRoutine(routine: Omit<Routine, "id">): Delta;
  deleteRoutine(id: string): Delta;
  toggleRoutine(routineId: string, date: ISODate): Delta;
  createDeadline(deadline: Omit<Deadline, "id">): Delta;
  completeDeadline(id: string): Delta;
  deleteDeadline(id: string): Delta;
};
