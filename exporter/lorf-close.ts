#!/usr/bin/env bun
/**
 * LORF Facility Close Command
 *
 * Sets facility status to dormant. Does NOT stop the exporter.
 * The exporter keeps running — its auto-close timer (2h idle) provides
 * the same behavior if you forget to close manually.
 *
 * Usage:
 *   bun run lorf-close.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";

// ─── Paths ──────────────────────────────────────────────────────────────────

const EXPORTER_DIR = dirname(new URL(import.meta.url).pathname);
const ENV_FILE = join(EXPORTER_DIR, ".env");
const PID_FILE = join(EXPORTER_DIR, ".exporter.pid");

// ─── Visual Output ──────────────────────────────────────────────────────────

const PASS = "\x1b[32m[✓]\x1b[0m";
const FAIL = "\x1b[31m[✗]\x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function header() {
  console.log();
  console.log(`${DIM}┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${DIM}│${RESET}  ${BOLD}LORF — Closing Research Facility${RESET}       ${DIM}│${RESET}`);
  console.log(`${DIM}└─────────────────────────────────────────┘${RESET}`);
  console.log();
}

// ─── Load .env ──────────────────────────────────────────────────────────────

function loadEnv() {
  if (!existsSync(ENV_FILE)) {
    console.error(`  ${FAIL} .env not found at ${ENV_FILE}`);
    process.exit(1);
  }
  const content = readFileSync(ENV_FILE, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  header();
  loadEnv();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error(`  ${FAIL} Missing SUPABASE_URL or SUPABASE_SECRET_KEY`);
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase
    .from("facility_status")
    .update({ status: "dormant", updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    console.error(`  ${FAIL} ${BOLD}Facility${RESET}          Failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`  ${PASS} ${BOLD}${"Facility".padEnd(18)}${RESET} ${DIM}Status → dormant${RESET}`);

  // Check exporter status for informational output
  let exporterInfo = "not running";
  if (existsSync(PID_FILE)) {
    const pidStr = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    try {
      process.kill(pid, 0);
      exporterInfo = `still running (PID ${pid})`;
    } catch {
      exporterInfo = "not running";
    }
  }

  console.log();
  console.log(`  ${DIM}── Facility Closed ────────────────────${RESET}`);
  console.log(`  ${BOLD}Exporter:${RESET} ${exporterInfo}`);
  console.log(`  ${BOLD}Auto-close:${RESET} 2h idle → dormant`);
  console.log();
}

main().catch((err) => {
  console.error(`  Unexpected error: ${err.message}`);
  process.exit(1);
});
