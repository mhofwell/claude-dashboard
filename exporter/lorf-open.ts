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
  if (!existsSync(ENV_FILE)) {
    fail("Environment", ".env file not found");
    abort(
      `Expected .env at ${ENV_FILE}`,
      "Copy .env.example to .env and fill in your Supabase credentials."
    );
  }

  // Load .env manually (bun auto-loads .env in cwd, but we may not be in exporter dir)
  const envContent = readFileSync(ENV_FILE, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    fail("Environment", "Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
    abort(
      "Required environment variables are not set in .env",
      "Check .env.example for the required variables."
    );
  }

  pass("Environment", ".env loaded, credentials present");
  return { url: url!, key: key! };
}

async function checkSupabase(url: string, key: string): Promise<SupabaseClient> {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const start = Date.now();
  const { data, error } = await supabase
    .from("facility_status")
    .select("id, status, active_agents")
    .eq("id", 1)
    .single();
  const latency = Date.now() - start;

  if (error) {
    fail("Supabase", `Connection failed (${error.message})`);
    if (error.message.includes("401") || error.message.includes("403")) {
      abort(
        "Supabase credentials are invalid or expired.",
        "Check SUPABASE_SECRET_KEY in .env"
      );
    }
    abort(
      `Supabase returned: ${error.message}`,
      "Check https://status.supabase.com or verify SUPABASE_URL in .env"
    );
  }

  if (!data) {
    fail("Supabase", "No facility_status row found");
    abort("facility_status table is empty (expected row id=1).");
  }

  // If already open and we want to be idempotent, note it
  if (data.status === "active") {
    pass("Supabase", `Connected (${latency}ms) — facility already active`);
  } else {
    pass("Supabase", `Connected (${latency}ms)`);
  }

  return supabase;
}

async function checkRailway(): Promise<void> {
  // Check if railway CLI exists
  try {
    await $`command -v railway`.quiet();
  } catch {
    warn("Railway", "CLI not installed — skipping deployment check");
    return;
  }

  try {
    const result = await $`cd ${SITE_REPO_DIR} && railway status --json`
      .quiet()
      .timeout(10_000);
    const status = JSON.parse(result.stdout.toString());

    // Find the service instance and its latest deployment
    const env = status.environments?.edges?.[0]?.node;
    const service = env?.serviceInstances?.edges?.[0]?.node;
    const deployment = service?.latestDeployment;

    if (!deployment) {
      warn("Railway", "No deployment found — skipping");
      return;
    }

    const deployStatus = deployment.status as string;
    const createdAt = new Date(deployment.createdAt as string);
    const agoMs = Date.now() - createdAt.getTime();
    const agoHours = Math.round(agoMs / 3_600_000);
    const agoStr = agoHours < 1 ? `${Math.round(agoMs / 60_000)}m ago` : `${agoHours}h ago`;

    if (deployStatus === "SUCCESS") {
      pass("Railway", `${service.serviceName} deployed (${deployStatus}, ${agoStr})`);
    } else if (deployStatus === "BUILDING" || deployStatus === "DEPLOYING") {
      warn("Railway", `${service.serviceName} ${deployStatus.toLowerCase()} (started ${agoStr}) — previous deployment still serves`);
    } else {
      // FAILED, CRASHED, etc — flag but don't abort yet (site check will determine)
      fail("Railway", `${service.serviceName} ${deployStatus} (${agoStr})`);
    }
  } catch (err: any) {
    if (err.message?.includes("No linked project")) {
      warn("Railway", "No project linked in site directory — skipping");
    } else {
      warn("Railway", `Could not check (${err.message?.slice(0, 60) ?? "unknown error"})`);
    }
  }
}

async function checkSite(): Promise<void> {
  try {
    const start = Date.now();
    const response = await fetch(SITE_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    });
    const latency = Date.now() - start;

    if (response.ok) {
      pass("Site", `${SITE_URL} reachable (${response.status}, ${latency}ms)`);
    } else {
      fail("Site", `${SITE_URL} returned ${response.status} ${response.statusText}`);
      abort(
        `The site is returning HTTP ${response.status}.`,
        "Check Railway dashboard or run: railway logs"
      );
    }
  } catch (err: any) {
    fail("Site", `${SITE_URL} unreachable`);
    abort(
      `Could not reach site: ${err.message}`,
      "Check DNS, Railway status, or your network connection."
    );
  }
}

