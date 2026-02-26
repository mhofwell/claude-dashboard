# LORF Scope Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `l` key toggle that filters the entire dashboard to show only projects under the `looselyorganized` namespace.

**Architecture:** A binary scope state (`_lorf_scope`) gates all data views. LORF project names are derived from `~/.claude/projects/` directory paths containing `looselyorganized`. The scope composes with existing project (`p`) and time range (`t`) filters as an independent layer.

**Tech Stack:** Python/Textual (same as existing dashboard)

**Note:** This project has no test infrastructure. Steps are manual-verification only.

---

### Task 1: Add LORF project scanning

**Files:**
- Modify: `dashboard.py:328-503` (ProjectTokenScanner — add method)
- Modify: `dashboard.py:1140-1161` (__init__ — add state)
- Modify: `dashboard.py:1192-1198` (on_mount — call scanner)

**Step 1: Add `lorf_projects()` method to ProjectTokenScanner**

After the `all_projects` method (line 503), add:

```python
def lorf_projects(self) -> set[str]:
    """Return project names whose session files live under a looselyorganized path."""
    return {proj for fp, (proj, _dates) in self._file_data.items() if "looselyorganized" in fp and proj}
```

This leverages the scanner's existing `_file_data` which maps `filepath → (project_name, dates)`. File paths under `~/.claude/projects/` encode the full CWD, so checking for `"looselyorganized"` in the path identifies LORF projects.

**Step 2: Add state to `__init__`**

After line 1156 (`self._daily_tokens_page`), add:

```python
self._lorf_scope: bool = False
self._lorf_projects: set[str] = set()
```

**Step 3: Populate on mount**

In `on_mount` (after line 1195 `self._discover_projects()`), add:

```python
self._lorf_projects = self._project_token_scanner.lorf_projects()
```

**Step 4: Refresh LORF set when scanner runs**

In `_reload_stats_cache` (line 1841, after `self._project_token_scanner.scan_incremental()`), add:

```python
self._lorf_projects = self._project_token_scanner.lorf_projects()
```

**Step 5: Verify**

Run `python3 dashboard.py`, confirm it starts without errors. No visible change yet.

**Step 6: Commit**

```bash
git add dashboard.py
git commit -m "feat: add LORF project scanning from session file paths"
```

---

### Task 2: Add keybinding and toggle action

**Files:**
- Modify: `dashboard.py:1115-1131` (BINDINGS)
- Modify: `dashboard.py:2167-2176` (actions section — add new action)
- Modify: `dashboard.py:1276-1277` (_has_active_filters)

**Step 1: Add binding**

After the `t` binding (line 1124), add:

```python
Binding("l", "toggle_lorf_scope", "LORF", show=True),
```

**Step 2: Add action method**

After `action_cycle_time_range` (after line 2176), add:

```python
def action_toggle_lorf_scope(self) -> None:
    """Toggle LORF scope filter."""
    self._lorf_scope = not self._lorf_scope
    self._project_idx = 0
    self.project_filter = ""
    self._daily_tokens_page = 0
    self._rebuild_log()
    self._update_sidebar()
    if self._is_stats_tab():
        self._refresh_stats_tab()
    if self._active_tab == "tab-instances":
        self._refresh_instances_tab()
```

**Step 3: Include LORF in active filters check**

Modify `_has_active_filters` (line 1276-1277) to include LORF scope:

```python
def _has_active_filters(self) -> bool:
    return bool(self.text_filter or self.project_filter or self.event_type_filter or self._stats_time_range != "All" or self._lorf_scope)
```

**Step 4: Verify**

Run dashboard, press `l`. Footer should show LORF binding. No data filtering yet but toggle should work without errors.

**Step 5: Commit**

```bash
git add dashboard.py
git commit -m "feat: add l keybinding and toggle action for LORF scope"
```

---

### Task 3: Filter event log entries by LORF scope

**Files:**
- Modify: `dashboard.py:1281-1301` (_rebuild_log)
- Modify: `dashboard.py:1393-1416` (_update_sidebar)
- Modify: `dashboard.py:1845-1862` (_count_live_today_activity)

