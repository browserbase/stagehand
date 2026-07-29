import { describe, expect, it } from "vitest";
import {
  buildStagehandInitParams,
  requireBrowserbaseApiKey,
  resolveModelApiKey,
} from "../initStagehand.js";
import { EvalLogger } from "../logger.js";

describe("Stagehand eval API keys", () => {
  const lookup =
    (values: Record<string, string>) =>
    (name: string): string =>
      values[name] ?? "";

  it("resolves provider keys through a package-aware lookup", () => {
    const keys = lookup({ OPENAI_API_KEY: "openai-key" });

    expect(resolveModelApiKey("openai/gpt-4.1-mini", keys)).toBe("openai-key");
  });

  it("resolves canonical and alias Browserbase keys through the same lookup", () => {
    expect(requireBrowserbaseApiKey(lookup({ BROWSERBASE_API_KEY: "browserbase-key" }))).toBe(
      "browserbase-key",
    );
    expect(requireBrowserbaseApiKey(lookup({ BB_API_KEY: "browserbase-alias-key" }))).toBe(
      "browserbase-alias-key",
    );
  });
});

describe("Stagehand eval logging", () => {
  it("uses the current logging shape and forwards structured data", async () => {
    const logger = new EvalLogger(false);
    const params = buildStagehandInitParams({
      env: "LOCAL",
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
      logger,
    });
    const onLog = params.logging?.onLog;
    expect(onLog).toBeTypeOf("function");

    await onLog?.({ level: "warn", message: "retrying", data: { attempt: 2 } });

    expect(logger.getLogs()).toEqual([
      expect.objectContaining({
        category: "stagehand-sdk",
        level: 1,
        message: "retrying",
        parsedAuxiliary: {
          data: { attempt: 2 },
        },
      }),
    ]);
  });

  it("drops debug events", async () => {
    const logger = new EvalLogger(false);
    const params = buildStagehandInitParams({
      env: "LOCAL",
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
      logger,
    });

    await params.logging?.onLog?.({ level: "debug", message: "internal detail", data: {} });

    expect(logger.getLogs()).toEqual([]);
  });

  it("builds the current Stagehand initialization parameters", () => {
    const params = buildStagehandInitParams({
      env: "LOCAL",
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
      systemPrompt: "Treat secret12345 as the navigation instruction.",
      logger: new EvalLogger(false),
    });

    expect(params).toMatchObject({
      browser: { type: "local", headless: false },
      selfHeal: true,
      systemPrompt: "Treat secret12345 as the navigation instruction.",
      logging: { onLog: expect.any(Function) },
    });
  });
});
