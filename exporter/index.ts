#!/usr/bin/env bun
/**
 * LORF Telemetry Exporter
 *
 * Reads Claude Code telemetry from ~/.claude/ and pushes it to Supabase
 * for the Loosely Organized Research Facility operations dashboard.
 *
 * Usage:
 *   bun run index.ts              # Start the daemon (incremental sync)
 *   bun run index.ts --backfill   # Backfill all historical data, then run daemon
 */

import {
  LogTailer,
  readTokenStats,
  readModelStats,
  readStatsCache,
  type LogEntry,
} from "./parsers";
import { scanProcesses, getFacilityState } from "./process-scanner";
import { scanProjectTokens, computeTokensByProject } from "./project-scanner";
import {
  initSupabase,
  upsertProject,
  updateProjectActivity,
  insertEvents,
  syncDailyMetrics,
  syncProjectDailyMetrics,
  updateFacilityStatus,
  type FacilityUpdate,
  type ProjectEventAggregates,
} from "./sync";
import {
  loadVisibilityCache,
  getVisibility,
} from "./visibility-cache";

// ─── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUSH_ACTIVE = parseInt(process.env.PUSH_INTERVAL_ACTIVE ?? "30") * 1000;
const PUSH_DORMANT = parseInt(process.env.PUSH_INTERVAL_DORMANT ?? "300") * 1000;
const IS_BACKFILL = process.argv.includes("--backfill");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("Copy .env.example to .env and fill in your credentials.");
  process.exit(1);
}

// ─── Init ──────────────────────────────────────────────────────────────────

console.log("LORF Telemetry Exporter starting...");
console.log(`  Supabase: ${SUPABASE_URL}`);
console.log(`  Push interval: ${PUSH_ACTIVE / 1000}s active / ${PUSH_DORMANT / 1000}s dormant`);
console.log(`  Mode: ${IS_BACKFILL ? "BACKFILL + daemon" : "daemon (incremental)"}`);
console.log();

initSupabase(SUPABASE_URL, SUPABASE_KEY);
loadVisibilityCache();

const tailer = new LogTailer();

// Track projects we've already ensured exist in the DB
const knownProjects = new Set<string>();

// Cache project token totals for facility status updates
let cachedTokensByProject: Record<string, number> = {};

// ─── Ensure projects exist ─────────────────────────────────────────────────

async function ensureProjects(entries: LogEntry[]) {
  const newProjects = new Set<string>();
  for (const entry of entries) {
    if (entry.project && !knownProjects.has(entry.project)) {
      newProjects.add(entry.project);
    }
  }

  for (const name of newProjects) {
    const visibility = getVisibility(name);
    const firstEntry = entries.find((e) => e.project === name);
    await upsertProject(
      name,
      visibility,
      firstEntry?.parsedTimestamp ?? undefined
    );
    knownProjects.add(name);
    console.log(`  Project registered: ${name} (${visibility})`);
  }
}

// ─── Compute today's tokens ────────────────────────────────────────────────

function computeTodayTokens(): number {
  const statsCache = readStatsCache();
  if (!statsCache?.dailyModelTokens) return 0;

  const today = new Date().toISOString().split("T")[0];
  const todayEntry = statsCache.dailyModelTokens.find((d) => d.date === today);
  if (!todayEntry) return 0;

  return Object.values(todayEntry.tokensByModel).reduce((a, b) => a + b, 0);
}

// ─── Compute lifetime tokens from modelUsage ───────────────────────────────

function computeLifetimeTokens(
  statsCache: ReturnType<typeof readStatsCache>
): number {
  if (!statsCache?.modelUsage) return 0;
  let total = 0;
  for (const model of Object.values(statsCache.modelUsage)) {
    total +=
      (model.inputTokens ?? 0) +
      (model.outputTokens ?? 0) +
      (model.cacheReadInputTokens ?? 0) +
      (model.cacheCreationInputTokens ?? 0);
  }
  return total;
}

// ─── Aggregate per-project events ─────────────────────────────────────────

