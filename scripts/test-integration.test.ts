import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverIntegrationTests, shardIntegrationTests } from "./test-integration.js";
import { toSafeName } from "./test-utils.js";

const fixtureRoots: string[] = [];

const createFixture = (files: string[] = []) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "integration-discovery-"));
  fixtureRoots.push(root);
  const testsDir = path.join(root, "packages/server/tests/integration");
  for (const file of files) {
    const fullPath = path.join(testsDir, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "");
  }
  return { root, testsDir };
};

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("toSafeName", () => {
  it.each([
    ["agent/streaming", "agent-streaming"],
    ["a\npath=x", "a-path-x"],
    ["a\rpath=x", "a-path-x"],
    ['agent"streaming', "agent-streaming"],
    ["agent streaming", "agent-streaming"],
  ])("sanitizes %j", (name, expected) => {
    expect(toSafeName(name)).toBe(expected);
  });
});

describe("integration test discovery", () => {
  it("returns an empty list for empty and missing directories", () => {
    const empty = createFixture();
    fs.mkdirSync(empty.testsDir, { recursive: true });
    expect(discoverIntegrationTests(empty.root, empty.testsDir)).toEqual([]);

    const missing = createFixture();
    expect(discoverIntegrationTests(missing.root, missing.testsDir)).toEqual([]);
  });

  it("lists flat and nested tests with CI-safe names", () => {
    const fixture = createFixture([
      "locator-fill.test.ts",
      "a/streaming.test.ts",
      "ignored.spec.ts",
    ]);

    expect(discoverIntegrationTests(fixture.root, fixture.testsDir)).toEqual([
      {
        path: "packages/server/tests/integration/a/streaming.test.ts",
        name: "a/streaming",
        safe_name: "a-streaming",
      },
      {
        path: "packages/server/tests/integration/locator-fill.test.ts",
        name: "locator-fill",
        safe_name: "locator-fill",
      },
    ]);
  });

  it("returns deterministic path ordering across runs", () => {
    const fixture = createFixture(["z.test.ts", "nested/c.test.ts", "a.test.ts"]);
    const first = discoverIntegrationTests(fixture.root, fixture.testsDir);
    const second = discoverIntegrationTests(fixture.root, fixture.testsDir);

    expect(second).toEqual(first);
    expect(first.map((entry) => entry.path)).toEqual(first.map((entry) => entry.path).sort());
  });

  it("balances seven files across at most three lossless shards", () => {
    const fixture = createFixture(Array.from({ length: 7 }, (_, index) => `${index}.test.ts`));
    const entries = discoverIntegrationTests(fixture.root, fixture.testsDir);
    const shards = shardIntegrationTests(entries, 3);
    const paths = shards.flatMap((shard) => shard.paths);

    expect(shards).toHaveLength(3);
    expect(new Set(paths)).toEqual(new Set(entries.map((entry) => entry.path)));
    expect(new Set(paths).size).toBe(paths.length);
    const sizes = shards.map((shard) => shard.paths.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("does not create empty shards when files are fewer than requested", () => {
    const fixture = createFixture(["a.test.ts", "b.test.ts"]);
    const entries = discoverIntegrationTests(fixture.root, fixture.testsDir);
    const shards = shardIntegrationTests(entries, 5);

    expect(shards).toHaveLength(2);
    expect(shards.every((shard) => shard.paths.length > 0)).toBe(true);
  });
});
