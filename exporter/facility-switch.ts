#!/usr/bin/env bun
/**
 * Manual facility open/close switch.
 *
 * Usage:
 *   bun run facility-switch.ts open   # lorf-open
 *   bun run facility-switch.ts close  # lorf-close
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const action = process.argv[2];
if (action !== "open" && action !== "close") {
  console.error("Usage: bun run facility-switch.ts [open|close]");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const status = action === "open" ? "active" : "dormant";

const { error } = await supabase
  .from("facility_status")
  .update({ status, updated_at: new Date().toISOString() })
  .eq("id", 1);

if (error) {
  console.error(`Failed to ${action} facility:`, error.message);
  process.exit(1);
}

console.log(`Facility ${action === "open" ? "opened" : "closed"}.`);
