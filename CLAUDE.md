# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

```bash
python3 dashboard.py
```

Requires `textual` and `rich` (`pip install textual rich`). No build system, tests, or linting — this is a single-file TUI utility.

## Architecture

**Single-file Textual TUI** (`dashboard.py`, ~2000 lines) that monitors Claude Code activity by reading files from `~/.claude/`.

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
