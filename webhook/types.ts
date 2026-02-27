// ─── GitHub webhook payload (subset we need) ────────────────────────────────

export interface GitHubPushPayload {
  ref: string;
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
    private: boolean;
  };
  commits: Array<{
    added: string[];
    removed: string[];
    modified: string[];
  }>;
}

// ─── GitHub Contents API ─────────────────────────────────────────────────────

export interface GitHubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  sha: string;
}

// ─── Parsed .lo/ content ─────────────────────────────────────────────────────

export interface ParsedProject {
  title: string;
  description: string;
  status: "explore" | "build" | "open" | "closed";
  classification: "public" | "private";
  topics: string[];
  repo?: string;
  stack?: string[];
  infrastructure?: string[];
  agents?: Array<{ name: string; role: string; email?: string }>;
  relatedContent?: Array<{ type: string; slug: string }>;
  body: string;
}

export interface ParsedHypothesis {
  id: string;
  statement: string;
  status: "proposed" | "testing" | "validated" | "invalidated" | "revised";
  date: string;
  revisesId?: string;
  notes: string;
}

export interface ParsedStreamEntry {
  slug: string;
  title: string;
  date: string;
  type: "update" | "milestone" | "note";
  body: string;
}

export interface ParsedResearchDoc {
  slug: string;
  title: string;
  date: string;
  topics: string[];
  status: "draft" | "review" | "published";
  body: string;
}

// ─── Sync context ────────────────────────────────────────────────────────────

export interface SyncContext {
  contentSlug: string;
  repoOwner: string;
  repoName: string;
  project: ParsedProject | null;
  hypotheses: ParsedHypothesis[];
  streamEntries: ParsedStreamEntry[];
  researchDocs: ParsedResearchDoc[];
}