async function checkLaunchd(): Promise<void> {
  // 1. Ensure plist symlink exists
  if (!existsSync(PLIST_DEST)) {
    if (!existsSync(PLIST_SOURCE)) {
      fail("Launchd", "Plist file missing from exporter directory");
      abort(
        `Expected ${PLIST_SOURCE}`,
        "The launchd plist was deleted. Recreate it or restore from git."
      );
    }
    try {
      symlinkSync(PLIST_SOURCE, PLIST_DEST);
      pass("Launchd", `Symlink created → ${PLIST_DEST}`);
    } catch (err: any) {
      fail("Launchd", `Could not create symlink: ${err.message}`);
      abort(`Failed to symlink plist to LaunchAgents.`);
    }
  }

  // 2. Check if service is loaded
  try {
    const result = await $`launchctl list`.quiet();
    const output = result.stdout.toString();
    const isLoaded = output.includes("com.lorf.telemetry-exporter");

    if (isLoaded) {
      pass("Launchd", "Service loaded (com.lorf.telemetry-exporter)");
      return;
    }
  } catch {
    // launchctl list failed entirely — unusual
  }

  // 3. Not loaded — load it
  try {
    await $`launchctl load ${PLIST_DEST}`.quiet();
    pass("Launchd", "Service loaded (was not loaded, loaded now)");
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() ?? "";
    if (stderr.includes("service already loaded")) {
      pass("Launchd", "Service loaded (already loaded)");
    } else {
      fail("Launchd", `launchctl load failed`);
      abort(
        `launchctl load returned: ${stderr.trim() || err.message}`,
        "Try manually: launchctl load ~/Library/LaunchAgents/com.lorf.telemetry-exporter.plist"
      );
    }
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkExporter(): Promise<number> {
  // Check PID file
  if (existsSync(PID_FILE)) {
    const pidStr = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    if (!isNaN(pid) && isProcessRunning(pid)) {
      pass("Exporter", `Running (PID ${pid})`);
      return pid;
    }
    // Stale PID file — clean it up
    try {
      const { unlinkSync } = await import("fs");
      unlinkSync(PID_FILE);
    } catch {}
  }

  // Not running — wait for launchd to spawn it (we just loaded the service)
  const MAX_WAIT = 5_000;
  const POLL_INTERVAL = 500;
  let waited = 0;

  while (waited < MAX_WAIT) {
    await Bun.sleep(POLL_INTERVAL);
    waited += POLL_INTERVAL;

    if (existsSync(PID_FILE)) {
      const pidStr = readFileSync(PID_FILE, "utf-8").trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid) && isProcessRunning(pid)) {
        pass("Exporter", `Running (PID ${pid}, started after ${waited}ms)`);
        return pid;
      }
    }
  }

  // Still not running after waiting
  fail("Exporter", "Not running after 5s wait");
  const errTail = readErrLogTail(10);
  console.log();
  console.log(`  ${DIM}── Last 10 lines of ${ERR_LOG} ──${RESET}`);
  for (const line of errTail.split("\n")) {
    console.log(`  ${DIM}${line}${RESET}`);
  }
  abort(
    "Exporter did not start. Check error log above.",
    `Log: ${ERR_LOG}`
  );

  return -1; // unreachable (abort exits)
}

async function checkTelemetry(
  supabase: SupabaseClient
): Promise<{ updatedAt: string; activeAgents: number; agentCount: number }> {
  // First read
  const { data: first, error: err1 } = await supabase
    .from("facility_status")
    .select("updated_at, active_agents")
    .eq("id", 1)
    .single();

  if (err1 || !first) {
    fail("Telemetry", "Could not read facility_status");
    abort(`Supabase query failed: ${err1?.message ?? "no data"}`);
  }

  const firstUpdated = new Date(first.updated_at as string);
  const firstAge = Date.now() - firstUpdated.getTime();

  // If updated very recently (< 10s), trust it without waiting
  if (firstAge < 10_000) {
    // Also grab agent counts from project_telemetry
    const { data: ptRows } = await supabase
      .from("project_telemetry")
      .select("active_agents, agent_count");
    const totalAgents = ptRows?.reduce((sum, r) => sum + (Number(r.agent_count) || 0), 0) ?? 0;
    const activeAgents = ptRows?.reduce((sum, r) => sum + (Number(r.active_agents) || 0), 0) ?? 0;

    pass("Telemetry", `Data flowing (updated ${Math.round(firstAge / 1000)}s ago)`);
    return { updatedAt: first.updated_at as string, activeAgents, agentCount: totalAgents };
  }

  // Wait 6s (slightly longer than the 5s aggregate cycle) and check again
  const waitMs = 6_000;
  await Bun.sleep(waitMs);

  const { data: second, error: err2 } = await supabase
    .from("facility_status")
    .select("updated_at, active_agents")
    .eq("id", 1)
    .single();

  if (err2 || !second) {
    fail("Telemetry", "Could not re-read facility_status");
    abort(`Supabase query failed: ${err2?.message ?? "no data"}`);
  }

  const secondUpdated = new Date(second.updated_at as string);

  if (secondUpdated > firstUpdated) {
    const { data: ptRows } = await supabase
      .from("project_telemetry")
      .select("active_agents, agent_count");
    const totalAgents = ptRows?.reduce((sum, r) => sum + (Number(r.agent_count) || 0), 0) ?? 0;
    const activeAgents = ptRows?.reduce((sum, r) => sum + (Number(r.active_agents) || 0), 0) ?? 0;
    const age = Math.round((Date.now() - secondUpdated.getTime()) / 1000);

    pass("Telemetry", `Data flowing (updated ${age}s ago)`);
    return { updatedAt: second.updated_at as string, activeAgents, agentCount: totalAgents };
  }

  // Timestamp didn't advance — exporter is alive but not writing
  fail("Telemetry", `Stale — last update was ${Math.round(firstAge / 1000)}s ago, no change after ${waitMs / 1000}s`);
  const errTail = readErrLogTail(10);
  console.log();
  console.log(`  ${DIM}── Last 10 lines of ${ERR_LOG} ──${RESET}`);
  for (const line of errTail.split("\n")) {
    console.log(`  ${DIM}${line}${RESET}`);
  }
  abort(
    "Exporter process is running but not writing telemetry.",
    "It may be stuck or failing silently. Check the error log above."
  );

  // unreachable
  return { updatedAt: "", activeAgents: 0, agentCount: 0 };
}

async function flipFacilityOpen(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase
    .from("facility_status")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    fail("Facility", `Failed to set status (${error.message})`);
    abort("Could not update facility_status to active.");
  }

  // Verify the write
  const { data } = await supabase
    .from("facility_status")
    .select("status")
    .eq("id", 1)
    .single();

  if (data?.status !== "active") {
    fail("Facility", "Write succeeded but read-back shows wrong status");
    abort("facility_status.status is not 'active' after update.");
  }

  pass("Facility", "Status → active");
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
