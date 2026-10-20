// Replaces everything in your Ashborn account with a backup the desktop app wrote
// (~/.local/share/ashborn/backups/<date>.json). Shows the row counts of the backup and of the
// account and asks before deleting anything. Replace, not merge: for data that is lost or broken.
//
//   node scripts/restore-backup.mjs ~/.local/share/ashborn/backups/2026-10-20.json

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { backupTables } from "../src/lib/backup.ts";
import { prompter } from "./ask.mjs";

// Rows per insert request
const BATCH = 500;

const file = process.argv[2];
if (!file) fail("Give the backup file: node scripts/restore-backup.mjs <file>");
// The file holds { madeAt, tables: { <table>: rows } } (src/lib/backupSchedule.ts)
const { madeAt, tables: backup } = JSON.parse(readFileSync(file, "utf8"));

process.loadEnvFile(".env");
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

const ask = await prompter();
const email = await ask("Email: ");
const password = await ask("Password: ", { hidden: true });
const { error: signInError } = await db.auth.signInWithPassword({ email, password });
if (signInError) fail(signInError.message);

console.log(`Backup made ${madeAt}.\ntable: rows in the backup / rows in ${email}`);
for (const { table } of backupTables) console.log(`${table}: ${(backup[table] ?? []).length} / ${await count(table)}`);
if ((await ask("Delete the account's rows and restore the backup? [y/N] ")).trim().toLowerCase() !== "y") fail("Nothing changed.");

// Children go first; most also go with their parents through cascading foreign keys
for (const { table, key } of [...backupTables].reverse()) {
  const { error } = await db.from(table).delete().not(key[0], "is", null);
  if (error) fail(`deleting ${table}: ${error.message}`);
}

for (const { table } of backupTables) {
  const rows = (backup[table] ?? []).map((row) => restorable(table, row));
  const ordered = table === "graph_nodes" ? parentsFirst(rows) : rows;
  for (let start = 0; start < ordered.length; start += BATCH) {
    const { error } = await db.from(table).insert(ordered.slice(start, start + BATCH));
    if (error) fail(`restoring ${table}: ${error.message} (the account is now partly restored; run this again)`);
  }
}

console.log("Restored. Rows now:");
for (const { table } of backupTables) console.log(`${table}: ${await count(table)}`);
process.exit(0);

// A backup row as it can be inserted into this account: the owner is whoever is signed in, and
// progress_log's id is made by the database
function restorable(table, { user_id: _owner, ...row }) {
  if (table === "progress_log") delete row.id;
  return row;
}

function parentsFirst(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depth = (node) => (node.parent_id && byId.has(node.parent_id) ? 1 + depth(byId.get(node.parent_id)) : 0);
  return [...nodes].sort((a, b) => depth(a) - depth(b));
}

async function count(table) {
  const { count: rows, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) fail(`${table}: ${error.message}`);
  return rows;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
