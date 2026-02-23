# Message Event Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track inter-agent message events (💬 emoji) across the dashboard TUI and Supabase exporter with per-project breakdown and Today/7d/All time aggregation.

**Architecture:** Add 💬 to the existing emoji-based event classification in both dashboard.py and the exporter. The dashboard already handles time-range and per-project filtering for all events in EMOJI_COUNT_MAP, so adding the new key propagates automatically. The exporter follows the same pattern as agentSpawns — a new counter threaded through aggregation, sync types, and upsert queries.

**Tech Stack:** Python/Textual (dashboard), TypeScript/Bun (exporter), Supabase/PostgreSQL (schema)

---

### Task 1: Add 💬 to dashboard data layer

**Files:**
- Modify: `dashboard.py:33-48` (EVENT_STYLES)
- Modify: `dashboard.py:141-147` (EMOJI_COUNT_MAP)

**Step 1: Add to EVENT_STYLES**

In `EVENT_STYLES` dict (line 33-48), add after the `"👥"` entry:

```python
    "💬": "bold #5fd7d7",
```

**Step 2: Add to EMOJI_COUNT_MAP**

In `EMOJI_COUNT_MAP` dict (line 141-147), add `"💬": "messages"` on the line with agent-related entries (after `"🤖": "subagents"`):

```python
EMOJI_COUNT_MAP = {
    "🔧": "tools", "📖": "reads", "🔍": "searches", "🌐": "fetches",
    "🔌": "mcp", "⚡": "skills", "🚀": "agents", "🤖": "subagents",
    "💬": "messages",
    "🛬": "landed", "🏁": "finished", "📐": "plans", "🟢": "sessions",
    "🔴": "ended", "👋": "input", "🔐": "permission", "❓": "questions",
    "✅": "completed", "⚠️": "compacts",
}
```

**Step 3: Verify — no other changes needed**

`count_events()` at line 153 iterates `EMOJI_COUNT_MAP.values()` to initialize counters and `.items()` to count. Adding the key is sufficient. `_filter_entries_by_time()` and per-project filtering are upstream of `count_events()`, so time-range and project scoping work automatically.

**Step 4: Commit**

```bash
git add dashboard.py
git commit -m "feat(dashboard): add 💬 message event to data layer"
```

---

### Task 2: Add 💬 row to stats sidebar

**Files:**
- Modify: `dashboard.py:1432-1433` (_update_stats_panel)

**Step 1: Add the display row**

In `_update_stats_panel()` (line 1416), insert a new row between the "🤖 Agent task" row (line 1432) and the "🛬 Agent finished" row (line 1433):

```python
        table.add_row("🤖 Agent task", str(counts["subagents"]))
        table.add_row("💬 Message", str(counts["messages"]))
        table.add_row("🛬 Agent finished", str(counts["landed"]))
```

**Step 2: Verify manually**

```bash
python3 dashboard.py
```

Open the dashboard, check the Stats sidebar shows "💬 Message" with a count. Switch between Today/7d/All to confirm filtering works.

**Step 3: Commit**

```bash
git add dashboard.py
git commit -m "feat(dashboard): display 💬 Message row in stats sidebar"
```

---

### Task 3: Add 💬 to exporter parser

**Files:**
- Modify: `exporter/parsers.ts:27-47` (EMOJI_TYPE_MAP)

**Step 1: Add emoji mapping**

In `EMOJI_TYPE_MAP` (line 27), add after the `"📋": "task"` entry:

```typescript
  "💬": "message",
```

**Step 2: Commit**

```bash
git add exporter/parsers.ts
git commit -m "feat(exporter): add 💬 message to emoji type map"
```

---

### Task 4: Add teamMessages to exporter aggregation

**Files:**
- Modify: `exporter/index.ts:138-139` (cachedLifetimeCounters type)
- Modify: `exporter/index.ts:231` (counts initializer in aggregateProjectEvents)
- Modify: `exporter/index.ts:235-238` (event type counting)
- Modify: `exporter/index.ts:302-311` (lifetime counter loading)
- Modify: `exporter/index.ts:425-437` (telemetry update building)
- Modify: `exporter/index.ts:484-494` (incremental lifetime loading)
- Modify: `exporter/index.ts:559-569` (project_telemetry fallback loading)

**Step 1: Update the counter type**

At line 138-139, add `teamMessages` to the type:

```typescript
let cachedLifetimeCounters: Record<string, {
  sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number;
}> = {};
```

**Step 2: Update aggregateProjectEvents initializer**

At line 231, add `teamMessages: 0`:

```typescript
      counts = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
```

**Step 3: Add the counting branch**

After line 238 (`else if (entry.eventType === "agent_spawn") counts.agentSpawns++;`), add:

```typescript
    else if (entry.eventType === "message") counts.teamMessages++;
```

**Step 4: Update all lifetime counter loading sites**

There are 3 locations where `cachedLifetimeCounters` objects are initialized/loaded. In each, add `teamMessages`:

At line 307:
```typescript
      if (!cachedLifetimeCounters[p]) cachedLifetimeCounters[p] = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
```
After line 311, add:
```typescript
      cachedLifetimeCounters[p].teamMessages += Number(row.team_messages) || 0;
```

At line 426:
```typescript
    const counters = cachedLifetimeCounters[slug] ?? { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
```

