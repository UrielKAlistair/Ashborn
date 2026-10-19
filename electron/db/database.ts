import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let database: Database.Database | null = null;

// Opens userData/ashborn.sqlite and creates the tables on first use. Tables left over from
// the beta quest system (questlines, tasks, ...) are not touched, nor are columns earlier
// drafts added (description, status, next_action, due_date, is_thread, soft, note): they all
// have defaults, so inserts that omit them still work.
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

  return database;
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES graph_nodes(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stat TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      PRIMARY KEY (from_id, to_id),
      FOREIGN KEY (from_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS progress_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      logged_at TEXT NOT NULL,
      FOREIGN KEY (node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cue TEXT NOT NULL DEFAULT '',
      weekdays TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routine_checks (
      routine_id TEXT NOT NULL,
      date TEXT NOT NULL,
      PRIMARY KEY (routine_id, date),
      FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deadlines (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      due_date TEXT NOT NULL,
      done_at TEXT
    );
  `);

  // graph_nodes tables created before steps existed lack these columns
  const columns = new Set(
    (db.prepare("PRAGMA table_info(graph_nodes)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!columns.has("parent_id")) {
    db.exec("ALTER TABLE graph_nodes ADD COLUMN parent_id TEXT REFERENCES graph_nodes(id) ON DELETE CASCADE");
  }
  if (!columns.has("completed_at")) {
    db.exec("ALTER TABLE graph_nodes ADD COLUMN completed_at TEXT");
  }

  // Per-node XP sums and today's counts read these on every change
  db.exec(`
    CREATE INDEX IF NOT EXISTS progress_log_node ON progress_log (node_id);
    CREATE INDEX IF NOT EXISTS progress_log_time ON progress_log (logged_at);
    CREATE INDEX IF NOT EXISTS graph_nodes_parent ON graph_nodes (parent_id);
  `);
}
