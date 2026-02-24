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
  readModelStats,
  readStatsCache,
  type LogEntry,
} from "./parsers";
import { getFacilityState } from "./process-scanner";
import { scanProjectTokens, computeTokensByProject } from "./project-scanner";
import {
  initSupabase,
  getSupabase,
  upsertProject,
  updateProjectActivity,
  insertEvents,
  syncDailyMetrics,
  syncProjectDailyMetrics,
  updateFacilityStatus,
  batchUpsertProjectTelemetry,
  pruneOldEvents,
  pushAgentState,
  updateFacilityMetrics,
  setFacilitySwitch,
  type FacilityUpdate,
  type FacilityMetricsUpdate,
  type ProjectTelemetryUpdate,
  type ProjectEventAggregates,
} from "./sync";
import { ProcessWatcher } from "./process-watcher";
import {
  loadVisibilityCache,
  getVisibility,
} from "./visibility-cache";
import { buildSlugMap, clearSlugCache } from "./slug-resolver";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

// ─── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const IS_BACKFILL = process.argv.includes("--backfill");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  console.error("Copy .env.example to .env and fill in your credentials.");
  process.exit(1);
}

// ─── Init ──────────────────────────────────────────────────────────────────

console.log("LORF Telemetry Exporter starting...");
console.log(`  Supabase: ${SUPABASE_URL}`);
console.log(`  Watcher: 250ms poll (agent state push-on-change)`);
console.log(`  Aggregator: 5s cycle (tokens, sessions, events)`);
console.log(`  Mode: ${IS_BACKFILL ? "BACKFILL + daemon" : "daemon (incremental)"}`);
console.log();

initSupabase(SUPABASE_URL, SUPABASE_KEY);
loadVisibilityCache();

const tailer = new LogTailer();

// Track projects we've already ensured exist in the DB (by slug)
const knownProjects = new Set<string>();

// Directory name → slug mapping, refreshed every 10 cycles
let slugMap: Map<string, string> = new Map();

const SLUG_MAPPING_FILE = join(dirname(new URL(import.meta.url).pathname), ".slug-mapping.json");

function loadSavedSlugMapping(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SLUG_MAPPING_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveSlugMapping(mapping: Record<string, string>) {
  writeFileSync(SLUG_MAPPING_FILE, JSON.stringify(mapping, null, 2));
}

async function refreshSlugMap() {
  clearSlugCache();
  slugMap = buildSlugMap();
  console.log(`  Slug map: ${slugMap.size} projects mapped`);

  // Detect slug changes: if a dir name previously mapped to a different slug
  const saved = loadSavedSlugMapping();
  const current: Record<string, string> = {};
  for (const [dirName, slug] of slugMap) {
    current[dirName] = slug;
    const oldSlug = saved[dirName];
    if (oldSlug && oldSlug !== slug) {
      console.log(`  Slug change detected: ${dirName}: ${oldSlug} → ${slug}`);
      // Migrate existing telemetry data from old slug to new slug
      try {
        const sb = getSupabase();
        await sb.from("events").update({ project: slug }).eq("project", oldSlug);
        await sb.from("daily_metrics").update({ project: slug }).eq("project", oldSlug);
        await sb.from("project_telemetry").update({ project: slug }).eq("project", oldSlug);
        console.log(`  Migrated telemetry data: ${oldSlug} → ${slug}`);
      } catch (err) {
        console.error(`  Error migrating slug ${oldSlug} → ${slug}:`, err);
      }
    }
  }
  saveSlugMapping(current);
}

/** Map a directory name (from events.log) to its content_slug, or null if not a LORF project */
function toSlug(dirName: string): string | null {
  return slugMap.get(dirName) ?? null;
}

/** Filter entries to only LORF projects and map project fields to slugs */
function filterAndMapEntries(entries: LogEntry[]): LogEntry[] {
  return entries
    .filter((e) => e.project && toSlug(e.project) !== null)
    .map((e) => ({
      ...e,
      project: toSlug(e.project)!,
    }));
}

// Cache project token totals for facility status updates
let cachedTokensByProject: Record<string, number> = {};

// Cache per-project lifetime counters for project_telemetry writes
let cachedLifetimeCounters: Record<string, {
  sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number;
}> = {};

// Cache per-project today tokens for project_telemetry writes
let cachedTodayTokensByProject: Record<string, {
  total: number; models: Record<string, number>;
}> = {};

// Cache all seen log entries to avoid re-reading the entire events.log
let allSeenEntries: LogEntry[] = [];

// Cache model stats — only re-read from disk when new events arrive
let cachedModelStats: ReturnType<typeof readModelStats> = [];

// ─── Ensure projects exist ─────────────────────────────────────────────────

async function ensureProjects(entries: LogEntry[]) {
  const newSlugs = new Set<string>();
  const slugToLocalName = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.project) continue;
    const slug = toSlug(entry.project);
    if (!slug) continue; // Not a LORF project — skip
    if (!knownProjects.has(slug)) {
      newSlugs.add(slug);
      slugToLocalName.set(slug, entry.project);
    }
  }

  for (const slug of newSlugs) {
    const localName = slugToLocalName.get(slug) ?? slug;
    const visibility = getVisibility(localName);
    const firstEntry = entries.find((e) => toSlug(e.project) === slug);
    await upsertProject(
      slug,
      localName,
      visibility,
      firstEntry?.parsedTimestamp ?? undefined
    );
    knownProjects.add(slug);
    console.log(`  Project registered: ${slug}${slug !== localName ? ` (dir: ${localName})` : ""} (${visibility})`);
  }
}

