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
  const { error: skipsError } = await db.from("alarm_skips").delete().not("key", "is", null);
  if (skipsError) throw skipsError;

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
    expect(body.split("\n\n")[1]).toContain("PCA from scratch");
    expect(body.split("\n\n")[1]).not.toContain("Kernel trick");
  });

  await test.step("loops and moving a node inside itself are refused", async () => {
    expect(await call("link", { from: id("kernel"), to: id("pca") })).toEqual({ ok: false, body: "That link would make a loop." });
    expect(await call("move", { id: id("dl"), parent_id: id("pca") })).toEqual({ ok: false, body: "A node cannot move inside itself." });
  });

  await test.step("mistakes are refused before anything changes, and say what they are", async () => {
    const count = async () => (await db.from("graph_nodes").select("*", { count: "exact", head: true })).count;
    const before = await count();
    expect(await call("add_plan", { parent_id: null, steps: [{ ref: "a", title: "A" }, { ref: "a", title: "B" }] })).toEqual({ ok: false, body: "Each ref must be unique in the call; repeated: a. Nothing was added." });
    expect((await call("add_plan", { parent_id: null, steps: [{ ref: "a", title: "A" }, { ref: "b", title: "B", parent: "typo" }] })).body).toBe("Not a ref in this call nor a quest or step: typo. Nothing was added.");
    expect((await call("add_plan", { parent_id: null, steps: [{ ref: "a", title: "A", after: ["b"] }, { ref: "b", title: "B", after: ["a"] }] })).body).toBe('The `after` links make a loop through "a".\nNothing was added.');
    expect((await call("add_plan", { parent_id: null, steps: [{ ref: "a", title: "A" }, { ref: "b", title: "B", parent: "a" }, { ref: "c", title: "C", after: ["b"] }] })).body).toBe('"c" can\'t come after "b": only steps in the same box can be linked.\nNothing was added.');
    expect((await call("add_plan", { parent_id: null, steps: [{ ref: "a", title: "  " }] })).ok).toBe(false);
    expect(await count()).toBe(before);
    expect((await call("delete_recipe", { id: id("pca") })).body).toBe(`No recipe ${id("pca")}.`);
    const { data: deadline } = await db.from("deadlines").insert({ title: "Not a step", due_date: "2099-01-01" }).select("id").single();
    expect((await call("complete", { ids: [id("pca"), deadline!.id] })).body).toBe(`Not a quest or step: ${deadline!.id}. Nothing was changed.`);
    expect((await db.from("graph_nodes").select("completed_at").eq("id", id("pca")).single()).data?.completed_at).toBeNull();
    await db.from("deadlines").delete().eq("id", deadline!.id);
    expect((await call("unlink", { from: id("kernel"), to: id("pca") })).body).toBe(`No link from ${id("kernel")} to ${id("pca")}.`);
    expect((await call("overview", { quest_id: id("pca") })).body).toBe(`${id("pca")} is not a quest; give a quest's id, or none for everything.`);
    expect((await call("update_quest", { id: id("pca"), shown: false })).body).toBe(`${id("pca")} is not a quest.`);
    expect((await call("add_alarm", { time: "07:00", date: "2026-02-30" })).ok).toBe(false);
  });

  await test.step("complete, level up, stat weights, deadline, move", async () => {
    expect((await call("complete", { ids: [id("pca")] })).ok).toBe(true);
    expect((await call("update_quest", { id: id("dl"), stat_weights: { INT: 0.2, CHR: 0.1, MND: 0 } })).ok).toBe(true);
    expect((await call("level_up", { id: id("dl") })).ok).toBe(true);
    expect((await call("add_deadline", { title: "Submit draft", due_date: "2099-01-01" })).ok).toBe(true);
    // An alarm on a due day already gone would never ring
    const late = await call("add_deadline", { title: "Too late", due_date: "2020-01-01", alarm_time: "09:00" });
    expect(late.ok).toBe(false);
    expect(late.body).toContain("has passed");
    expect((await call("move", { id: id("svm"), parent_id: id("kpca") })).ok).toBe(true);

    const { body } = await call("overview", { quest_id: id("dl") });
    expect(body).toMatch(/trains INT 0\.2, CHR 0\.1$/m); // a zero weight is not stored
    expect(body).toContain("- [x] PCA from scratch");
    expect(body).toMatch(/^ {2}- \[ \] Support vector machines/m); // now inside Kernel PCA, link dropped
    expect(body).not.toMatch(/Support vector machines.*after/);
  });

  await test.step("a priority is set, shown, stored, refused out of range, and removed", async () => {
    const prioritised = await call("set_priority", { ids: [id("kpca")], priority: 2 });
    expect(prioritised.body).toMatch(/Kernel PCA \[[^\]]+\]: P2, set on it/);
    let { body } = await call("overview", { quest_id: id("dl") });
    expect(body).toMatch(/Kernel PCA \[[^\]]+\] P2/);
    expect((await call("set_priority", { ids: [id("kpca")], priority: 5 })).ok).toBe(false);
    expect((await call("set_priority", { ids: [id("kpca")], priority: null })).ok).toBe(true);
    ({ body } = await call("overview", { quest_id: id("dl") }));
    expect(body).not.toMatch(/Kernel PCA \[[^\]]+\] P/);
  });

  await test.step("a deadline links to a step and raises nothing; unlinking, changing and deleting work, and `delete` refuses it", async () => {
    const soon = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await call("add_deadline", { title: "Soon", due_date: soon, node_id: id("kernel") })).ok).toBe(true);
    let { body } = await call("overview");
    expect(body.split("\n\n")[0]).not.toContain("Kernel trick");
    expect(body).toContain(", linked to Kernel trick: due");
    expect((await call("overview", { quest_id: id("dl") })).body).toMatch(/^Deadlines linked to this quest:\n- Soon \[/m);
    const deadlineId = /- Soon \[([^\]]+)\]/.exec(body)![1];
    expect((await call("update_deadline", { id: deadlineId, node_id: null })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).toMatch(/- Soon \[[^\]]+\]: due/);
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await call("update_deadline", { id: deadlineId, title: "Sooner", due_date: later })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).toContain(`- Sooner [${deadlineId}]: due ${later}`);

    // `delete` takes only quests and steps; a deadline has its own, which refuses an unknown id
    expect((await call("delete", { id: deadlineId })).ok).toBe(false);
    expect((await call("delete_deadline", { id: deadlineId })).ok).toBe(true);
    expect((await call("delete_deadline", { id: deadlineId })).ok).toBe(false);
    expect((await call("overview")).body).not.toContain("- Sooner [");
  });

  await test.step("a shelved step is marked, and nothing inside it is up next until it is unshelved", async () => {
    expect((await call("shelve", { ids: [id("kpca")] })).ok).toBe(true);
    let { body } = await call("overview", { quest_id: id("dl") });
    expect(body).toMatch(/Kernel PCA \[[^\]]+\] \(shelved\)/);
    expect(body.split("\n\n")[1]).not.toContain("Kernel trick");
    expect((await call("unshelve", { ids: [id("kpca")] })).ok).toBe(true);
    ({ body } = await call("overview", { quest_id: id("dl") }));
    expect(body).not.toContain("(shelved)");
    expect(body.split("\n\n")[1]).toContain("Kernel trick");
  });

  await test.step("finished before today: a box is one line, a quest moves to Completed, and asking for it shows it whole", async () => {
    const added = await call("add_plan", {
      parent_id: null,
      steps: [
        { ref: "errands", title: "Errands" },
        { ref: "cv", title: "Send CV", parent: "errands" },
        { ref: "admin", title: "Admin" },
        { ref: "papers", title: "Paperwork", parent: "admin" },
        { ref: "form", title: "Fill the form", parent: "papers" },
        { ref: "post", title: "Post the form", parent: "papers" },
        { ref: "stamps", title: "Buy stamps", parent: "admin" },
      ],
    });
    const ref = (name: string) => added.body.match(new RegExp(`^${name}: .*\\[([0-9a-f-]+)\\]`, "m"))![1];
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await db.from("graph_nodes").update({ completed_at: twoDaysAgo }).in("id", ["cv", "papers", "form", "post"].map(ref));

    let { body } = await call("overview");
    expect(body).not.toContain("# Errands");
    expect(body).toMatch(/^Completed quests.*\n- Errands \[/m);
    expect(body).toMatch(/Paperwork \[[^\]]+\] \(finished: 2 steps folded\)/);
    expect(body).not.toContain("Fill the form");
    ({ body } = await call("overview", { quest_id: ref("errands") }));
    expect(body).toContain("# Errands");
    expect(body).toContain("- [x] Send CV");
    expect((await call("delete", { id: ref("errands") })).ok).toBe(true);
    expect((await call("delete", { id: ref("admin") })).ok).toBe(true);
  });

  await test.step("alarms: in some minutes, on a date, or recurring with a challenge; and deleted", async () => {
    const nap = await call("add_alarm", { label: "Nap", in_minutes: 40 });
    expect(nap.ok).toBe(true);
    // The agent is told the phone may not have it yet
    expect(nap.body).toContain("open Ashborn on the phone");
    expect((await call("add_alarm", { label: "Wake", time: "06:00", weekdays: ["Mon", "Wed"], kind: "situps" })).ok).toBe(true);
    expect((await call("add_alarm", { label: "Bad", weekdays: ["Mon"] })).ok).toBe(false);
    expect((await call("add_alarm", { label: "Past", time: "16:00", date: "2020-01-01" })).ok).toBe(false);
    expect((await call("add_alarm", { label: "Dentist", time: "16:00", date: "2099-11-05" })).ok).toBe(true);
    let { body } = await call("overview");
    expect(body).toMatch(/\[on\] once at .* Nap \[/);
    expect(body).toMatch(/\[on\] 06:00 on Mon Wed Wake \[[^\]]+\] \(situps\)/);
    expect(body).toMatch(/\[on\] once at .*2099.* Dentist \[/);
    const dentist = /Dentist \[([^\]]+)\]/.exec(body)![1];
    expect((await call("delete_alarm", { id: dentist })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).not.toContain("Dentist");
  });

  await test.step("a routine's ring is skipped or moved on one date only, restored, and the routine edited keeping its ticks", async () => {
    // Two days ahead, so neither ring has passed whatever the hour
    const ahead = new Date();
    ahead.setDate(ahead.getDate() + 2);
    const day = `${ahead.getFullYear()}-${String(ahead.getMonth() + 1).padStart(2, "0")}-${String(ahead.getDate()).padStart(2, "0")}`;
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][ahead.getDay()];
    const all = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    expect((await call("add_routine", { title: "Portal check", weekdays: all, time: "19:00", alarm: "plain", cue: "after tea" })).ok).toBe(true);
    let { body } = await call("overview");
    const routine = /Portal check \[([^\]]+)\]/.exec(body)![1];
    expect(body).toContain(`19:00 Portal check [${routine}] on Mon Tue Wed Thu Fri Sat Sun (after tea) (alarm: plain) today [ ]`);
    const skips = async () => (await db.from("alarm_skips").select("key").eq("skipped", true)).data!.map((row) => row.key);

    expect((await call("skip_ring", { id: routine, date: day })).ok).toBe(true);
    expect(await skips()).toEqual([`routine:${routine}@${day}`]);
    ({ body } = await call("overview"));
    expect(body).toContain(`- ${day} Portal check [${routine}]`);
    expect((await call("restore_ring", { id: routine, date: day })).ok).toBe(true);
    expect(await skips()).toEqual([]);

    const moved = await call("skip_ring", { id: routine, date: day, instead_at: "20:30" });
    expect(moved.ok, moved.body).toBe(true);
    const replacement = (await db.from("alarms").select("label, at, kind").eq("label", "Portal check (moved from 19:00)").single()).data!;
    const at = new Date(replacement.at);
    expect([at.getDate(), at.getHours(), at.getMinutes(), replacement.kind]).toEqual([ahead.getDate(), 20, 30, "plain"]);
    // A second skip of the same date would leave the first move's alarm ringing too
    const again = await call("skip_ring", { id: routine, date: day, instead_at: "21:00" });
    expect(again.ok).toBe(false);
    expect(again.body).toContain("already skipped");
    expect((await db.from("alarms").select("id").like("label", "Portal check (moved%")).data).toHaveLength(1);
    expect((await call("restore_ring", { id: routine, date: day })).ok).toBe(true);
    expect((await db.from("alarms").select("id").eq("label", "Portal check (moved from 19:00)")).data).toEqual([]);

    const notThatDay = all.filter((name) => name !== weekday);
    expect((await call("update_routine", { id: routine, weekdays: notThatDay })).ok).toBe(true);
    expect((await call("skip_ring", { id: routine, date: day })).body).toContain("does not ring on");
    expect((await call("update_routine", { id: routine, time: null })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).toMatch(new RegExp(`- Portal check \\[${routine}\\] on ${notThatDay.join(" ")} \\(after tea\\)`));
    expect(body).not.toContain("(alarm: plain)");
    expect((await call("update_routine", { id: routine, alarm: "walk" })).body).toBe("An alarm needs a time.");
  });

  await test.step("delete removes a step with everything inside it", async () => {
    expect((await call("delete", { id: id("kpca") })).ok).toBe(true);
    const { body } = await call("overview");
    expect(body).not.toContain("Kernel");
    expect(body).toContain("Submit draft");
  });

  await test.step("completing a box completes every open step inside it; reopening it reopens only the box", async () => {
    const added = await call("add_plan", {
      parent_id: null,
      steps: [
        { ref: "pointers", title: "Two pointers" },
        { ref: "set", title: "Problem set", parent: "pointers" },
        { ref: "p1", title: "Problem 1", parent: "set" },
        { ref: "p2", title: "Problem 2", parent: "set" },
        { ref: "deeper", title: "Variants", parent: "set" },
        { ref: "p3", title: "Problem 3", parent: "deeper" },
        { ref: "later", title: "Write it up", parent: "pointers" },
      ],
    });
    const ref = (name: string) => added.body.match(new RegExp(`^${name}: .*\\[([0-9a-f-]+)\\]`, "m"))![1];
    expect((await call("complete", { ids: [ref("set")] })).ok).toBe(true);
    let { body } = await call("overview", { quest_id: ref("pointers") });
    for (const title of ["Problem set", "Problem 1", "Problem 2", "Variants", "Problem 3"]) expect(body).toContain(`- [x] ${title}`);
    expect(body).toContain("- [ ] Write it up");
    expect((await call("reopen", { ids: [ref("set")] })).ok).toBe(true);
    ({ body } = await call("overview", { quest_id: ref("pointers") }));
    expect(body).toContain("- [ ] Problem set");
    expect(body).toContain("- [x] Problem 1");
    // Reopening what is open leaves it, and says so
    expect((await call("reopen", { ids: [ref("later")] })).body).toBe(`Reopened. Not done, so left as they were: ${ref("later")}.`);
    // A quest is never ticked: completing it completes its steps, and it is finished
    expect((await call("complete", { ids: [ref("pointers")] })).ok).toBe(true);
    expect((await db.from("graph_nodes").select("completed_at").eq("id", ref("pointers")).single()).data?.completed_at).toBeNull();
    expect((await db.from("graph_nodes").select("id").eq("parent_id", ref("pointers")).is("completed_at", null)).data).toEqual([]);
    expect((await call("delete", { id: ref("pointers") })).ok).toBe(true);
  });

  await test.step("kitchen: a recipe deducts its tracked ingredients when its meal is cooked, and unticking restores them", async () => {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    const added = await call("add_stock_item", { name: "Rice", unit: "kg", target: 2, on_hand: 1.5 });
    const riceId = added.body.match(/Rice \[([^\]]+)\]/)![1];
    // One item per name, whatever its case or spaces
    const twice = await call("add_stock_item", { name: " rice ", unit: "g", target: 500 });
    expect(twice.ok).toBe(false);
    expect(twice.body).toContain("already tracked");

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
    // Cooked once only: a second cook is refused, and takes nothing more
    expect((await call("cook_meal", { date: today, slot: "lunch" })).body).toBe(`The lunch of ${today} is already cooked.`);
    expect((await call("kitchen")).body).toContain(`Rice [${riceId}]: 1.3 kg of 2 kg`);
    expect((await call("uncook_meal", { date: today, slot: "lunch" })).ok).toBe(true);
    expect((await call("kitchen")).body).toContain(`Rice [${riceId}]: 1.5 kg of 2 kg`);
    expect((await call("uncook_meal", { date: today, slot: "lunch" })).body).toBe(`The lunch of ${today} is not cooked.`);

    expect((await call("adjust_stock", { id: riceId, set: 5 })).body).toBe("Rice: 5 kg.");
    expect((await call("cancel_meals", { date: today })).ok).toBe(true);
    ({ body } = await call("overview"));
    expect(body).toContain(`- [-] ${today}`);
    expect(body).toContain("Rice and beans [");

    // A dropped stock item leaves its ingredient untracked; cooking says so and deducts the rest
    expect((await call("plan_meals", { meals: [{ date: today, slot: "dinner", description: "rice", recipes: [recipeId] }] })).ok).toBe(true);
    expect((await call("delete_stock_item", { id: riceId })).ok).toBe(true);
    expect((await call("cook_meal", { date: today, slot: "dinner" })).body).toBe("Cooked. Not deducted (no longer tracked): Rice.");

    // Cancelling the whole day leaves the cooked meal; naming it is refused
    expect((await call("cancel_meals", { date: today })).body).toBe("Cancelled the breakfast and lunch; the dinner was cooked and stays.");
    expect((await call("cancel_meals", { date: today, slots: ["dinner"] })).body).toBe(`Cooked, so not cancelled: the dinner of ${today}; unmark it first. Nothing was changed.`);

    // Cooking a meal past the days the Kitchen holds reports that meal's own ingredients
    const later = new Date(Date.parse(`${today}T12:00:00Z`) + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await call("plan_meals", { meals: [{ date: later, slot: "dinner", description: "rice", recipes: [recipeId] }] })).ok).toBe(true);
    expect((await call("cook_meal", { date: later, slot: "dinner" })).body).toBe("Cooked. Not deducted (no longer tracked): Rice.");
  });
});
