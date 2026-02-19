# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

**Dashboard (TUI):**
```bash
pip install textual rich
python3 dashboard.py
```

**Exporter (Supabase sync):**
```bash
cd exporter
cp .env.example .env   # fill in Supabase credentials
bun install
bun run index.ts              # daemon (incremental sync)
bun run index.ts --backfill   # backfill all history, then daemon
```

No tests or linting in either component.

## Architecture

Two components that read the same `~/.claude/` telemetry files:

1. **`dashboard.py`** — Single-file Python TUI (~2000 lines) for local monitoring
2. **`exporter/`** — TypeScript/Bun daemon that syncs telemetry to Supabase (lorf-site project)

### Data Sources

| File | Format | Purpose |
|------|--------|---------|
| `~/.claude/events.log` | Pipe-delimited, emoji-tagged lines | Real-time event stream |
| `~/.claude/token-stats` | Space-separated: input cache_write cache_read output | Aggregate tokens |
| `~/.claude/model-stats` | Per-line: model total input cache_write cache_read output | Per-model tokens |
| `~/.claude/stats-cache.json` | JSON with dailyActivity, dailyModelTokens, modelUsage | Historical stats |

### Core Components

- **`LogTailer`** — Incremental file reader tracking byte offset; only reads new data each poll
- **`ProcessScanner`** — Detects running Claude processes via `ps`/`lsof`; resolves CWD, child processes, MCP servers, shell commands
- **`build_agent_tree()`** — Reconstructs session→agent hierarchy from event log using stack-based inference
- **`ClaudeDashboardApp`** — Main Textual app with three tabs: Live (log + sidebar), Stats (summary + daily token table), Instances (process table)

### Event Identification

Events are identified by emoji in log lines (🔧 tools, 📖 reads, 🟢 session start, 🏁 finished, etc.). The `count_events()` function tallies by emoji, and `EVENT_STYLES` maps emojis to Rich styles.

### Polling Intervals

- **0.5s** — New log entries + sidebar refresh
- **1.0s** — Header bar (instance count, RAM)
- **3.0s** — Process scan (`ps`/`lsof`)
- **30s** — Stats cache reload

### Live Data Supplementation

When the stats cache is stale (today's date ≠ `lastComputedDate`), the Stats tab and sidebar token panel supplement cached data with live reads from `model-stats` and `events.log`. This pattern appears in `_update_stats_summary`, `_update_token_panel`, and `_update_daily_tokens_table`.

### Key Patterns

- **Stable project colors**: `_project_color()` assigns deterministic colors from a 10-color palette
- **Model name formatting**: `format_model_name()` converts IDs like `claude-opus-4-6` → `Opus 4.6`
- **Token formatting**: `_format_tokens()` renders as B/M/K notation
- **Time range filtering**: `_filter_entries_by_time()` and `_filter_daily_by_range()` filter by Today/7d/All, used across all views
- **Compact mode**: `_compact_entries()` collapses consecutive same-type events into `(xN)` groups

---

## Exporter (`exporter/`)

TypeScript/Bun daemon that reads the same `~/.claude/` files and pushes telemetry to the **lorf-site** Supabase project.

### Files

| File | Purpose |
|------|---------|
| `index.ts` | Entry point — backfill, incremental sync loop, facility status |
| `sync.ts` | Supabase upsert functions for events, daily_metrics, facility_status, projects |
| `parsers.ts` | Log line parsing, timestamp parsing, LogTailer, stats file readers |
| `process-scanner.ts` | Detects running Claude processes via `ps`/`lsof` |
| `project-scanner.ts` | Scans JSONL conversation files for per-project token breakdowns |
| `visibility-cache.ts` | Maps project names to public/classified visibility |

### Supabase Tables

| Table | What it stores |
|-------|---------------|
| `events` | Every log line — timestamp, project, branch, emoji, event type, text |
| `projects` | One row per project — name, visibility, first_seen, last_active, total_events |
| `daily_metrics` | Global rows (project IS NULL) from stats-cache.json + per-project rows with tokens, sessions, messages, tool_calls |
| `facility_status` | Singleton live snapshot — status, active_agents, agents_by_project, tokens, model_stats, hour_distribution |

### Sync Cadence

- **Every cycle** (30s active / 5min dormant): new events + facility status
- **Every ~10 cycles**: daily metrics + per-project daily metrics
- **Backfill mode** (`--backfill`): full historical import, then switches to daemon
