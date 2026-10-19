// Ashborn's MCP server: lets an agent read and edit your threads, steps, links, routines and
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
import { createApi } from "../src/lib/api";
import { buildGraphModel, isDone, threadOf, type GraphModel } from "../src/pages/home/graphModel";
import { daysBetween, today, week, weekdayOf } from "../src/shared/dates";
import { nodeLevel } from "../src/shared/progression";
import { byTime, nextOccurrence } from "../src/shared/schedule";
import { threadColors, type Delta, type Snapshot, type StatKey } from "../src/shared/types";

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
        "Shows the user's tracker: steps ready to do now, every thread with its steps nested as an indented list (done steps marked [x], prerequisites shown as 'after'), hidden threads, today's routines and open deadlines. Ids in brackets are what the other tools take. Call this first.",
      inputSchema: { thread_id: z.string().optional().describe("Show only this thread") },
    },
    async ({ thread_id }) => text(describe(await api.getSnapshot(), thread_id)),
  );

  server.registerTool(
    "add_plan",
    {
      description:
        "Adds several steps at once, nested and linked: the main way to turn a plan into the graph. Each step has a short `ref` of your choosing; `parent` puts it inside another step (a ref from this call or an existing id), otherwise it goes under `parent_id`. `after` lists prerequisites that must be done first; they must share the step's parent. List parents before their steps. With parent_id null, top-level entries become new threads.",
      inputSchema: {
        parent_id: z.string().nullable().describe("Existing node the plan goes into, or null for new threads"),
        steps: z
          .array(
            z.object({
              ref: z.string().describe("Your label for this step, unique in this call"),
              title: z.string(),
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
    "reopen",
    { description: "Marks done steps as not done.", inputSchema: { ids } },
    async ({ ids }) => run(ids.map((nodeId) => () => api.updateNode(nodeId, { done: false })), "Reopened"),
  );

  server.registerTool(
    "rename",
    { description: "Renames a thread or step.", inputSchema: { id, title: z.string().min(1) } },
    async ({ id, title }) => run([() => api.updateNode(id, { title })], "Renamed"),
  );

  server.registerTool(
    "move",
    {
      description: "Moves a step (with its own steps) into another node, or makes it a thread with parent_id null. Its links are removed, since links only join steps in the same box.",
      inputSchema: { id, parent_id: z.string().nullable() },
    },
    async ({ id, parent_id }) => run([() => api.moveNode(id, parent_id)], "Moved"),
  );

  server.registerTool(
    "delete",
    { description: "Deletes a thread or step together with every step inside it. Cannot be undone.", inputSchema: { id } },
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
      description: "Logs a session of progress on a thread (10 XP), for work that did not complete a step.",
      inputSchema: { id },
    },
    async ({ id }) => run([() => api.levelUp(id)], "Levelled up"),
  );

  server.registerTool(
    "update_thread",
    {
      description: "Sets which stat a thread trains, its colour (null is white), and whether it is shown on the dashboard.",
      inputSchema: {
        id,
        stat: z.enum(["STR", "DEX", "INT", "WIS", "CHR", "MND"]).nullable().optional(),
        color: z.enum(threadColors).nullable().optional(),
        shown: z.boolean().optional(),
      },
    },
    async ({ id, stat, color, shown }) => run([() => api.updateNode(id, { stat: stat as StatKey | null | undefined, color, active: shown })], "Updated"),
  );

  server.registerTool(
    "add_deadline",
    {
      description: "Adds a dated obligation, optionally with an alarm at a time on its due day (rings on the phone).",
      inputSchema: { title: z.string().min(1), due_date: z.string().describe("YYYY-MM-DD"), alarm_time: clock.optional() },
    },
    async ({ title, due_date, alarm_time }) =>
      run([() => api.createDeadline({ title, dueDate: due_date, alarmTime: alarm_time ?? null })], "Added deadline"),
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
        [() => api.createRoutine({ title, cue: cue ?? "", weekdays: weekdays as typeof week, time: time ?? null, alarm: alarm ?? "none" })],
        "Added routine",
      );
    },
  );
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
function describe(snapshot: Snapshot, threadId?: string) {
  const model = buildGraphModel(snapshot);
  const threads = (model.children.get(null) ?? []).filter((thread) => (threadId ? thread.id === threadId : true));
  const shown = threads.filter((thread) => thread.active);
  const hidden = threads.filter((thread) => !thread.active);
  const lines: string[] = [];

  const shownIds = new Set(shown.map((thread) => thread.id));
  const ready = snapshot.nodes.filter((node) => node.parentId && model.ready.has(node.id) && shownIds.has(threadOf(model.byId, node).id));
  lines.push("Up next (ready to do now):", ...(ready.length ? ready.map((node) => `- ${node.title} [${node.id}]`) : ["- nothing"]), "");

  for (const thread of shown) {
    const level = nodeLevel(model.totalXp.get(thread.id) ?? 0);
    lines.push(`# ${thread.title} [${thread.id}] Lv ${level.level}${thread.stat ? `, trains ${thread.stat}` : ""}${thread.color ? `, ${thread.color}` : ""}`);
    outline(model, snapshot, thread.id, 1, lines);
    lines.push("");
  }
  if (hidden.length) lines.push("Hidden threads:", ...hidden.map((thread) => `- ${thread.title} [${thread.id}]`), "");

  if (!threadId) {
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
    );
  }

  return lines.join("\n");
}

function outline(model: GraphModel, snapshot: Snapshot, parentId: string, depth: number, lines: string[]) {
  for (const step of model.children.get(parentId) ?? []) {
    const after = snapshot.edges.filter((edge) => edge.to === step.id).map((edge) => model.byId.get(edge.from)?.title);
    lines.push(`${"  ".repeat(depth - 1)}- [${isDone(step) ? "x" : " "}] ${step.title} [${step.id}]${after.length ? ` (after: ${after.join("; ")})` : ""}`);
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
