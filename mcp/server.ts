// Ashborn's MCP server: lets an agent read and edit your quests, steps, links, routines and
// deadlines, signed in as you. Changes show up live in the app.
//
//   npm run agent:login   sign in once (the session is kept in ~/.config/ashborn/agent-session.json)
//   npm run -s agent      start the server on stdio (what an MCP client runs, see .mcp.json)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { prompter } from "../scripts/ask.mjs";
import { createApi, readKitchen } from "../src/lib/api";
import { buildGraphModel, isDone, questOf, statKeys, trainedStats, type GraphModel } from "../src/shared/graphModel";
import { daysBetween, toISODate, today, week, weekdayOf } from "../src/shared/dates";
import { DEFAULT_REMINDER, fromBase, mealDeductions, sameKind, shownMeal, toBase } from "../src/shared/kitchen";
import { nodeLevel } from "../src/shared/progression";
import { byTime, nextOccurrence } from "../src/shared/schedule";
import { mealSlots, questColors, stockUnits, type Delta, type Kitchen, type Recipe, type Snapshot, type StockItem, type StockUnit } from "../src/shared/types";

const sessionFile = process.env.ASHBORN_SESSION_FILE ?? path.join(homedir(), ".config", "ashborn", "agent-session.json");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.loadEnvFile(path.join(repoRoot, ".env"));
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storage: fileStorage(sessionFile), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const api = createApi(db);

if (process.argv[2] === "login") await login();
else await serve();

async function login() {
  const ask = await prompter();
  const email = await ask("Email: ");
  const password = await ask("Password: ", { hidden: true });
  const { error } = await db.auth.signInWithPassword({ email, password });
  db.auth.stopAutoRefresh();
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`Signed in. Agents can now use Ashborn as ${email}.`);
}

async function serve() {
  const { data } = await db.auth.getSession();
  if (!data.session) {
    console.error("Not signed in: run `npm run agent:login` first.");
    process.exit(1);
  }

  const server = new McpServer({ name: "ashborn", version: "0.1.0" });
  registerTools(server);
  await server.connect(new StdioServerTransport());
}

