import { describe, it, expect } from "bun:test";
import { touchesLoDir, deriveSlugFromRepo } from "./github";

describe("touchesLoDir", () => {
  it("detects .lo/ file changes in commits", () => {
    const commits = [
      { added: [".lo/PROJECT.md"], removed: [], modified: [] },
    ];
    expect(touchesLoDir(commits)).toBe(true);
  });

  it("returns false when no .lo/ files changed", () => {
    const commits = [
      { added: ["src/index.ts"], removed: [], modified: ["README.md"] },
    ];
    expect(touchesLoDir(commits)).toBe(false);
  });

  it("detects .lo/ in modified files", () => {
    const commits = [
      { added: [], removed: [], modified: [".lo/stream/2026-02-26-update.md"] },
    ];
    expect(touchesLoDir(commits)).toBe(true);
  });

  it("detects .lo/ in removed files", () => {
    const commits = [
      { added: [], removed: [".lo/hypotheses/h001.md"], modified: [] },
    ];
    expect(touchesLoDir(commits)).toBe(true);
  });
});

describe("deriveSlugFromRepo", () => {
  it("uses repo name as slug", () => {
    expect(deriveSlugFromRepo("nexus")).toBe("nexus");
  });

  it("lowercases the slug", () => {
    expect(deriveSlugFromRepo("My-Project")).toBe("my-project");
  });
});
