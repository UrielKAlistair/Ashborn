import type { SupabaseClient } from "@supabase/supabase-js";

// Every table holding the user's data with its primary key, parents before the rows that refer to
// them, so a restore can insert them in this order (scripts/restore-backup.mjs)
export const backupTables: { table: string; key: string[] }[] = [
  { table: "graph_nodes", key: ["id"] },
  { table: "graph_edges", key: ["from_id", "to_id"] },
  { table: "progress_log", key: ["id"] },
  { table: "routines", key: ["id"] },
  { table: "routine_checks", key: ["routine_id", "date"] },
  { table: "deadlines", key: ["id"] },
  { table: "alarms", key: ["id"] },
  { table: "stock_items", key: ["id"] },
  { table: "recipes", key: ["id"] },
  { table: "recipe_ingredients", key: ["id"] },
  { table: "recipe_reminders", key: ["id"] },
  { table: "meals", key: ["id"] },
  { table: "meal_recipes", key: ["meal_id", "recipe_id"] },
  { table: "default_meals", key: ["id"] },
  { table: "default_meal_recipes", key: ["default_meal_id", "recipe_id"] },
  { table: "stock_changes", key: ["id"] },
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
