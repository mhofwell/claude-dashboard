#!/usr/bin/env bun
/**
 * LORF Facility Close Command
 *
 * Graceful shutdown: flips status to dormant, stops the exporter,
 * unloads the launchd service.
 *
 * Usage:
 *   bun run lorf-close.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

// ─── Paths ──────────────────────────────────────────────────────────────────

const EXPORTER_DIR = dirname(new URL(import.meta.url).pathname);
const ENV_FILE = join(EXPORTER_DIR, ".env");
const PID_FILE = join(EXPORTER_DIR, ".exporter.pid");
const PLIST_NAME = "com.lorf.telemetry-exporter.plist";
const PLIST_DEST = join(
  process.env.HOME!,
  "Library/LaunchAgents",
  PLIST_NAME
);

// ─── Visual Output ──────────────────────────────────────────────────────────

const PASS = "\x1b[32m[✓]\x1b[0m";
const FAIL = "\x1b[31m[✗]\x1b[0m";
const WARN = "\x1b[33m[!]\x1b[0m";
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

function pass(label: string, detail: string) {
  const padded = label.padEnd(18);
  console.log(`  ${PASS} ${BOLD}${padded}${RESET} ${DIM}${detail}${RESET}`);
}

function fail(label: string, detail: string) {
  const padded = label.padEnd(18);
  console.log(`  ${FAIL} ${BOLD}${padded}${RESET} ${detail}`);
}

function warn(label: string, detail: string) {
  const padded = label.padEnd(18);
  console.log(`  ${WARN} ${BOLD}${padded}${RESET} ${detail}`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

  // 1. Flip status → dormant
  const { error } = await supabase
    .from("facility_status")
    .update({ status: "dormant", updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    fail("Facility", `Failed to set status (${error.message})`);
    process.exit(1);
  }

  pass("Facility", "Status → dormant");

  // 2. Stop exporter process (SIGTERM for graceful shutdown)
  let pid: number | null = null;
  if (existsSync(PID_FILE)) {
    const pidStr = readFileSync(PID_FILE, "utf-8").trim();
    pid = parseInt(pidStr, 10);
    if (isNaN(pid) || !isProcessRunning(pid)) {
      pid = null;
    }
  }

  if (pid) {
    // Send SIGTERM — let exporter finish current cycle
    process.kill(pid, "SIGTERM");

    // Wait for exit (up to 5s)
    const MAX_WAIT = 5_000;
    const POLL_INTERVAL = 250;
    let waited = 0;

    while (waited < MAX_WAIT && isProcessRunning(pid)) {
      await Bun.sleep(POLL_INTERVAL);
      waited += POLL_INTERVAL;
    }

    if (isProcessRunning(pid)) {
      // Still alive after 5s — force kill
      warn("Exporter", `PID ${pid} did not exit after ${MAX_WAIT / 1000}s, sending SIGKILL`);
      process.kill(pid, "SIGKILL");
      await Bun.sleep(500);
    }

    if (!isProcessRunning(pid)) {
      pass("Exporter", `Stopped (PID ${pid})`);
    } else {
      fail("Exporter", `PID ${pid} could not be killed`);
    }
  } else {
    pass("Exporter", "Already stopped");
  }

  // Clean up stale PID file
  if (existsSync(PID_FILE)) {
    try { unlinkSync(PID_FILE); } catch {}
  }

  // 3. Unload launchd service (prevents auto-restart)
  try {
    const result = await $`launchctl list`.quiet();
    const isLoaded = result.stdout.toString().includes("com.lorf.telemetry-exporter");

    if (isLoaded) {
      await $`launchctl unload ${PLIST_DEST}`.quiet();
      pass("Launchd", "Service unloaded");
    } else {
      pass("Launchd", "Service already unloaded");
    }
  } catch {
    warn("Launchd", "Could not check/unload service");
  }

  // Summary
  console.log();
  console.log(`  ${DIM}── Facility Closed ────────────────────${RESET}`);
  console.log(`  ${BOLD}Exporter:${RESET} stopped`);
  console.log(`  ${BOLD}Launchd:${RESET} unloaded (lorf-open will reload)`);
  console.log();
}

main().catch((err) => {
  console.error(`  Unexpected error: ${err.message}`);
  process.exit(1);
});
