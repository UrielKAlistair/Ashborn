import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AttributeKey } from "../../src/shared/types.js";

let database: Database.Database | null = null;

const attributeKeys: AttributeKey[] = [
  "STR",
  "DEX",
  "INT",
  "WIS",
  "CHR",
  "MND",
];

export function getDatabase() {
  if (database) {
    return database;
  }

  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });

  database = new Database(path.join(userDataPath, "ashborn.sqlite"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");

  initializeSchema(database);
  ensureDefaultCharacterAttributes(database);

  return database;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questlines (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quest_categories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quest_category_questlines (
      category_id TEXT NOT NULL,
      questline_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (category_id, questline_id),
      FOREIGN KEY (category_id) REFERENCES quest_categories(id) ON DELETE CASCADE,
      FOREIGN KEY (questline_id) REFERENCES questlines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      questline_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT,
      kind TEXT NOT NULL,
      recurrence_frequency TEXT,
      recurrence_weekdays TEXT,
      recurrence_month_days TEXT,
      scheduled_for TEXT,
      keep_until_complete INTEGER,
      FOREIGN KEY (questline_id) REFERENCES questlines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      amount INTEGER NOT NULL,
      position INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_instances (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS character_attributes (
      attribute_key TEXT PRIMARY KEY,
      xp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character_resources (
      resource_key TEXT PRIMARY KEY,
      current INTEGER NOT NULL,
      max INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS effect_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_instance_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      amount INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      FOREIGN KEY (task_instance_id) REFERENCES task_instances(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dashboard_widgets (
      board_id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      w INTEGER NOT NULL,
      h INTEGER NOT NULL,
      position INTEGER NOT NULL
    );
  `);
}

function ensureDefaultCharacterAttributes(db: Database.Database) {
  const attributeCount = db
    .prepare("SELECT COUNT(*) AS count FROM character_attributes")
    .get() as { count: number };

  if (attributeCount.count > 0) {
    return;
  }

  const insertAttribute = db.prepare(`
    INSERT INTO character_attributes (attribute_key, xp)
    VALUES (?, 0)
  `);

  db.transaction(() => {
    attributeKeys.forEach((attributeKey) => {
      insertAttribute.run(attributeKey);
    });
  })();
}
