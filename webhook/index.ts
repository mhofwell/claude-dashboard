import { verifySignature } from "./verify";
import { touchesLoDir, deriveSlugFromRepo, fetchFileContent, fetchDirectoryContents, fetchContributors } from "./github";
import { parseProject, parseHypothesis, parseStreamEntry, parseResearchDoc } from "./parser";
import { initSupabase, syncProjectContent, syncContributors } from "./sync";
import type { GitHubPushPayload, SyncContext } from "./types";

// --- Load env ----------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PORT = parseInt(process.env.PORT ?? "3001", 10);

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}
if (!GITHUB_WEBHOOK_SECRET) {
  console.error("Missing GITHUB_WEBHOOK_SECRET");
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error("Missing GITHUB_TOKEN");
  process.exit(1);
}

initSupabase(SUPABASE_URL, SUPABASE_SECRET_KEY);

// --- Webhook handler ---------------------------------------------------------

async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();

  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!verifySignature(body, signature, GITHUB_WEBHOOK_SECRET!)) {
    console.warn("Invalid webhook signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: GitHubPushPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const { repository, commits } = payload;
  const repoOwner = repository.owner.login;
  const repoName = repository.name;
  const fullName = repository.full_name;

  console.log(`\nPush received: ${fullName} (${commits.length} commits)`);

  if (!touchesLoDir(commits)) {
    console.log("  No .lo/ changes — skipping");
    return new Response("OK — no .lo/ changes", { status: 200 });
  }

  console.log("  .lo/ changes detected — syncing...");

  // Parse PROJECT.md first to check for content_slug override
  const projectRaw = await fetchFileContent(repoOwner, repoName, ".lo/PROJECT.md", GITHUB_TOKEN!);
  const parsedProject = projectRaw ? parseProject(projectRaw) : null;
  if (projectRaw && !parsedProject) console.warn("  PROJECT.md found but failed validation");
  if (!projectRaw) console.warn("  No PROJECT.md found in .lo/");

  const contentSlug = parsedProject?.contentSlug ?? deriveSlugFromRepo(repoName);

  const ctx: SyncContext = {
    contentSlug,
    repoOwner,
    repoName,
    project: parsedProject,
    hypotheses: [],
    streamEntries: [],
    researchDocs: [],
  };

  // 2. hypotheses/
  const hypothesisFiles = await fetchDirectoryContents(repoOwner, repoName, ".lo/hypotheses", GITHUB_TOKEN!);
  for (const entry of hypothesisFiles) {
    if (entry.type !== "file" || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue;
    const raw = await fetchFileContent(repoOwner, repoName, entry.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseHypothesis(raw);
    if (parsed) ctx.hypotheses.push(parsed);
    else console.warn(`  Skipping invalid hypothesis: ${entry.name}`);
  }

  // 3. stream/
  const streamFiles = await fetchDirectoryContents(repoOwner, repoName, ".lo/stream", GITHUB_TOKEN!);
  for (const entry of streamFiles) {
    if (entry.type !== "file" || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue;
    const raw = await fetchFileContent(repoOwner, repoName, entry.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseStreamEntry(raw, entry.name);
    if (parsed) ctx.streamEntries.push(parsed);
    else console.warn(`  Skipping invalid stream entry: ${entry.name}`);
  }

  // 4. research/
  const researchFiles = await fetchDirectoryContents(repoOwner, repoName, ".lo/research", GITHUB_TOKEN!);
  for (const entry of researchFiles) {
    if (entry.type !== "file" || !entry.name.endsWith(".md") || entry.name === ".gitkeep") continue;
    const raw = await fetchFileContent(repoOwner, repoName, entry.path, GITHUB_TOKEN!);
    if (!raw) continue;
    const parsed = parseResearchDoc(raw, entry.name);
    if (parsed) ctx.researchDocs.push(parsed);
    else console.warn(`  Skipping invalid research doc: ${entry.name}`);
  }

  // Sync to Supabase
  const result = await syncProjectContent(ctx);

  // 5. Contributors
  try {
    const ghContributors = await fetchContributors(repoOwner, repoName, GITHUB_TOKEN!);
    const contributors = ghContributors.map((c, i) => ({
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
  } catch (err) {
    console.warn(`  Contributors sync failed: ${err}`);
  }

  if (result.ok) {
    console.log(`  Sync complete for ${contentSlug}`);
    return new Response(`Synced ${contentSlug}`, { status: 200 });
  } else {
    console.error(`  Sync failed: ${result.error}`);
    return new Response(`Sync failed: ${result.error}`, { status: 500 });
  }
}

// --- Health check + routing --------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/webhook/github") {
      return handleWebhook(req);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`lo-content-webhook listening on port ${server.port}`);
