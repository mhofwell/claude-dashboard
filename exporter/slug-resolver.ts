/**
 * Slug resolver for the LO telemetry exporter.
 *
 * Maps project directory paths to their content_slug by reading
 * .lo/project.md frontmatter. Only LO projects (those with .lo/)
 * are tracked — all others are silently ignored.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";

const PROJECT_ROOT =
  "/Users/bigviking/Documents/github/projects/looselyorganized";

const slugCache = new Map<string, string | null>();

/** Minimal YAML frontmatter parser — extracts key: value pairs between --- fences. */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (kv) {
      result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return result;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a project directory path to its content_slug.
 * Returns null if the project has no .lo/ directory (opt-in signal).
 * When .lo/ is added later, the exporter picks it up on the next slug map
 * refresh and retroactively backfills all historical telemetry from JSONL.
 */
export function resolveSlug(projectDir: string): string | null {
  if (slugCache.has(projectDir)) return slugCache.get(projectDir)!;

  const loDir = join(projectDir, ".lo");
  if (!existsSync(loDir)) {
    slugCache.set(projectDir, null);
    return null;
  }

  let slug = basename(projectDir);

  try {
    const content = readFileSync(join(loDir, "project.md"), "utf-8");
    const fm = parseFrontmatter(content);
    slug = fm.content_slug ?? fm.slug ?? slug;
  } catch {
    // .lo/ exists but no project.md — use directory basename
  }

  slugCache.set(projectDir, slug);
  return slug;
}

/**
 * Build a complete directory-name-to-slug mapping.
 * Only includes LO projects (those with .lo/ directories).
 * Called at startup + refreshed every 10 cycles (5 min at 30s intervals).
 */
export function buildSlugMap(): Map<string, string> {
  const map = new Map<string, string>();

  try {
    const dirs = readdirSync(PROJECT_ROOT).filter((d) =>
      isDirectory(join(PROJECT_ROOT, d))
    );

    for (const dir of dirs) {
      const slug = resolveSlug(join(PROJECT_ROOT, dir));
      if (slug) map.set(dir, slug);
    }
  } catch {
    // PROJECT_ROOT doesn't exist or isn't readable
  }

  return map;
}

/**
 * Clear the in-memory slug cache.
 * Call before refreshing the slug map.
 */
export function clearSlugCache(): void {
  slugCache.clear();
}
