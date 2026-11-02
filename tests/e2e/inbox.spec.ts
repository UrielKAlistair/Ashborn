import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerTools } from "../../mcp/tools";
import { phoneWindow } from "../phoneWindow";

// The Inbox: capture without choosing, on the desktop and the phone; sort with Move to…; the agent
// sees it. The tools run in this process, on the test's own signed-in client.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/lower-cost/shots";

let app: ElectronApplication;
let page: Page;
let profile: string;
let userId: string;
const work = crypto.randomUUID();
const report = crypto.randomUUID();

test.beforeAll(async () => {
  const { data, error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  userId = data.user.id;
  for (const table of ["graph_nodes", "routines", "deadlines", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const { error: seedError } = await db.from("graph_nodes").insert([
    { id: work, title: "Work", parent_id: null, color: "blue" },
    { id: report, title: "Write report", parent_id: work, color: null },
  ]);
  if (seedError) throw seedError;

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const field = () => page.getByLabel("Capture a thought");
const upNext = () => page.locator("section", { hasText: "Up next" }).last();
const quest = (title: string) => page.locator(".react-flow__node-quest", { hasText: title });
const step = (title: string) => page.locator(".react-flow__node-step", { hasText: title });
const capture = async (thought: string) => {
  await field().fill(thought);
  await field().press("Enter");
  await expect(field()).toHaveValue("");
};
const row = async (title: string) => {
  const { data, error } = await db.from("graph_nodes").select("id, parent_id, active").eq("title", title);
  if (error) throw error;
  return data;
};
const parentOf = async (title: string) => (await row(title))[0]?.parent_id;
const moveTo = (title: string, target: string) => step(title).getByLabel("Move to…").selectOption({ label: target });
const inboxRows = async () => {
  const { data, error } = await db.from("graph_nodes").select("id, title, active").eq("id", userId);
  if (error) throw error;
  return data;
};

test("inbox", async () => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await test.step("the first capture makes the Inbox, whose id is the user's", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(quest("Work")).toBeVisible({ timeout: 20_000 });
    await capture("Call the bank");

    await expect(quest("Inbox")).toBeVisible();
    await expect(step("Call the bank")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sort 1" })).toBeVisible();
    await expect.poll(inboxRows).toEqual([{ id: userId, title: "Inbox", active: true }]);
    await expect.poll(() => parentOf("Call the bank")).toBe(userId);
  });

  await test.step("later captures join it, its items stay off the to-do, and it sits after other quests", async () => {
    await capture("Book a dentist");
    await capture("Project idea");
    await expect(page.getByRole("button", { name: "Sort 3" })).toBeVisible();
    await expect(upNext()).not.toContainText("Call the bank");
    await expect.poll(async () => (await db.from("graph_nodes").select("id").eq("title", "Inbox")).data?.length).toBe(1);

    const left = (title: string) => quest(title).evaluate((el) => Number(/translate\((-?[\d.]+)px/.exec((el as HTMLElement).style.transform)![1]));
    const top = (title: string) => quest(title).evaluate((el) => Number(/, (-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform)![1]));
    await expect.poll(() => left("Work")).toBe(0);
    expect(await top("Work")).toBe(0);
    await page.screenshot({ path: `${shots}/inbox-desktop.png` });
  });

  await test.step("Move to… sorts a step into a quest, or into a quest of its own", async () => {
    // The headless display has no hovering pointer, so keyboard focus is what shows the buttons
    await step("Call the bank").getByLabel("Move to…").focus();
    await expect(step("Call the bank").locator("div:has(> span[title='Move to…'])")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `${shots}/inbox-hover.png` });
    await step("Call the bank").getByLabel("Move to…").click(); // the list is what a real click reaches
    await page.keyboard.press("Escape");
    await moveTo("Call the bank", "Work");
    await expect.poll(() => parentOf("Call the bank")).toBe(work);
    await expect(page.getByRole("button", { name: "Sort 2" })).toBeVisible();

    await moveTo("Book a dentist", "  Write report");
    await expect.poll(() => parentOf("Book a dentist")).toBe(report);

    await moveTo("Project idea", "Its own quest");
    await expect.poll(() => parentOf("Project idea")).toBeNull();
    await expect(quest("Project idea")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Sort \d/ })).toHaveCount(0);
  });

  await test.step("a step sorted out of the Inbox has no Move to…", async () => {
    await expect(step("Call the bank").getByLabel("Move to…")).toHaveCount(0);
  });

  await test.step("a renamed Inbox is still the Inbox; a hidden, then a deleted one comes back", async () => {
    await db.from("graph_nodes").update({ title: "Brain dump" }).eq("id", userId);
    await expect(quest("Brain dump")).toBeVisible();
    await capture("After the rename");
    await expect.poll(() => parentOf("After the rename")).toBe(userId);
    await expect.poll(inboxRows).toEqual([{ id: userId, title: "Brain dump", active: true }]);

    await db.from("graph_nodes").update({ active: false }).eq("id", userId);
    await expect(quest("Brain dump")).toHaveCount(0);
    await capture("While hidden");
    await expect(quest("Brain dump")).toBeVisible();
    await expect.poll(inboxRows).toEqual([{ id: userId, title: "Brain dump", active: true }]);

    await db.rpc("delete_node", { target: userId });
    await expect(quest("Brain dump")).toHaveCount(0);
    await capture("After the delete");
    await expect(quest("Inbox")).toBeVisible();
    await expect.poll(() => parentOf("After the delete")).toBe(userId);
  });

  await test.step("the agent is told about the Inbox, and can sort it", async () => {
    const server = new McpServer({ name: "test", version: "0" });
    registerTools(server, db, userId);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "e2e", version: "0" });
    await client.connect(clientSide);
    const overview = async () => {
      const result = await client.callTool({ name: "overview", arguments: {} });
      return (result.content as Array<{ text: string }>).map((part) => part.text).join("\n");
    };

    const body = await overview();
    expect(body).toContain(`# Inbox [${userId}]`);
    expect(body).toContain("The Inbox: thoughts the user captured");
    expect(body.indexOf("# Work")).toBeLessThan(body.indexOf("# Inbox"));
    expect(body.split("# ")[0]).not.toContain("After the delete"); // not offered as ready

    const [{ id }] = await row("After the delete");
    await client.callTool({ name: "move", arguments: { id, parent_id: work } });
    await expect.poll(() => parentOf("After the delete")).toBe(work);
    await client.close();
  });

  await test.step("on the phone the field tops the to-do, and the step's sheet offers Move to…", async () => {
    await phoneWindow(app, page);
    await expect(upNext()).toBeVisible();
    await capture("Thought on the phone");
    await expect(page.getByRole("button", { name: "Sort 1" })).toBeVisible();
    await page.screenshot({ path: `${shots}/inbox-phone-todo.png` });

    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("menu", { name: "Home" }).getByRole("menuitem", { name: "Graph" }).click();
    await expect(step("Thought on the phone")).toBeVisible();
    await step("Thought on the phone").getByRole("button", { name: "Actions" }).click();
    await page.screenshot({ path: `${shots}/inbox-phone-sheet.png` });
    await page.getByLabel("Move to…").selectOption({ label: "Work" });
    await expect.poll(() => parentOf("Thought on the phone")).toBe(work);
    await expect(page.getByLabel("Move to…")).toHaveCount(0); // the sheet closed
  });

  expect(pageErrors).toEqual([]);
});