// ─── Compute today's tokens ────────────────────────────────────────────────

function computeTodayTokens(): number {
  let total = 0;
  for (const entry of Object.values(cachedTodayTokensByProject)) {
    total += entry.total;
  }
  return total;
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

    const slug = toSlug(entry.project);
    if (!slug) continue; // Not a LORF project
    const date = entry.parsedTimestamp.toISOString().split("T")[0];

    let dateMap = agg.get(slug);
    if (!dateMap) {
      dateMap = new Map();
      agg.set(slug, dateMap);
    }

    let counts = dateMap.get(date);
    if (!counts) {
      counts = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
      dateMap.set(date, counts);
    }

    if (entry.eventType === "session_start") counts.sessions++;
    else if (entry.eventType === "response_finish") counts.messages++;
    else if (entry.eventType === "tool") counts.toolCalls++;
    else if (entry.eventType === "agent_spawn") counts.agentSpawns++;
    else if (entry.eventType === "message") counts.teamMessages++;
  }

  return agg;
}

// ─── Backfill ──────────────────────────────────────────────────────────────

async function backfill() {
  console.log("Starting backfill...");

  // 0. Build slug map
  await refreshSlugMap();

  // 1. Read all events
  console.log("  Reading events.log...");
  const allEntries = tailer.readAll();
  allSeenEntries = allEntries;
  console.log(`  Found ${allEntries.length} events`);

  // 2. Ensure all projects exist
  console.log("  Registering projects...");
  await ensureProjects(allEntries);

  // 3. Insert events in batches (with project mapped to slug)
  console.log("  Inserting events...");
  const lorfEntries = filterAndMapEntries(allEntries);
  const { inserted, errors, insertedByProject } = await insertEvents(lorfEntries);
  console.log(`  Inserted: ${inserted}, Errors: ${errors}`);

  // 4. Update project activity counts (insertedByProject keys are already slugs from lorfEntries)
  console.log("  Updating project activity...");
  const slugLastActive: Record<string, Date> = {};
  for (const entry of lorfEntries) {
    if (!entry.project || !entry.parsedTimestamp) continue;
    if (!slugLastActive[entry.project] || entry.parsedTimestamp > slugLastActive[entry.project]) {
      slugLastActive[entry.project] = entry.parsedTimestamp;
    }
  }
  for (const [slug, count] of Object.entries(insertedByProject)) {
    const lastActive = slugLastActive[slug] ?? new Date();
    await updateProjectActivity(slug, count, lastActive);
  }

  // 5. Sync daily metrics from stats-cache.json
  console.log("  Syncing daily metrics...");
  const statsCache = readStatsCache();
  cachedModelStats = readModelStats();
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

  // 7. Populate caches for project_telemetry writes from daily_metrics (authoritative)
  const { data: lifetimeRows } = await getSupabase()
    .from("daily_metrics")
    .select("project, sessions, messages, tool_calls, agent_spawns, team_messages")
    .not("project", "is", null);
  if (lifetimeRows) {
    for (const row of lifetimeRows) {
      const p = row.project as string;
      if (!cachedLifetimeCounters[p]) cachedLifetimeCounters[p] = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
      cachedLifetimeCounters[p].sessions += Number(row.sessions) || 0;
      cachedLifetimeCounters[p].messages += Number(row.messages) || 0;
      cachedLifetimeCounters[p].toolCalls += Number(row.tool_calls) || 0;
      cachedLifetimeCounters[p].agentSpawns += Number(row.agent_spawns) || 0;
      cachedLifetimeCounters[p].teamMessages += Number(row.team_messages) || 0;
    }
  }
  refreshTodayTokensCache(projectTokenMap, new Date().toISOString().split("T")[0]);

  // 8. Update facility status + project_telemetry
  console.log("  Updating facility status...");
  await syncFacilityStatus(statsCache, cachedModelStats);

  pruneSeenEntries();

  console.log("Backfill complete.\n");
}

