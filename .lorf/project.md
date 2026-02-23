---
title: "Project: Claude Dashboard"
description: "Real-time terminal dashboard and Supabase exporter for monitoring Claude Code activity."
status: "open"
classification: "public-open"
topics:
  - developer-tools
  - telemetry
  - tui
  - claude-code
repo: "https://github.com/looselyorganized/claude-dashboard.git"
stack:
  - Python
  - Textual
  - Rich
  - TypeScript
  - Bun
infrastructure:
  - Supabase
agents:
  - name: "claude-code"
    role: "AI coding agent (Claude Code)"
---

A real-time terminal dashboard and Supabase exporter for monitoring Claude Code activity. Reads `~/.claude/` telemetry files to provide live event feeds, token usage tracking, and process monitoring — locally via a Textual TUI and remotely via a Bun-powered sync daemon.

## Capabilities

- **Live Event Feed** — Real-time streaming of tool calls, session events, and agent spawns with emoji-tagged log lines
- **Token Analytics** — Per-model token breakdowns (Opus, Sonnet, Haiku) with cache hit ratios and daily totals
- **Process Monitoring** — CPU, memory, uptime, MCP server count, and subagent status for all running Claude instances
- **Agent Tree Visualization** — Stack-based session-to-agent hierarchy reconstruction with live activity indicators
- **Supabase Exporter** — Bun daemon syncing events, daily metrics, project data, and facility status to Postgres

## Architecture

Single-file Python TUI (Textual/Rich) polls `~/.claude/` files at 0.5-30s intervals. TypeScript/Bun exporter reads the same files and upserts to Supabase Postgres. Both components are read-only consumers of Claude Code's native telemetry.
