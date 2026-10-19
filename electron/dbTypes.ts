import type { StatKey } from "../src/shared/types.js";

export type GraphNodeRow = {
  id: string;
  parent_id: string | null;
  title: string;
  stat: StatKey | null;
  active: number;
  created_at: string;
  completed_at: string | null;
  own_xp: number; // computed in the select, not stored
};

export type GraphEdgeRow = {
  from_id: string;
  to_id: string;
};

export type RoutineRow = {
  id: string;
  title: string;
  cue: string;
  weekdays: string;
};

export type RoutineCheckRow = {
  routine_id: string;
  date: string;
};

export type DeadlineRow = {
  id: string;
  title: string;
  due_date: string;
  done_at: string | null;
};
