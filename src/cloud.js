import { createClient } from "@supabase/supabase-js";

// These are public values by design (the anon key is meant to ship in the client;
// data is protected by the code-gated RPC functions in Supabase). Safe to commit.
export const SUPABASE_URL = "https://sajxckfiknndrgbwflsp.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhanhja2Zpa25uZHJnYndmbHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzU4MjgsImV4cCI6MjA5MjM1MTgyOH0.zrLYqOTI3lYX-KaCiZXoHMMwWHy6hBLM52LgG94iyNY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

// Load a household's data blob (returns null if it doesn't exist yet).
export async function cloudLoad(code) {
  const { data, error } = await supabase.rpc("hh_load", { p_code: code });
  if (error) throw error;
  return data;
}

// Upsert a household's data blob. Returns the server updated_at.
export async function cloudSave(code, payload) {
  const { data, error } = await supabase.rpc("hh_save", { p_code: code, p_data: payload });
  if (error) throw error;
  return data;
}

// Generate a readable, hard-to-guess household code like "OUCHI-7K2F-9Q3M".
export function makeHouseholdCode() {
  const cs = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const grp = () => Array.from({ length: 4 }, () => cs[Math.floor(Math.random() * cs.length)]).join("");
  return `OUCHI-${grp()}-${grp()}`;
}