function registerTools(server: McpServer) {
  const id = z.string().describe("A node id, as shown by `overview`");
  const ids = z.array(z.string()).min(1).describe("Node ids, as shown by `overview`");
  const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("HH:MM, 24-hour local time");

  server.registerTool(
    "overview",
    {
      description:
        "Shows the user's tracker: steps ready to do now, every quest with its steps nested as an indented list (done steps marked [x], prerequisites shown as 'after'), hidden quests, today's routines and open deadlines, and the kitchen in short (stock, the next three days' meals, recipe titles). Ids in brackets are what the other tools take. Call this first.",
      inputSchema: { quest_id: z.string().optional().describe("Show only this quest") },
    },
    async ({ quest_id }) => text(describe(await api.getSnapshot(), quest_id)),
  );

  server.registerTool(
    "add_plan",
    {
      description:
        "Adds several steps at once, nested and linked: the main way to turn a plan into the graph. Each step has a short `ref` of your choosing; `parent` puts it inside another step (a ref from this call or an existing id), otherwise it goes under `parent_id`. `after` lists prerequisites that must be done first; they must share the step's parent. List parents before their steps. With parent_id null, top-level entries become new quests.",
      inputSchema: {
        parent_id: z.string().nullable().describe("Existing node the plan goes into, or null for new quests"),
        steps: z
          .array(
            z.object({
              ref: z.string().describe("Your label for this step, unique in this call"),
              title: z.string().describe("A few words (about 2 to 4): titles show on small cards in the graph"),
              parent: z.string().optional().describe("Ref or id of the step this one sits inside"),
              after: z.array(z.string()).optional().describe("Refs or ids of sibling prerequisites"),
            }),
          )
          .min(1),
      },
    },
    async ({ parent_id, steps }) => {
      const created = new Map<string, string>(); // ref → id
      const resolve = (refOrId: string) => created.get(refOrId) ?? refOrId;
      const problems: string[] = [];

      for (const step of steps) {
        if (step.parent && !created.has(step.parent) && steps.some((other) => other.ref === step.parent)) {
          return failure(`"${step.ref}" comes before its parent "${step.parent}"; list parents first. Nothing after it was added.`);
        }
        const delta = await api.createNode(step.title, step.parent ? resolve(step.parent) : parent_id);
        created.set(step.ref, delta.nodes![0].id);
      }
      for (const step of steps) {
        for (const prerequisite of step.after ?? []) {
          try {
            await api.addEdge({ from: resolve(prerequisite), to: created.get(step.ref)! });
          } catch (error) {
            problems.push(`${prerequisite} → ${step.ref}: ${(error as Error).message}`);
          }
        }
      }

      const lines = steps.map((step) => `${step.ref}: ${step.title} [${created.get(step.ref)}]`);
      return text(
        [`Added ${steps.length} steps:`, ...lines, ...(problems.length ? ["Links not made:", ...problems] : [])].join("\n"),
      );
    },
  );

  server.registerTool(
    "complete",
    { description: "Marks steps done.", inputSchema: { ids } },
    async ({ ids }) => run(ids.map((nodeId) => () => api.updateNode(nodeId, { done: true })), "Done"),
  );

  server.registerTool(
    "shelve",
    {
      description: "Shelves quests or steps: they stay on the graph, greyed, and nothing inside them is offered as ready until they are unshelved.",
      inputSchema: { ids },
    },
    async ({ ids }) => run(ids.map((nodeId) => () => api.updateNode(nodeId, { shelved: true })), "Shelved"),
  );

  server.registerTool(
    "unshelve",
    { description: "Takes quests or steps off the shelf.", inputSchema: { ids } },
    async ({ ids }) => run(ids.map((nodeId) => () => api.updateNode(nodeId, { shelved: false })), "Unshelved"),
  );

  server.registerTool(
    "reopen",
    { description: "Marks done steps as not done.", inputSchema: { ids } },
    async ({ ids }) => run(ids.map((nodeId) => () => api.updateNode(nodeId, { done: false })), "Reopened"),
  );

  server.registerTool(
    "rename",
    { description: "Renames a quest or step. Keep titles to a few words: they show on small cards.", inputSchema: { id, title: z.string().min(1) } },
    async ({ id, title }) => run([() => api.updateNode(id, { title })], "Renamed"),
  );

  server.registerTool(
    "move",
    {
      description: "Moves a step (with its own steps) into another node, or makes it a quest with parent_id null. Its links are removed, since links only join steps in the same box.",
      inputSchema: { id, parent_id: z.string().nullable() },
    },
    async ({ id, parent_id }) => run([() => api.moveNode(id, parent_id)], "Moved"),
  );

  server.registerTool(
    "delete",
    { description: "Deletes a quest or step together with every step inside it. Cannot be undone.", inputSchema: { id } },
    async ({ id }) => run([() => api.deleteNode(id)], "Deleted"),
  );

  server.registerTool(
    "link",
    {
      description: "Makes `from` a prerequisite of `to`. Both must have the same parent; loops are refused.",
      inputSchema: { from: id, to: id },
    },
    async ({ from, to }) => run([() => api.addEdge({ from, to })], "Linked"),
  );

  server.registerTool(
    "unlink",
    { description: "Removes the prerequisite link from `from` to `to`.", inputSchema: { from: id, to: id } },
    async ({ from, to }) => run([() => api.removeEdge({ from, to })], "Unlinked"),
  );

  server.registerTool(
    "level_up",
    {
      description: "Logs a session of progress on a quest (10 XP), for work that did not complete a step.",
      inputSchema: { id },
    },
    async ({ id }) => run([() => api.levelUp(id, crypto.randomUUID())], "Levelled up"),
  );

  server.registerTool(
    "update_quest",
    {
      description:
        "Sets which stats a quest trains and how much, its colour (null is white), and whether it is shown on the dashboard. Each XP earned in the quest adds weight × XP to each stat.",
      inputSchema: {
        id,
        stat_weights: z
          .partialRecord(z.enum(statKeys), z.number().nonnegative())
          .optional()
          .describe('Weight per stat, e.g. {"INT": 0.2, "CHR": 0.1}; replaces the quest\'s weights, and {} trains nothing'),
        color: z.enum(questColors).nullable().optional(),
        shown: z.boolean().optional(),
      },
    },
    async ({ id, stat_weights, color, shown }) => run([() => api.updateNode(id, { statWeights: stat_weights, color, active: shown })], "Updated"),
  );

  server.registerTool(
    "add_deadline",
    {
      description: "Adds a dated obligation, optionally with an alarm at a time on its due day (rings on the phone).",
      inputSchema: { title: z.string().min(1), due_date: z.string().describe("YYYY-MM-DD"), alarm_time: clock.optional() },
    },
    async ({ title, due_date, alarm_time }) =>
      run([() => api.createDeadline({ id: crypto.randomUUID(), title, dueDate: due_date, alarmTime: alarm_time ?? null })], "Added deadline"),
  );

  server.registerTool(
    "add_alarm",
    {
      description:
        "Sets an alarm that rings on the user's phone, apart from any routine or deadline: in some minutes from now (a nap), once at a time (the next time the clock shows it), or recurring at a time on chosen weekdays (waking up). An alarm can be plain, or stop only after walking or sit-ups.",
      inputSchema: {
        label: z.string().optional(),
        in_minutes: z.number().int().positive().optional().describe("Ring this many minutes from now"),
        time: clock.optional().describe("Ring at this time (once, unless weekdays are given)"),
        weekdays: z.array(z.enum(week as [string, ...string[]])).optional().describe("Repeat on these days"),
        kind: z.enum(["plain", "walk", "situps"]).optional(),
      },
    },
    async ({ label, in_minutes, time, weekdays, kind }) => {
      if ((in_minutes === undefined) === (time === undefined)) return failure("Give either in_minutes or time.");
      if (weekdays?.length && !time) return failure("Recurring alarms need a time.");
      const recurring = Boolean(time && weekdays?.length);
      const at = recurring ? null : in_minutes !== undefined ? new Date(Date.now() + in_minutes * 60_000) : nextOccurrence(time!);
      return run(
        [
          () =>
            api.createAlarm({
              id: crypto.randomUUID(),
              label: label ?? "",
              kind: kind ?? "plain",
              at: at ? at.toISOString() : null,
              time: recurring ? time! : null,
              weekdays: recurring ? (weekdays as typeof week) : [],
              enabled: true,
            }),
        ],
        at ? `Alarm set for ${at.toLocaleString()}` : "Recurring alarm set",
      );
    },
  );

  server.registerTool(
    "add_routine",
    {
      description:
        "Adds a recurring task on chosen weekdays, with an optional if-then cue such as 'after dinner', and an optional time. With a time it can ring an alarm on the phone: plain, or one that only stops after walking or sit-ups (for waking up).",
      inputSchema: {
        title: z.string().min(1),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1),
        cue: z.string().optional(),
        time: clock.optional(),
        alarm: z.enum(["none", "plain", "walk", "situps"]).optional().describe("Needs a time"),
      },
    },
    async ({ title, weekdays, cue, time, alarm }) => {
      if (alarm && alarm !== "none" && !time) return failure("An alarm needs a time.");
      return run(
        [() => api.createRoutine({ id: crypto.randomUUID(), title, cue: cue ?? "", weekdays: weekdays as typeof week, time: time ?? null, alarm: alarm ?? "none" })],
        "Added routine",
      );
    },
  );

  // The Kitchen. Amounts are given and shown in the item's own unit (kg for rice); a recipe
  // amount may use another unit of the same kind (g), converted when it is saved.
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
  const slot = z.enum(mealSlots);
  const unit = z.enum(stockUnits);
  const recipeIds = z.array(z.string()).optional().describe("Recipe ids, as shown by `kitchen`");

  server.registerTool(
    "kitchen",
    {
      description:
        "Shows the kitchen in full: stock items with amounts and targets, the meal plan from 2 days ago to 6 ahead ([x] cooked, [-] cancelled, (default) when it comes from the default week), the default week, and every recipe with its text, tracked ingredients and reminders. Ids in brackets are what the kitchen tools take.",
      inputSchema: {},
    },
    async () => text(describeKitchen(await readKitchen(db))),
  );

  server.registerTool(
    "save_recipe",
    {
      description:
        "Creates a recipe, or replaces one when `id` is given: what you pass replaces that part (title, body, ingredients, reminders); what you leave out stays. `body` is free text for the reader, with any amounts and formatting. `ingredients` are only the tracked bulk staples cooking deducts from stock (rice, beans; never spices), each naming a stock item by id or name, in a unit of the item's kind. `reminders` are alarms rung for a planned meal using the recipe: `offset_minutes` (negative is earlier) from the meal's time, or from another reminder given by its `ref`. A new recipe with no reminders given gets one, 'Start prep', 45 minutes before the meal; pass [] for none.",
      inputSchema: {
        id: z.string().optional().describe("Recipe id to replace"),
        title: z.string().min(1).optional().describe("Needed for a new recipe"),
        body: z.string().optional(),
        ingredients: z
          .array(z.object({ item: z.string().describe("Stock item id or name"), amount: z.number().positive(), unit, name: z.string().optional().describe("Defaults to the item's name") }))
          .optional(),
        reminders: z
          .array(
            z.object({
              ref: z.string().describe("Your label for it, unique in this call"),
              label: z.string().min(1),
              offset_minutes: z.number().int(),
              from: z.string().optional().describe("Ref of the reminder this one is timed from; omit to time it from the meal"),
            }),
          )
          .optional(),
      },
    },
    async ({ id, title, body, ingredients, reminders }) => {
      const kitchen = await readKitchen(db);
      const existing = id ? kitchen.recipes.find((recipe) => recipe.id === id) : undefined;
      if (id && !existing) return failure(`No recipe ${id}.`);
      if (!title && !existing) return failure("A new recipe needs a title.");

      const resolved: Recipe["ingredients"] = ingredients ? [] : (existing?.ingredients ?? []);
      for (const ingredient of ingredients ?? []) {
        const item = findItem(kitchen.items, ingredient.item);
        if (!item) return failure(`No stock item "${ingredient.item}". Add it with add_stock_item first; spices and the like are not tracked.`);
        if (!sameKind(item.unit, ingredient.unit)) return failure(`${item.name} is counted in ${item.unit}, so ${ingredient.amount} ${ingredient.unit} cannot be used.`);
        resolved.push({ id: crypto.randomUUID(), itemId: item.id, name: ingredient.name ?? item.name, amount: toBase(ingredient.amount, ingredient.unit), unit: ingredient.unit });
      }

      const refs = new Map((reminders ?? []).map((reminder) => [reminder.ref, crypto.randomUUID()]));
      const unknown = (reminders ?? []).find((reminder) => reminder.from && !refs.has(reminder.from));
      if (unknown) return failure(`Reminder "${unknown.ref}" is timed from "${unknown.from}", which is not a ref in this call.`);
      const timed: Recipe["reminders"] = reminders
        ? reminders.map((reminder) => ({ id: refs.get(reminder.ref)!, label: reminder.label, offsetMinutes: reminder.offset_minutes, anchorId: reminder.from ? refs.get(reminder.from)! : null }))
        : (existing?.reminders ?? [{ id: crypto.randomUUID(), anchorId: null, ...DEFAULT_REMINDER }]);

      const recipe = { id: existing?.id ?? crypto.randomUUID(), title: title ?? existing!.title, body: body ?? existing?.body ?? "", ingredients: resolved, reminders: timed };
      return run([() => api.saveRecipe(recipe)], `Saved recipe ${recipe.title} [${recipe.id}]`);
    },
  );

  server.registerTool(
    "delete_recipe",
    { description: "Deletes a recipe. Meals that used it keep their description.", inputSchema: { id: z.string() } },
    async ({ id }) => run([() => api.deleteRecipe(id)], "Deleted recipe"),
  );

  server.registerTool(
    "add_stock_item",
    {
      description:
        "Starts tracking a bulk staple (a carbohydrate or protein source: rice, beans, lentils). Never spices or the like. `unit` is how it is shown; `target` (the amount to keep on hand) and `on_hand` are in that unit.",
      inputSchema: { name: z.string().min(1), unit, target: z.number().nonnegative(), on_hand: z.number().nonnegative().optional() },
    },
    async ({ name, unit, target, on_hand }) => {
      const id = crypto.randomUUID();
      const changes = [() => api.createStockItem({ id, name, unit, target: toBase(target, unit) })];
      if (on_hand) changes.push(() => api.setStock(crypto.randomUUID(), id, toBase(on_hand, unit)));
      return run(changes, `Added ${name} [${id}]`);
    },
  );

  server.registerTool(
    "update_stock_item",
    {
      description: "Renames a stock item, changes its target (in its unit), or its unit to another of the same kind (kg to g).",
      inputSchema: { id: z.string(), name: z.string().min(1).optional(), unit: unit.optional(), target: z.number().nonnegative().optional() },
    },
    async ({ id, name, unit, target }) => {
      const item = (await readKitchen(db)).items.find((candidate) => candidate.id === id);
      if (!item) return failure(`No stock item ${id}.`);
      return run([() => api.updateStockItem(id, { name, unit, target: target === undefined ? undefined : toBase(target, unit ?? item.unit) })], "Updated");
    },
  );

  server.registerTool(
    "delete_stock_item",
    { description: "Stops tracking a stock item. Recipe ingredients naming it stay, untracked.", inputSchema: { id: z.string() } },
    async ({ id }) => run([() => api.deleteStockItem(id)], "Deleted stock item"),
  );

  server.registerTool(
    "adjust_stock",
    {
      description: "Corrects a stock item by hand, in its unit: `set` the amount on hand (after counting), or `add` to it (a restock; negative takes some away).",
      inputSchema: { id: z.string(), set: z.number().nonnegative().optional(), add: z.number().optional() },
    },
    async ({ id, set, add }) => {
      if ((set === undefined) === (add === undefined)) return failure("Give either set or add.");
      const item = (await readKitchen(db)).items.find((candidate) => candidate.id === id);
      if (!item) return failure(`No stock item ${id}.`);
      const onHand = set !== undefined ? toBase(set, item.unit) : item.onHand + toBase(add!, item.unit);
      return run([() => api.setStock(crypto.randomUUID(), id, onHand)], `${item.name}: ${amount(onHand, item.unit)}`);
    },
  );

  server.registerTool(
    "plan_meals",
    {
      description:
        "Plans meals on dates: each a short description ('rice with butter beans') and optionally recipes. This replaces what those dates and slots showed (their own plan or the default week), and plans a cancelled meal again. A meal already cooked keeps its stock deduction.",
      inputSchema: { meals: z.array(z.object({ date, slot, description: z.string(), recipes: recipeIds })).min(1) },
    },
    async ({ meals }) =>
      run(
        meals.map((meal) => () => planMeal(meal.date, meal.slot, meal.description, meal.recipes ?? [], "planned")),
        `Planned ${meals.length} meal${meals.length === 1 ? "" : "s"}`,
      ),
  );

  server.registerTool(
    "cancel_meals",
    {
      description: "Cancels meals in advance (eating out), which also silences their reminders. Without `slots`, cancels the whole day. A cooked meal cannot be cancelled.",
      inputSchema: { date, slots: z.array(slot).optional() },
    },
    async ({ date, slots }) => {
      const kitchen = await readKitchen(db);
      return run(
        (slots ?? [...mealSlots]).map((each) => () => {
          const shown = shownMeal(kitchen, date, each);
          return planMeal(date, each, shown.description, shown.recipeIds, "cancelled");
        }),
        "Cancelled",
      );
    },
  );

  server.registerTool(
    "set_default_meals",
    {
      description: "Sets the default week: what a weekday's slot shows when its date has no meal planned. Planning a date overrides it for that date only.",
      inputSchema: {
        meals: z.array(z.object({ weekday: z.enum(week as [string, ...string[]]), slot, description: z.string(), recipes: recipeIds })).min(1),
      },
    },
    async ({ meals }) =>
      run(
        meals.map((meal) => () => api.setDefaultMeal({ weekday: meal.weekday as (typeof week)[number], slot: meal.slot, description: meal.description, recipeIds: meal.recipes ?? [] })),
        "Default week set",
      ),
  );

  server.registerTool(
    "cook_meal",
    {
      description: "Marks a meal cooked, which deducts its recipes' tracked ingredients from stock. Says which ingredients are no longer tracked.",
      inputSchema: { date, slot },
    },
    async ({ date, slot }) => {
      try {
        const { kitchen } = await api.cookMeal(date, slot, crypto.randomUUID());
        const { untracked } = mealDeductions(kitchen!, shownMeal(kitchen!, date, slot));
        return text(untracked.length ? `Cooked. Not deducted (no longer tracked): ${untracked.join(", ")}.` : "Cooked.");
      } catch (error) {
        return failure((error as Error).message);
      }
    },
  );

  server.registerTool(
    "uncook_meal",
    { description: "Unticks a cooked meal, putting back exactly what cooking it deducted.", inputSchema: { date, slot } },
    async ({ date, slot }) => run([() => api.uncookMeal(date, slot)], "Unticked"),
  );
}

