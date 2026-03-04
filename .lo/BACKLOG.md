---
updated: 2026-03-04
---

## Features

### f004 — CodeRabbit Fix Automation
Automate the CodeRabbit comment resolution loop. Thin webhook server on Railway receives GitHub review events, writes to Supabase. Local daemon subscribes via Realtime, spawns Claude Code fix sessions in git worktrees, pushes fixes. New Dashboard tab 4 shows fix session status. Events flow through existing events.log pipeline.
Status: designed -> .lo/work/f004-coderabbit-fix-automation/


## Tasks

- [ ] t001 Review PROJECT.md and fill any TODO placeholders
