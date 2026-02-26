---
type: "milestone"
date: "2026-02-25"
title: "lo-open startup command"
commits: 10
---

Replaced naive facility switch with comprehensive `lo-open` running 8 sequential preflight checks — environment, Supabase, deployment health, site reachability, launchd, exporter process, telemetry flow, and status flip. Self-heals launchd and exporter. Matching `lo-close` performs graceful shutdown: SIGTERM, launchd unload. PID guard and strict project scanning added to exporter.