// ─── Incremental sync ──────────────────────────────────────────────────────

async function incrementalSync() {
  const newEntries = tailer.poll();
  if (newEntries.length > 0) allSeenEntries.push(...newEntries);

  if (newEntries.length > 0) {
    // Ensure projects exist
    await ensureProjects(newEntries);

    // Insert new events (only LORF projects, mapped to slug)
    const lorfEntries = filterAndMapEntries(newEntries);
    const { inserted, errors, insertedByProject } = await insertEvents(lorfEntries);
    if (inserted > 0 || errors > 0) {
      console.log(
        `  ${new Date().toLocaleTimeString()} — ${inserted} events synced${errors > 0 ? `, ${errors} errors` : ""}`
      );
    }

    // Update project activity (insertedByProject keys are already slugs from lorfEntries)
    const slugLastActive: Record<string, Date> = {};
    for (const entry of lorfEntries) {
      if (!entry.project || !entry.parsedTimestamp) continue;
      if (!slugLastActive[entry.project] || entry.parsedTimestamp > slugLastActive[entry.project]) {
        slugLastActive[entry.project] = entry.parsedTimestamp;
      }
    }
    for (const [slug, count] of Object.entries(insertedByProject)) {
      const lastActive = slugLastActive[slug] ?? new Date();
      await updateProjectActivity(slug, count, lastActive);
    }
  }

  // Sync aggregate metrics (tokens, sessions — NOT agent state)
  const statsCache = readStatsCache();
  if (newEntries.length > 0) cachedModelStats = readModelStats();
  await syncAggregateMetrics(statsCache, cachedModelStats);
}

// ─── Facility status sync ──────────────────────────────────────────────────

