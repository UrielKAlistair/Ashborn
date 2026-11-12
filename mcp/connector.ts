// Ashborn's agent tools as a hosted MCP server, for Claude's custom connectors (claude.ai, the
// phone app). A Supabase Edge Function: each request is signed in with an OAuth access token from
// Supabase Auth, and the tools act as that user, so the row rules bound them as in the app.
//
//   npm run connector:build    bundles this into supabase/functions/mcp/index.js
//   npm run connector:deploy   builds and deploys the function

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { readSettings } from "../src/lib/api";
import { setDayStartHour, setTimeZone } from "../src/shared/dates";
import { registerTools } from "./tools";

declare const Deno: { serve(handler: (request: Request) => Promise<Response>): unknown };

const NO_TIME_ZONE = "Ashborn doesn't know your time zone yet: open the Ashborn app once on your phone or laptop, then try again.";

// One request at a time in an isolate, a shortcut: the day-start hour and time zone are set
// process-wide per request (98), so two accounts' requests overlapping would read "today" in each
// other's zone. The fix is for the settings to travel with each request. With JSON replies, a
// request's tools have finished when its reply is made.
// A request that hangs gives up after REQUEST_MS, so it can't hold every later one; past MAX_WAITING
// queued, a request is turned away rather than queued without end.
const REQUEST_MS = 25_000;
const MAX_WAITING = 8;
let running: Promise<unknown> = Promise.resolve();
let waiting = 0;
function oneAtATime(serve: () => Promise<Response>): Promise<Response> {
  if (waiting >= MAX_WAITING) return Promise.resolve(new Response("Busy: try again in a moment", { status: 503, headers: { "Retry-After": "5" } }));
  waiting++;
  const timed = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Response>((resolve) => {
      timer = setTimeout(() => resolve(new Response("Timed out", { status: 504 })), REQUEST_MS);
    });
    return Promise.race([serve(), timeout]).finally(() => clearTimeout(timer));
  };
  const reply = running.then(timed, timed).finally(() => waiting--);
  running = reply.catch(() => undefined);
  return reply;
}

// Each request builds its own server: an Edge Function keeps no state between requests. The
// function runs in UTC, so dates and clock times are read in the user's zone from their settings.
Deno.serve(
  pipeline([withOAuthProtectedResource(), withSupabase({ auth: "user" })], (request, { supabase }) =>
    oneAtATime(async () => {
      const settings = await readSettings(supabase);
      setDayStartHour(settings.dayStartHour);
      setTimeZone(settings.timeZone);

      const server = new McpServer({ name: "ashborn", version: "0.1.0" });
      registerTools(server, supabase, () => (settings.timeZone ? null : NO_TIME_ZONE));
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      return transport.handleRequest(request);
    }),
  ),
);
