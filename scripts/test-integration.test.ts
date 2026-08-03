import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverIntegrationTests,
  groupIntegrationTests,
  parseIntegrationCliArgs,
} from "./test-integration.js";
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

describe("integration CLI arguments", () => {
  it("recognizes listing modes and removes their flags from forwarded arguments", () => {
    expect(parseIntegrationCliArgs(["--list", "--list-groups", "--reporter=verbose"])).toEqual({
      list: true,
      listGroups: true,
      args: ["--reporter=verbose"],
    });
  });

  it("forwards ordinary Vitest arguments unchanged", () => {
    expect(parseIntegrationCliArgs(["locator-fill", "--", "--reporter=verbose"])).toEqual({
      list: false,
      listGroups: false,
      args: ["locator-fill", "--", "--reporter=verbose"],
    });
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

  it("assigns every file to one stable semantic group", () => {
    const fixture = createFixture(["cookies.test.ts", "locator-fill.test.ts", "keyboard.test.ts"]);
    const entries = discoverIntegrationTests(fixture.root, fixture.testsDir);
    const groups = groupIntegrationTests(entries, {
      "local/browser-lifecycle": ["cookies"],
      "local/input": ["keyboard"],
      "local/locators-write": ["locator-fill"],
    });
    const paths = groups.flatMap((group) => group.paths);

    expect(groups.map((group) => group.name)).toEqual([
      "local/browser-lifecycle",
      "local/input",
      "local/locators-write",
    ]);
    expect(new Set(paths)).toEqual(new Set(entries.map((entry) => entry.path)));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("rejects invalid group ownership", () => {
    const fixture = createFixture(["a.test.ts", "b.test.ts"]);
    const entries = discoverIntegrationTests(fixture.root, fixture.testsDir);

    expect(() => groupIntegrationTests(entries, { local: ["a"] })).toThrow(
      "Integration tests missing a group: b",
    );
    expect(() => groupIntegrationTests(entries, { one: ["a"], two: ["a", "b"] })).toThrow(
      "Integration test a has multiple groups",
    );
    expect(() => groupIntegrationTests(entries, { "": ["a"], two: ["a", "b"] })).toThrow(
      "Integration test a has multiple groups",
    );
    expect(() => groupIntegrationTests(entries, { local: ["a", "a", "b"] })).toThrow(
      "Integration test a is listed multiple times in group local",
    );
    expect(() => groupIntegrationTests(entries, { empty: [], local: ["a", "b"] })).toThrow(
      "Integration group empty has no tests",
    );
    expect(() => groupIntegrationTests(entries, { local: ["a", "missing"] })).toThrow(
      "Integration group local references unknown test missing",
    );
  });
});
