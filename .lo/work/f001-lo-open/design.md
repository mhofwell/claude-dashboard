# lo-open Startup Command Design

**Date**: 2026-02-25
**Status**: Approved
**Scope**: claude-dashboard/exporter

## Problem

`lo-open` currently only flips `facility_status.status` to "active" in Supabase. It does not verify or manage the exporter process. This morning the exporter was dead (launchd service unloaded, process killed by a Supabase 500), but `lo-open` reported success — the facility showed "active" with zero telemetry flowing. Nothing should report "open" unless the system is actually healthy.

## Design

### Architecture

Two files:

| File | Purpose |
|------|---------|
| `exporter/lo-open.ts` | Preflight checks, launchd management, health verification, status flip |
| `~/.zshrc` alias | `alias lo-open="bun run ~/...exporter/lo-open.ts"` |

`lo-open.ts` is a short-lived command (not a daemon). It verifies health, ensures the exporter is running via launchd, confirms telemetry is flowing, then flips status to "open" and exits.

A corresponding `lo-close.ts` flips status to "dormant" but does NOT stop the exporter. The exporter's existing auto-close (2h idle) handles that.

### Process Lifecycle (launchd)

launchd owns the exporter process lifecycle:

- **Always on**: `KeepAlive: true`
- **Survives crashes**: auto-restart with `ThrottleInterval`
- **Survives reboots**: `RunAtLoad: true` in `~/Library/LaunchAgents/`
- **Intelligent backfill**: exporter's existing `gapBackfill()` detects offline windows via `facility_status.updated_at` and replays missed events on startup

`lo-open` is the verification + repair layer. It ensures launchd is configured correctly and confirms the exporter is actually running and healthy.

### Preflight Check Sequence (8 checks)

Each check prints a status line. Checks run in order; hard failures abort.

```
┌─────────────────────────────────────────┐
│  LO — Opening Research Facility         │
└─────────────────────────────────────────┘

  [✓] Environment       .env loaded, credentials present
  [✓] Supabase          Connection verified (48ms)
  [✓] Railway           looselyorganized deployed (SUCCESS, 14h ago)
  [✓] Site              looselyorganized.org reachable (200 OK, 312ms)
  [✓] Launchd           Service loaded (com.lo.telemetry-exporter)
  [✓] Exporter          Running (PID 12847, uptime 3m)
  [✓] Telemetry         Data flowing (updated 2s ago)
  [✓] Facility          Status → active

  ── Facility Open ──────────────────────
  Exporter: PID 12847 (launchd managed)
  Agents: 2 instances, 1 active
  Last sync: 2s ago
```

#### Check Details

1. **Environment** — `.env` exists in exporter dir, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are set and non-empty. HARD FAIL if missing.

2. **Supabase** — Test read of `facility_status` row (id=1). Measures latency. Catches 500s, auth failures (401/403), DNS resolution failures, timeouts. HARD FAIL.

3. **Railway** — `railway status --json` from the site repo. Parses latest deployment status. `SUCCESS` = pass. `BUILDING`/`DEPLOYING` = WARN (previous deployment still serves). `FAILED`/`CRASHED` = HARD FAIL only if site is also unreachable.

4. **Site** — HTTP GET `https://looselyorganized.org`, check for 200. Measures latency. Catches outages, DNS issues, Railway sleeping. HARD FAIL if combined with Railway FAILED.

5. **Launchd plist** — Check symlink exists at `~/Library/LaunchAgents/com.lo.telemetry-exporter.plist`. If missing, create it (symlink to exporter dir). Check service is loaded via `launchctl list`. If not loaded, run `launchctl load`. Report launchctl exit code on failure.

6. **Exporter process** — Read `.exporter.pid`, check if PID is alive (`kill -0`). If stale PID file, delete it. If process not running, wait up to 5s for launchd to spawn it (was just loaded/reloaded). If still not running after 5s, read last 10 lines of `~/.claude/lo-exporter.err` and display. HARD FAIL.

7. **Telemetry flowing** — Read `facility_status.updated_at`, wait 3s, read again. If timestamp advanced, telemetry is flowing. If not, the exporter may be alive but stuck — show last 10 lines of stderr log. HARD FAIL.

8. **Facility status flip** — Only reached if all 7 checks pass. Update `facility_status.status = 'active'`. Confirm the write succeeded by reading it back.

### Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Stale PID file | Delete if PID is dead, before launchd restart |
| Supabase outage | Fail at check 2, clear message + status page link |
| Exporter crash-looping | After launchctl load, detect via repeated PID changes in 5s window |
| Launchd refuses to load | Print exit code + known meanings |
| Already open | If status = "active" and exporter running, print stats, skip redundant work |
| Creds invalid | Supabase returns 401/403, print "credentials invalid" + instructions |
| Railway mid-deploy | WARN only — previous deployment still serves |
| Railway failed + site down | HARD FAIL — nobody can see telemetry |

### Failure Output

```
  [✓] Environment       .env loaded, credentials present
  [✗] Supabase          Connection failed (500 Internal Server Error)

  ABORT — Cannot open facility.
  Supabase returned HTTP 500. Check https://status.supabase.com
  The exporter will not start until Supabase is reachable.
```

### lo-close.ts

Simpler inverse:

```
┌─────────────────────────────────────────┐
│  LO — Closing Research Facility         │
└─────────────────────────────────────────┘

  [✓] Facility          Status → dormant

  ── Facility Closed ────────────────────
  Exporter: still running (PID 12847)
  Auto-close timer: 2h idle → dormant
```

Does NOT stop the exporter. Telemetry continues flowing silently.

### Exporter Resilience Improvement

Add circuit breaker to `index.ts`: if 3 consecutive Supabase calls fail, back off exponentially (5s → 10s → 20s → 60s cap). Reset on first success. Prevents crash-loop during transient Supabase outages.

### Shell Integration

```zsh
# ~/.zshrc
alias lo-open="~/.bun/bin/bun run ~/Documents/github/projects/looselyorganized/claude-dashboard/exporter/lo-open.ts"
alias lo-close="~/.bun/bin/bun run ~/Documents/github/projects/looselyorganized/claude-dashboard/exporter/lo-close.ts"
```