**Step 1: Add scope filter helper**

After `_filter_entries_by_time` (after line 1391), add:

```python
def _filter_entries_by_scope(self, entries: list[LogEntry]) -> list[LogEntry]:
    """Filter entries to LORF projects only when scope is active."""
    if not self._lorf_scope:
        return entries
    return [e for e in entries if e.project in self._lorf_projects]
```

**Step 2: Apply scope filter in `_rebuild_log`**

Change line 1286 from:

```python
entries = self._filter_entries_by_time(self.tailer.all_entries)
```

to:

```python
entries = self._filter_entries_by_scope(self._filter_entries_by_time(self.tailer.all_entries))
```

**Step 3: Apply scope filter in `_update_sidebar`**

Change line 1408 from:

```python
filtered_entries = self._filter_entries_by_time(self.tailer.all_entries)
```

to:

```python
filtered_entries = self._filter_entries_by_scope(self._filter_entries_by_time(self.tailer.all_entries))
```

**Step 4: Apply scope filter in `_count_live_today_activity`**

Change line 1850 from:

```python
live_entries = self._filter_entries_by_time(self.tailer.all_entries)
```

to:

```python
live_entries = self._filter_entries_by_scope(self._filter_entries_by_time(self.tailer.all_entries))
```

**Step 5: Verify**

Run dashboard, press `l`. Live tab log should only show events from LORF projects. Sidebar event counts should reflect LORF-only data. Press `l` again to toggle back to All.

**Step 6: Commit**

```bash
git add dashboard.py
git commit -m "feat: filter event log and sidebar by LORF scope"
```

---

### Task 4: Scope project cycling to LORF projects

**Files:**
- Modify: `dashboard.py:2199-2214` (action_cycle_project)

**Step 1: Filter project list when cycling**

Replace the `action_cycle_project` method (lines 2199-2214) with:

```python
def action_cycle_project(self) -> None:
    """Cycle project filter: All → proj1 → proj2 → ... → All."""
    if self._is_live_tab() and self.query_one("#filter-input", Input).has_focus:
        return
    projects = [p for p in self._projects if p in self._lorf_projects] if self._lorf_scope else self._projects
    if not projects:
        return
    self._project_idx = (self._project_idx + 1) % (len(projects) + 1)
    if self._project_idx == 0:
        self.project_filter = ""
    else:
        self.project_filter = projects[self._project_idx - 1]
    if self._is_live_tab():
        self._rebuild_log()
    if self._is_stats_tab():
        self._refresh_stats_tab()
    self._update_filter_indicators()
```

**Step 2: Verify**

Run dashboard, press `l` then `p` repeatedly. Should only cycle through LORF projects. Press `l` again, then `p` — should cycle through all projects.

**Step 3: Commit**

```bash
git add dashboard.py
git commit -m "feat: scope project cycling to LORF projects when scope active"
```

---

### Task 5: Scope token panel in sidebar

**Files:**
- Modify: `dashboard.py:475-488` (get_global_totals — add project_set param)
- Modify: `dashboard.py:490-500` (get_global_daily — add project_set param)
- Modify: `dashboard.py:1497-1538` (_update_token_panel)

**Step 1: Add `project_set` parameter to `get_global_totals`**

Change signature and add filter (lines 475-488):

```python
def get_global_totals(self, date_filter: set[str] | None, project_set: set[str] | None = None) -> dict[str, dict[str, int]]:
    """Returns {model: {input, output, cache_read, cache_write, total}} across all projects."""
    result: dict[str, dict[str, int]] = {}
    for _fp, (proj, dates) in self._file_data.items():
        if project_set is not None and proj not in project_set:
            continue
        for date, models in dates.items():
            if date_filter is not None and date not in date_filter:
                continue
            for model, tokens in models.items():
                if model not in result:
                    result[model] = {**_empty_token_bucket(), "total": 0}
                for key in _TOKEN_KEYS:
                    result[model][key] += tokens[key]
                result[model]["total"] += _token_total(tokens)
    return result
```

**Step 2: Add `project_set` parameter to `get_global_daily`**

Same pattern (lines 490-500):