// Plans or cancels a meal; a date with no meal of its own gets one with a new id
function planMeal(date: string, slot: (typeof mealSlots)[number], description: string, recipeIds: string[], status: "planned" | "cancelled") {
  return api.setMeal({ id: crypto.randomUUID(), date, slot, description, recipeIds, status });
}

const findItem = (items: StockItem[], idOrName: string) =>
  items.find((item) => item.id === idOrName) ?? items.find((item) => item.name.toLowerCase() === idOrName.trim().toLowerCase());

// An amount in base units, shown in a unit: "1.5 kg"
function amount(base: number, unit: StockUnit) {
  return `${Number(fromBase(base, unit).toFixed(3))} ${unit}`;
}

function describeKitchen(kitchen: Kitchen, short = false): string {
  const titleOf = (recipeId: string) => kitchen.recipes.find((recipe) => recipe.id === recipeId)?.title ?? "?";
  const lines: string[] = [
    "Stock:",
    ...(kitchen.items.length
      ? kitchen.items.map((item) => `- ${item.name} [${item.id}]: ${amount(item.onHand, item.unit)} of ${amount(item.target, item.unit)}`)
      : ["- nothing tracked"]),
    "",
    "Meal plan:",
  ];
  const days = short ? [0, 1, 2] : [-2, -1, 0, 1, 2, 3, 4, 5, 6];
  for (const offset of days) {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    const date = toISODate(day);
    for (const each of mealSlots) {
      const meal = shownMeal(kitchen, date, each);
      if (!meal.description && meal.recipeIds.length === 0 && meal.status === "planned") continue;
      const mark = meal.status === "cooked" ? "x" : meal.status === "cancelled" ? "-" : " ";
      const recipes = meal.recipeIds.length ? ` (recipes: ${meal.recipeIds.map((recipeId) => `${titleOf(recipeId)} [${recipeId}]`).join(", ")})` : "";
      lines.push(`- [${mark}] ${date} ${weekdayOf(date)} ${each}: ${meal.description || "(no description)"}${recipes}${meal.fromDefault ? " (default)" : ""}`);
    }
  }
  if (short) {
    lines.push("", "Recipes:", ...(kitchen.recipes.length ? kitchen.recipes.map((recipe) => `- ${recipe.title} [${recipe.id}]`) : ["- none"]));
    return lines.join("\n");
  }

  lines.push(
    "",
    "Default week:",
    ...(kitchen.defaultWeek.length
      ? kitchen.defaultWeek.map((meal) => `- ${meal.weekday} ${meal.slot}: ${meal.description}${meal.recipeIds.length ? ` (recipes: ${meal.recipeIds.map(titleOf).join(", ")})` : ""}`)
      : ["- not set"]),
    "",
    "Recipes:",
  );
  for (const recipe of kitchen.recipes) {
    const labelOf = (reminderId: string) => recipe.reminders.find((reminder) => reminder.id === reminderId)?.label ?? "?";
    lines.push(
      `## ${recipe.title} [${recipe.id}]`,
      ...recipe.ingredients.map((ingredient) => {
        const item = kitchen.items.find((candidate) => candidate.id === ingredient.itemId);
        return `- ${ingredient.name}: ${amount(ingredient.amount, ingredient.unit)}${item ? "" : " (untracked)"}`;
      }),
      ...recipe.reminders.map((reminder) => `- reminder "${reminder.label}": ${reminder.offsetMinutes} min from ${reminder.anchorId ? `"${labelOf(reminder.anchorId)}"` : "the meal"}`),
      recipe.body,
      "",
    );
  }
  return lines.join("\n");
}

