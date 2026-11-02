import { _electron as electron, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A change made while the server isn't yet listening is never sent, so the app reads the data again
// each time the server starts listening: after loading, and after a dropped connection comes back.
// That read happens then and not on every heartbeat.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const HEARTBEAT_MS = 25_000; // Realtime's own interval

test("changes made while the live connection is away still arrive", async () => {
  test.setTimeout(220_000);
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  const quest = crypto.randomUUID();
  const { error: seedError } = await db.from("graph_nodes").insert({ id: quest, title: "Live start", parent_id: null });
  if (seedError) throw seedError;
  // Two steps, so ticking one doesn't finish the quest and fold it away
  const { error: stepError } = await db.from("graph_nodes").insert([
    { title: "Tick me", parent_id: quest, id: crypto.randomUUID() },
    { title: "Leave me", parent_id: quest, id: crypto.randomUUID() },
  ]);
  if (stepError) throw stepError;
  const setTitle = async (title: string) => {
    const { error: updateError } = await db.from("graph_nodes").update({ title, changed_at: { title: new Date().toISOString() } }).eq("id", quest);
    if (updateError) throw updateError;
  };

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const card = (title: string) => page.locator(".react-flow__node-quest").filter({ hasText: title });
  // Whole reads of the graph: a single node's read filters on its id
  let reads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && /nodes_with_xp/.test(request.url()) && !/id=eq/.test(request.url())) reads += 1;
  });
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { liveSockets: WebSocket[] }).liveSockets = sockets;
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(target, args: ConstructorParameters<typeof WebSocket>) {
        const socket = new target(...args);
        sockets.push(socket);
        return socket;
      },
    });
  });
  const dropLive = () => page.evaluate(() => (window as unknown as { liveSockets: WebSocket[] }).liveSockets.filter((socket) => socket.readyState === 1 && /realtime/.test(socket.url)).map((socket) => socket.close()).length);

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(card("Live start")).toBeVisible({ timeout: 20_000 });

  await test.step("a change just after loading arrives, every time", async () => {
    for (let n = 1; n <= 6; n++) {
      await setTitle(`Before ${n}`);
      await expect(card(`Before ${n}`)).toBeVisible({ timeout: 10_000 });
      await page.reload();
      await expect(card(`Before ${n}`)).toBeVisible({ timeout: 20_000 });
      await setTitle(`Just after ${n}`);
      await expect(card(`Just after ${n}`)).toBeVisible({ timeout: 15_000 });
    }
  });

  await test.step("a change while the connection is away arrives once it is back, by one read", async () => {
    await page.waitForTimeout(4000); // past the listening message from that last load
    for (let n = 1; n <= 3; n++) {
      const before = reads;
      expect(await dropLive()).toBe(1);
      await setTitle(`In the gap ${n}`);
      await expect(card(`In the gap ${n}`)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(3000);
      expect(reads - before).toBe(1);
    }
  });

  await test.step("a heartbeat reads nothing", async () => {
    const before = reads;
    await page.waitForTimeout(HEARTBEAT_MS + 5000);
    expect(reads).toBe(before);
    await setTitle("Still live");
    await expect(card("Still live")).toBeVisible({ timeout: 10_000 });
    expect(reads).toBe(before);
  });

  await test.step("a read in flight can't undo a change answered while it ran", async () => {
    let held = 0;
    await page.route("**/rest/v1/nodes_with_xp*", async (route) => {
      if (route.request().method() !== "GET" || /id=eq/.test(route.request().url())) return route.continue();
      const response = await route.fetch(); // read now, handed over late: by then it is out of date
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({ response });
      held += 1;
    });
    const before = reads;
    await dropLive();
    await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(before);
    await dropLive(); // and no echo of the tick comes back to repair it
    const tick = page.locator(".react-flow__node-step", { hasText: "Tick me" }).getByRole("button", { name: /^Mark/ });
    await tick.click();
    await expect(tick).toHaveAttribute("title", "Mark not done");
    await expect.poll(() => held, { timeout: 10_000 }).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) {
      await expect(tick).toHaveAttribute("title", "Mark not done", { timeout: 100 });
      await page.waitForTimeout(150);
    }
    await page.unrouteAll({ behavior: "wait" }); // any read still held lands first
  });

  await test.step("coming back after a long time hidden reads again; a short look away doesn't", async () => {
    const setVisibility = (state: string) =>
      page.evaluate((value) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    const before = reads;
    await setVisibility("hidden");
    await page.waitForTimeout(1000);
    await setVisibility("visible");
    await page.waitForTimeout(1500);
    expect(reads).toBe(before);

    await setVisibility("hidden");
    await page.waitForTimeout(31_000);
    await setVisibility("visible");
    await expect.poll(() => reads, { timeout: 5000 }).toBe(before + 1);
  });

  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
