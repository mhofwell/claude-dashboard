/**
 * One-time backfill: fetch .lo/ content for all known projects
 * and sync to Supabase. Run manually after initial deployment.
 *
 * Usage: GITHUB_TOKEN=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... bun run backfill.ts
 */

import { fetchFileContent, fetchDirectoryContents, fetchContributors, deriveSlugFromRepo } from "./github";
import { parseProject, parseHypothesis, parseStreamEntry, parseResearchDoc } from "./parser";
import { initSupabase, syncProjectContent, syncContributors } from "./sync";
import type { SyncContext } from "./types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !GITHUB_TOKEN) {
  console.error("Missing required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GITHUB_TOKEN");
  process.exit(1);
}

initSupabase(SUPABASE_URL, SUPABASE_SECRET_KEY);

const REPOS = [
  { owner: "looselyorganized", name: "agent-development-brief" },
  { owner: "looselyorganized", name: "claude-dashboard" },
  { owner: "looselyorganized", name: "lo-plugin" },
  { owner: "looselyorganized", name: "looselyorganized" },
  { owner: "looselyorganized", name: "nexus" },
  { owner: "looselyorganized", name: "yellowages-for-agents" },
];

async function syncRepo(owner: string, name: string): Promise<void> {
  const contentSlug = deriveSlugFromRepo(name);
  console.log(`\n=== Syncing ${owner}/${name} -> ${contentSlug} ===`);

  const ctx: SyncContext = {
    contentSlug,
    repoOwner: owner,
    repoName: name,
    project: null,
    hypotheses: [],
    streamEntries: [],
    researchDocs: [],
  };

  // PROJECT.md
  const projectRaw = await fetchFileContent(owner, name, ".lo/PROJECT.md", GITHUB_TOKEN!);
  if (projectRaw) {
    ctx.project = parseProject(projectRaw);
    if (!ctx.project) console.warn("  PROJECT.md failed validation");
  }

  // hypotheses/
  const hFiles = await fetchDirectoryContents(owner, name, ".lo/hypotheses", GITHUB_TOKEN!);
  for (const f of hFiles) {
    if (f.type !== "file" || !f.name.endsWith(".md") || f.name === ".gitkeep") continue;
    const raw = await fetchFileContent(owner, name, f.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseHypothesis(raw);
    if (parsed) ctx.hypotheses.push(parsed);
  }

  // stream/
  const sFiles = await fetchDirectoryContents(owner, name, ".lo/stream", GITHUB_TOKEN!);
  for (const f of sFiles) {
    if (f.type !== "file" || !f.name.endsWith(".md") || f.name === ".gitkeep") continue;
    const raw = await fetchFileContent(owner, name, f.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseStreamEntry(raw, f.name);
    if (parsed) ctx.streamEntries.push(parsed);
  }

  // research/
  const rFiles = await fetchDirectoryContents(owner, name, ".lo/research", GITHUB_TOKEN!);
  for (const f of rFiles) {
    if (f.type !== "file" || !f.name.endsWith(".md") || f.name === ".gitkeep") continue;
    const raw = await fetchFileContent(owner, name, f.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseResearchDoc(raw, f.name);
    if (parsed) ctx.researchDocs.push(parsed);
  }

  const result = await syncProjectContent(ctx);
  if (!result.ok) {
    console.error(`  FAILED: ${result.error}`);
    return;
  }

  // Contributors
  const ghContribs = await fetchContributors(owner, name, GITHUB_TOKEN!);
  const contributors = ghContribs.map((c, i) => ({
    username: c.login,
    avatarUrl: c.avatar_url,
    profileUrl: c.html_url,
    commits: c.contributions,
    type: i === 0 ? "author" : "contributor",
  }));
  if (ctx.project?.agents) {
    for (const agent of ctx.project.agents) {
      contributors.push({
        username: agent.name,
        avatarUrl: "",
        profileUrl: "",
        commits: 0,
        type: "agent",
      });
    }
  }
  if (contributors.length > 0) {
    await syncContributors(contentSlug, contributors);
  }
}

console.log("Starting backfill...");
for (const repo of REPOS) {
  await syncRepo(repo.owner, repo.name);
}
console.log("\nBackfill complete.");
