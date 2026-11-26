// Ashborn's agent tools: read and edit quests, steps, links, routines, deadlines, alarms and the
// Kitchen, as the signed-in user. Served on stdio from the laptop (mcp/server.ts) and over HTTP as
// the hosted connector (mcp/connector.ts).
//
// registerTools registers every tool, in groups: the overview, the graph, deadlines, alarms,
// routines, skipping and restoring rings, then the Kitchen (its view first). Every change goes through the app's own API
// (src/lib/api.ts), so it keeps the same rules and stamps as a change made in the app. A tool checks
// what it can before changing anything; a change of several parts refused partway says what was
// already done. Replies are
// plain sentences of what changed, or why not (run, failure). describe, near the end, writes the
// overview an agent reads first.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createApi, readKitchen } from "../src/lib/api";
import { buildGraphModel, isDone, isFinished, questOf, statKeys, trainedStats, type GraphModel } from "../src/shared/graphModel";
import { addDays, atTime, clockAfter, clockOf, currentTimeZone, daysBetween, minutesFrom, today, toISODate, week, weekdayOf } from "../src/shared/dates";
import { DEFAULT_REMINDER, fromBase, mealDeductions, sameKind, sameName, shownMeal, toBase } from "../src/shared/kitchen";
import { nodeLevel } from "../src/shared/progression";
import { byTime, movedLabel, nextOccurrence } from "../src/shared/schedule";
import { derivePriorities, needsFirstStep, prioritisedSteps, type Priorities } from "../src/shared/priority";
import { goneQuiet } from "../src/shared/goneQuiet";
import { EVENT_DETAILS_MAX, mealDaysAhead, mealDaysBack, mealSlots, stockUnits, type Alarm, type AlarmPatch, type EventPatch, type ScheduleEvent, type AshbornApi, type Delta, type GraphNode, type Kitchen, type Priority, type Recipe, type DeadlinePatch, type RoutinePatch, type Snapshot, type StockItem, type StockUnit } from "../src/shared/types";

// Bounds on what one call may carry, generous for a plan or a week of meals, so a call can't ask for
// unbounded work: ids and refs, titles and short texts, a recipe's method, and any list
const ID_MAX = 64;
const TITLE_MAX = 300;
const DESCRIPTION_MAX = 4000; // as the database allows
const BODY_MAX = 20_000;
const LIST_MAX = 300;

// Ends every reply that sets something to ring (run adds the full stop): how soon the phone learns of it
const RINGS_ON_PHONE =
  "The phone is pushed the change at once; asleep, it gets it at once if a ring is due within 20 minutes, else within about 15 minutes (Settings > Sync now on the phone shows what it holds)";

