# lo-open Startup Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the naive `lo-open` facility switch with a comprehensive preflight + startup command that only reports "open" when the entire telemetry pipeline is verified healthy.

**Architecture:** A standalone `lo-open.ts` script runs 8 sequential health checks (env, Supabase, Railway, site, launchd, exporter, telemetry, status flip). Each check prints a visual status line. Hard failures abort with error details. The exporter daemon continues to be managed by launchd — `lo-open` is a verification/repair layer, not a process manager.

**Tech Stack:** Bun, @supabase/supabase-js, Railway CLI, launchd (macOS), shell aliases

**Design doc:** `docs/plans/2026-02-25-lo-open-startup-command-design.md`

---

### Task 1: Create lo-open.ts with visual output helpers

**Files:**
- Create: `exporter/lo-open.ts`
- Reference: `exporter/facility-switch.ts` (will be replaced by this)

**Step 1: Create the script with output helpers and main skeleton**

The visual language uses box-drawing for the header and check/cross marks for each step.

```ts
#!/usr/bin/env bun
/**
 * LO Facility Startup Command
 *
 * Preflight checks, launchd management, health verification, status flip.
 * Only sets facility to "open" when the entire telemetry pipeline is verified healthy.
 *
 * Usage:
 *   bun run lo-open.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, symlinkSync } from "fs";
import { join, dirname } from "path";
import { $ } from "bun";

// ─── Paths ──────────────────────────────────────────────────────────────────

const EXPORTER_DIR = dirname(new URL(import.meta.url).pathname);
const ENV_FILE = join(EXPORTER_DIR, ".env");
const PID_FILE = join(EXPORTER_DIR, ".exporter.pid");
const PLIST_NAME = "com.lo.telemetry-exporter.plist";
const PLIST_SOURCE = join(EXPORTER_DIR, PLIST_NAME);
const PLIST_DEST = join(
  process.env.HOME!,
  "Library/LaunchAgents",
  PLIST_NAME
);
const ERR_LOG = join(process.env.HOME!, ".claude/lo-exporter.err");
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
  console.log(`${DIM}│${RESET}  ${BOLD}LO — Opening Research Facility${RESET}       ${DIM}│${RESET}`);
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
```

**Step 2: Verify the script parses without errors**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-open.ts 2>&1 || true`
Expected: Fails with "Not implemented" (the skeleton works but checks aren't wired)

**Step 3: Commit**

```bash
git add exporter/lo-open.ts
git commit -m "feat: scaffold lo-open.ts with visual output helpers and main flow"
```

---

### Task 2: Implement environment and Supabase checks

**Files:**
- Modify: `exporter/lo-open.ts` (replace `checkEnvironment` and `checkSupabase`)

**Step 1: Implement checkEnvironment**

Replace the `checkEnvironment` stub with:

```ts
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
```

**Step 2: Implement checkSupabase**

Replace the `checkSupabase` stub with:

```ts
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
```

**Step 3: Test the two checks work**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-open.ts 2>&1 || true`
Expected: Environment ✓, Supabase ✓, then fails on "Not implemented" at checkRailway

**Step 4: Commit**

```bash
git add exporter/lo-open.ts
git commit -m "feat: implement environment and Supabase preflight checks"
```

---

### Task 3: Implement Railway and site reachability checks

**Files:**
- Modify: `exporter/lo-open.ts` (replace `checkRailway` and `checkSite`)

**Step 1: Implement checkRailway**

Replace the `checkRailway` stub. This shells out to `railway status --json` from the site repo directory.

```ts
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
```

**Step 2: Implement checkSite**

Replace the `checkSite` stub:

```ts
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
```

**Step 3: Test checks 1-4**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-open.ts 2>&1 || true`
Expected: Environment ✓, Supabase ✓, Railway ✓, Site ✓, then "Not implemented" at checkLaunchd

**Step 4: Commit**

```bash
git add exporter/lo-open.ts
git commit -m "feat: implement Railway deployment and site reachability checks"
```

---

### Task 4: Implement launchd and exporter process checks

**Files:**
- Modify: `exporter/lo-open.ts` (replace `checkLaunchd` and `checkExporter`)

**Step 1: Implement checkLaunchd**

Replace the `checkLaunchd` stub:

```ts
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
    const isLoaded = output.includes("com.lo.telemetry-exporter");

    if (isLoaded) {
      pass("Launchd", "Service loaded (com.lo.telemetry-exporter)");
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
        "Try manually: launchctl load ~/Library/LaunchAgents/com.lo.telemetry-exporter.plist"
      );
    }
  }
}
```

**Step 2: Implement checkExporter**

Replace the `checkExporter` stub:

```ts
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
```

**Step 3: Test checks 1-6**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-open.ts 2>&1 || true`
Expected: All checks through Exporter should pass (or the exporter starts via launchd), then "Not implemented" at checkTelemetry