function aggregateProjectEvents(entries: LogEntry[]): ProjectEventAggregates {
  const agg: ProjectEventAggregates = new Map();

  for (const entry of entries) {
    if (!entry.project || !entry.parsedTimestamp) continue;

    const date = entry.parsedTimestamp.toISOString().split("T")[0];

    let dateMap = agg.get(entry.project);
    if (!dateMap) {
      dateMap = new Map();
      agg.set(entry.project, dateMap);
    }

    let counts = dateMap.get(date);
    if (!counts) {
      counts = { sessions: 0, messages: 0, toolCalls: 0 };
      dateMap.set(date, counts);
    }

    if (entry.eventType === "session_start") counts.sessions++;
    else if (entry.eventType === "response_finish") counts.messages++;
    else if (entry.eventType === "tool") counts.toolCalls++;
  }

  return agg;
}

// ─── Backfill ──────────────────────────────────────────────────────────────

async function backfill() {
  console.log("Starting backfill...");

  // 1. Read all events
  console.log("  Reading events.log...");
  const allEntries = tailer.readAll();
  console.log(`  Found ${allEntries.length} events`);

  // 2. Ensure all projects exist
  console.log("  Registering projects...");
  await ensureProjects(allEntries);

  // 3. Insert events in batches
  console.log("  Inserting events...");
  const { inserted, errors } = await insertEvents(allEntries);
  console.log(`  Inserted: ${inserted}, Errors: ${errors}`);

  // 4. Update project activity counts
  console.log("  Updating project activity...");
  const projectCounts: Record<string, { count: number; lastActive: Date }> = {};
  for (const entry of allEntries) {
    if (!entry.project) continue;
    if (!projectCounts[entry.project]) {
      projectCounts[entry.project] = { count: 0, lastActive: new Date(0) };
    }
    projectCounts[entry.project].count++;
    if (entry.parsedTimestamp && entry.parsedTimestamp > projectCounts[entry.project].lastActive) {
      projectCounts[entry.project].lastActive = entry.parsedTimestamp;
    }
  }
  for (const [name, data] of Object.entries(projectCounts)) {
    await updateProjectActivity(name, data.count, data.lastActive);
  }

  // 5. Sync daily metrics from stats-cache.json
  console.log("  Syncing daily metrics...");
  const statsCache = readStatsCache();
  if (statsCache) {
    const synced = await syncDailyMetrics(statsCache);
    console.log(`  Synced ${synced} daily metric rows`);
  }

  // 6. Scan and sync per-project token metrics + event counts from JSONL files
  console.log("  Scanning JSONL files for per-project tokens...");
  const projectTokenMap = scanProjectTokens();
  cachedTokensByProject = computeTokensByProject(projectTokenMap);
  const projectEventAggregates = aggregateProjectEvents(allEntries);
  const projectSynced = await syncProjectDailyMetrics(projectTokenMap, projectEventAggregates);
  console.log(`  Synced ${projectSynced} per-project daily metric rows`);

  // 7. Update facility status
  console.log("  Updating facility status...");
  await syncFacilityStatus();

  console.log("Backfill complete.\n");
}

// ─── Incremental sync ──────────────────────────────────────────────────────

async function incrementalSync() {
  const newEntries = tailer.poll();

  if (newEntries.length > 0) {
    // Ensure projects exist
    await ensureProjects(newEntries);

    // Insert new events
    const { inserted, errors } = await insertEvents(newEntries);
    if (inserted > 0 || errors > 0) {
      console.log(
        `  ${new Date().toLocaleTimeString()} — ${inserted} events synced${errors > 0 ? `, ${errors} errors` : ""}`
      );
    }

    // Update project activity
    const projectCounts: Record<string, { count: number; lastActive: Date }> = {};
    for (const entry of newEntries) {
      if (!entry.project) continue;
      if (!projectCounts[entry.project]) {
        projectCounts[entry.project] = { count: 0, lastActive: new Date(0) };
      }
      projectCounts[entry.project].count++;
      if (entry.parsedTimestamp && entry.parsedTimestamp > projectCounts[entry.project].lastActive) {
        projectCounts[entry.project].lastActive = entry.parsedTimestamp;
      }
    }
    for (const [name, data] of Object.entries(projectCounts)) {
      await updateProjectActivity(name, data.count, data.lastActive);
    }
  }

  // Always update facility status (live processes change independently)
  await syncFacilityStatus();
}

