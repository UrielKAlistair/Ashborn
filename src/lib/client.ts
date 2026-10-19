import { createClient } from "@supabase/supabase-js";
import { createApi } from "./api";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env (see .env.example).");
}

// The app's one connection to Supabase; the session is kept in local storage between launches
export const db = createClient(url, publishableKey);
export const api = createApi(db);
