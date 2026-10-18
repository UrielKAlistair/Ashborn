import { getDateForDay, getTodayDate, getWeekdayFromDate, week } from "./questCalendar.js";
import type {
  QuestWeekProgress,
  Task,
  TaskInstance,
  TodayTask,
} from "../../shared/types";

type TaskInstancesById = Record<string, TaskInstance[]>;

export type TaskInstanceState = {
  byId: Record<string, TaskInstance>;
  byTaskId: TaskInstancesById;
};

export function buildInstanceState(instances: TaskInstance[]) {
  const state = instances.reduce<TaskInstanceState>(
    (state, instance) => {
      state.byId[instance.id] = instance;

      if (!state.byTaskId[instance.taskId]) {
        state.byTaskId[instance.taskId] = [];
      }

      state.byTaskId[instance.taskId].push(instance);

      return state;
    },
    { byId: {}, byTaskId: {} },
  );

  Object.values(state.byTaskId).forEach((taskInstances) => {
    taskInstances.sort((left, right) => left.date.localeCompare(right.date));
  });

  return state;
}

function matchesToday(task: Task) {
  if (!task.recurrence) {
    return false;
  }

  const todayWeekday = getWeekdayFromDate(getTodayDate());

  if (task.recurrence.frequency === "weekly") {
    return task.recurrence.weekdays?.includes(todayWeekday) ?? false;
  }

  if (task.recurrence.frequency === "monthly") {
    return false;
  }

  return false;
}
export function getQuestTasks(tasks: Task[], questlineId: string) {
  return tasks.filter((task) => task.questlineId === questlineId);
}

export function getRecurringTasks(tasks: Task[], questlineId: string) {
  return getQuestTasks(tasks, questlineId).filter((task) => task.kind === "recurring");
}

export function getOneOffTasks(tasks: Task[], questlineId: string) {
  return getQuestTasks(tasks, questlineId).filter((task) => task.kind === "one_off");
}

export function getTaskInstances(taskId: string, instanceState: TaskInstanceState): TaskInstance[] {
  return instanceState.byTaskId[taskId] ?? [];
}

export function getSingleTaskInstance(
  taskId: string,
  instanceState: TaskInstanceState,
): TaskInstance | null {
  return getTaskInstances(taskId, instanceState)[0] ?? null;
}

export function countCompletedOneOffTasks(
  tasks: Task[],
  questlineId: string,
  instanceState: TaskInstanceState,
) {
  return getOneOffTasks(tasks, questlineId).filter((task) => {
    const instance = getSingleTaskInstance(task.id, instanceState);

    return instance ? instance.status === "done" : false;
  }).length;
}

function isOneOffTaskVisibleToday(
  task: Task,
  instance: TaskInstance,
) {
  const keepUntilComplete = task.keepUntilComplete ?? true;
  const todayDate = getTodayDate();

  if (keepUntilComplete) {
    return instance.date <= todayDate && instance.status === "open";
  }

  return instance.date === todayDate && instance.status === "open";
}

export function getQuestWeekProgress(
  tasks: Task[],
  questlineId: string,
  instanceState: TaskInstanceState,
): QuestWeekProgress {
  const questTasks = getQuestTasks(tasks, questlineId);
  const todayDate = getTodayDate();

  const activeDays = week.filter((day) =>
    questTasks.some((task) => {
      const instance = getTaskInstances(task.id, instanceState).find(
        (currentInstance) => currentInstance.date === getDateForDay(day, todayDate),
      );
      return instance ? instance.status === "done" : false;
    }),
  );

  return {
    activeDays,
    done: activeDays.length,
    total: week.length,
    percent: Math.round((activeDays.length / week.length) * 100),
  };
}

export function getTodayTasks(
  tasks: Task[],
  questlineId: string,
  instanceState: TaskInstanceState,
): TodayTask[] {
  const todayDate = getTodayDate();
  const recurringTasks = getRecurringTasks(tasks, questlineId)
    .filter(matchesToday)
    .flatMap<TodayTask>((task) => {
      const instance = getTaskInstances(task.id, instanceState).find(
        (currentInstance) => currentInstance.date === todayDate,
      );

      return instance
        ? [
            {
              ...task,
              instanceId: instance.id,
              date: instance.date,
              status: instance.status,
              completedAt: instance.completedAt ?? null,
            },
          ]
        : [];
    });

  const oneOffTasks = getOneOffTasks(tasks, questlineId)
    .flatMap<TodayTask>((task) => {
      const instance = getSingleTaskInstance(task.id, instanceState);

      if (!instance || !isOneOffTaskVisibleToday(task, instance)) {
        return [];
      }

      return [
        {
          ...task,
          instanceId: instance.id,
          date: instance.date,
          status: instance.status,
          completedAt: instance.completedAt ?? null,
        },
      ];
    });

  return [...recurringTasks, ...oneOffTasks];
}

export function getRecurringScheduleLabel(task: Task) {
  if (!task.recurrence) {
    return "No schedule";
  }

  if (task.recurrence.frequency === "weekly") {
    return task.recurrence.weekdays?.join(" / ") ?? "Weekly";
  }

  return task.recurrence.monthDays?.map((day) => `${day}`).join(" / ") ?? "Monthly";
}