At line 487/490 (incremental lifetime loading):
```typescript
      const sums: Record<string, { sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number }> = {};
```
```typescript
        if (!sums[p]) sums[p] = { sessions: 0, messages: 0, toolCalls: 0, agentSpawns: 0, teamMessages: 0 };
```
After line 494, add:
```typescript
        sums[p].teamMessages += Number(row.team_messages) || 0;
```

At line 567-569 (project_telemetry fallback loading), add `teamMessages`:
```typescript
        cachedLifetimeCounters[p] = {
          sessions: Number(row.sessions_lifetime) || 0,
          messages: Number(row.messages_lifetime) || 0,
          toolCalls: Number(row.tool_calls_lifetime) || 0,
          agentSpawns: Number(row.agent_spawns_lifetime) || 0,
          teamMessages: Number(row.team_messages_lifetime) || 0,
        };
```

**Step 5: Commit**

```bash
git add exporter/index.ts
git commit -m "feat(exporter): aggregate teamMessages in per-project events"
```

---

### Task 5: Add team_messages to exporter sync types and upserts

**Files:**
- Modify: `exporter/sync.ts:162-166` (ProjectEventAggregates type)
- Modify: `exporter/sync.ts:256` (keys type in syncProjectDailyMetrics)
- Modify: `exporter/sync.ts:313-317` (update object)
- Modify: `exporter/sync.ts:326-330` (insert object)
- Modify: `exporter/sync.ts:406-410` (ProjectTelemetryUpdate interface)
- Modify: `exporter/sync.ts:421-425` (upsert mapping)

**Step 1: Update ProjectEventAggregates type**

At line 162-166:

```typescript
/** project → date → { sessions, messages, toolCalls, agentSpawns, teamMessages } */
export type ProjectEventAggregates = Map<
  string,
  Map<string, { sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number }>
>;
```

**Step 2: Update keys type in syncProjectDailyMetrics**

At line 256:

```typescript
  const keys = new Map<string, { tokens?: Record<string, number>; events?: { sessions: number; messages: number; toolCalls: number; agentSpawns: number; teamMessages: number } }>();
```

**Step 3: Add team_messages to update/insert objects**

At the update block (after line 317):
```typescript
        updates.team_messages = row.events.teamMessages;
```

At the insert block (line 326-330):
```typescript
      toInsert.push({
        date: row.date,
        project: row.project,
        tokens: row.tokens ?? null,
        sessions: row.events?.sessions ?? 0,
        messages: row.events?.messages ?? 0,
        tool_calls: row.events?.toolCalls ?? 0,
        agent_spawns: row.events?.agentSpawns ?? 0,
        team_messages: row.events?.teamMessages ?? 0,
      });
```

**Step 4: Update ProjectTelemetryUpdate interface**

At line 406-410, add:
```typescript
  teamMessagesLifetime: number;
```

**Step 5: Update upsert mapping**

At line 421-425, add:
```typescript
    team_messages_lifetime: u.teamMessagesLifetime,
```

**Step 6: Update telemetry update builder in index.ts**

At line 435-437, add `teamMessagesLifetime`:
```typescript
      teamMessagesLifetime: counters.teamMessages,
```

**Step 7: Update the select query for lifetime loading**

At lines 302 and 484, add `team_messages` to the select:
```typescript
      .select("project, sessions, messages, tool_calls, agent_spawns, team_messages")
```

At line 561, add `team_messages_lifetime` to the select:
```typescript
      .select("project, tokens_lifetime, tokens_today, models_today, sessions_lifetime, messages_lifetime, tool_calls_lifetime, agent_spawns_lifetime, team_messages_lifetime");
```

**Step 8: Commit**

```bash
git add exporter/sync.ts exporter/index.ts
git commit -m "feat(exporter): thread team_messages through sync and project_telemetry"
```

---

### Task 6: Add Supabase schema migration

**Files:**
- Create: `exporter/migrations/add-team-messages.sql`

**Step 1: Write the migration SQL**

```sql
-- Add team_messages column to daily_metrics
ALTER TABLE daily_metrics
  ADD COLUMN IF NOT EXISTS team_messages integer NOT NULL DEFAULT 0;

-- Add team_messages_lifetime column to project_telemetry
ALTER TABLE project_telemetry
  ADD COLUMN IF NOT EXISTS team_messages_lifetime integer NOT NULL DEFAULT 0;
```

**Step 2: Apply the migration via Supabase dashboard or CLI**

Run the SQL in the Supabase SQL editor for the lorf-site project.

**Step 3: Commit**

```bash
git add exporter/migrations/add-team-messages.sql
git commit -m "feat(exporter): add team_messages schema migration"
```

---

### Task 7: Smoke test

**Step 1: Run dashboard and verify**

```bash
python3 dashboard.py
```

Confirm "💬 Message" row appears in the stats sidebar. Switch time ranges. Filter by project if messages exist.

**Step 2: Run exporter and verify**

```bash
cd exporter && bun run index.ts
```

Check console output for successful sync. Verify in Supabase that `daily_metrics` rows include `team_messages` and `project_telemetry` rows include `team_messages_lifetime`.

**Step 3: Final commit (if any fixups)**

```bash
git add -A && git commit -m "fix: smoke test fixups for message event tracking"
```
