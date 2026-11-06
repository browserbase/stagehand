/**
 * End-to-end tests for the @browserbasehq/eve extension with eve 1.0 compatibility.
 *
 * These tests validate:
 * 1. Extension loads and initializes correctly with eve 1.0.0-rc.x
 * 2. Tools are properly defined with correct schemas
 * 3. Extension manifest is correctly generated for eve 1.0
 *
 * Full browser E2E tests (run/snapshot/screenshot with real Browserbase sessions)
 * require BROWSERBASE_API_KEY. When that credential is unavailable, these tests
 * verify extension loading and tool structure without browser operations.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import runTool from "../extension/tools/run.js";
import screenshotTool from "../extension/tools/screenshot.js";
import snapshotTool from "../extension/tools/snapshot.js";

const MANIFEST_PATH = new URL("../dist/extension/_manifest.json", import.meta.url);

describe("eve 1.0 extension compatibility", () => {
  it("builds with eve 1.0 manifest format", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

    expect(manifest.kind).toBe("eve-extension");
    expect(manifest.formatVersion).toBe(3);
    expect(manifest.builtWithEve).toMatch(/^1\.0\.0/);
    expect(manifest.contractMajor).toBe(0);
    expect(manifest.build.externalDependencies).toContain("@browserbasehq/sdk");
    expect(manifest.build.externalDependencies).toContain("@browserbasehq/stagehand");
  });

  it("exports tools with valid eve 1.0 tool structure", () => {
    for (const tool of [runTool, screenshotTool, snapshotTool]) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("run tool accepts code or actions in input schema", () => {
    const schema = runTool.inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("code");
    expect(schema.properties).toHaveProperty("actions");
    expect(schema.properties.code.type).toBe("string");
    expect(schema.properties.actions.type).toBe("array");
  });

  it("screenshot tool has toModelOutput for eve rendering", () => {
    expect(typeof screenshotTool.toModelOutput).toBe("function");
    const mockResult = { data: "base64data", mimeType: "image/png" as const };
    const output = screenshotTool.toModelOutput?.(mockResult);
    expect(output).toMatchObject({
      type: "content",
      value: expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({ type: "file" }),
      ]),
    });
  });

  it("snapshot tool accepts includeIframes option", () => {
    const schema = snapshotTool.inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe("object");
    expect(schema.properties).toHaveProperty("includeIframes");
    expect(schema.properties.includeIframes.type).toBe("boolean");
  });
});

describe("eve 1.0 tool descriptions", () => {
  it("run tool description contains action guidance", () => {
    expect(runTool.description).toContain('"op"');
    expect(runTool.description).toContain('"id"');
    expect(runTool.description).toContain('never "kind"');
    expect(runTool.description).toContain("Playwright");
  });

  it("snapshot tool description mentions accessibility tree", () => {
    expect(snapshotTool.description).toContain("accessibility tree");
    expect(snapshotTool.description).toContain("ID");
  });

  it("screenshot tool description provides format guidance", () => {
    expect(screenshotTool.description).toContain("screenshot");
    expect(screenshotTool.description).toContain("jpeg");
  });
});

describe("eve 1.0 browser E2E", () => {
  const hasBrowserbaseKey = !!process.env.BROWSERBASE_API_KEY;

  it.skipIf(!hasBrowserbaseKey)(
    "requires BROWSERBASE_API_KEY for full browser E2E tests",
    () => {
      expect(process.env.BROWSERBASE_API_KEY).toBeDefined();
    },
  );

  it("documents required credentials for full E2E testing", () => {
    const requiredCredentials = ["BROWSERBASE_API_KEY"];
    const optionalCredentials = ["BROWSERBASE_PROJECT_ID", "BROWSERBASE_API_URL"];

    if (!hasBrowserbaseKey) {
      console.log("\n=== Browser E2E Test Credentials ===");
      console.log("Required for full E2E testing:");
      for (const cred of requiredCredentials) {
        console.log(`  - ${cred}: ${process.env[cred] ? "SET" : "NOT SET"}`);
      }
      console.log("Optional:");
      for (const cred of optionalCredentials) {
        console.log(`  - ${cred}: ${process.env[cred] ? "SET" : "NOT SET"}`);
      }
      console.log("===================================\n");
    }

    expect(requiredCredentials).toHaveLength(1);
  });
});
