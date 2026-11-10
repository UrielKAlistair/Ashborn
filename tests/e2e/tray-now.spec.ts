import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { phoneWindow } from "../phoneWindow";

// The tray names Now's step: the app sends it, and sends the next one once it is ticked. The menu
// itself is the desktop's; the test reads what it is given. Then on the phone, Now's title opens the
// graph tab on its step.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);

test("the tray's Now", async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const id = { quest: crypto.randomUUID(), draft: crypto.randomUUID(), email: crypto.randomUUID(), room: crypto.randomUUID() };
  const insert = async (rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  };
  await insert([{ id: id.quest, title: "Work", parent_id: null, priority: 1 }]);
  await insert([
    { id: id.draft, title: "Draft the intro", parent_id: id.quest },
    { id: id.email, title: "Email the professor", parent_id: id.quest },
    { id: id.room, title: "Book the room", parent_id: id.quest },
  ]);

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  await app.evaluate(({ ipcMain }) => ipcMain.on("now:update", (_event, step) => ((globalThis as { trayNow?: unknown }).trayNow = step)));
  const trayNow = () => app.evaluate(() => (globalThis as { trayNow?: unknown }).trayNow);
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(now).toContainText("Draft the intro", { timeout: 15_000 });

  await test.step("Now's step reaches the tray, and the next one once it is ticked", async () => {
    await expect.poll(trayNow).toEqual({ id: id.draft, title: "Draft the intro" });
    await now.getByRole("listitem").filter({ hasText: "Draft the intro" }).getByTitle("Mark done").click();
    await expect.poll(async () => ((await trayNow()) as { title: string }).title).toBe("Email the professor");
  });

  await test.step("on the phone, Now's title opens the graph on its step", async () => {
    await phoneWindow(app, page);
    await now.getByRole("button", { name: "Email the professor", exact: true }).click();
    const node = page.locator(`.react-flow__node[data-id="${id.email}"]`);
    await expect(node).toHaveClass(/node-flash/);
    await expect(node).toBeInViewport();
    // Ticked on the graph tab, with no Now card mounted, the tag moves to the next step
    await expect(node.getByText("Now", { exact: true })).toBeVisible();
    await node.getByTitle("Mark done").click();
    await expect(page.locator(`.react-flow__node[data-id="${id.room}"]`).getByText("Now", { exact: true })).toBeVisible();
    await expect(node.getByText("Now", { exact: true })).toHaveCount(0);
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
