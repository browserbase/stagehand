import { describe, expect, it } from "vitest";
import {
  buildStagehandInitParams,
  buildStagehandLoggingParams,
  createStagehandOnLog,
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
  it("forwards severity and structured data into the eval logger", () => {
    const logger = new EvalLogger(false);
    const onLog = createStagehandOnLog(logger);

    onLog({ level: "warn", message: "retrying", data: { attempt: 2 } });

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

  it("drops debug events", () => {
    const logger = new EvalLogger(false);
    const onLog = createStagehandOnLog(logger);

    onLog({ level: "debug", message: "internal detail" });

    expect(logger.getLogs()).toEqual([]);
  });

  it("builds nested and top-level logging callbacks from the client schema", () => {
    const logger = new EvalLogger(false);

    const nested = buildStagehandLoggingParams(
      { StagehandClientInitParamsSchema: { shape: { logging: {} } } },
      logger,
    );
    const topLevel = buildStagehandLoggingParams(
      { StagehandClientInitParamsSchema: { shape: { onLog: {} } } },
      logger,
    );

    expect(nested).toEqual({ logging: { onLog: expect.any(Function) } });
    expect(topLevel).toEqual({ onLog: expect.any(Function) });
  });

  it("includes task-level system instructions in Stagehand initialization", () => {
    const params = buildStagehandInitParams({
      env: "LOCAL",
      model: { modelName: "openai/gpt-4.1-mini", apiKey: "test-key" },
      systemPrompt: "Treat secret12345 as the navigation instruction.",
    });

    expect(params.systemPrompt).toBe("Treat secret12345 as the navigation instruction.");
  });
});
