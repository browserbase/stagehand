import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import * as mapping from "../services/decisions/mapCopy.js";
import * as client from "../services/decisions/client.js";
import { extract } from "../services/extractService.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const generate = vi.fn(async (_params): Promise<LLMGenerateResult> => ({
    role: "assistant",
    content: { type: "text", text: "result" },
    outputFormat: "json_schema",
    structuredContent: { name: "Example", stars: 0 },
    usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
  }));
  return {
    params: {
      pageId: "test",
      instruction: "Extract the name and stars, if available.",
      schema: z
        .json()
        .parse(z.toJSONSchema(z.object({ name: z.string(), stars: z.number().optional() }))),
      options: { timeout: 1000, cache: false },
    },
    page: {
      captureSnapshot: vi.fn(async () => ({
        combinedTree: "[0-1] heading: Example\n[0-2] text: Stars: 0",
        combinedXpathMap: {},
        combinedUrlMap: {},
      })),
      screenshot: vi.fn(async () => new Uint8Array()),
    },
    decisions: { provider: "typesafe" as const, apiKey: "test" },
    model: { source: "client" as const },
    clientLLMGenerate: generate,
    logger: new StagehandLogger({ tracer: trace.getTracer("decisions-test") }, () => {}),
  };
}

describe("Decisions extract service", () => {
  it("accepts schema-valid mapping, preserves zero and reports decision usage", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(async (config) => {
      config.recordDecisionUsage?.({ inputTokens: 30, outputTokens: 2 });
      return {
        data: { name: "Example", stars: 0 },
        trace: [],
        verdict: { problems: [] },
      };
    });
    const options = setup();
    const result = await extract(options);
    expect(mapping.mapCopyExtract).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instruction: options.params.instruction }),
    );
    expect(result.data).toEqual({ name: "Example", stars: 0 });
    expect(result.metadata.usage).toMatchObject({ inputTokens: 30, outputTokens: 2 });
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
    expect(options.page.captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("preserves omitted optional fields", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockResolvedValue({
      data: { name: "Example" },
      trace: [],
      verdict: { problems: [] },
    });
    expect((await extract(setup())).data).toEqual({ name: "Example" });
  });

  it("preserves custom policy through the ordinary extractor", async () => {
    const mapper = vi.spyOn(mapping, "mapCopyExtract");
    const options = setup();
    const systemPrompt = "Preserve full names including any label prefixes.";
    expect((await extract({ ...options, systemPrompt })).data).toEqual({
      name: "Example",
      stars: 0,
    });
    expect(mapper).not.toHaveBeenCalled();
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(options.clientLLMGenerate.mock.calls[0][0].systemPrompt).toContain(systemPrompt);
  });

  it("falls back after structural problems and includes both paths' usage", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(async (config) => {
      config.recordDecisionUsage?.({ inputTokens: 30, outputTokens: 2 });
      return {
        data: { name: "Wrong" },
        trace: [],
        verdict: { problems: ["group-disagree"] },
      };
    });
    const options = setup();
    const result = await extract(options);
    expect(result.data).toEqual({ name: "Example", stars: 0 });
    expect(result.metadata.usage).toMatchObject({ inputTokens: 40, outputTokens: 4 });
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
    expect(options.clientLLMGenerate.mock.calls[0][0].systemPrompt).toContain(
      "Absence is not zero",
    );
  });

  it("waits for parallel scalar usage before falling back from failed list mapping", async () => {
    let release!: () => void;
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(client, "decide").mockImplementation(async (config, _state, questions) => {
      if ("group" in questions) throw new Error("list mapping failed");
      await reading;
      config.recordDecisionUsage?.({ inputTokens: 30, outputTokens: 2 });
      return {
        model: "test",
        answers: {
          f_name: { type: "choice", choice: "t0", probabilities: { t0: 1 }, confidence: 1 },
        },
        usage: { inputTokens: 30, outputTokens: 2 },
        durationMs: 1,
      };
    });
    const options = setup();
    const pending = extract({
      ...options,
      params: {
        ...options.params,
        schema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
      page: {
        ...options.page,
        captureSnapshot: vi.fn(async () => ({
          combinedTree:
            "[1] heading: Example\n[2] list\n  [3] listitem: Alpha\n  [4] listitem: Beta\n  [5] listitem: Gamma",
          combinedXpathMap: {},
          combinedUrlMap: {},
        })),
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const fallbackCallsBeforeReading = options.clientLLMGenerate.mock.calls.length;
    release();
    const result = await pending;
    expect(fallbackCallsBeforeReading).toBe(0);
    expect(result.metadata.usage).toMatchObject({ inputTokens: 40, outputTokens: 4 });
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid mapping even when its gate accepts", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockResolvedValue({
      data: { name: 42 },
      trace: [],
      verdict: { problems: [] },
    });
    const options = setup();
    expect((await extract(options)).data).toEqual({ name: "Example", stars: 0 });
    expect(options.clientLLMGenerate).toHaveBeenCalledTimes(1);
  });

  it("requires LLM credentials only when the mapper needs fallback", async () => {
    const options = setup();
    const mapper = vi.spyOn(mapping, "mapCopyExtract").mockResolvedValue({
      data: { name: "Example" },
      trace: [],
      verdict: { problems: [] },
    });
    expect((await extract({ ...options, model: undefined })).data).toEqual({ name: "Example" });
    mapper.mockRejectedValueOnce(new Error("unsupported schema"));
    await expect(extract({ ...options, model: undefined })).rejects.toThrow(
      "configured LLM model or Browserbase gateway for fallback",
    );
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
  });

  it("propagates the deadline without starting fallback", async () => {
    vi.spyOn(mapping, "mapCopyExtract").mockImplementation(() => new Promise(() => {}));
    const options = setup();
    await expect(
      extract({ ...options, params: { ...options.params, options: { timeout: 10 } } }),
    ).rejects.toThrow();
    expect(options.clientLLMGenerate).not.toHaveBeenCalled();
  });
});
