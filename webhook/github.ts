import type { GitHubContentEntry } from "./types";

const GITHUB_API = "https://api.github.com";

export function touchesLoDir(
  commits: Array<{ added: string[]; removed: string[]; modified: string[] }>
): boolean {
  for (const commit of commits) {
    const allFiles = [...commit.added, ...commit.removed, ...commit.modified];
    if (allFiles.some((f) => f.startsWith(".lo/"))) return true;
  }
  return false;
}

export function deriveSlugFromRepo(repoName: string): string {
  return repoName.toLowerCase();
}

export async function fetchDirectoryContents(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<GitHubContentEntry[]> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "lo-content-webhook",
    },
  });

  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  token: string
): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3.raw",
      "User-Agent": "lo-content-webhook",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  return res.text();
}

export interface GitHubContributor {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

export async function fetchContributors(
  owner: string,
  repo: string,
  token: string
): Promise<GitHubContributor[]> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contributors`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "lo-content-webhook",
    },
  });

  if (!res.ok) {
    console.warn(`Failed to fetch contributors: ${res.status}`);
    return [];
  }

  return res.json();
}