```python
def get_global_daily(self, date_filter: set[str] | None, project_set: set[str] | None = None) -> list[dict]:
    """Returns [{date, tokensByModel: {model: total}}] across all projects."""
    daily: dict[str, dict[str, int]] = {}
    for _fp, (proj, dates) in self._file_data.items():
        if project_set is not None and proj not in project_set:
            continue
        for date, models in dates.items():
            if date_filter is not None and date not in date_filter:
                continue
            day_bucket = daily.setdefault(date, {})
            for model, tokens in models.items():
                day_bucket[model] = day_bucket.get(model, 0) + _token_total(tokens)
    return [{"date": d, "tokensByModel": m} for d, m in sorted(daily.items(), reverse=True)]
```

**Step 3: Pass LORF scope to token panel**

In `_update_token_panel` (lines 1497-1538), the non-project-filter branch (line 1515 onward) calls `get_global_totals`. Add the LORF project set:

Change line 1531 from:

```python
model_totals = self._project_token_scanner.get_global_totals(date_filter)
```

to:

```python
lorf_set = self._lorf_projects if self._lorf_scope else None
model_totals = self._project_token_scanner.get_global_totals(date_filter, lorf_set)
```

Also update the title (line 1515) to show LORF label when active. Change:

```python
table = self._make_token_table(f"[bold]🪙 Tokens ({title_label})[/]")
```

to:

```python
scope_label = " — LORF" if self._lorf_scope else ""
table = self._make_token_table(f"[bold]🪙 Tokens ({title_label}{scope_label})[/]")
```

**Step 4: Verify**

Run dashboard, press `l`. Token panel in sidebar should show only LORF project tokens. Toggle back — should show all.

**Step 5: Commit**

```bash
git add dashboard.py
git commit -m "feat: scope sidebar token panel to LORF projects"
```

---

### Task 6: Scope stats summary on Stats tab

**Files:**
- Modify: `dashboard.py:1885-1972` (_update_stats_summary)

**Step 1: Add LORF-scoped summary path**

In `_update_stats_summary`, after the project_filter branch (line 1918) and before the global branch (line 1920), add a LORF scope branch. The modified method should have this structure after line 1918:

```python
        # LORF scope (no specific project): aggregate across LORF projects
        if self._lorf_scope and not self.project_filter:
            entries = self._filter_entries_by_scope(self._filter_entries_by_time(self.tailer.all_entries))
            sessions = 0
            messages = 0
            dates_seen: set[str] = set()
            for entry in entries:
                if "🟢" in entry.event and "Session started" in entry.event:
                    sessions += 1
                if "🏁" in entry.event:
                    messages += 1
                m = re.match(r"(\d{2}/\d{2})", entry.timestamp.strip())
                if m:
                    dates_seen.add(m.group(1))
            days_active = len(dates_seen)

            box = Text()
            box.append(f"  LORF Projects ({title_label})\n", style="bold #5fafff")
            box.append(f"  {sessions:,} sessions", style="bold")
            box.append("  |  ", style="dim")
            box.append(f"{messages:,} messages", style="bold")
            if days_active > 1:
                box.append("  |  ", style="dim")
                box.append(f"{days_active} days active", style="bold")
            box.append("\n")
            self.query_one("#stats-summary", Static).update(box)
            return
```

**Step 2: Verify**

Run dashboard, press `2` (Stats tab), press `l`. Summary should show "LORF Projects" with aggregated counts. Toggle off — should show global.

**Step 3: Commit**

```bash
git add dashboard.py
git commit -m "feat: scope stats summary to LORF projects"
```

---

### Task 7: Scope daily tokens table on Stats tab

**Files:**
- Modify: `dashboard.py:1974-2083` (_update_daily_tokens_table)

**Step 1: Pass LORF set to scanner calls**

In `_update_daily_tokens_table`, when not in project_filter mode:

Change line 1996 from:

```python
filtered = self._project_token_scanner.get_global_daily(date_filter)
```

to:

```python
lorf_set = self._lorf_projects if self._lorf_scope else None
filtered = self._project_token_scanner.get_global_daily(date_filter, lorf_set)
```

