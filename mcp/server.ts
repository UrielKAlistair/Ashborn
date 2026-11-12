// Ashborn's MCP server on this computer: lets an agent (Claude Code) read and edit your quests, steps,
// links, routines, deadlines, alarms and Kitchen, signed in as you, with the tools in tools.ts (the
// hosted connector, connector.ts, serves the same tools). Changes show up live in the app. Dates are
// read in this computer's time zone.
//
//   npm run agent:login   sign in once (the session is kept in ~/.config/ashborn/agent-session.json)
//   npm run -s agent      start the server on stdio (what an MCP client runs, see .mcp.json)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prompter } from "../scripts/ask.mjs";
import { readSettings } from "../src/lib/api";
import { setDayStartHour } from "../src/shared/dates";
import { registerTools } from "./tools";

const sessionFile = process.env.ASHBORN_SESSION_FILE ?? path.join(homedir(), ".config", "ashborn", "agent-session.json");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.loadEnvFile(path.join(repoRoot, ".env"));
const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storage: fileStorage(sessionFile), persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

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

  // The user's day-start hour, for the tools' "today" from the first call (the overview reads it
  // again); unread (offline, say), the default stands until then
  await readSettings(db).then(({ dayStartHour }) => setDayStartHour(dayStartHour), () => undefined);
  const server = new McpServer({ name: "ashborn", version: "0.1.0" });
  registerTools(server, db);
  await server.connect(new StdioServerTransport());
}

// Keeps the Supabase session in a file only the user can read, so the agent stays signed in. Written
// whole beside it and moved into place, so a crash mid-write leaves the last good one.
function fileStorage(file: string): SupportedStorage {
  const read = (): Record<string, string> => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  const write = (items: Record<string, string>) => {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.partial`, JSON.stringify(items), { mode: 0o600 });
    chmodSync(`${file}.partial`, 0o600);
    renameSync(`${file}.partial`, file);
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
