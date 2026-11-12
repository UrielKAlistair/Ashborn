// Sends the user's phones an FCM data message when a row their alarm schedule reads changes, so the
// phone refreshes its alarms at once. Called only by the database (request_push, migration
// 20261112200000), with the shared secret from Vault.
//
//   in:  POST {user_id, table}, header x-push-secret
//   out: {kind:"refresh", sent_at} to each of the user's devices, normal priority, or high when a ring
//        is due within RING_HORIZON; plus {kind:"call", id, at, label, sent_at}, high, for each call due
//        within it, once per call. All FCM data values are strings; times are epoch ms.
//
// Secrets: PUSH_SECRET (matches Vault's push_secret), FCM_SERVICE_ACCOUNT (the Firebase service
// account's JSON key). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
//   npx supabase functions deploy push --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// RefreshWake's 15-minute interval plus a margin: a ring further off reaches the phone by its wake
const RING_HORIZON = "20 minutes";
// A normal push waits this long and is dropped if a later one was asked for meanwhile
const DEBOUNCE_MS = 1500;
// A call this late no longer rings (the phone sends it straight to missed), so FCM may drop it
const STALE_CALL = "2 minutes";
const STALE_CALL_MS = 2 * 60_000;
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
type Message = { data: Record<string, string>; high: boolean; ttlMs?: number };

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const account: ServiceAccount = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "{}");

Deno.serve(async (request) => {
  if (request.method !== "POST" || request.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }
  const { user_id: userId } = (await request.json()) as { user_id: string; table: string };

  // The calls this request claims, and those a phone was sent
  const claimed: string[] = [];
  const delivered = new Set<string>();
  try {
    const messages = await messagesFor(userId, claimed);
    // Only a call skips the debounce: a ring due soon is still pushed high, a moment later
    if (claimed.length === 0 && !(await lastAsked(userId))) return Response.json({ sent: 0, debounced: true });

    const tokens = must(await db.from("push_devices").select("token").eq("user_id", userId)).map((row: { token: string }) => row.token);
    let sent = 0;
    for (const token of tokens) {
      for (const message of messages) {
        const status = await send(token, message);
        if (status === "gone") {
          await db.from("push_devices").delete().eq("token", token);
          break;
        }
        if (status === "sent") {
          sent++;
          if (message.data.kind === "call") delivered.add(message.data.id);
        }
      }
    }
    return Response.json({ sent });
  } finally {
    // A call no phone was sent, whatever stopped it, is unclaimed, so the next push tries it again
    const undelivered = claimed.filter((id) => !delivered.has(id));
    if (undelivered.length > 0) must(await db.from("call_pushes").delete().in("alarm_id", undelivered));
  }
});

// The refresh, and a message per call due soon, each call's id added to `claimed` as it is claimed.
// The calls are read here rather than from the trigger, so a call set by any client is pushed alike.
async function messagesFor(userId: string, claimed: string[]): Promise<Message[]> {
  const now = Date.now();
  const sentAt = String(now);
  const dueSoon = must(await db.rpc("push_ring_due_soon", { uid: userId, horizon: RING_HORIZON })) as boolean;
  const dueCalls = must(await db.rpc("push_due_calls", { uid: userId, stale: STALE_CALL, horizon: RING_HORIZON })) as { id: string; at: string; label: string }[];
  // Each call once: those this request claims first
  const calls = [];
  for (const call of dueCalls) {
    const rows = must(await db.from("call_pushes").upsert({ alarm_id: call.id }, { onConflict: "alarm_id", ignoreDuplicates: true }).select("alarm_id"));
    if (rows.length > 0) {
      claimed.push(call.id);
      calls.push(call);
    }
  }
  const high = dueSoon || calls.length > 0;
  if (high) console.log(`high push for ${userId}: ${calls.length > 0 ? `${calls.length} call(s)` : "ring due soon"}`);
  return [
    ...calls.map((call) => {
      const at = new Date(call.at).getTime();
      return { high: true, ttlMs: Math.max(0, at + STALE_CALL_MS - now), data: { kind: "call", id: call.id, at: String(at), label: call.label, sent_at: sentAt } };
    }),
    { high, data: { kind: "refresh", sent_at: sentAt } },
  ];
}

// Records this request as the latest, waits, and says whether it still is
async function lastAsked(userId: string) {
  const askedAt = new Date().toISOString();
  must(await db.from("push_requests").upsert({ user_id: userId, asked_at: askedAt }));
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
  const row = must(await db.from("push_requests").select("asked_at").eq("user_id", userId).single()) as { asked_at: string };
  return new Date(row.asked_at).getTime() === new Date(askedAt).getTime();
}

async function send(token: string, message: Message): Promise<"sent" | "gone" | "failed"> {
  let response: Response;
  try {
    response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data: message.data, android: { priority: message.high ? "HIGH" : "NORMAL", ...(message.ttlMs !== undefined && { ttl: `${Math.ceil(message.ttlMs / 1000)}s` }) } } }),
    });
  } catch (error) {
    console.error(`FCM unreachable: ${error}`);
    return "failed";
  }
  if (response.ok) return "sent";
  const text = await response.text();
  // A token the phone no longer holds (app reinstalled, data cleared)
  if (response.status === 404 || text.includes("UNREGISTERED")) return "gone";
  console.error(`FCM ${response.status}: ${text}`);
  return "failed";
}

// A Google OAuth access token for FCM, from a JWT signed with the service account's key; kept until
// a minute before it expires
let cached: { token: string; expiresAt: number } | null = null;
async function accessToken() {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const issued = Math.floor(Date.now() / 1000);
  const claims = { iss: account.client_email, scope: FCM_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600 };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64url(signature)}` }),
  });
  if (!response.ok) throw new Error(`Google token ${response.status}: ${await response.text()}`);
  const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
  cached = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return access_token;
}

function pemBytes(pem: string) {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function base64url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function must<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}
