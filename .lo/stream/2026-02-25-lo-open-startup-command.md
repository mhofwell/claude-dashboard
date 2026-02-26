---
type: "milestone"
date: "2026-02-25"
title: "lorf-open startup command"
commits: 10
---

Replaced naive facility switch with comprehensive `lorf-open` running 8 sequential preflight checks — environment, Supabase, deployment health, site reachability, launchd, exporter process, telemetry flow, and status flip. Self-heals launchd and exporter. Matching `lorf-close` performs graceful shutdown: SIGTERM, launchd unload. PID guard and strict project scanning added to exporter.
