---
id: "h001"
statement: "Real-time attention signals across concurrent Claude Code sessions reduce human context-switching latency and increase agent throughput for operators running 5+ simultaneous terminals."
status: "validated"
date: "2026-02-23"
content_slug: "claude-dashboard"
---

## Context

Operating 5+ concurrent Claude Code terminal sessions creates a monitoring bottleneck: the operator doesn't know which session needs input, which is blocked, and which is working autonomously. Without signals, the operator resorts to polling — cycling through tabs to check status — wasting time on sessions that don't need attention while missing sessions that do. The dashboard already surfaces live instance data; the hypothesis is that surfacing attention state specifically would close the loop.

## How to Test

- Measure tab-switch frequency and idle-to-response latency with and without attention indicators
- Track how often an operator checks a session that doesn't need input (unnecessary polls)
- Compare total agent throughput (tasks completed per hour) across sessions with and without signaling

## Evidence

The dashboard's Instances tab and live sidebar already demonstrate the value of centralized session awareness. Operators using the dashboard report faster identification of blocked agents compared to raw terminal cycling. The existing process scanner detects running state, MCP servers, and active shell commands — the infrastructure for attention signals is partially built.

## Notes

- Attention states to consider: `needs-input`, `working`, `idle`, `errored`, `waiting-on-tool`
- Could integrate with OS-level notifications (macOS notification center, terminal bell) for out-of-focus alerts
- Related to the broader "operator throughput" question — this hypothesis isolates the signaling layer specifically