// The tools, acting as whoever `db` is signed in as. `blocked` gives a reason every tool refuses
// with, or null.
export function registerTools(server: McpServer, db: SupabaseClient, blocked: () => string | null = () => null) {
  const api = createApi(db);
  const register = ((name: string, config: unknown, handler: (...args: unknown[]) => unknown) =>
    server.registerTool(name, config as never, ((...args: unknown[]) => {
      const reason = blocked();
      return reason ? failure(reason) : handler(...args);
    }) as never)) as McpServer["registerTool"];

  const id = z.string().max(ID_MAX).describe("A node id, as shown by `overview`");
  const ids = z.array(z.string().max(ID_MAX)).min(1).max(LIST_MAX).describe("Node ids, as shown by `overview`");
  const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("HH:MM, 24-hour local time");
  // A day that exists: 2026-02-30 would roll over into March
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((day) => {
      const midnight = new Date(`${day}T00:00:00Z`);
      return !Number.isNaN(midnight.getTime()) && midnight.toISOString().startsWith(day);
    }, "Not a day of the calendar")
    .describe("YYYY-MM-DD");
  // Which of `nodeIds` are done: ticking a done step again would move its completion to now, and
  // count it in today's progress a second time
  const doneIds = async (nodeIds: string[]) =>
    new Set(((await db.from("graph_nodes").select("id").in("id", nodeIds).not("completed_at", "is", null)).data ?? []).map((row: { id: string }) => row.id));
  // Which of `candidates` name one of the user's quests or steps (a malformed id names none)
  const existingNodes = async (candidates: string[]) => {
    const wellFormed = candidates.filter((candidate) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate));
    if (wellFormed.length === 0) return new Set<string>();
    return new Set(((await db.from("graph_nodes").select("id").in("id", wellFormed)).data ?? []).map((row: { id: string }) => row.id));
  };
  // A change made to each of several quests or steps, in order. Ids that name none are refused before
  // anything changes; a failure partway says which were already changed.
  const runEach = async (nodeIds: string[], change: (nodeId: string) => Promise<unknown>, done: string) => {
    const found = await existingNodes(nodeIds);
    const unknown = nodeIds.filter((nodeId) => !found.has(nodeId));
    if (unknown.length) return failure(`Not a quest or step: ${unknown.join(", ")}. Nothing was changed.`);
    for (const [index, nodeId] of nodeIds.entries()) {
      try {
        await change(nodeId);
      } catch (error) {
        return failure(`${(error as Error).message} (at ${nodeId}). ${index ? `Already changed: ${nodeIds.slice(0, index).join(", ")}.` : "Nothing was changed."}`);
      }
    }
    return text(`${done}.`);
  };
  // The `after` links of an add_plan call the server would refuse, as add_edge does: a prerequisite in
  // another box than its step, or a loop (only the call's own steps can make one: nothing existing
  // leads to them yet)
  const linkProblems = async (steps: Array<{ ref: string; parent?: string; after?: string[] }>, parentId: string | null) => {
    const refs = new Set(steps.map(({ ref }) => ref));
    const boxOf = new Map(steps.map((step) => [step.ref, step.parent ?? parentId]));
    const existingAfter = [...new Set(steps.flatMap((step) => step.after ?? []).filter((name) => !refs.has(name)))];
    const rows = existingAfter.length ? (((await db.from("graph_nodes").select("id, parent_id").in("id", existingAfter)).data ?? []) as { id: string; parent_id: string | null }[]) : [];
    rows.forEach((row) => boxOf.set(row.id, row.parent_id));
    const problems = steps.flatMap((step) =>
      (step.after ?? []).filter((name) => boxOf.get(name) !== boxOf.get(step.ref)).map((name) => `"${step.ref}" can't come after "${name}": only steps in the same box can be linked.`),
    );
    const visiting = new Set<string>();
    const done = new Set<string>();
    const loops = (ref: string): boolean => {
      if (visiting.has(ref)) return true;
      if (done.has(ref)) return false;
      visiting.add(ref);
      const found = (steps.find((step) => step.ref === ref)?.after ?? []).some((name) => refs.has(name) && loops(name));
      visiting.delete(ref);
      done.add(ref);
      return found;
    };
    const looping = steps.find((step) => loops(step.ref));
    if (looping) problems.push(`The \`after\` links make a loop through "${looping.ref}".`);
    return problems;
  };
  // Whether a deadline id names one of the user's deadlines, so a wrong id is refused rather than
  // answered "Deleted."
  const deadlineExists = async (deadlineId: string) => Boolean((await db.from("deadlines").select("id").eq("id", deadlineId).maybeSingle()).data);
  // Each node's priority as it now stands and where it comes from, read after a change, so a reply
  // shows what the change did
  const prioritiesNow = async (nodeIds: string[]) => {
    const snapshot = await api.getSnapshot();
    const model = buildGraphModel(snapshot);
    const priorities = derivePriorities(model, snapshot);
    return nodeIds.flatMap((nodeId) => {
      const node = model.byId.get(nodeId);
      return node ? [`- ${node.title} [${nodeId}]: ${priorityText(model, priorities, nodeId)}`] : [];
    });
  };

  register(
    "overview",
    {
      description:
        "Shows the user's tracker: steps ready to do now, every quest with its steps nested as an indented list (done steps marked [x], prerequisites shown as 'after', a description quoted under its node after '> '), shelved quests, every routine with its weekdays (today's ticked or not), alarms, events, skipped rings ahead, open deadlines, and the kitchen in short (stock, the next three days' meals, recipe titles). Ids in brackets are what the other tools take. Call this first.",
      inputSchema: { quest_id: z.string().optional().describe("Show only this quest") },
    },
    async ({ quest_id }) => {
      const snapshot = await api.getSnapshot();
      if (quest_id && !snapshot.nodes.some((node) => node.id === quest_id && node.parentId === null)) return failure(`${quest_id} is not a quest; give a quest's id, or none for everything.`);
      return text(describe(snapshot, quest_id));
    },
  );

  register(
    "add_plan",
    {
      description:
        "Adds several steps at once, nested and linked: the main way to turn a plan into the graph. Each step has a short `ref` of your choosing; `parent` puts it inside another step (a ref from this call or an existing id), otherwise it goes under `parent_id`. `after` lists prerequisites that must be done first; they must share the step's parent. List parents before their steps. With parent_id null, top-level entries become new quests.",
      inputSchema: {
        parent_id: z.string().max(ID_MAX).nullable().describe("Existing node the plan goes into, or null for new quests"),
        steps: z
          .array(
            z.object({
              ref: z.string().max(ID_MAX).describe("Your label for this step, unique in this call"),
              title: z.string().trim().min(1).max(TITLE_MAX).describe("A few words (about 2 to 4): titles show on small cards in the graph"),
              description: z.string().trim().max(DESCRIPTION_MAX).optional().describe("Free text the user can read on the step: what it involves, where its details are kept"),
              parent: z.string().max(ID_MAX).optional().describe("Ref or id of the step this one sits inside"),
              after: z.array(z.string().max(ID_MAX)).max(LIST_MAX).optional().describe("Refs or ids of sibling prerequisites"),
            }),
          )
          .min(1)
          .max(LIST_MAX),
      },
    },
    async ({ parent_id, steps }) => {
      // The whole call is checked before anything is made, so a mistake leaves nothing half-added
      const refs = steps.map(({ ref }) => ref);
      const repeated = refs.filter((ref, index) => refs.indexOf(ref) !== index);
      if (repeated.length) return failure(`Each ref must be unique in the call; repeated: ${[...new Set(repeated)].join(", ")}. Nothing was added.`);
      const late = steps.find((step, index) => step.parent && refs.indexOf(step.parent) >= index);
      if (late) return failure(`"${late.ref}" comes before its parent "${late.parent}"; list parents first. Nothing was added.`);
      const named = [...new Set([parent_id, ...steps.flatMap((step) => [step.parent, ...(step.after ?? [])])].filter((name): name is string => Boolean(name) && !refs.includes(name!)))];
      const nodeIdsFound = await existingNodes(named);
      const unknown = named.filter((name) => !nodeIdsFound.has(name));
      if (unknown.length) return failure(`Not a ref in this call nor a quest or step: ${unknown.join(", ")}. Nothing was added.`);
      const unlinkable = await linkProblems(steps, parent_id);
      if (unlinkable.length) return failure([...unlinkable, "Nothing was added."].join("\n"));

      const created = new Map<string, string>(); // ref → id
      const resolve = (refOrId: string) => created.get(refOrId) ?? refOrId;
      const problems: string[] = [];
      for (const step of steps) {
        try {
          const delta = await api.createNode(step.title, step.parent ? resolve(step.parent) : parent_id);
          created.set(step.ref, delta.nodes![0].id);
          if (step.description) await api.updateNode(delta.nodes![0].id, { description: step.description });
        } catch (error) {
          const made = steps.filter(({ ref }) => created.has(ref)).map(({ ref, title }) => `${ref}: ${title} [${created.get(ref)}]`);
          return failure([`Adding "${step.ref}" failed: ${(error as Error).message}. Made before it, with no links yet:`, ...(made.length ? made : ["- nothing"])].join("\n"));
        }
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

  register(
    "complete",
    { description: "Marks steps done. Marking a box (a step with steps) done also marks every open step inside it done, as the user means by ticking it; marking a quest done marks its open steps done (a quest itself is never ticked: it is finished when all its steps are). Steps already done keep the time they were done.", inputSchema: { ids } },
    async ({ ids }) => {
      // Read before each tick, so a step already swept by its box's tick earlier in the list keeps its time
      const tick = async (nodeId: string): Promise<unknown> => {
        const node = (await db.from("graph_nodes").select("parent_id, completed_at").eq("id", nodeId).single()).data as { parent_id: string | null; completed_at: string | null } | null;
        if (node?.completed_at) return;
        if (node && node.parent_id === null) {
          const steps = ((await db.from("graph_nodes").select("id").eq("parent_id", nodeId).is("completed_at", null)).data ?? []) as { id: string }[];
          for (const step of steps) await tick(step.id);
          return;
        }
        return api.updateNode(nodeId, { done: true });
      };
      return runEach(ids, tick, "Done");
    },
  );

  register(
    "set_priority",
    {
      description:
        "Sets the priority of quests or steps: 1 is the most urgent, 4 the least, null removes it. It covers the node's chain: its open prerequisites and the steps inside. Only ready steps a priority covers show in the user's to-do.",
      inputSchema: { ids, priority: z.number().int().min(1).max(4).nullable() },
    },
    async ({ ids, priority }) => {
      const result = await runEach(ids, (nodeId) => api.updateNode(nodeId, { priority: priority as Priority | null }), "Prioritised");
      return "isError" in result ? result : text(["Prioritised. Each now stands at:", ...(await prioritiesNow(ids))].join("\n"));
    },
  );

  register(
    "shelve",
    {
      description: "Shelves quests or steps: they and everything inside them leave the graph and the to-do, kept, until they are unshelved. A shelved quest is listed under Shelved quests in `overview`; a shelved step still shows in its quest's outline, marked (shelved).",
      inputSchema: { ids },
    },
    async ({ ids }) => runEach(ids, (nodeId) => api.updateNode(nodeId, { shelved: true }), "Shelved"),
  );

  register(
    "unshelve",
    { description: "Takes quests or steps off the shelf.", inputSchema: { ids } },
    async ({ ids }) => runEach(ids, (nodeId) => api.updateNode(nodeId, { shelved: false }), "Unshelved"),
  );

  register(
    "reopen",
    { description: "Marks done steps as not done. Reopening a box reopens only the box, not the steps inside it. A box is done only while everything in it is, so reopening a step also reopens the done boxes it sits in (adding or moving a step into a done box does too).", inputSchema: { ids } },
    async ({ ids }) => {
      const done = await doneIds(ids);
      const open = ids.filter((nodeId) => !done.has(nodeId));
      const result = await runEach(ids, (nodeId) => (done.has(nodeId) ? api.updateNode(nodeId, { done: false }) : Promise.resolve()), "Reopened");
      return "isError" in result || open.length === 0 ? result : text(`Reopened. Not done, so left as they were: ${open.join(", ")}.`);
    },
  );

  register(
    "rename",
    { description: "Renames a quest or step. Keep titles to a few words: they show on small cards.", inputSchema: { id, title: z.string().trim().min(1).max(TITLE_MAX) } },
    async ({ id, title }) => run([() => api.updateNode(id, { title })], "Renamed"),
  );

  register(
    "describe",
    {
      description:
        "Sets a quest's or step's description: free text the user reads when they open it (what it involves, where its details are kept, e.g. \"see notes/project.md\"). Replaces the old one; \"\" clears it. The overview shows each description.",
      inputSchema: { id, description: z.string().trim().max(DESCRIPTION_MAX) },
    },
    async ({ id, description }) => {
      if (!(await existingNodes([id])).has(id)) return failure(`No quest or step ${id}.`);
      return run([() => api.updateNode(id, { description })], description ? "Described" : "Description cleared");
    },
  );

  register(
    "move",
    {
      description: "Moves a step (with its own steps) into another node, or makes it a quest with parent_id null. Its links are removed, since links only join steps in the same box, and it is placed afresh in its new box.",
      inputSchema: { id, parent_id: z.string().max(ID_MAX).nullable() },
    },
    async ({ id, parent_id }) => run([() => api.moveNode(id, parent_id)], "Moved"),
  );

  register(
    "delete",
    { description: "Deletes a quest or step together with every step inside it. Cannot be undone. Deadlines, alarms and routines have their own delete tools.", inputSchema: { id } },
    async ({ id }) => {
      const { data } = await db.from("graph_nodes").select("id").eq("id", id).maybeSingle();
      if (!data) return failure(`No quest or step ${id}. Deadlines, alarms and routines have their own delete tools.`);
      return run([() => api.deleteNode(id)], "Deleted");
    },
  );

  register(
    "link",
    {
      description: "Makes `from` a prerequisite of `to`. Both must have the same parent; loops are refused.",
      inputSchema: { from: id, to: id },
    },
    async ({ from, to }) => run([() => api.addEdge({ from, to })], "Linked"),
  );

  register(
    "unlink",
    { description: "Removes the prerequisite link from `from` to `to`.", inputSchema: { from: id, to: id } },
    async ({ from, to }) => {
      const { data } = await db.from("graph_edges").select("from_id").eq("from_id", from).eq("to_id", to).maybeSingle();
      if (!data) return failure(`No link from ${from} to ${to}.`);
      return run([() => api.removeEdge({ from, to })], "Unlinked");
    },
  );

  register(
    "level_up",
    {
      description: "Logs a session of progress on a quest (10 XP), for work that did not complete a step.",
      inputSchema: { id },
    },
    async ({ id }) => run([() => api.levelUp(id, crypto.randomUUID())], "Levelled up"),
  );

  register(
    "update_quest",
    {
      description:
        "Sets which stats a quest trains and how much. Each XP earned in the quest adds weight × XP to each stat.",
      inputSchema: {
        id,
        stat_weights: z
          .partialRecord(z.enum(statKeys), z.number().nonnegative())
          .optional()
          .describe('Weight per stat, e.g. {"INT": 0.2, "CHR": 0.1}; replaces the quest\'s weights, and {} trains nothing'),
      },
    },
    async ({ id, stat_weights }) => {
      // Stats belong to quests: on a step they would be stored and do nothing
      const { data } = await db.from("graph_nodes").select("parent_id").eq("id", id).maybeSingle();
      if (!data || (data as { parent_id: string | null }).parent_id !== null) return failure(`${id} is not a quest.`);
      if (stat_weights === undefined) return failure("Give stat_weights.");
      return run([() => api.updateNode(id, { statWeights: stat_weights })], "Updated");
    },
  );

  register(
    "add_deadline",
    {
      description:
        "Adds a dated obligation, optionally with an alarm at a time on its due day (rings on the phone). Linking it to a quest or step (`node_id`) only groups it there; a deadline never changes a priority, which only the user sets. For a ring with no deadline, use add_alarm with a date.",
      inputSchema: { title: z.string().trim().min(1).max(TITLE_MAX), due_date: date, alarm_time: clock.optional(), node_id: id.optional().describe("The quest or step it belongs to") },
    },
    async ({ title, due_date, alarm_time, node_id }) => {
      if (node_id && !(await existingNodes([node_id])).has(node_id)) return failure(`Not a quest or step: ${node_id}. Nothing was added.`);
      // As add_alarm: an alarm whose moment has passed would never ring
      if (alarm_time && atTime(due_date, alarm_time).getTime() <= Date.now()) {
        return failure(`${due_date} ${alarm_time} has passed: give a later alarm_time, or none. Nothing was added.`);
      }
      const deadlineId = crypto.randomUUID();
      return run([() => api.createDeadline({ id: deadlineId, title, dueDate: due_date, alarmTime: alarm_time ?? null, nodeId: node_id ?? null })], `Added deadline [${deadlineId}]${alarm_time ? `. ${RINGS_ON_PHONE}` : ""}`);
    },
  );

  register(
    "update_deadline",
    {
      description:
        "Changes a deadline: its title, due date, alarm time on the due day, or the quest or step it is linked to. Only the fields given change. Linking only groups it there and changes no priority.",
      inputSchema: {
        id: z.string().describe("A deadline id, as shown by `overview`"),
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        due_date: date.optional(),
        alarm_time: clock.nullable().optional().describe("null removes the alarm"),
        node_id: id.nullable().optional().describe("The quest or step it belongs to; null unlinks it"),
      },
    },
    async ({ id, title, due_date, alarm_time, node_id }) => {
      const current = (await db.from("deadlines").select("due_date, alarm_time").eq("id", id).maybeSingle()).data as { due_date: string; alarm_time: string | null } | null;
      if (!current) return failure(`No deadline ${id}.`);
      if (node_id && !(await existingNodes([node_id])).has(node_id)) return failure(`Not a quest or step: ${node_id}. Nothing was changed.`);
      const patch = Object.fromEntries(Object.entries({ title, dueDate: due_date, alarmTime: alarm_time, nodeId: node_id }).filter(([, value]) => value !== undefined)) as DeadlinePatch;
      if (Object.keys(patch).length === 0) return failure("Nothing to change.");
      // As add_deadline: an alarm whose moment has passed would never ring
      const alarmAt = alarm_time === undefined ? current.alarm_time?.slice(0, 5) : alarm_time;
      const dueOn = due_date ?? current.due_date;
      if ((due_date !== undefined || alarm_time) && alarmAt && atTime(dueOn, alarmAt).getTime() <= Date.now()) {
        return failure(`${dueOn} ${alarmAt} has passed: give a later alarm_time, or null for none. Nothing was changed.`);
      }
      return run([() => api.updateDeadline(id, patch)], `Updated deadline${alarmAt ? `. ${RINGS_ON_PHONE}` : ""}`);
    },
  );

  register(
    "delete_deadline",
    { description: "Deletes a deadline, with its alarm.", inputSchema: { id: z.string().describe("A deadline id, as shown by `overview`") } },
    async ({ id }) => {
      if (!(await deadlineExists(id))) return failure(`No deadline ${id}.`);
      return run([() => api.deleteDeadline(id)], "Deleted deadline");
    },
  );

  register(
    "add_alarm",
    {
      description:
        "Sets an alarm that rings on the user's phone, apart from any routine or deadline: in some minutes from now (a nap), once at a time (on `date`, or else the next time the clock shows it), or recurring at a time on chosen weekdays (waking up). An alarm can be plain, or stop only after walking or sit-ups.",
      inputSchema: {
        label: z.string().max(TITLE_MAX).optional(),
        in_minutes: z.number().int().positive().optional().describe("Ring this many minutes from now"),
        time: clock.optional().describe("Ring at this time (once, unless weekdays are given)"),
        date: date.optional().describe("The day a one-off alarm rings; needs a time, not weekdays"),
        weekdays: z.array(z.enum(week as [string, ...string[]])).optional().describe("Repeat on these days"),
        kind: z.enum(["plain", "walk", "situps"]).optional(),
      },
    },
    async ({ label, in_minutes, time, date, weekdays, kind }) => {
      if ((in_minutes === undefined) === (time === undefined)) return failure("Give either in_minutes or time.");
      if (weekdays?.length && !time) return failure("Recurring alarms need a time.");
      if (date && (!time || weekdays?.length)) return failure("A date goes with a time, for a one-off alarm.");
      const recurring = Boolean(time && weekdays?.length);
      const at = recurring ? null : in_minutes !== undefined ? new Date(Date.now() + in_minutes * 60_000) : date ? atTime(date, time!) : nextOccurrence(time!);
      if (at && at.getTime() <= Date.now()) return failure(`${date} ${time} has passed.`);
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
              eventId: null,
              sound: "default",
            }),
        ],
        `${at ? `Alarm set for ${at.toLocaleString(undefined, { timeZone: currentTimeZone() })}` : "Recurring alarm set"}. ${RINGS_ON_PHONE}`,
      );
    },
  );

  const ringsAtStart = z.enum(["plain", "walk", "situps"]).nullable().optional().describe("An alarm at its start, and how it stops (walk, sit-ups); null or left out for none");
  const eventDetails = z.string().max(EVENT_DETAILS_MAX).optional().describe("Where, who, notes: free text the user reads on tapping the event");

  register(
    "add_event",
    {
      description:
        "Puts an event on the user's schedule: a time with an optional end (a test from 2 to 4, a lecture every Tuesday), and details to read on tapping it. It shows on the Alarms screen's day, in time order among the rings, and on the Calendar. Once on `date`, or recurring on `weekdays`. It doesn't ring unless `rings` is given: then an alarm rings at its start (leave it off for a test or an exam, where a ring would be harmful). Change it with update_event, remove it with delete_event.",
      inputSchema: {
        title: z.string().min(1).max(TITLE_MAX),
        start: clock.describe("When it starts"),
        end: clock.optional().describe("When it ends; past midnight if earlier than start"),
        date: date.optional().describe("The day of a one-off event"),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1).optional().describe("Repeat on these days"),
        details: eventDetails,
        rings: ringsAtStart,
      },
    },
    async ({ title, start, end, date: day, weekdays, details, rings }) => {
      if ((day === undefined) === (weekdays === undefined)) return failure("Give either date or weekdays.");
      const at = day ? atTime(day, start) : null;
      if (at && rings && at.getTime() <= Date.now()) return failure(`${day} ${start} has passed, so it can't ring at its start. Nothing was changed.`);
      return run(
        [
          () =>
            api.createEvent({
              id: crypto.randomUUID(),
              title,
              details: details?.trim() ?? "",
              at: at ? at.toISOString() : null,
              time: day ? null : start,
              weekdays: day ? [] : (weekdays as typeof week),
              minutes: end ? minutesFrom(start, end) : null,
              rings: rings ?? null,
            }),
        ],
        `Event set: ${title}, ${day ?? (weekdays as string[]).join(" ")} ${start}${end ? `–${end}` : ""}. ${rings ? `It rings at its start. ${RINGS_ON_PHONE}` : "It doesn't ring."}`,
      );
    },
  );

  register(
    "update_event",
    {
      description:
        "Changes one of the user's events: its title, start (`time`), end, the day of a one-off (`date`), a recurring one's weekdays, its details, or whether an alarm rings at its start (`rings`; null for none). Only the fields given change. A one-off stays a one-off. To skip or move one day's start ring of a recurring event, use skip_ring with the event's alarm id from `overview`.",
      inputSchema: {
        id: z.string().max(ID_MAX).describe("An event id, as shown by `overview`"),
        title: z.string().min(1).max(TITLE_MAX).optional(),
        time: clock.optional().describe("Its new start"),
        end: clock.nullable().optional().describe("When it ends; null for a moment"),
        date: date.optional().describe("A one-off event's new day"),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1).optional().describe("A recurring event's new days"),
        details: eventDetails,
        rings: ringsAtStart,
      },
    },
    async ({ id, title, time, end, date: day, weekdays, details, rings }) => {
      const event = (await api.getSnapshot()).events.find((candidate) => candidate.id === id);
      if (!event) return failure(`No event ${id}.`);
      const patch: EventPatch = Object.fromEntries(Object.entries({ title, rings }).filter(([, value]) => value !== undefined));
      if (details !== undefined) patch.details = details.trim();
      const start = time ?? event.time ?? clockOf(new Date(event.at!));
      if (event.at) {
        if (weekdays) return failure("That is a one-off event: to make it recurring, delete it and add_event with weekdays.");
        if (day !== undefined || time !== undefined) patch.at = atTime(day ?? toISODate(new Date(event.at)), start).toISOString();
        const at = new Date(patch.at ?? event.at);
        const ringsAfter = rings !== undefined ? rings : event.rings;
        if (ringsAfter && (patch.at || rings) && at.getTime() <= Date.now()) return failure(`${toISODate(at)} ${clockOf(at)} has passed, so it can't ring at its start. Nothing was changed.`);
      } else {
        if (day !== undefined) return failure("That event recurs, so it has no date: give weekdays.");
        if (time !== undefined) patch.time = time;
        if (weekdays) patch.weekdays = weekdays as typeof week;
      }
      // The end is kept as a length, so a new start with no end given keeps the end where it was
      if (end !== undefined) patch.minutes = end ? minutesFrom(start, end) : null;
      else if (time !== undefined && event.minutes) {
        const was = event.time ?? clockOf(new Date(event.at!));
        patch.minutes = minutesFrom(start, clockAfter(was, event.minutes));
      }
      if (Object.keys(patch).length === 0) return failure("Nothing to change was given.");
      const ringing = rings !== undefined ? rings : event.rings;
      return run([() => api.updateEvent(id, patch)], `Updated event${ringing ? `; it rings at its start. ${RINGS_ON_PHONE}` : "; it doesn't ring."}`);
    },
  );

  register(
    "delete_event",
    { description: "Deletes one of the user's events, with the alarm at its start if it has one.", inputSchema: { id: z.string().max(ID_MAX).describe("An event id, as shown by `overview`") } },
    async ({ id }) => {
      if (!(await db.from("events").select("id").eq("id", id).maybeSingle()).data) return failure(`No event ${id}.`);
      return run([() => api.deleteEvent(id)], "Deleted event");
    },
  );

  register(
    "update_alarm",
    {
      description:
        "Changes one of the user's own alarms: its label, its time, the day a one-off rings (`date`), a recurring one's weekdays, how it stops, or whether it is on. Only the fields given change. An event's start alarm is changed through its event (update_event). A one-off moved to a new date or time stays a one-off. To move a single day's ring of a recurring alarm or routine, use skip_ring with instead_at.",
      inputSchema: {
        id: z.string().max(ID_MAX).describe("An alarm id, as shown by `overview`"),
        label: z.string().max(TITLE_MAX).optional(),
        time: clock.optional(),
        date: date.optional().describe("A one-off alarm's new day"),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1).optional().describe("A recurring alarm's new days"),
        kind: z.enum(["plain", "walk", "situps"]).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async ({ id, label, time, date: day, weekdays, kind, enabled }) => {
      const snapshot = await api.getSnapshot();
      const alarm = snapshot.alarms.find((candidate) => candidate.id === id);
      if (!alarm) return failure(`No alarm ${id}. Routines, deadlines and events have their own update tools.`);
      if (alarm.eventId) return failure(`That alarm rings at the start of event ${alarm.eventId}: change it with update_event, or skip one day's ring with skip_ring.`);
      const patch: AlarmPatch = Object.fromEntries(Object.entries({ label, kind, enabled }).filter(([, value]) => value !== undefined));
      if (alarm.at) {
        if (weekdays) return failure("That is a one-off alarm: to make it recurring, delete it and add_alarm with weekdays.");
        if (day !== undefined || time !== undefined) {
          const was = new Date(alarm.at);
          const at = atTime(day ?? toISODate(was), time ?? clockOf(was));
          if (at.getTime() <= Date.now()) return failure(`${toISODate(at)} ${clockOf(at)} has passed. Nothing was changed.`);
          patch.at = at.toISOString();
        }
      } else {
        if (day !== undefined) return failure("That alarm recurs, so it has no date: give weekdays, or skip_ring one date with instead_at.");
        if (time !== undefined) patch.time = time;
        if (weekdays) patch.weekdays = weekdays as typeof week;
      }
      if (Object.keys(patch).length === 0) return failure("Nothing to change was given.");
      return run([() => api.updateAlarm(id, patch)], `Updated alarm${patch.at ? ` to ring ${new Date(patch.at).toLocaleString(undefined, { timeZone: currentTimeZone() })}` : ""}. ${RINGS_ON_PHONE}`);
    },
  );

  register(
    "call_user",
    {
      description:
        "Calls the user's phone: a ring at once, about 24 seconds long (Ashborn's call tune, or the phone's ringtone in a build without one), that obeys the phone's silent mode. If unanswered it leaves a \"Missed call from Claude\" notification showing `message`. Use only when work is blocked on the user (see the ring-user skill). Delete the call with delete_alarm once the user has answered.",
      inputSchema: {
        message: z.string().trim().min(1).max(TITLE_MAX).describe("Who is calling and what is needed, readable on the lock screen"),
      },
    },
    async ({ message }) => {
      const id = crypto.randomUUID();
      const at = new Date();
      return run(
        [() => api.createAlarm({ id, label: message, kind: "plain", at: at.toISOString(), time: null, weekdays: [], enabled: true, sound: "call", eventId: null })],
        `Calling now [${id}]. The phone rings as the push reaches it, within seconds even asleep; if the phone is offline the call is dropped after 2 minutes`,
      );
    },
  );

  register(
    "add_routine",
    {
      description:
        "Adds a recurring task on chosen weekdays, with an optional if-then cue such as 'after dinner', and an optional time. With a time it can ring an alarm on the phone: plain, or one that only stops after walking or sit-ups (for waking up).",
      inputSchema: {
        title: z.string().trim().min(1).max(TITLE_MAX),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1),
        cue: z.string().max(TITLE_MAX).optional(),
        time: clock.optional(),
        alarm: z.enum(["none", "plain", "walk", "situps"]).optional().describe("Needs a time"),
      },
    },
    async ({ title, weekdays, cue, time, alarm }) => {
      if (alarm && alarm !== "none" && !time) return failure("An alarm needs a time.");
      return run(
        [() => api.createRoutine({ id: crypto.randomUUID(), title, cue: cue ?? "", weekdays: weekdays as typeof week, time: time ?? null, alarm: alarm ?? "none" })],
        `Added routine${alarm && alarm !== "none" ? `. ${RINGS_ON_PHONE}` : ""}`,
      );
    },
  );

  register(
    "update_routine",
    {
      description: "Changes a routine: its title, cue, weekdays, time or alarm. Only the fields given change; its ticks are kept. To change one date only, use skip_ring.",
      inputSchema: {
        id: z.string().max(ID_MAX).describe("A routine id, as shown by `overview`"),
        title: z.string().trim().min(1).max(TITLE_MAX).optional(),
        cue: z.string().max(TITLE_MAX).optional(),
        weekdays: z.array(z.enum(week as [string, ...string[]])).min(1).optional(),
        time: clock.nullable().optional().describe("null removes the time (and so the alarm)"),
        alarm: z.enum(["none", "plain", "walk", "situps"]).optional().describe("Needs a time"),
      },
    },
    async ({ id, title, cue, weekdays, time, alarm }) => {
      const current = (await api.getSnapshot()).routines.find((routine) => routine.id === id);
      if (!current) return failure(`No routine ${id}.`);
      const patch = Object.fromEntries(Object.entries({ title, cue, weekdays, time, alarm }).filter(([, value]) => value !== undefined)) as RoutinePatch;
      if (time === null && alarm === undefined) patch.alarm = "none";
      if ((patch.alarm ?? current.alarm) !== "none" && !(time === undefined ? current.time : time)) return failure("An alarm needs a time.");
      if (Object.keys(patch).length === 0) return failure("Nothing to change.");
      return run([() => api.updateRoutine(id, patch)], `Updated routine${(patch.alarm ?? current.alarm) !== "none" ? `. ${RINGS_ON_PHONE}` : ""}`);
    },
  );

  register(
    "skip_ring",
    {
      description:
        "Stops one date's ring of a routine's alarm or of a recurring alarm, leaving every other date as it is; with instead_at it rings at that time instead, that date only (as a one-off alarm with the same title and kind). Use it to keep an alarm out of an exam or a meeting. restore_ring undoes it. A date already skipped, or an alarm turned off, is refused.",
      inputSchema: {
        id: z.string().max(ID_MAX).describe("A routine id or a recurring alarm's id, as shown by `overview`"),
        date: date.describe("The date whose ring to skip, YYYY-MM-DD"),
        instead_at: clock.optional().describe("Ring at this time instead, on the same date"),
      },
    },
    async ({ id, date: day, instead_at }) => {
      const found = await ringOn(id, day);
      if ("problem" in found) return failure(found.problem);
      const { ring, snapshot } = found;
      if (snapshot.alarms.some((alarm) => alarm.id === id && !alarm.enabled)) return failure(`${ring.title} is turned off, so it doesn't ring on ${day} anyway.`);
      // A second skip would leave the first's alarm at its new time ringing too
      if (snapshot.skippedAlarms.some((skip) => skip.key === ring.key)) return failure(`${ring.title} is already skipped on ${day}: restore_ring it first, then skip it again.`);
      if (atTime(day, ring.time).getTime() <= Date.now()) return failure(`The ${day} ring at ${ring.time} has already passed.`);
      const moved = instead_at ? atTime(day, instead_at) : null;
      if (moved && moved.getTime() <= Date.now()) return failure(`${day} ${instead_at} has passed.`);
      const alarmId = crypto.randomUUID();
      const changes = [() => api.setAlarmSkip(ring.key, day, true)];
      if (moved) changes.push(() => api.createAlarm({ id: alarmId, label: movedLabel(ring.title, ring.time), kind: ring.kind, at: moved.toISOString(), time: null, weekdays: [], enabled: true, sound: "default", eventId: null }));
      const when = (at: Date) => at.toLocaleString(undefined, { timeZone: currentTimeZone() });
      return run(
        changes,
        `${ring.title} will not ring at ${ring.time} on ${day}${moved ? `; it rings at ${when(moved)} instead (alarm [${alarmId}])` : ""}. ${RINGS_ON_PHONE}`,
        ["the skip", "the alarm at the new time"],
      );
    },
  );

  register(
    "restore_ring",
    {
      description: "Undoes skip_ring: the date's ring is back at its usual time, and the one-off alarm a move made is deleted.",
      inputSchema: { id: z.string().max(ID_MAX).describe("A routine id or a recurring alarm's id"), date: date },
    },
    async ({ id, date: day }) => {
      const found = await ringOn(id, day);
      if ("problem" in found) return failure(found.problem);
      const { ring, snapshot } = found;
      if (!snapshot.skippedAlarms.some((skip) => skip.key === ring.key)) return failure(`${ring.title} is not skipped on ${day}.`);
      const replacements = movedAlarms(snapshot, ring, day);
      return run(
        [() => api.setAlarmSkip(ring.key, day, false), ...replacements.map((alarm) => () => api.deleteAlarm(alarm.id))],
        `${ring.title} rings at ${ring.time} on ${day} again${replacements.length ? ", and the alarm at the new time is deleted" : ""}. ${RINGS_ON_PHONE}`,
      );
    },
  );

  // The ring a routine or a recurring alarm makes on `day`, or why it makes none
  const ringOn = async (ringId: string, day: string): Promise<{ problem: string } | { ring: Ring & { kind: Alarm["kind"] }; snapshot: Snapshot }> => {
    const snapshot = await api.getSnapshot();
    const routine = snapshot.routines.find((candidate) => candidate.id === ringId);
    const alarm = snapshot.alarms.find((candidate) => candidate.id === ringId);
    if (!routine && !alarm) return { problem: `No routine or alarm ${ringId}.` };
    if (alarm && !alarm.time) return { problem: "That is a one-off alarm: delete it, and add another at the new time." };
    const ring: Ring = routine
      ? { key: `routine:${ringId}@${day}`, title: routine.title, kind: routine.alarm === "none" ? null : routine.alarm, time: routine.time ?? "", weekdays: routine.weekdays }
      : { key: `alarm:${ringId}@${day}`, title: alarm!.label || "Alarm", kind: alarm!.kind, time: alarm!.time!, weekdays: alarm!.weekdays };
    if (!ring.kind || !ring.time) return { problem: `${ring.title} has no alarm.` };
    if (!ring.weekdays.includes(weekdayOf(day))) return { problem: `${ring.title} does not ring on ${day}, a ${weekdayOf(day)}; it rings on ${ring.weekdays.join(" ")}.` };
    return { ring: ring as Ring & { kind: Alarm["kind"] }, snapshot };
  };

  register(
    "delete_alarm",
    { description: "Deletes one of the user's alarms (not a routine's or a deadline's).", inputSchema: { id: z.string().describe("An alarm id, as shown by `overview`") } },
    async ({ id }) => {
      const alarm = (await db.from("alarms").select("id, event_id").eq("id", id).maybeSingle()).data;
      if (!alarm) return failure(`No alarm ${id}.`);
      if (alarm.event_id) return failure(`That alarm rings at the start of event ${alarm.event_id}: stop it with update_event and rings null, or delete the event.`);
      return run([() => api.deleteAlarm(id)], "Deleted alarm");
    },
  );

  register(
    "delete_routine",
    { description: "Deletes a routine, with its alarm.", inputSchema: { id: z.string().describe("A routine id, as shown by `overview`") } },
    async ({ id }) => {
      if (!(await db.from("routines").select("id").eq("id", id).maybeSingle()).data) return failure(`No routine ${id}.`);
      return run([() => api.deleteRoutine(id)], "Deleted routine");
    },
  );

  // The Kitchen. Amounts are given and shown in the item's own unit (kg for rice); a recipe
  // amount may use another unit of the same kind (g), converted when it is saved.
  const slot = z.enum(mealSlots);
  const unit = z.enum(stockUnits);
  const recipeIds = z.array(z.string().max(ID_MAX)).max(LIST_MAX).optional().describe("Recipe ids, as shown by `kitchen`");

  register(
    "kitchen",
    {
      description:
        `Shows the kitchen in full: stock items with amounts and targets, the meal plan from ${mealDaysBack} days ago to ${mealDaysAhead} ahead ([x] cooked, [-] cancelled, (default) when it comes from the default week), the default week, and every recipe with its text, tracked ingredients and reminders. Ids in brackets are what the kitchen tools take.`,
      inputSchema: {},
    },
    async () => text(describeKitchen(await readKitchen(db))),
  );

  register(
    "save_recipe",
    {
      description:
        "Creates a recipe, or replaces one when `id` is given: what you pass replaces that part (title, body, ingredients, reminders); what you leave out stays. `body` is free text for the reader, with any amounts and formatting; for a recipe cooked more than one way, a line `[1: name]` starts text only route 1 shows (the app shows each route as a tab) and `[all]` returns to text every route shows. `ingredients` are only the tracked bulk staples cooking deducts from stock (rice, beans; never spices), each naming a stock item by id or name, in a unit of the item's kind. `reminders` are alarms rung for a planned meal using the recipe: `offset_minutes` (negative is earlier) from the meal's time, or from another reminder given by its `ref`. A new recipe with no reminders given gets one, 'Start prep', 45 minutes before the meal; pass [] for none.",
      inputSchema: {
        id: z.string().optional().describe("Recipe id to replace"),
        title: z.string().trim().min(1).max(TITLE_MAX).optional().describe("Needed for a new recipe"),
        body: z.string().max(BODY_MAX).optional(),
        ingredients: z
          .array(z.object({ item: z.string().max(TITLE_MAX).describe("Stock item id or name"), amount: z.number().positive(), unit, name: z.string().max(TITLE_MAX).optional().describe("Defaults to the item's name") }))
          .max(LIST_MAX)
          .optional(),
        reminders: z
          .array(
            z.object({
              ref: z.string().max(ID_MAX).describe("Your label for it, unique in this call"),
              label: z.string().trim().min(1).max(TITLE_MAX),
              offset_minutes: z.number().int(),
              from: z.string().max(ID_MAX).optional().describe("Ref of the reminder this one is timed from; omit to time it from the meal"),
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
        if (!item) return failure(`No single stock item "${ingredient.item}". Add it with add_stock_item first (spices and the like are not tracked), or name it by its id if two share the name.`);
        if (!sameKind(item.unit, ingredient.unit)) return failure(`${item.name} is counted in ${item.unit}, so ${ingredient.amount} ${ingredient.unit} cannot be used.`);
        resolved.push({ id: crypto.randomUUID(), itemId: item.id, name: ingredient.name ?? item.name, amount: toBase(ingredient.amount, ingredient.unit), unit: ingredient.unit });
      }

      const reminderRefs = (reminders ?? []).map(({ ref }) => ref);
      const repeated = reminderRefs.filter((ref, index) => reminderRefs.indexOf(ref) !== index);
      if (repeated.length) return failure(`Each reminder ref must be unique; repeated: ${[...new Set(repeated)].join(", ")}.`);
      const refs = new Map((reminders ?? []).map((reminder) => [reminder.ref, crypto.randomUUID()]));
      const unknown = (reminders ?? []).find((reminder) => reminder.from && !refs.has(reminder.from));
      if (unknown) return failure(`Reminder "${unknown.ref}" is timed from "${unknown.from}", which is not a ref in this call.`);
      const timed: Recipe["reminders"] = reminders
        ? reminders.map((reminder) => ({ id: refs.get(reminder.ref)!, label: reminder.label, offsetMinutes: reminder.offset_minutes, anchorId: reminder.from ? refs.get(reminder.from)! : null }))
        : (existing?.reminders ?? [{ id: crypto.randomUUID(), anchorId: null, ...DEFAULT_REMINDER }]);

      const recipe = { id: existing?.id ?? crypto.randomUUID(), title: title ?? existing!.title, body: body ?? existing?.body ?? "", ingredients: resolved, reminders: timed };
      return run([() => api.saveRecipe(recipe, !existing)], `Saved recipe ${recipe.title} [${recipe.id}]`);
    },
  );

  register(
    "delete_recipe",
    { description: "Deletes a recipe. Meals that used it keep their description.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      if (!(await readKitchen(db)).recipes.some((recipe) => recipe.id === id)) return failure(`No recipe ${id}.`);
      return run([() => api.deleteRecipe(id)], "Deleted recipe");
    },
  );

  register(
    "add_stock_item",
    {
      description:
        "Starts tracking a bulk staple (a carbohydrate or protein source: rice, beans, lentils). Never spices or the like. `unit` is how it is shown; `target` (the amount to keep on hand) and `on_hand` are in that unit.",
      inputSchema: { name: z.string().trim().min(1).max(TITLE_MAX), unit, target: z.number().nonnegative(), on_hand: z.number().nonnegative().optional() },
    },
    async ({ name, unit, target, on_hand }) => {
      const same = (await readKitchen(db)).items.find((item) => sameName(item.name, name));
      if (same) return failure(`${same.name} is already tracked [${same.id}]: change it with update_stock_item.`);
      const id = crypto.randomUUID();
      const changes = [() => api.createStockItem({ id, name, unit, target: toBase(target, unit) })];
      if (on_hand) changes.push(() => api.setStock(crypto.randomUUID(), id, toBase(on_hand, unit)));
      return run(changes, `Added ${name} [${id}]`, ["the item", "its amount on hand"]);
    },
  );

  register(
    "update_stock_item",
    {
      description: "Renames a stock item, changes its target (in its unit), or its unit to another of the same kind (kg to g).",
      inputSchema: { id: z.string(), name: z.string().trim().min(1).max(TITLE_MAX).optional(), unit: unit.optional(), target: z.number().nonnegative().optional() },
    },
    async ({ id, name, unit, target }) => {
      const { items } = await readKitchen(db);
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return failure(`No stock item ${id}.`);
      const same = name ? items.find((other) => other.id !== id && sameName(other.name, name)) : undefined;
      if (same) return failure(`Another item is already called ${same.name} [${same.id}].`);
      return run([() => api.updateStockItem(id, { name, unit, target: target === undefined ? undefined : toBase(target, unit ?? item.unit) })], "Updated");
    },
  );

  register(
    "delete_stock_item",
    { description: "Stops tracking a stock item. Recipe ingredients naming it stay, untracked.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      if (!(await readKitchen(db)).items.some((item) => item.id === id)) return failure(`No stock item ${id}.`);
      return run([() => api.deleteStockItem(id)], "Deleted stock item");
    },
  );

  register(
    "adjust_stock",
    {
      description: "Corrects a stock item by hand, in its unit: `set` the amount on hand (after counting), or `add` to it (a restock; negative takes some away, down to none).",
      inputSchema: { id: z.string(), set: z.number().nonnegative().optional(), add: z.number().optional() },
    },
    async ({ id, set, add }) => {
      if ((set === undefined) === (add === undefined)) return failure("Give either set or add.");
      const item = (await readKitchen(db)).items.find((candidate) => candidate.id === id);
      if (!item) return failure(`No stock item ${id}.`);
      const onHand = set !== undefined ? toBase(set, item.unit) : Math.max(0, item.onHand + toBase(add!, item.unit));
      return run([() => api.setStock(crypto.randomUUID(), id, onHand)], `${item.name}: ${amount(onHand, item.unit)}`);
    },
  );

  register(
    "plan_meals",
    {
      description:
        "Plans meals on dates: each a short description ('rice with butter beans') and optionally recipes. This replaces what those dates and slots showed (their own plan or the default week), and plans a cancelled meal again. A meal already cooked keeps its stock deduction.",
      inputSchema: { meals: z.array(z.object({ date, slot, description: z.string().max(TITLE_MAX), recipes: recipeIds })).min(1).max(LIST_MAX) },
    },
    async ({ meals }) =>
      run(
        meals.map((meal) => () => planMeal(api, meal.date, meal.slot, meal.description, meal.recipes ?? [], "planned")),
        `Planned ${meals.length} meal${meals.length === 1 ? "" : "s"}`,
        meals.map((meal) => `${meal.date} ${meal.slot}`),
      ),
  );

  register(
    "cancel_meals",
    {
      description: "Cancels meals in advance (eating out), which also silences their reminders. Without `slots`, cancels the whole day, leaving any meal already cooked. A cooked meal named in `slots` is refused: unmark it first.",
      inputSchema: { date, slots: z.array(slot).optional() },
    },
    async ({ date, slots }) => {
      // Read around the date itself, which may lie past the days the Kitchen usually holds
      const kitchen = await readKitchen(db, date);
      const asked = slots ?? [...mealSlots];
      const cooked = asked.filter((each) => shownMeal(kitchen, date, each).status === "cooked");
      if (slots && cooked.length) return failure(`Cooked, so not cancelled: the ${cooked.join(" and ")} of ${date}; unmark it first. Nothing was changed.`);
      const cancelling = asked.filter((each) => !cooked.includes(each));
      const were = cooked.length === 1 ? "was" : "were";
      if (cancelling.length === 0) return text(`Nothing cancelled: the ${cooked.join(" and ")} of ${date} ${were} cooked.`);
      return run(
        cancelling.map((each) => () => {
          const shown = shownMeal(kitchen, date, each);
          return planMeal(api, date, each, shown.description, shown.recipeIds, "cancelled");
        }),
        cooked.length ? `Cancelled the ${cancelling.join(" and ")}; the ${cooked.join(" and ")} ${were} cooked and ${cooked.length === 1 ? "stays" : "stay"}` : "Cancelled",
        cancelling,
      );
    },
  );

  register(
    "set_default_meals",
    {
      description: "Sets the default week: what a weekday's slot shows when its date has no meal planned. Planning a date overrides it for that date only.",
      inputSchema: {
        meals: z.array(z.object({ weekday: z.enum(week as [string, ...string[]]), slot, description: z.string().max(TITLE_MAX), recipes: recipeIds })).min(1).max(LIST_MAX),
      },
    },
    async ({ meals }) =>
      run(
        meals.map((meal) => () => api.setDefaultMeal({ weekday: meal.weekday as (typeof week)[number], slot: meal.slot, description: meal.description, recipeIds: meal.recipes ?? [] })),
        "Default week set",
        meals.map((meal) => `${meal.weekday} ${meal.slot}`),
      ),
  );

  register(
    "cook_meal",
    {
      description: "Marks a meal cooked, which deducts its recipes' tracked ingredients from stock. Says which ingredients are no longer tracked. A meal already cooked is refused (unmark it first), and so is a cancelled one (plan it again first).",
      inputSchema: { date, slot },
    },
    async ({ date, slot }) => {
      // As in the app, a cooked meal is unticked before it is cooked again: cooking it twice would take
      // its amounts off a stock counted since the first time
      const status = shownMeal(await readKitchen(db, date), date, slot).status;
      if (status === "cooked") return failure(`The ${slot} of ${date} is already cooked.`);
      // As in the app, which offers no tick on a cancelled meal: plan it again first
      if (status === "cancelled") return failure(`The ${slot} of ${date} is cancelled: plan it again (plan_meals) before cooking it.`);
      try {
        await api.cookMeal(date, slot, crypto.randomUUID());
      } catch (error) {
        return failure((error as Error).message);
      }
      // Read around the date itself, which may lie past the days the Kitchen usually holds; cooked
      // either way, so a failed read only leaves the note out
      const kitchen = await readKitchen(db, date).catch(() => null);
      const untracked = kitchen ? mealDeductions(kitchen, shownMeal(kitchen, date, slot)).untracked : [];
      return text(untracked.length ? `Cooked. Not deducted (no longer tracked): ${untracked.join(", ")}.` : "Cooked.");
    },
  );

  register(
    "uncook_meal",
    { description: "Unticks a cooked meal, putting back exactly what cooking it deducted.", inputSchema: { date, slot } },
    async ({ date, slot }) => {
      if (shownMeal(await readKitchen(db, date), date, slot).status !== "cooked") return failure(`The ${slot} of ${date} is not cooked.`);
      return run([() => api.uncookMeal(date, slot)], "Unticked");
    },
  );
}

// Plans or cancels a meal; a date with no meal of its own gets one with a new id
function planMeal(api: AshbornApi, date: string, slot: (typeof mealSlots)[number], description: string, recipeIds: string[], status: "planned" | "cancelled") {
  return api.setMeal({ id: crypto.randomUUID(), date, slot, description, recipeIds, status });
}

// By id, or by a name only one item has
const findItem = (items: StockItem[], idOrName: string) => {
  const byId = items.find((item) => item.id === idOrName);
  if (byId) return byId;
  const named = items.filter((item) => sameName(item.name, idOrName));
  return named.length === 1 ? named[0] : undefined;
};

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
  const days = short ? [0, 1, 2] : Array.from({ length: mealDaysBack + mealDaysAhead + 1 }, (_, index) => index - mealDaysBack);
  for (const offset of days) {
    const date = addDays(today(), offset);
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

// Runs changes one after another and stops at the first that fails. With several, `labels` names
// each, so a failure partway says which were made.
async function run(changes: Array<() => Promise<Delta>>, done: string, labels: string[] = []) {
  for (const [index, change] of changes.entries()) {
    try {
      await change();
    } catch (error) {
      const message = (error as Error).message;
      if (changes.length === 1) return failure(message);
      const name = (at: number) => labels[at] ?? `change ${at + 1}`;
      const made = changes.slice(0, index).map((_, at) => name(at));
      return failure(`${message} (at ${name(index)}). ${made.length ? `Already made: ${made.join(", ")}.` : "Nothing was changed."}`);
    }
  }
  return text(`${done}.`);
}

// One date's ring of a routine or a recurring alarm (skip_ring). `at` places a clock time on its date;
// An alarm in the overview: on or off, when, its label and id, then how it stops
function describeAlarm(alarm: Alarm) {
  const when = alarm.at ? `once at ${new Date(alarm.at).toLocaleString(undefined, { timeZone: currentTimeZone() })}` : `${alarm.time} on ${alarm.weekdays.join(" ")}`;
  return `- [${alarm.enabled ? "on" : "off"}] ${when} ${alarm.label || "Alarm"} [${alarm.id}]${alarm.kind !== "plain" ? ` (${alarm.kind})` : ""}`;
}

// An event in the overview: when, how long, its title and id, whether it rings at its start (with that
// alarm's id, which skip_ring takes), then its details indented
function describeEvent(event: ScheduleEvent, alarms: Alarm[]) {
  const when = event.at ? `once at ${new Date(event.at).toLocaleString(undefined, { timeZone: currentTimeZone() })}` : `${event.time} on ${event.weekdays.join(" ")}`;
  const alarm = alarms.find((candidate) => candidate.eventId === event.id);
  const extra = [event.minutes ? `${event.minutes} min` : "", event.rings ? `rings at its start: ${event.rings}${alarm ? ` [alarm ${alarm.id}]` : ""}` : "doesn't ring"].filter(Boolean).join(", ");
  const details = event.details ? `\n${event.details.replace(/^/gm, "    ")}` : "";
  return `- ${when} ${event.title || "Event"} [${event.id}] (${extra})${details}`;
}

type Ring = { key: string; title: string; kind: Alarm["kind"] | null; time: string; weekdays: string[] };

// The one-off alarms a move of the ring made (movedLabel), for restore_ring to delete
const movedAlarms = (snapshot: Snapshot, ring: Ring, day: string) =>
  snapshot.alarms.filter((alarm) => alarm.at && alarm.label === movedLabel(ring.title, ring.time) && toISODate(new Date(alarm.at)) === day);

// How far off a due date is, in words: an open deadline can be past
const dueIn = (days: number) => (days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `overdue by ${-days} ${days === -1 ? "day" : "days"}`);

// The tracker as an indented outline an agent can read. As in the app, a finished box
// is one line and a finished quest is listed under Completed (or Archived, if shelved); asking for
// one quest shows it in full.
function describe(snapshot: Snapshot, questId?: string) {
  const model = buildGraphModel(snapshot);
  const folds = (id: string) => !questId && isFinished(model, id);
  const quests = (model.children.get(null) ?? []).filter((quest) => (questId ? quest.id === questId : true));
  // One quest asked for is shown whether or not it is shelved
  const inView = (quest: GraphNode) => !quest.shelved || Boolean(questId);
  const completed = quests.filter((quest) => inView(quest) && folds(quest.id));
  const shown = quests.filter((quest) => inView(quest) && !folds(quest.id));
  const archived = quests.filter((quest) => !inView(quest) && model.finishedAt.has(quest.id));
  const shelved = quests.filter((quest) => !inView(quest) && !model.finishedAt.has(quest.id));
  const lines: string[] = [];

  const shownIds = new Set(shown.map((quest) => quest.id));
  const ready = snapshot.nodes.filter((node) => (node.parentId || needsFirstStep(model, node)) && model.ready.has(node.id) && shownIds.has(questOf(model.byId, node).id));
  const priorities = derivePriorities(model, snapshot);
  // As in the app: a quiet quest's steps are listed with it, not again under Also ready
  const quiet = goneQuiet(model, priorities, today()).filter(({ quest }) => shownIds.has(quest.id));
  const quietIds = new Set(quiet.map(({ quest }) => quest.id));
  const prioritised = prioritisedSteps(model, snapshot, priorities).flatMap(({ priority, steps }) =>
    steps.filter((node) => shownIds.has(questOf(model.byId, node).id)).map((node) => `- P${priority} ${node.title} [${node.id}] (${prioritySource(model, priorities, node.id)})${needsFirstStep(model, node) ? " (a quest with no steps yet: it needs a first step)" : ""}`),
  );
  const unprioritised = ready.filter((node) => !priorities.effective.has(node.id) && !quietIds.has(questOf(model.byId, node).id)).map((node) => `- ${node.title} [${node.id}]${needsFirstStep(model, node) ? " (a quest with no steps yet)" : ""}`);
  lines.push("To-do (what the app lists under Now: ready to do now, with a priority, and where the priority comes from):", ...(prioritised.length ? prioritised : ["- nothing"]), "");
  lines.push("Also ready, no priority (not on the user's to-do):", ...(unprioritised.length ? unprioritised : ["- nothing"]), "");
  if (quiet.length) lines.push("Gone quiet (open steps, nothing done for 3 days on a P1 quest or a week on any other, on the to-do or not; the user may want to act on it, change its priority, or shelve it):", ...quiet.map(({ quest, days, openSteps, priority }) => `- ${quest.title} [${quest.id}]${priority ? ` (P${priority})` : ""}: quiet ${days} days, ${openSteps} open ${openSteps === 1 ? "step" : "steps"}`), "");

  for (const quest of shown) {
    const level = nodeLevel(model.totalXp.get(quest.id) ?? 0);
    const trains = trainedStats(quest.statWeights).map(([key, weight]) => `${key} ${weight}`);
    lines.push(`# ${quest.title} [${quest.id}] Lv ${level.level}${trains.length ? `, trains ${trains.join(", ")}` : ""}${quest.priority ? `, P${quest.priority}` : ""}${quest.shelved ? " (shelved)" : ""}`);
    if (quest.description) lines.push(...descriptionLines(quest.description, ""));
    outline(model, snapshot, quest.id, 1, lines, folds);
    lines.push("");
  }
  const listed = (quest: GraphNode) => `- ${quest.title} [${quest.id}]`;
  if (completed.length) lines.push("Completed quests (every step done; adding a step brings one back):", ...completed.map(listed), "");
  if (shelved.length) lines.push("Shelved quests (off the graph and the to-do; `unshelve` brings one back):", ...shelved.map(listed), "");
  if (archived.length) lines.push("Archived quests (finished and shelved):", ...archived.map(listed), "");

  const describeDeadline = (deadline: Snapshot["deadlines"][number]) =>
    `- ${deadline.title} [${deadline.id}]${deadline.nodeId ? `, linked to ${model.byId.get(deadline.nodeId)?.title}` : ""}: due ${deadline.dueDate} (${dueIn(daysBetween(today(), deadline.dueDate))})${deadline.alarmTime ? `, alarm at ${deadline.alarmTime}` : ""}`;
  if (questId) {
    const linked = snapshot.deadlines.filter((deadline) => deadline.nodeId && model.byId.has(deadline.nodeId) && questOf(model.byId, model.byId.get(deadline.nodeId)!).id === questId);
    lines.push("Deadlines linked to this quest:", ...(linked.length ? linked.map(describeDeadline) : ["- none"]));
  }

  if (!questId) {
    const weekday = weekdayOf(today());
    const checked = new Set(snapshot.routineChecks.filter((check) => check.date === today()).map((check) => check.routineId));
    const titleOf = (key: string) => {
      const [, kind, ringId] = /^(\w+):([^@]+)@/.exec(key) ?? [];
      const source = kind === "routine" ? snapshot.routines.find((routine) => routine.id === ringId) : kind === "alarm" ? snapshot.alarms.find((alarm) => alarm.id === ringId) : undefined;
      return source ? `${"title" in source ? source.title : source.label || "Alarm"} [${ringId}]` : key;
    };
    const skips = snapshot.skippedAlarms.filter((skip) => skip.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
    const rings = snapshot.alarms.filter((alarm) => !alarm.eventId);
    lines.push(
      "Routines (today's tick shown for those due today):",
      ...(snapshot.routines.length
        ? [...snapshot.routines].sort(byTime).map((routine) => {
            const due = routine.weekdays.includes(weekday) ? ` today [${checked.has(routine.id) ? "x" : " "}]` : "";
            return `- ${routine.time ? `${routine.time} ` : ""}${routine.title} [${routine.id}] on ${routine.weekdays.join(" ")}${routine.cue ? ` (${routine.cue})` : ""}${routine.alarm !== "none" ? ` (alarm: ${routine.alarm})` : ""}${due}`;
          })
        : ["- none"]),
      "",
      "Skipped rings ahead (restore_ring undoes one):",
      ...(skips.length ? skips.map((skip) => `- ${skip.date} ${titleOf(skip.key)}`) : ["- none"]),
      "",
      "Alarms:",
      ...(rings.length ? rings.map(describeAlarm) : ["- none"]),
      "",
      "Events (change with update_event):",
      ...(snapshot.events.length ? snapshot.events.map((event) => describeEvent(event, snapshot.alarms)) : ["- none"]),
      "",
      "Open deadlines:",
      ...(snapshot.deadlines.length ? snapshot.deadlines.map(describeDeadline) : ["- none"]),
      "",
      "Kitchen (more with the kitchen tool):",
      describeKitchen(snapshot.kitchen, true),
    );
  }

  return lines.join("\n");
}

// Where a covered node's priority comes from: set on it, or a chain it is in
function prioritySource(model: GraphModel, priorities: Priorities, nodeId: string) {
  const from = priorities.origin.get(nodeId)!;
  return from === nodeId ? "set on it" : `from ${model.byId.get(from)?.title} [${from}]`;
}

function priorityText(model: GraphModel, priorities: Priorities, nodeId: string) {
  const priority = priorities.effective.get(nodeId);
  return priority ? `P${priority}, ${prioritySource(model, priorities, nodeId)}` : "no priority";
}

function outline(model: GraphModel, snapshot: Snapshot, parentId: string, depth: number, lines: string[], folds: (id: string) => boolean) {
  for (const step of model.children.get(parentId) ?? []) {
    const after = snapshot.edges.filter((edge) => edge.to === step.id).map((edge) => model.byId.get(edge.from)?.title);
    const folded = folds(step.id);
    const marks = `${step.priority ? ` P${step.priority}` : ""}${after.length ? ` (after: ${after.join("; ")})` : ""}${step.shelved ? " (shelved)" : ""}${folded ? ` (finished: ${subtreeSize(model, step.id) - 1} steps folded)` : ""}`;
    lines.push(`${"  ".repeat(depth - 1)}- [${isDone(step) ? "x" : " "}] ${step.title} [${step.id}]${marks}`);
    if (step.description && !folded) lines.push(...descriptionLines(step.description, `${"  ".repeat(depth)}`));
    if (!folded) outline(model, snapshot, step.id, depth + 1, lines, folds);
  }
}

// A description under its node, each line indented and quoted with "> "
function descriptionLines(description: string, indent: string) {
  return description.split("\n").map((line) => `${indent}> ${line}`);
}

function subtreeSize(model: GraphModel, id: string): number {
  return 1 + (model.children.get(id) ?? []).reduce((sum, step) => sum + subtreeSize(model, step.id), 0);
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

function failure(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
