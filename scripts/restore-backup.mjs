// Replaces everything in your Ashborn account with a backup the desktop app wrote
// (~/.local/share/ashborn/backups/<date>.json). Replace, not merge: for data that is lost or broken.
// Steps: make the backup consistent (drops repeated rows and rows whose parent is missing, which a
// backup taken while the app was writing can hold); show its row counts against the account's and
// ask; save the account as it is next to the backup (<date>.before-restore-<time>.json, itself a
// backup this script can restore); delete the account's rows; insert the backup's; check the counts.
//
//   node scripts/restore-backup.mjs ~/.local/share/ashborn/backups/2026-10-20.json

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { backupTables, consistentBackup, exportAll } from "../src/lib/backup.ts";
import { prompter } from "./ask.mjs";

// Rows per insert request
const BATCH = 500;

const file = process.argv[2];
if (!file) fail("Give the backup file: node scripts/restore-backup.mjs <file>");
// The file holds { madeAt, tables: { <table>: rows } } (src/lib/backupSchedule.ts)
const { madeAt, tables: saved } = JSON.parse(readFileSync(file, "utf8"));
const { tables: backup, dropped } = consistentBackup(saved);

process.loadEnvFile(".env");
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_PUBLISHABLE_KEY);

const ask = await prompter();
const email = await ask("Email: ");
const password = await ask("Password: ", { hidden: true });
const { error: signInError } = await db.auth.signInWithPassword({ email, password });
if (signInError) fail(signInError.message);

console.log(`Backup made ${madeAt}.\ntable: rows in the backup / rows in ${email}`);
for (const { table } of backupTables) console.log(`${table}: ${(backup[table] ?? []).length} / ${await count(table)}`);
for (const [table, rows] of Object.entries(dropped)) console.log(`Left out of ${table}: ${rows} rows repeated or whose parent is missing.`);
if ((await ask("Delete the account's rows and restore the backup? [y/N] ")).trim().toLowerCase() !== "y") fail("Nothing changed.");

const before = `${file.replace(/\.json$/, "")}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(before, JSON.stringify({ madeAt: new Date().toISOString(), tables: await exportAll(db) }), { mode: 0o600 });
console.log(`The account as it was is saved in ${before}.`);

// Children go first; most also go with their parents through cascading foreign keys
for (const { table, key } of [...backupTables].reverse()) {
  const { error } = await db.from(table).delete().not(key[0], "is", null);
  if (error) fail(`deleting ${table}: ${error.message}`);
}

for (const { table } of backupTables) {
  const rows = (backup[table] ?? []).map((row) => restorable(table, row));
  const ordered = table === "graph_nodes" ? parentsFirst(rows, "parent_id") : table === "recipe_reminders" ? parentsFirst(rows, "anchor_id") : rows;
  for (let start = 0; start < ordered.length; start += BATCH) {
    const { error } = await db.from(table).insert(ordered.slice(start, start + BATCH));
    if (error) fail(`restoring ${table}: ${error.message}. The account is now partly restored; ${before} holds it as it was.`);
  }
}

const short = [];
for (const { table } of backupTables) {
  const rows = await count(table);
  if (rows !== (backup[table] ?? []).length) short.push(`${table}: ${rows} of ${(backup[table] ?? []).length}`);
}
if (short.length) fail(`Restored, but some tables don't hold what the backup does:\n${short.join("\n")}\nThe account as it was is in ${before}.`);
console.log("Restored: every table holds what the backup does.");
process.exit(0);

// A backup row as it can be inserted into this account: the owner is whoever is signed in,
// progress_log's id is made by the database, and older backups hold node sizes (before 2026-10-22)
// and colours (before 2026-11-05) the table no longer has
function restorable(table, { user_id: _owner, ...row }) {
  if (table === "progress_log") delete row.id;
  if (table === "graph_nodes") {
    delete row.width;
    delete row.height;
    delete row.color;
  }
  return row;
}

// Rows a row's `column` names come before it, so a batch never refers to one in a later batch
function parentsFirst(rows, column) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const depth = (row) => (row[column] && byId.has(row[column]) ? 1 + depth(byId.get(row[column])) : 0);
  return [...rows].sort((a, b) => depth(a) - depth(b));
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
