import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// What a read of the whole graph must not do: move steps made together, drop a change queued while it
// ran, or call the app offline because one read failed.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const uuid = () => crypto.randomUUID();

test("reads of the whole graph", async () => {
  test.setTimeout(150_000);
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "deadlines"]) await db.from(table).delete().not("id", "is", null);
  const quest = uuid();
  const steps = [uuid(), uuid(), uuid(), uuid()];
  const insert = async (rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from("graph_nodes").insert(rows);
    if (insertError) throw insertError;
  };
  await insert([{ id: quest, title: "Work", parent_id: null, priority: 1 }]);
  await insert(steps.map((id, i) => ({ id, title: `Step ${i + 1}`, parent_id: quest }))); // one insert

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const now = page.getByRole("region", { name: "Now" });
  const nowTitle = () => now.getByRole("listitem").first().getByTitle("Show on the graph").innerText();
  const tickOf = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("button", { name: /^Mark/ });
  const banner = page.getByText(/^Offline/);
  let reads = 0; // whole reads of the graph: a single node's filters on its id
  page.on("request", (request) => {
    if (request.method() === "GET" && /nodes_with_xp/.test(request.url()) && !/id=eq/.test(request.url())) reads += 1;
  });
  const queued = () => page.evaluate(() => JSON.parse(localStorage.getItem("ashborn-offline-queue") ?? "[]").length as number);
  const isDone = async (id: string) => Boolean((await db.from("graph_nodes").select("completed_at").eq("id", id).single()).data?.completed_at);

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(now).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500); // past the read when the server starts listening

  await test.step("steps inserted together keep their order, through an update and a reload", async () => {
    const { data } = await db.from("graph_nodes").select("created_at").in("id", steps).order("created_at");
    expect(new Set(data?.map(({ created_at }) => created_at)).size).toBe(steps.length);
    expect(await nowTitle()).toBe("Step 1");
    await db.from("graph_nodes").update({ shelved: false, changed_at: { shelved: new Date().toISOString() } }).eq("id", steps[0]);
    await page.reload();
    await expect(now).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3000); // the first frame is from the device's copy: past the read
    expect(await nowTitle()).toBe("Step 1");
  });

  await test.step("a change queued while a read runs stays shown, and is sent", async () => {
    await expect(banner).toHaveCount(0);
    await page.route("**/rest/v1/**", (route) => route.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(banner).toBeVisible({ timeout: 8000 });
    await page.unrouteAll({ behavior: "wait" });

    await page.route("**/rest/v1/nodes_with_xp*", async (route) => {
      if (route.request().method() !== "GET" || /id=eq/.test(route.request().url())) return route.continue();
      const response = await route.fetch(); // read now, handed over late: by then it is out of date
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.fulfill({ response });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(300);
    const tick = tickOf(steps[3]);
    await tick.click();
    await expect(tick).toHaveAttribute("title", "Mark not done");
    await expect(banner).toHaveCount(0, { timeout: 8000 });
    for (let i = 0; i < 10; i++) {
      await expect(tick).toHaveAttribute("title", "Mark not done", { timeout: 100 });
      await page.waitForTimeout(150);
    }
    await page.unrouteAll({ behavior: "wait" });
    await expect.poll(() => isDone(steps[3]), { timeout: 15_000 }).toBe(true);
    await expect.poll(queued).toBe(0);
    await expect(tick).toHaveAttribute("title", "Mark not done");
  });

  const hide = (ms: number) =>
    page.evaluate((away) => {
      const setVisibility = (value: string) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      setVisibility("hidden");
      const real = Date.now;
      Date.now = () => real() + away;
      setVisibility("visible");
    }, ms);

  await test.step("one failed read on waking keeps the data on screen, says nothing, and tries again", async () => {
    await page.waitForTimeout(1000);
    await page.route("**/rest/v1/**", (route) => route.abort("internetdisconnected"));
    await hide(40_000);
    await page.waitForTimeout(800);
    await page.unrouteAll({ behavior: "wait" }); // the radio is up a moment later
    const before = reads;
    await expect(banner).toHaveCount(0);
    await expect.poll(() => reads, { timeout: 6000 }).toBeGreaterThan(before); // the second try
    await page.waitForTimeout(500);
    await expect(banner).toHaveCount(0);
  });

  await test.step("still no connection when it tries again: offline, as before", async () => {
    await page.waitForTimeout(1000);
    await page.route("**/rest/v1/**", (route) => route.abort("internetdisconnected"));
    await hide(40_000);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await page.unrouteAll({ behavior: "wait" });
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
