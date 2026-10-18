import Database from "better-sqlite3";
import type { BoardWidgetData, Weekday } from "../../src/shared/types.js";
import type { CategoryQuestlineRow, CategoryRow, TaskInstanceRow, TaskRow } from "../dbTypes.js";
import { getDateForDay, getTodayDate, getWeekdayFromDate, week } from "./dates.js";
import { parseJsonArray } from "./readers.js";

export function readHomeBoards(db: Database.Database): BoardWidgetData[] {
  const todayDate = getTodayDate();
  const weekStart = getDateForDay("Mon", todayDate);
  const weekEnd = getDateForDay("Sun", todayDate);
  const todayWeekday = getWeekdayFromDate(todayDate);
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
  const questlines = db
    .prepare("SELECT id, title FROM questlines ORDER BY title")
    .all() as Array<{ id: string; title: string }>;
  const taskRows = db.prepare(`
    SELECT id, questline_id, title, kind, recurrence_frequency, recurrence_weekdays, recurrence_month_days, scheduled_for, keep_until_complete
    FROM tasks
    ORDER BY id
  `).all() as Array<Pick<TaskRow, "id" | "questline_id" | "title" | "kind" | "recurrence_frequency" | "recurrence_weekdays" | "recurrence_month_days" | "scheduled_for" | "keep_until_complete">>;
  const instanceRows = db.prepare(`
    SELECT ti.id, ti.task_id, ti.date, ti.status, ti.completed_at
    FROM task_instances ti
    JOIN tasks t ON t.id = ti.task_id
    WHERE
      ti.date BETWEEN @weekStart AND @weekEnd
      OR (
        t.kind = 'one_off'
        AND ti.status = 'open'
        AND (
          (COALESCE(t.keep_until_complete, 1) = 1 AND ti.date <= @todayDate)
          OR
          (COALESCE(t.keep_until_complete, 1) = 0 AND ti.date = @todayDate)
        )
      )
      OR (t.kind = 'recurring' AND ti.date = @todayDate)
    ORDER BY ti.date, ti.id
  `).all({ weekStart, weekEnd, todayDate }) as TaskInstanceRow[];

  const questlineMap = new Map(questlines.map((questline) => [questline.id, questline]));
  const joinsByCategory = new Map<string, CategoryQuestlineRow[]>();
  const tasksByQuestline = new Map<string, typeof taskRows>();

  joins.forEach((join) => {
    const currentJoins = joinsByCategory.get(join.category_id) ?? [];

    currentJoins.push(join);
    joinsByCategory.set(join.category_id, currentJoins);
  });

  taskRows.forEach((task) => {
    const currentTasks = tasksByQuestline.get(task.questline_id) ?? [];
    currentTasks.push(task);
    tasksByQuestline.set(task.questline_id, currentTasks);
  });

  const instancesByTask = new Map<string, TaskInstanceRow[]>();

  instanceRows.forEach((instance) => {
    const currentInstances = instancesByTask.get(instance.task_id) ?? [];
    currentInstances.push(instance);
    instancesByTask.set(instance.task_id, currentInstances);
  });

  return categories.map((category) => ({
    id: category.id,
    title: category.title,
    quests: (joinsByCategory.get(category.id) ?? [])
      .map((join) => questlineMap.get(join.questline_id))
      .filter((questline): questline is NonNullable<typeof questline> => Boolean(questline))
      .map((questline) => {
        const questlineTasks = tasksByQuestline.get(questline.id) ?? [];
        const activeDays = week.filter((day) =>
          questlineTasks.some((task) => {
            const taskInstances = instancesByTask.get(task.id) ?? [];
            const instanceDate = getDateForDay(day, todayDate);

            return taskInstances.some(
              (instance) => instance.date === instanceDate && instance.status === "done",
            );
          }),
        );
        const todayTasks = questlineTasks.flatMap((task) => {
          const taskInstances = instancesByTask.get(task.id) ?? [];

          if (task.kind === "recurring") {
            const matchesToday =
              task.recurrence_frequency === "weekly"
                ? parseJsonArray<Weekday>(task.recurrence_weekdays)?.includes(todayWeekday) ?? false
                : false;

            if (!matchesToday) {
              return [];
            }

            const instance = taskInstances.find(
              (currentInstance) =>
                currentInstance.date === todayDate && currentInstance.status === "open",
            );

            return instance
              ? [{ id: task.id, instanceId: instance.id, title: task.title }]
              : [];
          }

          const instance = taskInstances[0];
          const keepUntilComplete = task.keep_until_complete === null
            ? true
            : Boolean(task.keep_until_complete);

          if (!instance || instance.status !== "open") {
            return [];
          }

          if (keepUntilComplete ? instance.date > todayDate : instance.date !== todayDate) {
            return [];
          }

          return [{ id: task.id, instanceId: instance.id, title: task.title }];
        });

        return {
          id: questline.id,
          title: questline.title,
          activeDays,
          todayTasks,
        };
      }),
  }));
}
