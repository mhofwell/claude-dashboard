# LORF Scope Toggle

## Summary

Add a binary scope filter (`l` key) that toggles between **All** (default) and **LORF**. Independent of and composable with the existing `p` (project) and `t` (time range) filters.

## How LORF projects are identified

On startup, scan `~/.claude/projects/` directory names. Any directory whose name contains `-projects-looselyorganized-` maps to a LORF project. Extract the project name using `_derive_project_name()` and store as a `set[str]` (e.g., `{"claude-dashboard", "lorf-site", "nexus", ...}`).

## Filter behavior

- **Scope = All**: No change from current behavior.
- **Scope = LORF**: All data views filter to only show entries/tokens/instances where `project in lorf_projects`.
- **Composable**: When LORF is active, `p` key only cycles through LORF projects. Time range still applies independently.

## UI changes

- **Header bar**: Show `[LORF]` indicator next to existing time range label when active.
- **Keybinding**: `l` toggles scope. Footer shows `l LORF` binding.
- **Sidebar/Stats/Instances**: All respect the scope filter, same as project filter does today.

## Implementation touch points

1. New state: `self._lorf_scope: bool = False` and `self._lorf_projects: set[str]`
2. New method: `_scan_lorf_projects()` — walks `~/.claude/projects/` dirs once at startup
3. Add a chained `_filter_entries_by_scope()` that checks `entry.project in self._lorf_projects`
4. Modify `action_cycle_project()` to only cycle LORF projects when scope is active
5. Modify token panel, stats summary, daily tokens, and instances to respect scope
6. Add `Binding("l", "toggle_lorf_scope", "LORF")` and `action_toggle_lorf_scope()`