// ─── Facility status sync ──────────────────────────────────────────────────

async function syncFacilityStatus() {
  const facility = getFacilityState();
  const statsCache = readStatsCache();
  const modelStats = readModelStats();
  const tokenStats = readTokenStats();

  // Compute per-project agent breakdown
  const agentsByProject: Record<string, { count: number; active: number }> = {};
  for (const proc of facility.processes) {
    if (proc.projectName === "unknown") continue;
    if (!agentsByProject[proc.projectName]) {
      agentsByProject[proc.projectName] = { count: 0, active: 0 };
    }
    agentsByProject[proc.projectName].count++;
    if (proc.isActive) agentsByProject[proc.projectName].active++;
  }

  const update: FacilityUpdate = {
    status: facility.status,
    activeAgents: facility.activeAgents,
    activeProjects: facility.activeProjects,
    tokensLifetime: computeLifetimeTokens(statsCache),
    tokensToday: computeTodayTokens(),
    sessionsLifetime: statsCache?.totalSessions ?? 0,
    messagesLifetime: statsCache?.totalMessages ?? 0,
    modelStats: Object.fromEntries(
      modelStats.map((m) => [
        m.model,
        {
          total: m.total,
          input: m.input,
          cacheWrite: m.cacheWrite,
          cacheRead: m.cacheRead,
          output: m.output,
        },
      ])
    ),
    hourDistribution: statsCache?.hourCounts ?? {},
    firstSessionDate: statsCache?.firstSessionDate ?? null,
    tokensByProject: cachedTokensByProject,
    agentsByProject,
  };

  await updateFacilityStatus(update);
}

// ─── Periodic daily metrics sync ───────────────────────────────────────────

let lastDailySync = "";

async function maybeSyncDailyMetrics() {
  const today = new Date().toISOString().split("T")[0];
  if (today === lastDailySync) return; // Already synced today's data this cycle

  const statsCache = readStatsCache();
  if (statsCache) {
    await syncDailyMetrics(statsCache);
    lastDailySync = today;
  }
}

// ─── Periodic project daily metrics sync ────────────────────────────────────

let lastProjectSync = "";

async function maybeSyncProjectDailyMetrics() {
  const today = new Date().toISOString().split("T")[0];
  if (today === lastProjectSync) return;

  try {
    const projectTokenMap = scanProjectTokens();
    cachedTokensByProject = computeTokensByProject(projectTokenMap);
    const aggregationTailer = new LogTailer();
    const allEntries = aggregationTailer.readAll();
    const projectEventAggregates = aggregateProjectEvents(allEntries);
    await syncProjectDailyMetrics(projectTokenMap, projectEventAggregates);
    lastProjectSync = today;
  } catch (err) {
    console.error("Error syncing project daily metrics:", err);
  }
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function main() {
  if (IS_BACKFILL) {
    await backfill();
  } else {
    // Prime the tailer — read existing file to set offset, but don't backfill
    console.log("Priming log tailer (skipping existing entries)...");
    tailer.readAll(); // Sets offset to end of file
    console.log("  Ready — will only sync new events from this point.\n");
  }

  console.log("Daemon running. Press Ctrl+C to stop.\n");

  let cycleCount = 0;

  while (true) {
    try {
      await incrementalSync();

      // Sync daily metrics every ~10 cycles
      if (cycleCount % 10 === 0) {
        await maybeSyncDailyMetrics();
        await maybeSyncProjectDailyMetrics();
      }
      cycleCount++;
    } catch (err) {
      console.error("Sync error:", err);
    }

    // Adaptive sleep: shorter when active, longer when dormant
    const facility = getFacilityState();
    const sleepMs = facility.status === "active" ? PUSH_ACTIVE : PUSH_DORMANT;
    await Bun.sleep(sleepMs);
  }
}

// ─── Start ─────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