Change line 2002 from:

```python
scanner_today = self._project_token_scanner.get_global_daily({today_str})
```

to:

```python
scanner_today = self._project_token_scanner.get_global_daily({today_str}, lorf_set)
```

Update the table title (line 2034) from:

```python
title=f"[bold]🪙 Daily Token Usage ({title_label})[/]", title_style="bold",
```

to:

```python
scope_label = " — LORF" if self._lorf_scope else ""
title=f"[bold]🪙 Daily Token Usage ({title_label}{scope_label})[/]", title_style="bold",
```

**Step 2: Verify**

Run dashboard, Stats tab, press `l`. Daily tokens table should only show LORF project usage. Toggle off — full data.

**Step 3: Commit**

```bash
git add dashboard.py
git commit -m "feat: scope daily tokens table to LORF projects"
```

---

### Task 8: Scope instances tab

**Files:**
- Modify: `dashboard.py:1664-1779` (_refresh_instances_tab)

**Step 1: Filter instances by LORF scope**

After line 1666 (`instances = self.scanner.instances`), add:

```python
if self._lorf_scope:
    instances = [i for i in instances if i.project_name in self._lorf_projects]
```

Recalculate totals from the filtered list. Change lines 1667-1669 from:

```python
total = len(instances)
active = self.scanner.active_count
mem = self.scanner.total_mem_mb
```

to:

```python
total = len(instances)
active = sum(1 for i in instances if i.is_active)
mem = sum(i.mem_mb for i in instances)
```

(This makes the counts match the filtered list regardless of scope.)

**Step 2: Update header to show LORF indicator**

Change line 1673 from:

```python
header.append("  🖥️  Running Claude Instances ", style="bold")
```

to:

```python
scope_label = " (LORF)" if self._lorf_scope else ""
header.append(f"  🖥️  Running Claude Instances{scope_label} ", style="bold")
```

**Step 3: Verify**

Run dashboard, press `3` (Instances tab), press `l`. Should only show LORF project instances.

**Step 4: Commit**

```bash
git add dashboard.py
git commit -m "feat: scope instances tab to LORF projects"
```

---

### Task 9: Update header bar and filter indicators

**Files:**
- Modify: `dashboard.py:1247-1256` (_update_header)
- Modify: `dashboard.py:1816-1835` (_update_filter_indicators)
- Modify: `dashboard.py:2234-2247` (action_clear_filters)

**Step 1: Show LORF in header bar**

In `_update_header` (line 1254-1256), add LORF indicator:

```python
scope_label = "  │  [LORF]" if self._lorf_scope else ""
header.update(
    f" 🟢 Claude Dashboard  │  {total} instances ({active} active)  │  {mem_str} RAM  │  {now}{scope_label}"
)
```

**Step 2: Show LORF in filter indicators**

In `_update_filter_indicators` (line 1817), add LORF to the filters list:

After line 1817 (`filters = []`), add:

```python
if self._lorf_scope:
    filters.append("scope:LORF")
```

**Step 3: Clear LORF on escape**

In `action_clear_filters` (after line 2244), add:

```python
self._lorf_scope = False
```

**Step 4: Verify**

Run dashboard, press `l`. Header should show `[LORF]`. Filter indicator bar should show `scope:LORF`. Press `escape` — all filters including LORF should clear.

**Step 5: Commit**

```bash
git add dashboard.py
git commit -m "feat: show LORF indicator in header and filter bar"
```

---

### Task 10: Final verification

**Step 1: Full smoke test**

Run `python3 dashboard.py` and verify:

1. `l` toggles LORF scope on/off
2. Live tab: only LORF project events shown when active
3. Sidebar: event counts and tokens reflect LORF scope
4. `p` cycles only LORF projects when scope active
5. Stats tab: summary and daily tokens scoped to LORF
6. Instances tab: only LORF instances shown
7. Header shows `[LORF]` when active
8. Filter bar shows `scope:LORF`
9. `escape` clears LORF scope along with other filters
10. `t` (time range) composes correctly with LORF scope
11. `p` + `l` compose correctly (LORF scope + specific project)
