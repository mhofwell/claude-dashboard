/**
 * JSONL session scanner for per-project token aggregation.
 * Reads session JSONL files from ~/.claude/projects/ and aggregates
 * token usage by project, date, and model.
 *
 * IMPORTANT: Only processes directories whose encoded CWD starts with a known
 * org root prefix + "-". This prevents:
 *   1. Parent CWD misattribution (org root without trailing repo name)
 *   2. Duplicate counting from dirs outside the org root that resolve to the
 *      same slug (e.g. projects/nexus vs projects/looselyorganized/nexus)
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveSlug } from "./slug-resolver";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// ─── Types ──────────────────────────────────────────────────────────────────

// project -> date -> { model: totalTokens }
export type ProjectTokenMap = Map<string, Map<string, Record<string, number>>>;

// ─── Strict org-root allowlist ──────────────────────────────────────────────

const PROJECT_ROOT = "/Users/bigviking/Documents/github/projects/looselyorganized";

/**
 * All known org root paths whose repos should be scanned.
 * The same physical repos may appear under multiple encoded CWD prefixes
 * (e.g. after a directory rename or symlink). We pick ONE canonical prefix
 * to avoid double-counting.
 */
const CANONICAL_ENCODED_ROOT = PROJECT_ROOT.replace(/\//g, "-");

let cachedProjectDirs: string[] | null = null;

function getProjectDirs(): string[] {
  if (cachedProjectDirs) return cachedProjectDirs;
  try {
    cachedProjectDirs = readdirSync(PROJECT_ROOT)
      .filter((d) => {
        try { return statSync(join(PROJECT_ROOT, d)).isDirectory(); } catch { return false; }
      })
      .sort((a, b) => b.length - a.length); // Longest first for prefix matching
  } catch {
    cachedProjectDirs = [];
  }
  return cachedProjectDirs;
}

/**
 * Resolve an encoded ~/.claude/projects/ directory name to a project name.
 *
 * STRICT: Only matches directories under the canonical org root prefix.
 * Returns null for:
 *   - The org root itself (parent CWD — no trailing repo name)
 *   - Directories outside the org root (prevents duplicate counting)
 *   - Directories that don't match any repo on disk
 */
export function resolveProjectName(encodedDirName: string): string | null {
  const actualDirs = getProjectDirs();
  const lowerEncoded = encodedDirName.toLowerCase();
  const lowerRoot = CANONICAL_ENCODED_ROOT.toLowerCase();

  // Must start with the canonical root + "-" (repo name follows the dash)
  if (!lowerEncoded.startsWith(lowerRoot + "-")) {
    return null; // Not under the canonical org root — skip entirely
  }

  const remainder = encodedDirName.slice(CANONICAL_ENCODED_ROOT.length + 1);
  const lowerRemainder = remainder.toLowerCase();

  // Match remainder against actual repo directories on disk (longest first)
  for (const dir of actualDirs) {
    const lowerDir = dir.toLowerCase();
    if (lowerRemainder === lowerDir || lowerRemainder.startsWith(lowerDir + "-")) {
      return dir;
    }
  }

  // No match on disk — skip (don't fall back to fuzzy resolution)
  return null;
}

// ─── JSONL scanner ──────────────────────────────────────────────────────────

/**
 * Scan all JSONL session files and aggregate token usage
 * by project, date, and model.
 *
 * Uses fast-filtering: only JSON.parse lines containing "usage" substring.
 * Deduplicates by requestId to avoid counting streaming chunks multiple times.
 */
export function scanProjectTokens(): ProjectTokenMap {
  cachedProjectDirs = null; // Force fresh directory listing each scan
  const result: ProjectTokenMap = new Map();

  let projectDirs: string[];
  try {
    projectDirs = readdirSync(PROJECTS_DIR);
  } catch {
    console.warn("  Could not read projects directory:", PROJECTS_DIR);
    return result;
  }

  let totalFiles = 0;
  let totalRecords = 0;
  let skippedFiles = 0;
  let skippedDirs = 0;
  let dedupedFiles = 0;

  // Track seen JSONL filenames per slug to prevent double-counting
  // when the same session file appears under multiple directory paths
  const seenFilesBySlug = new Map<string, Set<string>>();

  for (const dirName of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dirName);

    let stat;
    try {
      stat = statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Strict: only process dirs under the canonical org root
    const projectName = resolveProjectName(dirName);
    if (!projectName) {
      skippedDirs++;
      continue;
    }

    const projectSlug = resolveSlug(join(PROJECT_ROOT, projectName));

    // Skip non-LO projects
    if (!projectSlug) continue;

    // Initialize dedup set for this slug
    if (!seenFilesBySlug.has(projectSlug)) {
      seenFilesBySlug.set(projectSlug, new Set());
    }
    const seenFiles = seenFilesBySlug.get(projectSlug)!;

    // Find all .jsonl files: top-level sessions + subagent sessions
    let filePaths: { fullPath: string; dedupKey: string }[];
    try {
      filePaths = [];
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) {
          filePaths.push({ fullPath: join(dirPath, entry), dedupKey: entry });
        } else {
          // Check for subagent files in <session-uuid>/subagents/
          try {
            const subDir = join(dirPath, entry, "subagents");
            for (const sf of readdirSync(subDir)) {
              if (sf.endsWith(".jsonl")) {
                filePaths.push({
                  fullPath: join(subDir, sf),
                  dedupKey: join(entry, "subagents", sf),
                });
              }
            }
          } catch {
            // Not a session directory or no subagents — skip
          }
        }
      }
    } catch {
      continue;
    }

    for (const { fullPath: filePath, dedupKey } of filePaths) {
      // File-level dedup: skip if we've already counted this session file for this slug
      if (seenFiles.has(dedupKey)) {
        dedupedFiles++;
        continue;
      }
      seenFiles.add(dedupKey);

      totalFiles++;

      try {
        const content = readFileSync(filePath, "utf-8");
        const seenRequestIds = new Set<string>();

        for (const line of content.split("\n")) {
          // Fast-filter: skip lines that don't contain usage data
          if (!line.includes('"usage"')) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          const usage = parsed?.message?.usage;
          if (!usage) continue;

          // Deduplicate by requestId (streaming produces multiple lines)
          const requestId = parsed.requestId;
          if (requestId) {
            if (seenRequestIds.has(requestId)) continue;
            seenRequestIds.add(requestId);
          }

          const model = parsed.message?.model;
          const timestamp = parsed.timestamp;
          if (!model || !timestamp) continue;

          // Extract date from ISO timestamp
          const date = timestamp.substring(0, 10); // "YYYY-MM-DD"

          const tokens =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.output_tokens ?? 0);

          if (tokens === 0) continue;

          // Accumulate into result map (keyed by slug, not dir name)
          if (!result.has(projectSlug)) {
            result.set(projectSlug, new Map());
          }
          const dateMap = result.get(projectSlug)!;
          if (!dateMap.has(date)) {
            dateMap.set(date, {});
          }
          const modelMap = dateMap.get(date)!;
          modelMap[model] = (modelMap[model] ?? 0) + tokens;

          totalRecords++;
        }
      } catch {
        skippedFiles++;
        continue;
      }
    }
  }

  console.log(
    `  Scanned ${totalFiles} JSONL files, ${totalRecords} usage records` +
      (skippedDirs > 0 ? `, ${skippedDirs} dirs skipped (non-org-root)` : "") +
      (dedupedFiles > 0 ? `, ${dedupedFiles} deduped` : "") +
      (skippedFiles > 0 ? `, ${skippedFiles} errors` : "")
  );

  return result;
}

// ─── Per-project lifetime totals ────────────────────────────────────────────

/**
 * Compute total lifetime tokens per project from the token map.
 * Returns { projectName: totalTokens }
 */
export function computeTokensByProject(
  tokenMap: ProjectTokenMap
): Record<string, number> {
  const totals: Record<string, number> = {};

  for (const [project, dateMap] of tokenMap) {
    let total = 0;
    for (const [, modelMap] of dateMap) {
      for (const tokens of Object.values(modelMap)) {
        total += tokens;
      }
    }
    totals[project] = total;
  }

  return totals;
}
