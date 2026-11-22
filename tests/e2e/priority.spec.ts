import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { addDays, today } from "../../src/shared/dates";

// Priorities: a chain's priority reaches its prerequisites, only ready covered steps are on the
// to-do, chains float up, and a linked deadline raises one. Also takes the graph's screenshot.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const shots = "research/graph-layout/shots";

let app: ElectronApplication;
let page: Page;
let profile: string;
const uuid = () => crypto.randomUUID();
const ids = { ddp: uuid(), placement: uuid(), bsc: uuid(), survey: uuid(), part2: uuid(), slides: uuid(), notes: uuid(), apply: uuid(), course: uuid(), quiz: uuid() };

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  for (const table of ["graph_nodes", "routines", "deadlines", "events", "alarms"]) await db.from(table).delete().not("id", "is", null);
  const insert = async (table: string, rows: Array<Record<string, unknown>>) => {
    const { error: insertError } = await db.from(table).insert(rows);
    if (insertError) throw insertError;
  };
  await insert("graph_nodes", [
    { id: ids.ddp, title: "DDP Work", parent_id: null },
    { id: ids.placement, title: "Placement", parent_id: null },
    { id: ids.bsc, title: "Online BSc", parent_id: null },
  ]);
  const step = (id: string, title: string, parent_id: string) => ({ id, title, parent_id });
  await insert("graph_nodes", [
    step(ids.survey, "Review the survey", ids.ddp),
    step(ids.part2, "Presentation part 2", ids.ddp),
    step(ids.slides, "Presentation part 1", ids.ddp),
    step(ids.notes, "Rewrite notes", ids.placement),
    step(ids.apply, "Apply to DTL", ids.placement),
    step(ids.course, "Course 1", ids.bsc),
    step(ids.quiz, "Practice quiz", ids.bsc),
  ]);
  await insert("graph_edges", [
    { from_id: ids.survey, to_id: ids.part2 },
    { from_id: ids.course, to_id: ids.quiz },
  ]);

  profile = mkdtempSync(path.join(tmpdir(), "ashborn-e2e-"));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.ASHBORN_BACKUP_DIR = path.join(profile, "backups");
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, "."], env });
  page = await app.firstWindow();
  // The whole to-do in Now, not only its first rows
  await page.evaluate(() => localStorage.setItem("ashborn-show-all-todo", "1"));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(profile, { recursive: true, force: true });
});

const upNext = () => page.getByRole("region", { name: "Now" });
const quest = (title: string) => page.locator(".react-flow__node-quest", { hasText: title });
const canvasXY = async (title: string) => {
  const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((await quest(title).evaluate((el) => (el as HTMLElement).style.transform)))!;
  return { x: Number(x), y: Number(y) };
};

test("priorities", async () => {
  await test.step("with none set, the to-do is empty and nothing is marked", async () => {
    await page.getByPlaceholder("Email").fill(process.env.E2E_EMAIL!);
    await page.getByPlaceholder("Password").fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(quest("DDP Work")).toBeVisible({ timeout: 20_000 });
    await expect(upNext()).toContainText("Nothing with a priority is ready");
    await expect(page.locator(".react-flow__node [data-priority]")).toHaveCount(0);
  });

  await test.step("a priority set on a step in the app reaches its prerequisite: the prerequisite is on the to-do, the step is not yet", async () => {
    const row = page.locator(".react-flow__node", { hasText: "Presentation part 2" }).last();
    await row.hover();
    await row.getByTitle("Priority").click();
    await page.getByRole("radio", { name: "Priority 2" }).click();
    await expect(upNext()).toContainText("Review the survey");
    await expect(upNext()).not.toContainText("Presentation part 2");
    await expect(upNext()).not.toContainText("Presentation part 1");
    await expect(upNext()).not.toContainText("Rewrite notes");
    await page.locator(".react-flow__pane").click({ position: { x: 5, y: 400 } });
  });

  await test.step("inside a box the prioritised chain sits above an unprioritised step", async () => {
    const top = async (title: string) => (await page.locator(".react-flow__node", { hasText: title }).last().boundingBox())!.y;
    await expect.poll(async () => (await top("Review the survey")) < (await top("Presentation part 1"))).toBe(true);
  });

  await test.step("a more urgent quest floats to the top left and leads the to-do", async () => {
    await db.from("graph_nodes").update({ priority: 1 }).eq("id", ids.bsc);
    await expect(upNext().getByRole("listitem").first()).toContainText("Course 1", { timeout: 10_000 });
    await expect.poll(async () => (await canvasXY("Online BSc")).x).toBe(0);
    expect((await canvasXY("Online BSc")).y).toBe(0);
    await expect(upNext()).toContainText("Course 1");
    await expect(upNext()).not.toContainText("Practice quiz");
    // The quest is marked; its steps carry its priority without a mark of their own
    await expect(quest("Online BSc").locator("[data-priority]")).toHaveAttribute("data-priority", "1");
    await expect(page.locator(".react-flow__node-step", { hasText: "Course 1" }).locator("[data-priority]")).toHaveCount(0);
  });

  await test.step("a deadline linked in the app only groups: its chain stays off Now", async () => {
    await db.from("deadlines").insert({ title: "Apply by", due_date: addDays(today(), 3) });
    const picker = page.locator("section", { hasText: "Routines" }).last().getByLabel("Deadline for");
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.selectOption(ids.apply);
    await expect.poll(async () => (await db.from("deadlines").select("node_id").eq("title", "Apply by").single()).data?.node_id).toBe(ids.apply);
    await expect(upNext()).not.toContainText("Apply to DTL");
  });

  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shots}/priority.png` });
});
