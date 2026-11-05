import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupTables } from "../../src/lib/backup";

// The desktop app's nightly backup, signed in as the test user with the backups in a temporary
// folder: written on start, not again the same day, caught up when over a day old, the newest 30
// kept; then the restore script puts a backup back.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const DAY_MS = 24 * 60 * 60 * 1000;

let profile: string;
let backups: string;
let app: ElectronApplication | undefined;

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  backups = path.join(profile, "backups");
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

function today() {
  const at = new Date();
  return `${at.getFullYear()}-${`${at.getMonth() + 1}`.padStart(2, "0")}-${`${at.getDate()}`.padStart(2, "0")}`;
}

const todaysFile = () => path.join(backups, `${today()}.json`);

// Starts the desktop app on the same profile; signs in the first time, after which the session
// is kept in the profile
async function start() {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = backups;
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const email = page.getByPlaceholder("Email");
  const home = page.getByRole("button", { name: "Kitchen", exact: true });
  await expect(email.or(home).first()).toBeVisible({ timeout: 15_000 });
  if (await email.isVisible()) {
    await email.fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(home).toBeVisible({ timeout: 15_000 });
}

async function stop() {
  await app?.close();
  app = undefined;
}

async function counts() {
  const rows: Record<string, number> = {};
  for (const { table } of backupTables) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    rows[table] = count ?? 0;
  }
  return rows;
}

function backupCounts(file: string) {
  const { tables } = JSON.parse(readFileSync(file, "utf8")) as { tables: Record<string, unknown[]> };
  return Object.fromEntries(backupTables.map(({ table }) => [table, (tables[table] ?? []).length]));
}

test("backup", async () => {
  // The earlier suites leave the test account with quests, a kitchen and level-ups
  const inAccount = await counts();

  await test.step("on start, with no backup yet, every table is written", async () => {
    await start();
    await expect.poll(() => existsSync(todaysFile()), { timeout: 20_000 }).toBe(true);
    await stop();
    expect(backupCounts(todaysFile())).toEqual(inAccount);
    expect(inAccount.graph_nodes).toBeGreaterThan(0);
  });

  await test.step("started again the same day, nothing new is written", async () => {
    const written = statSync(todaysFile()).mtimeMs;
    await start();
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await stop();
    expect(statSync(todaysFile()).mtimeMs).toBe(written);
  });

  await test.step("a backup over a day old is caught up; only the newest 30 are kept", async () => {
    const dayOld = new Date(Date.now() - DAY_MS - 60_000);
    utimesSync(todaysFile(), dayOld, dayOld);
    mkdirSync(backups, { recursive: true });
    for (let day = 1; day <= 31; day++) {
      const file = path.join(backups, `2025-01-${`${day}`.padStart(2, "0")}.json`);
      writeFileSync(file, "{}");
      utimesSync(file, dayOld, dayOld);
    }

    await start();
    await expect.poll(() => statSync(todaysFile()).mtimeMs, { timeout: 20_000 }).toBeGreaterThan(dayOld.getTime() + 1000);
    await stop();
    const kept = readdirSync(backups).sort();
    expect(kept).toHaveLength(30);
    expect(kept).not.toContain("2025-01-01.json");
    expect(kept).not.toContain("2025-01-02.json");
    expect(kept).toContain(`${today()}.json`);
  });

  await test.step("restoring puts back what was deleted since the backup", async () => {
    const backedUp = backupCounts(todaysFile());
    const { error } = await db.from("graph_nodes").delete().not("id", "is", null);
    if (error) throw error;
    expect((await counts()).graph_nodes).toBe(0);

    const restore = spawnSync("node", ["scripts/restore-backup.mjs", todaysFile()], {
      input: `${process.env.E2E_EMAIL}\n${process.env.E2E_PASSWORD}\ny\n`,
      encoding: "utf8",
    });
    expect(restore.status, restore.stderr).toBe(0);
    expect(restore.stdout).toContain("Restored: every table holds what the backup does.");
    expect(await counts()).toEqual(backedUp);
    // The account as it was before, saved beside the backup and left out of the rotation
    expect(readdirSync(path.dirname(todaysFile())).some((name) => name.startsWith(`${today()}.before-restore-`))).toBe(true);
  });
});
