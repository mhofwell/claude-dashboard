#!/usr/bin/env bun
/**
 * LORF Facility Startup Command
 *
 * Preflight checks, launchd management, health verification, status flip.
 * Only sets facility to "open" when the entire telemetry pipeline is verified healthy.
 *
 * Usage:
 *   bun run lorf-open.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, symlinkSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

// ─── Paths ──────────────────────────────────────────────────────────────────

const EXPORTER_DIR = dirname(new URL(import.meta.url).pathname);
const ENV_FILE = join(EXPORTER_DIR, ".env");
const PID_FILE = join(EXPORTER_DIR, ".exporter.pid");
const PLIST_NAME = "com.lorf.telemetry-exporter.plist";
const PLIST_SOURCE = join(EXPORTER_DIR, PLIST_NAME);
const PLIST_DEST = join(
  process.env.HOME!,
  "Library/LaunchAgents",
  PLIST_NAME
);
const ERR_LOG = join(process.env.HOME!, ".claude/lorf-exporter.err");
const SITE_URL = "https://looselyorganized.org";
const SITE_REPO_DIR = join(EXPORTER_DIR, "../../looselyorganized");

// ─── Visual Output ──────────────────────────────────────────────────────────

const PASS = "\x1b[32m[✓]\x1b[0m";
const FAIL = "\x1b[31m[✗]\x1b[0m";
const WARN = "\x1b[33m[!]\x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CREAM = "\x1b[38;5;223m";

function header() {
  console.log();
  console.log(`${DIM}┌─────────────────────────────────────────┐${RESET}`);
  console.log(`${DIM}│${RESET}  ${BOLD}LORF — Opening Research Facility${RESET}       ${DIM}│${RESET}`);
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

function abort(reason: string, hint?: string) {
  console.log();
  console.log(`  ${BOLD}\x1b[31mABORT${RESET} — Cannot open facility.`);
  console.log(`  ${reason}`);
  if (hint) console.log(`  ${DIM}${hint}${RESET}`);
  console.log();
  process.exit(1);
}

function summary(lines: Record<string, string>) {
  console.log();
  console.log(`  ${DIM}── Facility Open ──────────────────────${RESET}`);
  for (const [key, value] of Object.entries(lines)) {
    console.log(`  ${BOLD}${key}:${RESET} ${value}`);
  }
  console.log();
}

function readErrLogTail(lines = 10): string {
  try {
    if (!existsSync(ERR_LOG)) return "(no error log found)";
    const content = readFileSync(ERR_LOG, "utf-8").trim();
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch {
    return "(could not read error log)";
  }
}

// ─── Check Implementations ──────────────────────────────────────────────────

// These are filled in by subsequent tasks — this is the skeleton.

async function checkEnvironment(): Promise<{ url: string; key: string }> {
  // Task 2
  throw new Error("Not implemented");
}

async function checkSupabase(url: string, key: string): Promise<SupabaseClient> {
  // Task 3
  throw new Error("Not implemented");
}

async function checkRailway(): Promise<void> {
  // Task 4
  throw new Error("Not implemented");
}

async function checkSite(): Promise<void> {
  // Task 4
  throw new Error("Not implemented");
}

async function checkLaunchd(): Promise<void> {
  // Task 5
  throw new Error("Not implemented");
}

async function checkExporter(): Promise<number> {
  // Task 5
  throw new Error("Not implemented");
}

async function checkTelemetry(supabase: SupabaseClient): Promise<{ updatedAt: string; activeAgents: number; agentCount: number }> {
  // Task 6
  throw new Error("Not implemented");
}

async function flipFacilityOpen(supabase: SupabaseClient): Promise<void> {
  // Task 6
  throw new Error("Not implemented");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  header();

  // 1. Environment
  const { url, key } = await checkEnvironment();

  // 2. Supabase
  const supabase = await checkSupabase(url, key);

  // 3. Railway deployment
  await checkRailway();

  // 4. Site reachable
  await checkSite();

  // 5. Launchd service
  await checkLaunchd();

  // 6. Exporter process
  const pid = await checkExporter();

  // 7. Telemetry flowing
  const telemetry = await checkTelemetry(supabase);

  // 8. Flip status
  await flipFacilityOpen(supabase);

  // Summary
  const ago = Math.round(
    (Date.now() - new Date(telemetry.updatedAt).getTime()) / 1000
  );
  summary({
    Exporter: `PID ${pid} (launchd managed)`,
    Agents: `${telemetry.agentCount} instances, ${telemetry.activeAgents} active`,
    "Last sync": `${ago}s ago`,
  });
}

main().catch((err) => {
  console.error();
  console.error(`  Unexpected error: ${err.message}`);
  process.exit(1);
});
