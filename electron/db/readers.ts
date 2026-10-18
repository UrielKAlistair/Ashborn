import Database from "better-sqlite3";
import type {
  BoardWidget,
  CharacterSnapshot,
  QuestCategory,
  Questline,
  Task,
  TaskEffect,
  TaskInstance,
  Weekday,
} from "../../src/shared/types.js";
import type {
  CategoryQuestlineRow,
  CategoryRow,
  CharacterAttributeRow,
  CharacterResourceRow,
  DashboardWidgetRow,
  TaskEffectRow,
  TaskInstanceRow,
  TaskRow,
} from "../dbTypes.js";

function parseJsonArray<T>(value: string | null): T[] | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as T[];
}

export function readQuestlines(db: Database.Database): Questline[] {
  return db
    .prepare("SELECT id, title, summary FROM questlines ORDER BY title")
    .all() as Questline[];
}

export function readQuestCategories(db: Database.Database): QuestCategory[] {
  const categories = db
    .prepare("SELECT id, title FROM quest_categories ORDER BY position")
    .all() as CategoryRow[];
  const joins = db
    .prepare(`
      SELECT category_id, questline_id, position
      FROM quest_category_questlines
      ORDER BY category_id, position
    `)
    .all() as CategoryQuestlineRow[];
  const questlineIdsByCategory = new Map<string, string[]>();

  joins.forEach((join) => {
    const currentQuestlineIds = questlineIdsByCategory.get(join.category_id) ?? [];

    currentQuestlineIds.push(join.questline_id);
    questlineIdsByCategory.set(join.category_id, currentQuestlineIds);
  });

  return categories.map((category) => ({
    id: category.id,
    title: category.title,
    questlineIds: questlineIdsByCategory.get(category.id) ?? [],
  }));
}

export function readTasks(db: Database.Database): Task[] {
  const taskRows = db.prepare("SELECT * FROM tasks ORDER BY id").all() as TaskRow[];
  const effectRows = db
    .prepare(`
      SELECT task_id, kind, target, amount, position
      FROM task_effects
      ORDER BY task_id, position
    `)
    .all() as TaskEffectRow[];
  const effectsByTaskId = new Map<string, TaskEffectRow[]>();

  effectRows.forEach((effect) => {
    const currentEffects = effectsByTaskId.get(effect.task_id) ?? [];

    currentEffects.push(effect);
    effectsByTaskId.set(effect.task_id, currentEffects);
  });

  return taskRows.map((row) => {
    const effects = (effectsByTaskId.get(row.id) ?? [])
      .map<TaskEffect>((effect) =>
        effect.kind === "attribute_xp"
          ? {
              kind: "attribute_xp",
              target: effect.target as Extract<TaskEffect, { kind: "attribute_xp" }>["target"],
              amount: effect.amount,
            }
          : {
              kind: "resource",
              target: effect.target as Extract<TaskEffect, { kind: "resource" }>["target"],
              amount: effect.amount,
            },
      );

    return {
      id: row.id,
      questlineId: row.questline_id,
      title: row.title,
      note: row.note ?? undefined,
      kind: row.kind,
      recurrence: row.recurrence_frequency
        ? {
            frequency: row.recurrence_frequency,
            weekdays: parseJsonArray<Weekday>(row.recurrence_weekdays),
            monthDays: parseJsonArray<number>(row.recurrence_month_days),
          }
        : null,
      scheduledFor: row.scheduled_for ?? undefined,
      keepUntilComplete:
        row.keep_until_complete === null ? undefined : Boolean(row.keep_until_complete),
      effects,
    };
  });
}

export function readInstances(db: Database.Database): TaskInstance[] {
  return (db
    .prepare("SELECT id, task_id, date, status, completed_at FROM task_instances ORDER BY date, id")
    .all() as TaskInstanceRow[]).map((instance) => ({
    id: instance.id,
    taskId: instance.task_id,
    date: instance.date,
    status: instance.status,
    completedAt: instance.completed_at ?? undefined,
  }));
}

export function readDashboardWidgets(db: Database.Database): BoardWidget[] {
  return (db
    .prepare(`
      SELECT board_id, x, y, w, h
      FROM dashboard_widgets
      ORDER BY position
    `)
    .all() as DashboardWidgetRow[]).map((widget) => ({
    boardId: widget.board_id,
    x: widget.x,
    y: widget.y,
    w: widget.w,
    h: widget.h,
  }));
}

export function readCharacter(db: Database.Database): CharacterSnapshot {
  const attributes = (db
    .prepare("SELECT attribute_key, xp FROM character_attributes ORDER BY rowid")
    .all() as CharacterAttributeRow[]).map((attribute) => ({
    key: attribute.attribute_key as CharacterSnapshot["attributes"][number]["key"],
    xp: attribute.xp,
  }));

  const resources = (db
    .prepare("SELECT resource_key, current, max FROM character_resources ORDER BY rowid")
    .all() as CharacterResourceRow[]).map((resource) => ({
    key: resource.resource_key,
    current: resource.current,
    max: resource.max,
  }));

  return { attributes, resources };
}

export { parseJsonArray };