**Step 4: Commit**

```bash
git add exporter/lo-open.ts
git commit -m "feat: implement launchd and exporter process checks"
```

---

### Task 5: Implement telemetry verification and facility status flip

**Files:**
- Modify: `exporter/lo-open.ts` (replace `checkTelemetry` and `flipFacilityOpen`)

**Step 1: Implement checkTelemetry**

Replace the `checkTelemetry` stub. Polls `facility_status.updated_at` twice to verify the exporter is actually writing data.

```ts
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
```

**Step 2: Implement flipFacilityOpen**

Replace the `flipFacilityOpen` stub:

```ts
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
```

**Step 3: Full end-to-end test**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-open.ts`
Expected: All 8 checks pass, facility opens, summary prints

**Step 4: Commit**

```bash
git add exporter/lo-open.ts
git commit -m "feat: implement telemetry verification and facility status flip"
```

---

### Task 6: Create lo-close.ts

**Files:**
- Create: `exporter/lo-close.ts`

**Step 1: Write lo-close.ts**

Simpler script — just flips status to dormant with visual output.

```ts
#!/usr/bin/env bun
/**
 * LO Facility Close Command
 *
 * Sets facility status to dormant. Does NOT stop the exporter.
 * The exporter keeps running — its auto-close timer (2h idle) provides
 * the same behavior if you forget to close manually.
 *
 * Usage:
 *   bun run lo-close.ts
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
  console.log(`${DIM}│${RESET}  ${BOLD}LO — Closing Research Facility${RESET}       ${DIM}│${RESET}`);
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
```

**Step 2: Test it**

Run: `cd /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter && bun run lo-close.ts`
Expected: Prints header, sets dormant, shows exporter status

**Step 3: Commit**

```bash
git add exporter/lo-close.ts
git commit -m "feat: create lo-close.ts with visual output"
```

---

### Task 7: Update package.json scripts and shell aliases

**Files:**
- Modify: `exporter/package.json`
- Modify: `~/.zshrc:137-139`

**Step 1: Update package.json**

Replace the `open` and `close` scripts to point to the new files:

```json
{
  "scripts": {
    "start": "bun run index.ts",
    "backfill": "bun run index.ts --backfill",
    "open": "bun run lo-open.ts",
    "close": "bun run lo-close.ts"
  }
}
```

**Step 2: Update .zshrc aliases**

Replace lines 138-139 of `~/.zshrc`:

```zsh
# LO Facility Switch
alias lo-open="~/.bun/bin/bun run /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter/lo-open.ts"
alias lo-close="~/.bun/bin/bun run /Users/bigviking/Documents/github/projects/looselyorganized/claude-dashboard/exporter/lo-close.ts"
```

Uses full bun path (no PATH dependency) and runs from any directory.

**Step 3: Delete old facility-switch.ts**

```bash
rm exporter/facility-switch.ts
```

It's fully replaced by lo-open.ts and lo-close.ts.

**Step 4: Source and test**

Run: `source ~/.zshrc && lo-open`
Expected: Full preflight output, facility opens

**Step 5: Commit**

```bash
git add exporter/package.json exporter/lo-open.ts exporter/lo-close.ts
git rm exporter/facility-switch.ts
git commit -m "feat: replace facility-switch with lo-open/lo-close commands"
```

---

### Task 8: End-to-end verification

**No new files — verify the full flow works.**

**Step 1: Close facility**

Run: `lo-close`
Expected: Facility → dormant, exporter still running

**Step 2: Open facility**

Run: `lo-open`
Expected: All 8 checks pass, facility → active

**Step 3: Verify on site**

Open `https://looselyorganized.org` and confirm:
- AGENTS counter shows non-zero (if Claude instances are running)
- ACTIVE counter reflects actual state
- Braille indicators are animating
- Workstream events are flowing

**Step 4: Test failure mode — kill exporter**

Run: `launchctl unload ~/Library/LaunchAgents/com.lo.telemetry-exporter.plist`
Then: `lo-open`
Expected: Launchd check detects unloaded service, loads it, exporter starts, all checks pass

**Step 5: Verify exporter auto-restarted**

Run: `ps aux | grep "bun.*index.ts" | grep -v grep`
Expected: Exporter process is running
