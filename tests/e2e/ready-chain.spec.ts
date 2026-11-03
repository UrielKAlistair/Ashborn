import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A chain has one ready step at a time, and a step's priority covers only what leads to it. So Ready
// offers the chain's quest a priority, and with that one tap Now carries on through the chain.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("a chain takes one priority, on its quest", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const id = { essay: crypto.randomUUID(), outline: crypto.randomUUID(), draft: crypto.randomUUID(), edit: crypto.randomUUID() };
  const insert = async (table: string, rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from(table).insert(rows);
    if (insertError) throw insertError;
  };
  await insert("graph_nodes", [{ id: id.essay, title: "Essay", parent_id: null }]);
  await insert("graph_nodes", [
    { id: id.outline, title: "Outline", parent_id: id.essay },
    { id: id.draft, title: "Draft", parent_id: id.essay },
    { id: id.edit, title: "Edit", parent_id: id.essay },
  ]);
  await insert("graph_edges", [
    { from_id: id.outline, to_id: id.draft },
    { from_id: id.draft, to_id: id.edit },
  ]);

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  // One ready of three, and the quest is offered
  await expect(page.getByText("1 ready of 3")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("group", { name: "Priority for all of Essay" }).getByRole("button", { name: "P2" }).click();
  await expect(now).toContainText("Outline");
  await now.getByRole("button", { name: "Done", exact: true }).click();
  await expect(now).toContainText("Draft");
  await now.getByRole("button", { name: "Done", exact: true }).click();
  await expect(now).toContainText("Edit");

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