async function syncFacilityStatus(
  statsCache: ReturnType<typeof readStatsCache>,
  modelStats: ReturnType<typeof readModelStats>
) {
  const facility = getFacilityState();

  // Compute per-project agent breakdown (keyed by slug)
  const agentsByProject: Record<string, { count: number; active: number }> = {};
  for (const proc of facility.processes) {
    if (proc.slug === "unknown") continue;
    if (!agentsByProject[proc.slug]) {
      agentsByProject[proc.slug] = { count: 0, active: 0 };
    }
    agentsByProject[proc.slug].count++;
    if (proc.isActive) agentsByProject[proc.slug].active++;
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
  };

  await updateFacilityStatus(update);

  // Build and write per-project telemetry rows
  const allSlugs = new Set([
    ...Object.keys(cachedTokensByProject),
    ...Object.keys(agentsByProject),
    ...Object.keys(cachedLifetimeCounters),
    ...Object.keys(cachedTodayTokensByProject),
  ]);

  const telemetryUpdates: ProjectTelemetryUpdate[] = [...allSlugs].map((slug) => {
    const counters = cachedLifetimeCounters[slug] ?? { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
    const todayData = cachedTodayTokensByProject[slug] ?? { total: 0, models: {} };
    const agents = agentsByProject[slug] ?? { count: 0, active: 0 };
    return {
      project: slug,
      tokensLifetime: cachedTokensByProject[slug] ?? 0,
      tokensToday: todayData.total,
      modelsToday: todayData.models,
      sessionsLifetime: counters.sessions,
      messagesLifetime: counters.messages,
      toolCallsLifetime: counters.toolCalls,
      agentSpawnsLifetime: counters.agentSpawns,
      teamMessagesLifetime: counters.teamMessages,
      activeAgents: agents.active,
      agentCount: agents.count,
    };
  });

  await batchUpsertProjectTelemetry(telemetryUpdates);

  return facility;
}

// ─── Aggregate metrics sync (daemon mode) ──────────────────────────────────

async function syncAggregateMetrics(
  statsCache: ReturnType<typeof readStatsCache>,
  modelStats: ReturnType<typeof readModelStats>
) {
  const metricsUpdate: FacilityMetricsUpdate = {
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
  };

  await updateFacilityMetrics(metricsUpdate);

  // Build per-project telemetry (aggregate fields only — skip agent fields)
  const allSlugs = new Set([
    ...Object.keys(cachedTokensByProject),
    ...Object.keys(cachedLifetimeCounters),
    ...Object.keys(cachedTodayTokensByProject),
  ]);

  const telemetryUpdates: ProjectTelemetryUpdate[] = [...allSlugs].map((slug) => {
    const counters = cachedLifetimeCounters[slug] ?? {
      sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0,
    };
    const todayData = cachedTodayTokensByProject[slug] ?? { total: 0, models: {} };
    return {
      project: slug,
      tokensLifetime: cachedTokensByProject[slug] ?? 0,
      tokensToday: todayData.total,
      modelsToday: todayData.models,
      sessionsLifetime: counters.sessions,
      messagesLifetime: counters.messages,
      toolCallsLifetime: counters.toolCalls,
      agentSpawnsLifetime: counters.agentSpawns,
      teamMessagesLifetime: counters.teamMessages,
      activeAgents: 0,
      agentCount: 0,
    };
  });

  await batchUpsertProjectTelemetry(telemetryUpdates, { skipAgentFields: true });
}

// ─── Periodic daily metrics sync ───────────────────────────────────────────

let lastDailySync = "";

async function maybeSyncDailyMetrics(
  statsCache: ReturnType<typeof readStatsCache>
) {
  const today = new Date().toISOString().split("T")[0];
  if (today === lastDailySync) return; // Already synced today's data this cycle

  if (statsCache) {
    await syncDailyMetrics(statsCache);
    lastDailySync = today;
  }
}

// ─── Periodic project daily metrics sync ────────────────────────────────────

let lastProjectSync = "";
let lastPruneDate = "";

async function maybeSyncProjectDailyMetrics() {
  const today = new Date().toISOString().split("T")[0];
  if (today === lastProjectSync) return;

  try {
    const projectTokenMap = scanProjectTokens();
    cachedTokensByProject = computeTokensByProject(projectTokenMap);
    const projectEventAggregates = aggregateProjectEvents(allSeenEntries);
    await syncProjectDailyMetrics(projectTokenMap, projectEventAggregates);

    // Refresh lifetime counters from daily_metrics (authoritative source)
    // We query the DB rather than using allSeenEntries because in daemon mode
    // allSeenEntries only contains events since startup, not the full history.
    const { data: lifetimeRows } = await getSupabase()
      .from("daily_metrics")
      .select("project, sessions, messages, tool_calls, agent_spawns, team_messages")
      .not("project", "is", null);
    if (lifetimeRows) {
      const sums: Record<string, { sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number }> = {};
      for (const row of lifetimeRows) {
        const p = row.project as string;
        if (!sums[p]) sums[p] = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
        sums[p].sessions += Number(row.sessions) || 0;
        sums[p].messages += Number(row.messages) || 0;
        sums[p].toolCalls += Number(row.tool_calls) || 0;
        sums[p].agentSpawns += Number(row.agent_spawns) || 0;
        sums[p].teamMessages += Number(row.team_messages) || 0;
      }
      cachedLifetimeCounters = sums;
    }
    refreshTodayTokensCache(projectTokenMap, today);

    lastProjectSync = today;
  } catch (err) {
    console.error("Error syncing project daily metrics:", err);
  }
}

/**
 * Re-scan JSONL files and refresh cachedTodayTokensByProject.
 * Runs on the 5-minute cycle so today's token counts stay current
 * throughout the day (not just on first sync).
 */
function refreshTodayTokensFromDisk() {
  const today = new Date().toISOString().split("T")[0];
  const projectTokenMap = scanProjectTokens();
  cachedTokensByProject = computeTokensByProject(projectTokenMap);
  refreshTodayTokensCache(projectTokenMap, today);
}

function refreshTodayTokensCache(projectTokenMap: ReturnType<typeof scanProjectTokens>, today: string) {
  for (const [slug, dateMap] of projectTokenMap) {
    const todayTokens = dateMap.get(today);
    if (todayTokens) {
      const total = Object.values(todayTokens).reduce((a, b) => a + b, 0);
      cachedTodayTokensByProject[slug] = { total, models: todayTokens };
    } else {
      cachedTodayTokensByProject[slug] = { total: 0, models: {} };
    }
  }
}

async function maybePruneEvents() {
  const today = new Date().toISOString().split("T")[0];
  if (today === lastPruneDate) return;

  try {
    const pruned = await pruneOldEvents(14);
    if (pruned > 0) {
      console.log(`  Pruned ${pruned} events older than 14 days`);
    }
    lastPruneDate = today;
  } catch (err) {
    console.error("Error pruning events:", err);
  }
}

// ─── Prune in-memory seen entries ───────────────────────────────────────────

function pruneSeenEntries() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 31);
  const before = allSeenEntries.length;
  allSeenEntries = allSeenEntries.filter(
    (e) => e.parsedTimestamp && e.parsedTimestamp >= cutoff
  );
  const pruned = before - allSeenEntries.length;
  if (pruned > 0) {
    console.log(`  Pruned ${pruned} in-memory entries older than 31 days`);
  }
}

