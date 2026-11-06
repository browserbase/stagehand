/**
 * Structural compatibility tests for the @browserbasehq/eve extension with eve 1.0.
 *
 * IMPORTANT: These tests verify build/manifest/schema compatibility only.
 * They do NOT verify that the native tools (run/snapshot/screenshot) work correctly
 * with actual browser operations.
 *
 * Browser E2E Requirement:
 * ========================
 * Full browser E2E tests require BROWSERBASE_API_KEY. This extension uses
 * browserbase.launch() from @browserbasehq/stagehand and has no local browser mode.
 * Without BROWSERBASE_API_KEY, browser operations cannot be tested.
 *
 * What these tests verify:
 * - Extension manifest is correctly generated for eve 1.0 (formatVersion 3)
 * - Tool exports exist with correct structure
 * - Input schemas have expected properties
 *
 * What these tests do NOT verify:
 * - Tool execution against real browsers
 * - run() code execution
 * - snapshot() accessibility tree capture
 * - screenshot() image capture
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import runTool from "../extension/tools/run.js";
import screenshotTool from "../extension/tools/screenshot.js";
import snapshotTool from "../extension/tools/snapshot.js";

const MANIFEST_PATH = new URL("../dist/extension/_manifest.json", import.meta.url);

describe("eve 1.0 extension manifest compatibility", () => {
  it("builds with eve 1.0 manifest format", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

    expect(manifest.kind).toBe("eve-extension");
    expect(manifest.formatVersion).toBe(3);
    expect(manifest.builtWithEve).toMatch(/^1\.0\.0/);
    expect(manifest.contractMajor).toBe(0);
    expect(manifest.build.externalDependencies).toContain("@browserbasehq/sdk");
    expect(manifest.build.externalDependencies).toContain("@browserbasehq/stagehand");
  });
});

describe("eve 1.0 tool structure (NOT execution)", () => {
  it("exports tools with valid eve 1.0 tool structure", () => {
    for (const tool of [runTool, screenshotTool, snapshotTool]) {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("run tool schema accepts code or actions", () => {
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

  it("snapshot tool schema accepts includeIframes option", () => {
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

describe("browser E2E status", () => {
  const hasBrowserbaseKey = !!process.env.BROWSERBASE_API_KEY;

  it("reports browser E2E blocker when credentials unavailable", () => {
    if (!hasBrowserbaseKey) {
      console.log("\n" + "=".repeat(60));
      console.log("BROWSER E2E NOT EXECUTED - CREDENTIALS REQUIRED");
      console.log("=".repeat(60));
      console.log("\nThis extension requires Browserbase for browser operations.");
      console.log("There is no local browser mode.\n");
      console.log("Required credential: BROWSERBASE_API_KEY");
      console.log(`  Current status: ${process.env.BROWSERBASE_API_KEY ? "SET" : "NOT SET"}\n`);
      console.log("Optional credentials:");
      console.log(`  BROWSERBASE_PROJECT_ID: ${process.env.BROWSERBASE_PROJECT_ID ? "SET" : "NOT SET"}`);
      console.log(`  BROWSERBASE_API_URL: ${process.env.BROWSERBASE_API_URL ? "SET" : "NOT SET"}\n`);
      console.log("Without BROWSERBASE_API_KEY, the following cannot be verified:");
      console.log("  - run() code execution against real browser");
      console.log("  - snapshot() accessibility tree capture");
      console.log("  - screenshot() image capture");
      console.log("=".repeat(60) + "\n");
    }
    expect(true).toBe(true);
  });
});
