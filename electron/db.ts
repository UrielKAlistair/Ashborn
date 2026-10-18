import type { BoardWidget, GameSnapshot, HomeSnapshot } from "../src/shared/types.js";
import { getDatabase } from "./db/database.js";
import { readHomeBoards } from "./db/homeSnapshot.js";
import {
  readCharacter,
  readDashboardWidgets,
  readInstances,
  readQuestCategories,
  readQuestlines,
  readTasks,
} from "./db/readers.js";
import { saveDashboardWidgetsInDb, toggleTaskInstanceInDb } from "./db/writes.js";

export function getGameSnapshot(): GameSnapshot {
  const db = getDatabase();

  return {
    questlines: readQuestlines(db),
    questCategories: readQuestCategories(db),
    tasks: readTasks(db),
    instances: readInstances(db),
    dashboardWidgets: readDashboardWidgets(db),
    character: readCharacter(db),
  };
}

export function getHomeSnapshot(): HomeSnapshot {
  const db = getDatabase();

  return {
    boards: readHomeBoards(db),
    dashboardWidgets: readDashboardWidgets(db),
    character: readCharacter(db),
  };
}

export function saveDashboardWidgets(widgets: BoardWidget[]): HomeSnapshot {
  const db = getDatabase();

  saveDashboardWidgetsInDb(db, widgets);

  return getHomeSnapshot();
}

export function toggleTaskInstance(instanceId: string): GameSnapshot {
  const db = getDatabase();

  toggleTaskInstanceInDb(db, instanceId);

  return getGameSnapshot();
}

export function toggleHomeTaskInstance(instanceId: string): HomeSnapshot {
  const db = getDatabase();

  toggleTaskInstanceInDb(db, instanceId);

  return getHomeSnapshot();
}
