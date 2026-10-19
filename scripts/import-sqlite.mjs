// Copies the old local database (~/.config/ashborn/ashborn.sqlite) into your Supabase account,
// keeping ids and timestamps, then checks the row counts match. Refuses to run if the account
// already has threads, so it cannot import twice.
//
// Run once, after creating your account in the app:  node scripts/import-sqlite.mjs

import { createClient } from "@supabase/supabase-js";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prompter } from "./ask.mjs";

const sqlitePath = path.join(homedir(), ".config", "ashborn", "ashborn.sqlite");

process.loadEnvFile(".env");
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const local = new DatabaseSync(sqlitePath, { readOnly: true });

const ask = await prompter();
const email = await ask("Email: ");
const password = await ask("Password: ", { hidden: true });

const { error: signInError } = await db.auth.signInWithPassword({ email, password });
if (signInError) fail(signInError.message);

const { count: existing } = await db.from("graph_nodes").select("*", { count: "exact", head: true });
if (existing > 0) fail(`This account already has ${existing} nodes; nothing imported.`);

const nodes = local.prepare("SELECT id, parent_id, title, stat, active, created_at, completed_at FROM graph_nodes").all();
const edges = local.prepare("SELECT from_id, to_id FROM graph_edges").all();
const levelUps = local.prepare("SELECT node_id, amount, logged_at FROM progress_log").all();
const routines = local.prepare("SELECT id, title, cue, weekdays FROM routines").all();
const checks = local.prepare("SELECT routine_id, date FROM routine_checks").all();
const deadlines = local.prepare("SELECT id, title, due_date, done_at FROM deadlines").all();

// Parents before their steps, so every parent_id exists when its step arrives
const depth = (node) => (node.parent_id ? 1 + depth(nodes.find((other) => other.id === node.parent_id)) : 0);
const orderedNodes = [...nodes].sort((a, b) => depth(a) - depth(b));

await insert("graph_nodes", orderedNodes.map((node) => ({ ...node, active: Boolean(node.active) })));
await insert("graph_edges", edges);
await insert("progress_log", levelUps);
await insert("routines", routines.map((routine) => ({ ...routine, weekdays: JSON.parse(routine.weekdays) })));
await insert("routine_checks", checks);
await insert("deadlines", deadlines);

for (const [table, rows] of [
  ["graph_nodes", nodes],
  ["graph_edges", edges],
  ["progress_log", levelUps],
  ["routines", routines],
  ["routine_checks", checks],
  ["deadlines", deadlines],
]) {
  const { count } = await db.from(table).select("*", { count: "exact", head: true });
  console.log(`${table}: ${rows.length} local, ${count} in Supabase${count === rows.length ? "" : "  <-- MISMATCH"}`);
}

async function insert(table, rows) {
  if (rows.length === 0) return;
  const { error } = await db.from(table).insert(rows);
  if (error) fail(`${table}: ${error.message}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
