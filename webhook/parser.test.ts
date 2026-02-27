import { describe, it, expect } from "bun:test";
import {
  parseProject,
  parseHypothesis,
  parseStreamEntry,
  parseResearchDoc,
} from "./parser";

describe("parseProject", () => {
  it("parses valid PROJECT.md", () => {
    const content = `---
title: "Test Project"
description: "A test project"
status: "build"
classification: "public"
topics: [ai, testing]
repo: "https://github.com/org/test"
stack: [Bun, TypeScript]
agents:
  - name: "claude-code"
    role: "AI agent"
---

## Overview

This is the project body.`;

    const result = parseProject(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test Project");
    expect(result!.status).toBe("build");
    expect(result!.topics).toEqual(["ai", "testing"]);
    expect(result!.body).toContain("## Overview");
    expect(result!.agents).toHaveLength(1);
    expect(result!.agents![0].name).toBe("claude-code");
  });

  it("returns null for missing required fields", () => {
    const content = `---
title: "No Status"
---
body`;

    expect(parseProject(content)).toBeNull();
  });

  it("handles missing optional fields", () => {
    const content = `---
title: "Minimal"
description: "Minimal project"
status: "explore"
classification: "private"
topics: [test]
---
body`;

    const result = parseProject(content);
    expect(result).not.toBeNull();
    expect(result!.stack).toBeUndefined();
    expect(result!.agents).toBeUndefined();
  });
});

describe("parseHypothesis", () => {
  it("parses valid hypothesis", () => {
    const content = `---
id: "h001"
statement: "Redis locking is sufficient"
status: "proposed"
date: "2026-02-19"
---

## Context

Details here.`;

    const result = parseHypothesis(content);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("h001");
    expect(result!.status).toBe("proposed");
    expect(result!.notes).toContain("## Context");
  });

  it("returns null for missing required fields", () => {
    expect(parseHypothesis("---\nid: h001\n---\nbody")).toBeNull();
  });
});

describe("parseStreamEntry", () => {
  it("parses valid stream entry with slug from filename", () => {
    const content = `---
title: "Prototype deployed"
date: "2026-02-15"
type: "milestone"
---

First working prototype.`;

    const result = parseStreamEntry(content, "2026-02-15-prototype-deployed.md");
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("2026-02-15-prototype-deployed");
    expect(result!.type).toBe("milestone");
  });
});

describe("parseResearchDoc", () => {
  it("parses valid research doc", () => {
    const content = `---
title: "Distributed Locking"
date: "2026-02-19"
topics: [distributed-systems, redis]
status: "published"
---

## Introduction

Research content here.`;

    const result = parseResearchDoc(content, "distributed-locking.md");
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("distributed-locking");
    expect(result!.topics).toEqual(["distributed-systems", "redis"]);
  });
});
