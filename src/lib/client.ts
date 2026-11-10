// The app's one connection to Supabase, and the API built on it. Requests give up after 15 s and
// Supabase's own retries are off, because the offline queue (offline.ts) owns resending.
import { createClient } from "@supabase/supabase-js";
import { createApi } from "./api";

export const url = import.meta.env.VITE_SUPABASE_URL;
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (see .env.example).");
}

// A request still unanswered after this long is given up as a lost connection, so the change is
// queued and sent again. Without it a stalled request would hold every later change to its rows.
const REQUEST_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};

// The app's one connection to Supabase; the session is kept in local storage between launches.
// Supabase's own retries are off: the app sends again from its offline queue, and a read retried
// with backoff after a change would hold that change's rows for seconds before it is queued.
export const db = createClient(url, publishableKey, { global: { fetch: fetchWithTimeout }, db: { retry: false } });
export const api = createApi(db);
