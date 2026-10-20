import { expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The MCP server, driven as an agent would drive it, signed in as the test user with a
// throwaway session file

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
let sessionDir: string;
let client: Client;

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms", "meals", "recipes", "stock_items", "default_meals"]) {
    const { error: wipeError } = await db.from(table).delete().not("id", "is", null);
    if (wipeError) throw wipeError;
  }

  sessionDir = mkdtempSync(path.join(tmpdir(), "ashborn-agent-"));
  const env = { ...process.env, ASHBORN_SESSION_FILE: path.join(sessionDir, "session.json") } as Record<string, string>;
  const login = spawnSync("node", ["dist-mcp/server.mjs", "login"], { input: `${process.env.E2E_EMAIL}\n${process.env.E2E_PASSWORD}\n`, env });
  expect(login.status, login.stderr.toString()).toBe(0);

  client = new Client({ name: "e2e", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["dist-mcp/server.mjs"], env }));
});

test.afterAll(async () => {
  await client?.close();
  rmSync(sessionDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const body = (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
  return { ok: !result.isError, body };
}

test("agent tools", async () => {
  expect(statSync(path.join(sessionDir, "session.json")).mode & 0o777).toBe(0o600);

  const plan = await call("add_plan", {
    parent_id: null,
    steps: [
      { ref: "dl", title: "Deep Learning" },
      { ref: "kpca", title: "Kernel PCA", parent: "dl" },
      { ref: "pca", title: "PCA from scratch", parent: "kpca" },
      { ref: "kernel", title: "Kernel trick", parent: "kpca", after: ["pca"] },
      { ref: "svm", title: "Support vector machines", parent: "dl", after: ["kpca"] },
    ],
  });
  expect(plan.ok).toBe(true);
  const id = (ref: string) => plan.body.match(new RegExp(`^${ref}: .*\\[([0-9a-f-]+)\\]`, "m"))![1];

  await test.step("a plan becomes nested, linked steps; only the first in line is ready", async () => {
    const { body } = await call("overview");
    expect(body).toContain("# Deep Learning");
    expect(body).toContain("- [ ] Kernel trick");
    expect(body).toMatch(/Kernel trick \[[^\]]+\] \(after: PCA from scratch\)/);
    expect(body.split("\n\n")[0]).toContain("PCA from scratch");
    expect(body.split("\n\n")[0]).not.toContain("Kernel trick");
  });

  await test.step("loops and moving a node inside itself are refused", async () => {
    expect(await call("link", { from: id("kernel"), to: id("pca") })).toEqual({ ok: false, body: "That link would make a loop." });
    expect(await call("move", { id: id("dl"), parent_id: id("pca") })).toEqual({ ok: false, body: "A node cannot move inside itself." });
  });

  await test.step("complete, level up, stat weights, deadline, move", async () => {
    expect((await call("complete", { ids: [id("pca")] })).ok).toBe(true);
    expect((await call("update_thread", { id: id("dl"), stat_weights: { INT: 0.2, CHR: 0.1, MND: 0 } })).ok).toBe(true);
    expect((await call("level_up", { id: id("dl") })).ok).toBe(true);
    expect((await call("add_deadline", { title: "Submit draft", due_date: "2099-01-01" })).ok).toBe(true);
    expect((await call("move", { id: id("svm"), parent_id: id("kpca") })).ok).toBe(true);

    const { body } = await call("overview", { thread_id: id("dl") });
    expect(body).toMatch(/trains INT 0\.2, CHR 0\.1$/m); // a zero weight is not stored
    expect(body).toContain("- [x] PCA from scratch");
    expect(body).toMatch(/^ {2}- \[ \] Support vector machines/m); // now inside Kernel PCA, link dropped
    expect(body).not.toMatch(/Support vector machines.*after/);
  });

  await test.step("a shelved step is marked, and nothing inside it is up next until it is unshelved", async () => {
    expect((await call("shelve", { ids: [id("kpca")] })).ok).toBe(true);
    let { body } = await call("overview", { thread_id: id("dl") });
    expect(body).toMatch(/Kernel PCA \[[^\]]+\] \(shelved\)/);
    expect(body.split("\n\n")[0]).not.toContain("Kernel trick");
    expect((await call("unshelve", { ids: [id("kpca")] })).ok).toBe(true);
    ({ body } = await call("overview", { thread_id: id("dl") }));
    expect(body).not.toContain("(shelved)");
    expect(body.split("\n\n")[0]).toContain("Kernel trick");
  });

  await test.step("alarms: in some minutes, or recurring with a challenge", async () => {
    expect((await call("add_alarm", { label: "Nap", in_minutes: 40 })).ok).toBe(true);
    expect((await call("add_alarm", { label: "Wake", time: "06:00", weekdays: ["Mon", "Wed"], kind: "situps" })).ok).toBe(true);
    expect((await call("add_alarm", { label: "Bad", weekdays: ["Mon"] })).ok).toBe(false);
    const { body } = await call("overview");
    expect(body).toMatch(/\[on\] once at .* Nap/);
    expect(body).toContain("[on] 06:00 on Mon Wed Wake (situps)");
  });

  await test.step("delete removes a step with everything inside it", async () => {
    expect((await call("delete", { id: id("kpca") })).ok).toBe(true);
    const { body } = await call("overview");
    expect(body).not.toContain("Kernel");
    expect(body).toContain("Submit draft");
  });

  await test.step("kitchen: a recipe deducts its tracked ingredients when its meal is cooked, and unticking restores them", async () => {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const added = await call("add_stock_item", { name: "Rice", unit: "kg", target: 2, on_hand: 1.5 });
    const riceId = added.body.match(/Rice \[([^\]]+)\]/)![1];

    expect((await call("save_recipe", { title: "Rice and beans", ingredients: [{ item: "rice", amount: 200, unit: "ml" }] })).ok).toBe(false);
    const saved = await call("save_recipe", { title: "Rice and beans", body: "Wash the rice twice.", ingredients: [{ item: "rice", amount: 200, unit: "g" }] });
    expect(saved.ok).toBe(true);
    const recipeId = saved.body.match(/\[([^\]]+)\]/)![1];

    expect((await call("plan_meals", { meals: [{ date: today, slot: "lunch", description: "rice and beans", recipes: [recipeId] }] })).ok).toBe(true);
    let { body } = await call("kitchen");
    expect(body).toContain(`lunch: rice and beans (recipes: Rice and beans [${recipeId}])`);
    expect(body).toContain('reminder "Start prep": -45 min from the meal');

    expect((await call("cook_meal", { date: today, slot: "lunch" })).body).toBe("Cooked.");
    expect((await call("kitchen")).body).toContain(`Rice [${riceId}]: 1.3 kg of 2 kg`);
    expect((await call("uncook_meal", { date: today, slot: "lunch" })).ok).toBe(true);
    expect((await call("kitchen")).body).toContain(`Rice [${riceId}]: 1.5 kg of 2 kg`);

    expect((await call("adjust_stock", { id: riceId, set: 5 })).body).toBe("Rice: 5 kg.");
    expect((await call("cancel_meals", { date: today })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).toContain(`- [-] ${today}`);
    expect(body).toContain("Rice and beans [");

    // A dropped stock item leaves its ingredient untracked; cooking says so and deducts the rest
    expect((await call("plan_meals", { meals: [{ date: today, slot: "dinner", description: "rice", recipes: [recipeId] }] })).ok).toBe(true);
    expect((await call("delete_stock_item", { id: riceId })).ok).toBe(true);
    expect((await call("cook_meal", { date: today, slot: "dinner" })).body).toBe("Cooked. Not deducted (no longer tracked): Rice.");
  });
});