// ─── Gap backfill ───────────────────────────────────────────────────────────

const GAP_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes — longer than any normal push cycle

async function gapBackfill(allEntries: LogEntry[]) {
  // Check when the exporter last pushed
  const { data: facilityRow } = await getSupabase()
    .from("facility_status")
    .select("updated_at")
    .single();

  const lastUpdated = facilityRow?.updated_at
    ? new Date(facilityRow.updated_at as string)
    : null;
  const gapMs = lastUpdated ? Date.now() - lastUpdated.getTime() : Infinity;

  if (gapMs < GAP_THRESHOLD_MS) {
    console.log(`  No gap detected (last update ${Math.round(gapMs / 1000)}s ago)`);
    return;
  }

  const gapMinutes = Math.round(gapMs / 60_000);
  console.log(`  Gap detected: exporter was offline for ~${gapMinutes} minutes`);
  console.log(`  Last update: ${lastUpdated?.toISOString() ?? "never"}`);

  // Filter entries to only those after the last update
  const gapEntries = lastUpdated
    ? allEntries.filter(
        (e) => e.parsedTimestamp && e.parsedTimestamp > lastUpdated
      )
    : allEntries;
  console.log(
    `  Found ${gapEntries.length} events in the gap (of ${allEntries.length} total)`
  );

  if (gapEntries.length === 0) {
    // No events in the gap, but still need to sync daily metrics and tokens
    console.log("  No events to backfill, syncing metrics only...");
  } else {
    // Ensure projects exist
    await ensureProjects(gapEntries);

    // Insert gap events
    const lorfEntries = filterAndMapEntries(gapEntries);
    const { inserted, errors, insertedByProject } =
      await insertEvents(lorfEntries);
    console.log(
      `  Gap backfill: ${inserted} events inserted${errors > 0 ? `, ${errors} errors` : ""}`
    );

    // Update project activity
    const slugLastActive: Record<string, Date> = {};
    for (const entry of lorfEntries) {
      if (!entry.project || !entry.parsedTimestamp) continue;
      if (
        !slugLastActive[entry.project] ||
        entry.parsedTimestamp > slugLastActive[entry.project]
      ) {
        slugLastActive[entry.project] = entry.parsedTimestamp;
      }
    }
    for (const [slug, count] of Object.entries(insertedByProject)) {
      const lastActive = slugLastActive[slug] ?? new Date();
      await updateProjectActivity(slug, count, lastActive);
    }

    // Keep gap entries in allSeenEntries for aggregation
    allSeenEntries.push(...gapEntries);
  }

  // Sync daily metrics (idempotent upserts — covers the full gap)
  const statsCache = readStatsCache();
  cachedModelStats = readModelStats();
  if (statsCache) {
    const synced = await syncDailyMetrics(statsCache);
    console.log(`  Gap backfill: synced ${synced} daily metric rows`);
  }

  // Scan JSONL files for per-project tokens (full scan, idempotent)
  const projectTokenMap = scanProjectTokens();
  cachedTokensByProject = computeTokensByProject(projectTokenMap);
  const projectEventAggregates = aggregateProjectEvents(allSeenEntries);
  const projectSynced = await syncProjectDailyMetrics(
    projectTokenMap,
    projectEventAggregates
  );
  console.log(
    `  Gap backfill: synced ${projectSynced} per-project daily metric rows`
  );

  // Populate caches from daily_metrics (authoritative)
  const { data: lifetimeRows } = await getSupabase()
    .from("daily_metrics")
    .select(
      "project, sessions, messages, tool_calls, agent_spawns, team_messages"
    )
    .not("project", "is", null);
  if (lifetimeRows) {
    const sums: Record<
      string,
      {
        sessions: number;
        messages: number;
        toolCalls: number;
        agentSpawns: number;
        teamMessages: number;
      }
    > = {};
    for (const row of lifetimeRows) {
      const p = row.project as string;
      if (!sums[p])
        sums[p] = {
          sessions: 0,
          messages: 0,
          toolCalls: 0,
          agentSpawns: 0,
          teamMessages: 0,
        };
      sums[p].sessions += Number(row.sessions) || 0;
      sums[p].messages += Number(row.messages) || 0;
      sums[p].toolCalls += Number(row.tool_calls) || 0;
      sums[p].agentSpawns += Number(row.agent_spawns) || 0;
      sums[p].teamMessages += Number(row.team_messages) || 0;
    }
    cachedLifetimeCounters = sums;
  }
  refreshTodayTokensCache(projectTokenMap, new Date().toISOString().split("T")[0]);

  // Update facility status with fresh data
  await syncFacilityStatus(statsCache, cachedModelStats);

  pruneSeenEntries();
  console.log("  Gap backfill complete.\n");
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function main() {
  if (IS_BACKFILL) {
    await backfill();
  } else {
    // Build initial slug map
    await refreshSlugMap();

    // Read all existing entries (sets tailer offset to end of file)
    console.log("Reading log file...");
    const allEntries = tailer.readAll();
    console.log(`  ${allEntries.length} entries in log`);

    // Check for gap and backfill missed events
    await gapBackfill(allEntries);

    // Seed caches from project_telemetry for ongoing updates
    console.log("  Loading cached telemetry from Supabase...");
    const { data: ptRows } = await getSupabase()
      .from("project_telemetry")
      .select("project, tokens_lifetime, tokens_today, models_today, sessions_lifetime, messages_lifetime, tool_calls_lifetime, agent_spawns_lifetime, team_messages_lifetime");
    if (ptRows && ptRows.length > 0) {
      for (const row of ptRows) {
        cachedTokensByProject[row.project] = Number(row.tokens_lifetime) || 0;
        cachedLifetimeCounters[row.project] = {
          sessions: Number(row.sessions_lifetime) || 0,
          messages: Number(row.messages_lifetime) || 0,
          toolCalls: Number(row.tool_calls_lifetime) || 0,
          agentSpawns: Number(row.agent_spawns_lifetime) || 0,
          teamMessages: Number(row.team_messages_lifetime) || 0,
        };
        const models = (row.models_today && typeof row.models_today === "object")
          ? row.models_today as Record<string, number>
          : {};
        cachedTodayTokensByProject[row.project] = {
          total: Number(row.tokens_today) || 0,
          models,
        };
      }
      console.log(`  Loaded ${ptRows.length} project telemetry entries`);
    }

    console.log("  Ready — will only sync new events from this point.\n");
  }

  console.log("Daemon running (250ms watcher + 5s aggregator). Press Ctrl+C to stop.\n");

  const watcher = new ProcessWatcher();

  // ── Auto-close: flip facility to dormant after 2h with no active agents ──
  const AUTO_CLOSE_MS = 2 * 60 * 60 * 1000; // 2 hours
  let lastActiveAgentTime = Date.now();
  let autoCloseFired = false;

  // ── Loop 1: Process Watcher (250ms) ──
  const watcherLoop = async () => {
    while (true) {
      try {
        const diff = watcher.tick();
        if (diff) {
          await pushAgentState(diff);
          for (const event of diff.events) {
            const ts = new Date().toLocaleTimeString();
            console.log(`  ${ts} [${event.type}] ${event.project} (pid ${event.pid})`);
          }
        }

        // Track active agents for auto-close (uses in-memory snapshot, no extra process scan)
        if (watcher.activeAgents > 0) {
          lastActiveAgentTime = Date.now();
          autoCloseFired = false;
        }

        // Auto-close after 2h of no active agents
        if (!autoCloseFired && Date.now() - lastActiveAgentTime > AUTO_CLOSE_MS) {
          await setFacilitySwitch("dormant");
          autoCloseFired = true;
          console.log(`  ${new Date().toLocaleTimeString()} [auto-close] Facility dormant after 2h idle`);
        }
      } catch (err) {
        console.error("Watcher error:", err);
      }
      await Bun.sleep(250);
    }
  };

  // ── Loop 2: Aggregate Metrics (5s) ──
  let cycleCount = 0;
  const aggregateLoop = async () => {
    while (true) {
      try {
        await incrementalSync();

        // Periodic tasks every ~60 cycles (~5 minutes at 5s interval)
        if (cycleCount % 60 === 0 && cycleCount > 0) {
          const statsCache = readStatsCache();
          await refreshSlugMap();
          refreshTodayTokensFromDisk();
          await Promise.all([
            maybeSyncDailyMetrics(statsCache),
            maybeSyncProjectDailyMetrics(),
            maybePruneEvents(),
          ]);
          pruneSeenEntries();
        }
        cycleCount++;
      } catch (err) {
        console.error("Aggregate sync error:", err);
      }
      await Bun.sleep(5000);
    }
  };

  // Run both loops concurrently
  await Promise.all([watcherLoop(), aggregateLoop()]);
}

// ─── Start ─────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
