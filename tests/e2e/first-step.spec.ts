import { _electron as electron, expect, test } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerTools } from "../../mcp/tools";
import { phoneWindow } from "../phoneWindow";

// A quest with a priority and no steps shows in Today, asking for a first step rather than a tick.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";

test("a quest with a priority and no steps", async () => {
  const { data, error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const idea = crypto.randomUUID();
  const other = crypto.randomUUID();
  const { error: seedError } = await db.from("graph_nodes").insert([
    { id: idea, title: "Talk on attention", parent_id: null, priority: 1 },
    { id: other, title: "Learn to sail", parent_id: null, priority: 3 },
  ]);
  if (seedError) throw seedError;
  const completedAt = async (id: string) => (await db.from("graph_nodes").select("completed_at").eq("id", id).single()).data?.completed_at;
  const stepsOf = async (id: string) => (await db.from("graph_nodes").select("title").eq("parent_id", id)).data?.map(({ title }) => title);

  const profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  const app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (pageError) => pageErrors.push(pageError.message));
  const now = page.getByRole("region", { name: "Now" });

  await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
  await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(now).toContainText("Talk on attention", { timeout: 20_000 });

  await test.step("Now asks for a first step, and has nothing to tick", async () => {
    const row = now.getByRole("listitem").filter({ hasText: "Talk on attention" });
    await expect(row.getByRole("button", { name: "Add a first step" })).toBeVisible();
    await expect(row.getByTitle("Mark done")).toHaveCount(0);
    await now.getByRole("button", { name: "Actions for Talk on attention" }).click();
    await expect(now.getByRole("menuitem", { name: "Split it" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `${shots}/first-step.png` });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("d");
    await page.waitForTimeout(300);
    expect(await completedAt(idea)).toBeNull();
  });

  await test.step("the agent is told it needs one", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerTools(server, db, data.user.id);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "e2e", version: "0" });
    await client.connect(clientSide);
    const result = await client.callTool({ name: "overview", arguments: {} });
    const line = (result.content as Array<{ text: string }>)[0].text.split("\n").find((text) => text.includes(`[${idea}]`));
    expect(line).toMatch(/^- P1 Talk on attention \[.*\] \(.*\) \(a quest with no steps yet: it needs a first step\)$/);
    await client.close();
  });

  await test.step("the first steps replace it with the first of them", async () => {
    await now.getByRole("listitem").filter({ hasText: "Talk on attention" }).getByRole("button", { name: "Add a first step" }).click();
    await page.getByLabel("Steps, one per line").fill("Read the papers\nDraft an outline");
    await expect(now.getByText("First steps", { exact: true })).toBeVisible();
    await expect(now.getByText("Split into steps")).toHaveCount(0);
    await now.getByRole("button", { name: "Add", exact: true }).click();
    await expect(now).toContainText("Read the papers");
    await expect(now.getByRole("listitem").first().getByTitle("Mark done")).toBeVisible();
    await expect.poll(() => stepsOf(idea)).toEqual(expect.arrayContaining(["Read the papers", "Draft an outline"]));
  });

  await test.step("further down Now it has a + where a tick would be", async () => {
    const list = page.getByRole("region", { name: "Now" });
    const row = list.getByRole("listitem").filter({ hasText: "Learn to sail" });
    await expect(row.getByTitle("Mark done")).toHaveCount(0);
    await row.getByTitle("Add a first step").click();
    await list.getByLabel("Steps, one per line").fill("Find a course");
    await page.screenshot({ path: `${shots}/first-step-row.png` });
    await expect(list.getByText("First steps", { exact: true })).toBeVisible();
    await list.getByRole("button", { name: "Add", exact: true }).click();
    await expect.poll(() => stepsOf(other)).toEqual(["Find a course"]);
    await expect(list).toContainText("Find a course");
  });

  await test.step("with no priority it waits in Ready, chips and all; an empty Inbox doesn't", async () => {
    const { error: insertError } = await db.from("graph_nodes").insert([
      { id: crypto.randomUUID(), title: "Someday idea", parent_id: null },
      { id: data.user.id, title: "Inbox", parent_id: null },
    ]);
    if (insertError) throw insertError;
    await expect(page.getByRole("button", { name: /Ready, no priority/ })).toContainText("1");
    await page.getByRole("button", { name: /Ready, no priority/ }).click();
    const chips = page.getByRole("group", { name: "Priority for Someday idea" });
    await expect(chips).toBeVisible();
    await expect(page.getByRole("group", { name: "Priority for Inbox" })).toHaveCount(0);
    await expect(page.getByText("A quest with no steps yet")).toBeVisible();
    await page.screenshot({ path: `${shots}/first-step-ready.png` });

    await chips.getByRole("button", { name: "P4" }).click();
    await expect(chips).toHaveCount(0);
    const list = page.getByRole("region", { name: "Now" });
    await expect(list).toContainText("Someday idea");
    await expect(list.getByTitle("Add a first step")).toBeVisible();
  });

  await test.step("on the phone too", async () => {
    const { error: insertError } = await db.from("graph_nodes").insert({ title: "Plan the move", parent_id: null, priority: 1 });
    if (insertError) throw insertError;
    await phoneWindow(app, page);
    await expect(page.getByTitle("Add a first step").first()).toBeVisible();
    await page.screenshot({ path: `${shots}/first-step-phone.png` });
  });

  expect(pageErrors).toEqual([]);
  await app.close();
  rmSync(profile, { recursive: true, force: true });
});
