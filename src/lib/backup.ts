// The backup's content: every table of the user's, read whole (exportAll), and the cleaning a restore
// needs first (consistentBackup). Writing it to disk is the desktop shell's (backupSchedule.ts,
// electron/main.ts); restoring is scripts/restore-backup.mjs.
import type { SupabaseClient } from "@supabase/supabase-js";

// Every table holding the user's data with its primary key and the rows it refers to, parents before
// the rows that refer to them, so a restore can insert them in this order (scripts/restore-backup.mjs).
// A reference is a column naming another table's `id`; `orNull` when the database empties the column,
// rather than deleting the row, once that row is gone.
type Reference = { column: string; table: string; orNull?: true };
export const backupTables: { table: string; key: string[]; references?: Reference[] }[] = [
  { table: "graph_nodes", key: ["id"], references: [{ column: "parent_id", table: "graph_nodes" }] },
  { table: "graph_edges", key: ["from_id", "to_id"], references: [{ column: "from_id", table: "graph_nodes" }, { column: "to_id", table: "graph_nodes" }] },
  { table: "progress_log", key: ["id"], references: [{ column: "node_id", table: "graph_nodes" }] },
  { table: "routines", key: ["id"] },
  { table: "routine_checks", key: ["routine_id", "date"], references: [{ column: "routine_id", table: "routines" }] },
  { table: "deadlines", key: ["id"], references: [{ column: "node_id", table: "graph_nodes", orNull: true }] },
  { table: "alarms", key: ["id"] },
  { table: "alarm_skips", key: ["user_id", "key"] },
  { table: "stock_items", key: ["id"] },
  { table: "recipes", key: ["id"] },
  { table: "recipe_ingredients", key: ["id"], references: [{ column: "recipe_id", table: "recipes" }, { column: "item_id", table: "stock_items", orNull: true }] },
  { table: "recipe_reminders", key: ["id"], references: [{ column: "recipe_id", table: "recipes" }, { column: "anchor_id", table: "recipe_reminders", orNull: true }] },
  { table: "meals", key: ["id"] },
  { table: "meal_recipes", key: ["meal_id", "recipe_id"], references: [{ column: "meal_id", table: "meals" }, { column: "recipe_id", table: "recipes" }] },
  { table: "default_meals", key: ["id"] },
  { table: "default_meal_recipes", key: ["default_meal_id", "recipe_id"], references: [{ column: "default_meal_id", table: "default_meals" }, { column: "recipe_id", table: "recipes" }] },
  { table: "stock_changes", key: ["id"], references: [{ column: "item_id", table: "stock_items" }, { column: "meal_id", table: "meals" }] },
  { table: "user_settings", key: ["user_id"] },
];

// Pages of this many rows, under the server's cap on rows per request
const PAGE = 1000;

// All rows of every table that the signed-in user's access rules allow, by table name
export async function exportAll(db: SupabaseClient): Promise<Record<string, unknown[]>> {
  const tables = await Promise.all(backupTables.map(async ({ table, key }) => [table, await readAll(db, table, key)] as const));
  return Object.fromEntries(tables);
}

// Ordered by the primary key, so pages neither skip nor repeat rows
async function readAll(db: SupabaseClient, table: string, key: string[]) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const ordered = key.reduce((query, column) => query.order(column), db.from(table).select());
    const { data, error } = await ordered.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

type Row = Record<string, unknown>;

// A backup as the database would hold it, for a restore that cannot fail halfway on it: the tables
// are read side by side, each a page at a time, while the app may be writing, so a backup can hold a
// row twice (a page boundary moved) or a row whose parent was deleted between two reads. Repeats are dropped, and so is
// a row whose parent is missing, as the database would cascade it (or its column emptied, where the
// database does that). Says how many rows of each table were dropped.
export function consistentBackup(tables: Record<string, Row[]>): { tables: Record<string, Row[]>; dropped: Record<string, number> } {
  const kept: Record<string, Row[]> = {};
  const dropped: Record<string, number> = {};
  for (const { table, key, references = [] } of backupTables) {
    const seen = new Set<string>();
    let rows = (tables[table] ?? []).filter((row) => {
      const id = key.map((column) => String(row[column])).join("|");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    // Until nothing more goes: a node whose parent went takes its own children with it
    for (let before = -1; before !== rows.length; ) {
      before = rows.length;
      const ids = (name: string) => new Set((name === table ? rows : kept[name] ?? []).map((row) => row.id));
      const present = Object.fromEntries(references.map(({ table: name }) => [name, ids(name)]));
      rows = rows.flatMap((row) => {
        let fixed = row;
        for (const { column, table: name, orNull } of references) {
          if (fixed[column] == null || present[name].has(fixed[column])) continue;
          if (!orNull) return [];
          fixed = { ...fixed, [column]: null };
        }
        return [fixed];
      });
    }
    kept[table] = rows;
    if ((tables[table] ?? []).length !== rows.length) dropped[table] = (tables[table] ?? []).length - rows.length;
  }
  return { tables: kept, dropped };
}
