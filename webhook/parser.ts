import matter from "gray-matter";
import type {
  ParsedProject,
  ParsedHypothesis,
  ParsedStreamEntry,
  ParsedResearchDoc,
} from "./types";

function asStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string") return [val];
  return [];
}

export function parseProject(raw: string): ParsedProject | null {
  const { data, content } = matter(raw);

  if (!data.title || !data.description || !data.status || !data.classification || !data.topics) {
    return null;
  }

  const validStatuses = ["explore", "build", "open", "closed"];
  if (!validStatuses.includes(data.status)) return null;

  const validClassifications = ["public", "private"];
  if (!validClassifications.includes(data.classification)) return null;

  const topics = asStringArray(data.topics);
  if (topics.length === 0) return null;

  const result: ParsedProject = {
    title: String(data.title),
    description: String(data.description),
    status: data.status,
    classification: data.classification,
    topics,
    body: content.trim(),
  };

  if (data.repo) result.repo = String(data.repo);
  if (data.stack) result.stack = asStringArray(data.stack);
  if (data.infrastructure) result.infrastructure = asStringArray(data.infrastructure);
  if (Array.isArray(data.agents)) {
    result.agents = data.agents
      .filter((a: any) => a.name && a.role)
      .map((a: any) => ({
        name: String(a.name),
        role: String(a.role),
        ...(a.email ? { email: String(a.email) } : {}),
      }));
  }
  if (Array.isArray(data.relatedContent)) {
    result.relatedContent = data.relatedContent
      .filter((r: any) => r.type && r.slug)
      .map((r: any) => ({ type: String(r.type), slug: String(r.slug) }));
  }

  return result;
}

export function parseHypothesis(raw: string): ParsedHypothesis | null {
  const { data, content } = matter(raw);

  if (!data.id || !data.statement || !data.status || !data.date) return null;

  return {
    id: String(data.id),
    statement: String(data.statement),
    status: data.status,
    date: String(data.date),
    ...(data.revises_id || data.revisesId
      ? { revisesId: String(data.revises_id ?? data.revisesId) }
      : {}),
    notes: content.trim(),
  };
}

export function parseStreamEntry(
  raw: string,
  filename: string
): ParsedStreamEntry | null {
  const { data, content } = matter(raw);

  if (!data.title || !data.date || !data.type) return null;

  const slug = filename.replace(/\.md$/, "");

  return {
    slug,
    title: String(data.title),
    date: String(data.date),
    type: data.type,
    body: content.trim(),
  };
}

export function parseResearchDoc(
  raw: string,
  filename: string
): ParsedResearchDoc | null {
  const { data, content } = matter(raw);

  if (!data.title || !data.date || !data.topics || !data.status) return null;

  const slug = filename.replace(/\.md$/, "");

  return {
    slug,
    title: String(data.title),
    date: String(data.date),
    topics: asStringArray(data.topics),
    status: data.status,
    body: content.trim(),
  };
}
