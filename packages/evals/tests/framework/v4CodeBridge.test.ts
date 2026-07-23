import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  startV4CodeController,
  type V4CodeController,
} from "../../framework/v4CodeController.js";

function makeMetricsSdk(metricsMethod: string): {
  directory: string;
  sdkPath: string;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "v4-metrics-bridge-sdk-"),
  );
  const sdkPath = path.join(directory, "index.ts");
  fs.writeFileSync(
    sdkPath,
    `
const page = { pageId: "fixture-page" };
const context = {
  clipboard: {},
  async activePage() { return page; },
  async pages() { return [page]; },
  async newPage() { return page; },
};

export class Stagehand {
  context = context;
  async init() {}
  async close() {}
  ${metricsMethod}
}
`,
  );
  return { directory, sdkPath };
}

async function startMetricsFixture(sdkPath: string): Promise<V4CodeController> {
  return startV4CodeController({
    mode: "ai",
    model: {
      modelName: "anthropic/claude-sonnet-5",
      apiKey: "fixture-key",
    },
    sdkPath,
    startupTimeoutMs: 2_000,
    executeTimeoutMs: 2_000,
    closeTimeoutMs: 2_000,
  });
}

describe("V4 code bridge metrics", () => {
  it("transports a successful snapshot through the real child process", async () => {
    const fixture = makeMetricsSdk(`
      async metrics() {
        return { actPromptTokens: 12, totalInferenceTimeMs: 340 };
      }
    `);
    let controller: V4CodeController | undefined;
    try {
      controller = await startMetricsFixture(fixture.sdkPath);
      await expect(controller.metrics()).resolves.toEqual({
        available: true,
        values: {
          actPromptTokens: 12,
          totalInferenceTimeMs: 340,
        },
      });
    } finally {
      await controller?.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });

  it("returns a rejected runtime metrics call through the real child process", async () => {
    const fixture = makeMetricsSdk(`
      async metrics() {
        throw new Error("fixture metrics failed");
      }
    `);
    let controller: V4CodeController | undefined;
    try {
      controller = await startMetricsFixture(fixture.sdkPath);
      await expect(controller.metrics()).rejects.toThrow(
        "V4 code bridge metrics failed: fixture metrics failed",
      );
    } finally {
      await controller?.close();
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  });
});
