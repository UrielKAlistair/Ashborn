import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A captured thought the server refuses comes back to the field, so it isn't lost.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("a refused capture comes back to the field", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const { error: seedError } = await db.from("graph_nodes").insert({ id: crypto.randomUUID(), title: "Something to show", parent_id: null });
  if (seedError) throw seedError;

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Capture a thought" });
  await expect(field).toBeVisible({ timeout: 20_000 });

  // A write the database refuses (a check constraint), not a lost connection
  await page.route("**/rest/v1/graph_nodes*", (route) =>
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "23514", message: "new row violates check constraint", details: null, hint: null }) }),
  );
  await field.fill("Buy milk");
  await field.press("Enter");
  await expect(field).toHaveValue("Buy milk", { timeout: 10_000 });
  await page.unroute("**/rest/v1/graph_nodes*");

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
