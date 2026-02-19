/**
 * JSONL session scanner for per-project token aggregation.
 * Reads session JSONL files from ~/.claude/projects/ and aggregates
 * token usage by project, date, and model.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { deriveProjectName } from "./process-scanner";

const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// ─── Types ──────────────────────────────────────────────────────────────────

// project -> date -> { model: totalTokens }
export type ProjectTokenMap = Map<string, Map<string, Record<string, number>>>;

// ─── CWD → project name mapping ────────────────────────────────────────────

/**
 * Decode the directory name format used under ~/.claude/projects/.
 * e.g. "-Users-bigviking-Documents-github-projects-claude-dashboard"
 * becomes "/Users/bigviking/Documents/github/projects/claude-dashboard"
 */
function decodeDirName(dirName: string): string {
  if (dirName === "-") return "/";
  // Replace leading dash with /, then remaining dashes with /
  // But we need to be careful: the format replaces / with -
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
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

  for (const dirName of projectDirs) {
    const dirPath = join(PROJECTS_DIR, dirName);

    let stat;
    try {
      stat = statSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    // Decode dir name to CWD path, then derive project name
    const cwd = decodeDirName(dirName);
    const projectName = deriveProjectName(cwd);

    // Find all .jsonl files in this project dir
    let files: string[];
    try {
      files = readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      totalFiles++;
      const filePath = join(dirPath, file);

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

          // Accumulate into result map
          if (!result.has(projectName)) {
            result.set(projectName, new Map());
          }
          const dateMap = result.get(projectName)!;
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
      (skippedFiles > 0 ? `, ${skippedFiles} skipped` : "")
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
