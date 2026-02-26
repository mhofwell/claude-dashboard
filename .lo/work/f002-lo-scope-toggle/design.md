# LO Scope Toggle

## Summary

Add a binary scope filter (`l` key) that toggles between **All** (default) and **LO**. Independent of and composable with the existing `p` (project) and `t` (time range) filters.

## How LO projects are identified

On startup, scan `~/.claude/projects/` directory names. Any directory whose name contains `-projects-looselyorganized-` maps to a LO project. Extract the project name using `_derive_project_name()` and store as a `set[str]` (e.g., `{"claude-dashboard", "lo-site", "nexus", ...}`).

## Filter behavior

- **Scope = All**: No change from current behavior.
- **Scope = LO**: All data views filter to only show entries/tokens/instances where `project in lo_projects`.
- **Composable**: When LO is active, `p` key only cycles through LO projects. Time range still applies independently.

## UI changes

- **Header bar**: Show `[LO]` indicator next to existing time range label when active.
- **Keybinding**: `l` toggles scope. Footer shows `l LO` binding.
- **Sidebar/Stats/Instances**: All respect the scope filter, same as project filter does today.

## Implementation touch points

1. New state: `self._lo_scope: bool = False` and `self._lo_projects: set[str]`
2. New method: `_scan_lo_projects()` — walks `~/.claude/projects/` dirs once at startup
3. Add a chained `_filter_entries_by_scope()` that checks `entry.project in self._lo_projects`
4. Modify `action_cycle_project()` to only cycle LO projects when scope is active
5. Modify token panel, stats summary, daily tokens, and instances to respect scope
6. Add `Binding("l", "toggle_lo_scope", "LO")` and `action_toggle_lo_scope()`