// Runs changes one after another and stops at the first that fails
async function run(changes: Array<() => Promise<Delta>>, done: string) {
  try {
    for (const change of changes) await change();
    return text(`${done}.`);
  } catch (error) {
    return failure((error as Error).message);
  }
}

// The tracker as an indented outline an agent can read
function describe(snapshot: Snapshot, questId?: string) {
  const model = buildGraphModel(snapshot);
  const quests = (model.children.get(null) ?? []).filter((quest) => (questId ? quest.id === questId : true));
  const shown = quests.filter((quest) => quest.active);
  const hidden = quests.filter((quest) => !quest.active);
  const lines: string[] = [];

  const shownIds = new Set(shown.map((quest) => quest.id));
  const ready = snapshot.nodes.filter((node) => node.parentId && model.ready.has(node.id) && shownIds.has(questOf(model.byId, node).id));
  lines.push("Up next (ready to do now):", ...(ready.length ? ready.map((node) => `- ${node.title} [${node.id}]`) : ["- nothing"]), "");

  for (const quest of shown) {
    const level = nodeLevel(model.totalXp.get(quest.id) ?? 0);
    const trains = trainedStats(quest.statWeights).map(([key, weight]) => `${key} ${weight}`);
    lines.push(`# ${quest.title} [${quest.id}] Lv ${level.level}${trains.length ? `, trains ${trains.join(", ")}` : ""}${quest.color ? `, ${quest.color}` : ""}${quest.shelved ? " (shelved)" : ""}`);
    outline(model, snapshot, quest.id, 1, lines);
    lines.push("");
  }
  if (hidden.length) lines.push("Hidden quests:", ...hidden.map((quest) => `- ${quest.title} [${quest.id}]${quest.shelved ? " (shelved)" : ""}`), "");

  if (!questId) {
    const weekday = weekdayOf(today());
    const routines = snapshot.routines.filter((routine) => routine.weekdays.includes(weekday)).sort(byTime);
    const checked = new Set(snapshot.routineChecks.map((check) => check.routineId));
    lines.push(
      "Routines today:",
      ...(routines.length
        ? routines.map(
            (routine) =>
              `- [${checked.has(routine.id) ? "x" : " "}] ${routine.time ? `${routine.time} ` : ""}${routine.title}${routine.cue ? ` (${routine.cue})` : ""}${routine.alarm !== "none" ? ` [alarm: ${routine.alarm}]` : ""}`,
          )
        : ["- none"]),
      "",
      "Alarms:",
      ...(snapshot.alarms.length
        ? snapshot.alarms.map(
            (alarm) =>
              `- [${alarm.enabled ? "on" : "off"}] ${alarm.at ? `once at ${new Date(alarm.at).toLocaleString()}` : `${alarm.time} on ${alarm.weekdays.join(" ")}`} ${alarm.label || "Alarm"}${alarm.kind !== "plain" ? ` (${alarm.kind})` : ""}`,
          )
        : ["- none"]),
      "",
      "Open deadlines:",
      ...(snapshot.deadlines.length
        ? snapshot.deadlines.map(
            (deadline) =>
              `- ${deadline.title}: due ${deadline.dueDate} (in ${daysBetween(today(), deadline.dueDate)} days)${deadline.alarmTime ? `, alarm at ${deadline.alarmTime}` : ""}`,
          )
        : ["- none"]),
      "",
      "Kitchen (more with the kitchen tool):",
      describeKitchen(snapshot.kitchen, true),
    );
  }

  return lines.join("\n");
}

function outline(model: GraphModel, snapshot: Snapshot, parentId: string, depth: number, lines: string[]) {
  for (const step of model.children.get(parentId) ?? []) {
    const after = snapshot.edges.filter((edge) => edge.to === step.id).map((edge) => model.byId.get(edge.from)?.title);
    lines.push(`${"  ".repeat(depth - 1)}- [${isDone(step) ? "x" : " "}] ${step.title} [${step.id}]${after.length ? ` (after: ${after.join("; ")})` : ""}${step.shelved ? " (shelved)" : ""}`);
    outline(model, snapshot, step.id, depth + 1, lines);
  }
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// Keeps the Supabase session in a file only the user can read, so the agent stays signed in
function fileStorage(file: string): SupportedStorage {
  const read = (): Record<string, string> => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  const write = (items: Record<string, string>) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(items), { mode: 0o600 });
    chmodSync(file, 0o600);
  };

  return {
    getItem: (key) => read()[key] ?? null,
    setItem: (key, value) => write({ ...read(), [key]: value }),
    removeItem: (key) => {
      const { [key]: _removed, ...rest } = read();
      write(rest);
    },
  };
}
