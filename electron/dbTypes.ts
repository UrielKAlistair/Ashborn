import type { ResourceKey, Task, TaskEffect, TaskInstance } from "../src/shared/types.js";

export type TaskRow = {
  id: string;
  questline_id: string;
  title: string;
  note: string | null;
  kind: Task["kind"];
  recurrence_frequency: "weekly" | "monthly" | null;
  recurrence_weekdays: string | null;
  recurrence_month_days: string | null;
  scheduled_for: string | null;
  keep_until_complete: number | null;
};

export type TaskEffectRow = {
  task_id: string;
  kind: TaskEffect["kind"];
  target: string;
  amount: number;
  position: number;
};

export type TaskInstanceRow = {
  id: string;
  task_id: string;
  date: string;
  status: TaskInstance["status"];
  completed_at: string | null;
};

export type CategoryRow = {
  id: string;
  title: string;
};

export type CategoryQuestlineRow = {
  category_id: string;
  questline_id: string;
  position: number;
};

export type CharacterAttributeRow = {
  attribute_key: string;
  xp: number;
};

export type CharacterResourceRow = {
  resource_key: ResourceKey;
  current: number;
  max: number;
};

export type LedgerRow = {
  kind: TaskEffect["kind"];
  target: string;
  amount: number;
};

export type DashboardWidgetRow = {
  board_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
};
